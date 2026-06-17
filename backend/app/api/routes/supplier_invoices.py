import calendar
import os
import httpx
from pathlib import Path
from datetime import datetime, timezone, timedelta, date as date_type
from decimal import Decimal
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Supplier, SupplierInvoice, SupplierInvoiceLineItem, PaymentTermType, Truck, DieselFillUp, BusinessEntity
from app.schemas.schemas import (
    SupplierInvoiceCreate, SupplierInvoiceUpdate, SupplierInvoiceOut,
    SupplierInvoiceLineItemCreate, SupplierInvoiceLineItemOut,
    SupplierStatementGroup, SupplierPayablesDashboard, PendingVerificationInvoice,
    SupplierCurrentPayable, Supplier30DaysPayable,
    BulkImportPayload, BulkImportResult,
    DieselConflict, DieselConflictSide, DieselConflictResolution,
)
from app.services.audit import log_action
from app.services.verification import (
    apply_verify_step, apply_finalize_step, get_verification_display, ensure_not_locked,
    build_initials_cache, intent_from_action,
)
from app.services.diesel_service import DieselCalculationService, diesel_type_for_supplier

router = APIRouter(prefix="/api/supplier-invoices", tags=["supplier-invoices"])

# ── Attachment storage (physical supplier invoice document) ────────────────────
# Mirrors the entity-logo pattern (entities.py) but stores files PRIVATELY: these
# are sensitive financial documents, so they are never served on a public URL —
# the bytes are streamed back through the authenticated GET endpoint below.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ATTACH_BUCKET = "supplier-invoices"

DATABASE_URL = os.getenv("DATABASE_URL", "")
IS_LOCAL = DATABASE_URL.startswith("sqlite") or not SUPABASE_URL

# Private uploads dir — deliberately NOT under static/ (which is mounted at /static)
# so the files are never publicly reachable.
LOCAL_ATTACH_DIR = Path(__file__).resolve().parents[3] / "uploads" / "supplier-invoices"

ALLOWED_ATTACH_TYPES = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}
MAX_ATTACH_BYTES = 10 * 1024 * 1024  # 10 MB


def _attach_save(invoice_id: int, file_bytes: bytes, ext: str, content_type: str) -> str:
    """Persist the file and return its storage key (deterministic per invoice, so a
    re-upload overwrites the previous file)."""
    key = f"si_{invoice_id}.{ext}"
    if IS_LOCAL:
        LOCAL_ATTACH_DIR.mkdir(parents=True, exist_ok=True)
        (LOCAL_ATTACH_DIR / key).write_bytes(file_bytes)
    else:
        upload_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
        resp = httpx.put(
            upload_url, content=file_bytes,
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"Attachment upload failed: {resp.text}")
    return key


def _attach_read(key: str) -> bytes:
    """Read the stored file bytes (local disk or private Supabase object)."""
    if IS_LOCAL:
        path = LOCAL_ATTACH_DIR / key
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Attachment file not found")
        return path.read_bytes()
    download_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
    resp = httpx.get(download_url, headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"})
    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Attachment file not found")
    return resp.content


def _attach_delete(key: str) -> None:
    """Remove the stored file. Best-effort: clearing the DB metadata is what matters."""
    if IS_LOCAL:
        try:
            (LOCAL_ATTACH_DIR / key).unlink(missing_ok=True)
        except OSError:
            pass
    else:
        delete_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
        try:
            httpx.request(
                "DELETE", delete_url,
                headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
            )
        except httpx.HTTPError:
            pass


def _link_fillup_from_slip(db: Session, invoice: SupplierInvoice, slip_number: str) -> None:
    """Set supplier_invoice_id (and invoice_number if known) on the DieselFillUp matching slip_number."""
    if not slip_number:
        return
    fillup = db.query(DieselFillUp).filter(
        DieselFillUp.slip_number == slip_number,
        DieselFillUp.entity_id == invoice.entity_id,
    ).first()
    if fillup:
        fillup.supplier_invoice_id = invoice.id
        if invoice.invoice_number:
            fillup.invoice_number = invoice.invoice_number


def _propagate_invoice_number_to_fillups(db: Session, invoice: SupplierInvoice) -> None:
    """After invoice_number is set/changed, push it to all DieselFillUps linked via sub-line slip numbers."""
    if not invoice.invoice_number:
        return
    for li in invoice.line_items:
        _link_fillup_from_slip(db, invoice, li.item_code)


def _maybe_create_line_fillup(
    db: Session, invoice: SupplierInvoice, li: SupplierInvoiceLineItem, user_id: int
) -> None:
    """Create a diesel fill-up for a line that carries a truck + litres + amount
    but has no fill-up to link to.

    Runs *after* _link_fillup_from_slip, so a slip already captured as a fill-up
    (e.g. Merino's diesel-sheet imports) is linked, not duplicated. This covers
    suppliers like Oukop, whose slip numbers come straight off a statement and
    were never imported as fill-ups — previously their manually-keyed lines
    linked to nothing and never showed under the truck. Mirrors the per-line
    creation in bulk_import_invoices.
    """
    slip = (li.item_code or "").strip()
    if not slip:
        return
    supplier = db.query(Supplier).filter(Supplier.id == invoice.supplier_id).first()
    if not supplier or not supplier.is_diesel_supplier:
        return
    reg = (li.unit or "").strip()
    if not reg or not li.quantity or li.quantity <= 0:
        return
    if not li.amount_excl_vat or li.amount_excl_vat <= 0:
        return

    truck = (
        db.query(Truck)
        .filter(Truck.registration.ilike(reg), Truck.entity_id == invoice.entity_id)
        .first()
    )
    if not truck:
        return

    # Already a fill-up for this slip on this truck (created earlier, or linked
    # just now by _link_fillup_from_slip)? Then only ensure it points at this
    # invoice — never duplicate.
    existing = (
        db.query(DieselFillUp)
        .filter(
            DieselFillUp.slip_number == slip,
            DieselFillUp.truck_id == truck.id,
            DieselFillUp.entity_id == invoice.entity_id,
            DieselFillUp.is_archived != True,
        )
        .first()
    )
    if existing:
        if not existing.supplier_invoice_id:
            existing.supplier_invoice_id = invoice.id
        return

    litres_d = Decimal(str(li.quantity))
    excl_d = Decimal(str(li.amount_excl_vat))
    rate_d = (excl_d / litres_d).quantize(Decimal("0.0001"))
    inv_date = invoice.invoice_date.date() if hasattr(invoice.invoice_date, "date") else invoice.invoice_date
    fillup_date = li.line_date or inv_date

    settings = DieselCalculationService.get_diesel_settings(db, invoice.entity_id)
    admin_fee_pct = Decimal(str(settings.admin_fee_pct)) if settings else Decimal("0")
    apply_admin_fee = settings.apply_admin_fee if settings else False
    amounts = DieselCalculationService.calculate_fillup_amounts(
        litres=litres_d,
        rate_per_litre=rate_d,
        admin_fee_pct=admin_fee_pct,
        apply_admin_fee=apply_admin_fee,
    )

    db.add(DieselFillUp(
        entity_id=invoice.entity_id,
        truck_id=truck.id,
        supplier_id=supplier.id,
        fillup_date=fillup_date,
        litres=litres_d,
        rate_per_litre=rate_d,
        invoice_number=invoice.invoice_number,
        slip_number=slip,
        supplier_invoice_id=invoice.id,
        admin_fee_pct=admin_fee_pct,
        diesel_type=diesel_type_for_supplier(supplier),
        created_by=user_id,
        **amounts,
    ))
    log_action(
        db, "diesel_fillup.auto_created", user_id=user_id,
        entity_id=invoice.entity_id, resource_type="diesel_fillup",
        description=(
            f"Auto-created diesel fill-up from invoice "
            f"{invoice.invoice_number or '(pending)'} line for {truck.registration} "
            f"({litres_d}L, slip {slip})"
        ),
    )


def _recalc_invoice_total(db: Session, invoice: SupplierInvoice) -> None:
    from sqlalchemy import func as sa_func
    result = db.query(
        sa_func.coalesce(sa_func.sum(SupplierInvoiceLineItem.amount_incl_vat), 0)
    ).filter(SupplierInvoiceLineItem.invoice_id == invoice.id).scalar()
    invoice.amount = Decimal(str(result))
    db.commit()
    db.refresh(invoice)


def _json_safe(v):
    """Make a value storable in the audit log's JSON columns."""
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (datetime, date_type)):
        return v.isoformat()
    return v


def _values_equal(current, new) -> bool:
    if isinstance(current, Decimal) or isinstance(new, Decimal):
        try:
            return Decimal(str(current)) == Decimal(str(new))
        except Exception:
            return False
    if isinstance(current, datetime) and isinstance(new, datetime):
        a = current if current.tzinfo else current.replace(tzinfo=timezone.utc)
        b = new if new.tzinfo else new.replace(tzinfo=timezone.utc)
        return a == b
    return current == new


def _changed_values(obj, updates: dict) -> tuple[dict, dict]:
    """Field-level diff of requested `updates` against the current row,
    returned as (old_values, new_values) for the audit log."""
    old, new = {}, {}
    for field, value in updates.items():
        current = getattr(obj, field, None)
        if not _values_equal(current, value):
            old[field] = _json_safe(current)
            new[field] = _json_safe(value)
    return old, new


_LINE_FIELDS = (
    "item_code", "item_description", "quantity", "unit",
    "amount_excl_vat", "amount_incl_vat", "line_date", "sort_order",
)


def _line_snapshot(li: SupplierInvoiceLineItem) -> dict:
    return {f: _json_safe(getattr(li, f)) for f in _LINE_FIELDS}


def _auto_create_diesel_fillup(
    db: Session,
    supplier_invoice: SupplierInvoice,
    supplier: Supplier,
    vehicle_reg: str,
    litres: Decimal,
    invoice_amount: Decimal,
    entity_id: int,
    user_id: int,
) -> Optional[int]:
    """
    Try to create a DieselFillUp linked to a supplier invoice.
    Returns the new fill-up ID, or None if the truck wasn't found or creation failed.

    Uses the same robust registration matcher as the bulk import (space/case-
    insensitive + temp-registration aware) rather than a strict ilike, so a
    single-line capture resolves to the same truck the import would — otherwise
    the fill-up was silently never created and the diesel never showed under the
    truck or in the Diesel module. For top-up suppliers (Merino/Oukop) the typed
    invoice number IS the depot slip, so it's tagged as slip_number — that's what
    lets a later statement import match by slip+truck and fold this capture in
    instead of leaving it as a separate log.
    """
    try:
        truck = _resolve_truck_by_reg(db, entity_id, vehicle_reg)
        if not truck:
            return None

        inv_date = supplier_invoice.invoice_date.date() if hasattr(supplier_invoice.invoice_date, 'date') else supplier_invoice.invoice_date

        slip = (supplier_invoice.invoice_number or "").strip()
        # Only top-up suppliers use the invoice-number field to carry a depot slip;
        # for everyone else it's a genuine invoice number, not a slip.
        slip_number = slip if (slip and diesel_type_for_supplier(supplier) == "topup") else None

        # Link to an existing DieselFillUp rather than duplicating. Prefer a
        # slip+truck match (mirrors the import, and handles a slip already logged
        # via the Diesel module); fall back to supplier+invoice_number for
        # non-top-up suppliers where the number is a real invoice number.
        existing_fillup = None
        if slip_number:
            existing_fillup = db.query(DieselFillUp).filter(
                DieselFillUp.slip_number == slip_number,
                DieselFillUp.truck_id == truck.id,
                DieselFillUp.entity_id == entity_id,
                DieselFillUp.is_archived != True,
            ).first()
        elif slip:
            existing_fillup = db.query(DieselFillUp).filter(
                DieselFillUp.supplier_id == supplier.id,
                DieselFillUp.invoice_number == slip,
            ).first()
        if existing_fillup:
            if not existing_fillup.supplier_invoice_id:
                existing_fillup.supplier_invoice_id = supplier_invoice.id
                db.commit()
            return existing_fillup.id

        # Always derive rate from invoice (ground truth); system rate is for manual fill-ups only
        rate_per_litre = (invoice_amount / litres).quantize(Decimal("0.0001"))

        settings = DieselCalculationService.get_diesel_settings(db, entity_id)
        admin_fee_pct = Decimal(str(settings.admin_fee_pct)) if settings else Decimal("0")
        apply_admin_fee = settings.apply_admin_fee if settings else False

        amounts = DieselCalculationService.calculate_fillup_amounts(
            litres=litres,
            rate_per_litre=rate_per_litre,
            admin_fee_pct=admin_fee_pct,
            apply_admin_fee=apply_admin_fee,
        )

        fillup = DieselFillUp(
            entity_id=entity_id,
            truck_id=truck.id,
            supplier_id=supplier.id,
            fillup_date=inv_date,
            litres=litres,
            rate_per_litre=rate_per_litre,
            invoice_number=supplier_invoice.invoice_number,
            slip_number=slip_number,
            supplier_invoice_id=supplier_invoice.id,
            admin_fee_pct=admin_fee_pct,
            diesel_type=diesel_type_for_supplier(supplier),
            created_by=user_id,
            **amounts,
        )
        db.add(fillup)
        log_action(
            db, "diesel_fillup.auto_created", user_id=user_id,
            entity_id=entity_id, resource_type="diesel_fillup",
            description=f"Auto-created diesel fill-up from invoice {supplier_invoice.invoice_number} for {truck.registration} ({litres}L)",
        )
        db.commit()
        db.refresh(fillup)
        return fillup.id
    except Exception:
        db.rollback()
        return None


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _accessible_entity_ids(user: User) -> Optional[List[int]]:
    if user.role == "admin":
        return None
    return [a.entity_id for a in user.entity_access]


def calculate_supplier_due_date(invoice_date: datetime, payment_term: PaymentTermType) -> datetime:
    """
    current: due by last day of the same calendar month.
    30_days: due on the 7th of the month AFTER the statement (invoice) month.
    """
    if payment_term == PaymentTermType.current:
        last_day = calendar.monthrange(invoice_date.year, invoice_date.month)[1]
        return invoice_date.replace(day=last_day, hour=23, minute=59, second=59, microsecond=0)
    else:  # days_30
        if invoice_date.month == 12:
            return invoice_date.replace(year=invoice_date.year + 1, month=1, day=7,
                                        hour=0, minute=0, second=0, microsecond=0)
        else:
            return invoice_date.replace(month=invoice_date.month + 1, day=7,
                                        hour=0, minute=0, second=0, microsecond=0)


# ── Dashboard summary ─────────────────────────────────────────────────────────
# IMPORTANT: This must be declared BEFORE /{invoice_id} to avoid routing conflict.

@router.get("/dashboard-summary", response_model=SupplierPayablesDashboard)
def get_dashboard_summary(
    entity_id: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)
    now = datetime.now(tz=timezone.utc)
    # Statement period being viewed — defaults to the current month.
    period_month = month or now.month
    period_year  = year or now.year

    # OBHI: don't hide 30-day invoices that fall outside the selected statement
    # month — show every outstanding 30-day payable (original, pre-statement-period
    # behaviour). Other entities stay scoped to the selected period.
    is_obhi = bool(entity_id) and db.query(BusinessEntity.code).filter(
        BusinessEntity.id == entity_id).scalar() == "OBHI"

    # The "Truck/Trailer (purchases)" supplier is shown only in the reports, never
    # on the dashboard — exclude it from every payables figure here. (Matches the
    # slash name only; the separate "Arqs Truck & Trailer" repair vendor stays.)
    exclude_truck_trailer = ~Supplier.name.ilike("%truck/trailer%")

    q = (
        db.query(SupplierInvoice)
        .join(Supplier)
        .filter(
            SupplierInvoice.is_paid == False,
            SupplierInvoice.is_archived != True,
            exclude_truck_trailer,
        )
    )

    if accessible is not None:
        q = q.filter(SupplierInvoice.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(SupplierInvoice.entity_id == entity_id)

    all_unpaid = q.all()

    current_payables: dict = {}       # supplier_id -> {name, total, count}
    days_30_payables: dict = {}       # (supplier_id, year, month) -> {name, total, count, due_date}
    other_period_payables: dict = {}  # (supplier_id, year, month) -> current/cash from other months

    for inv in all_unpaid:
        supplier = inv.supplier
        term = supplier.payment_term
        outstanding = Decimal(str(inv.amount)) - Decimal(str(inv.deposit_paid or 0))
        if outstanding <= 0:
            continue

        if term == PaymentTermType.current:
            stmt_m = inv.statement_month or inv.invoice_date.month
            stmt_y = inv.statement_year  or inv.invoice_date.year
            if stmt_m == period_month and stmt_y == period_year:
                # Statement period matches the selected period — normal bucket
                key = inv.supplier_id
                if key not in current_payables:
                    current_payables[key] = {"supplier_name": supplier.name, "total": Decimal("0"), "count": 0}
                current_payables[key]["total"] += outstanding
                current_payables[key]["count"] += 1
            else:
                # Statement period is a different month — flag for visibility
                key = (inv.supplier_id, stmt_y, stmt_m)
                if key not in other_period_payables:
                    other_period_payables[key] = {
                        "supplier_name": supplier.name,
                        "invoice_month": stmt_m,
                        "invoice_year": stmt_y,
                        "total": Decimal("0"),
                        "count": 0,
                    }
                other_period_payables[key]["total"] += outstanding
                other_period_payables[key]["count"] += 1
        else:  # days_30 — scoped to the selected statement period (except OBHI)
            stmt_m = inv.statement_month or inv.invoice_date.month
            stmt_y = inv.statement_year  or inv.invoice_date.year
            if not is_obhi and (stmt_m != period_month or stmt_y != period_year):
                continue
            key = (inv.supplier_id, inv.statement_year, inv.statement_month)
            if key not in days_30_payables:
                days_30_payables[key] = {
                    "supplier_name": supplier.name,
                    "statement_month": inv.statement_month,
                    "statement_year": inv.statement_year,
                    "total": Decimal("0"),
                    "count": 0,
                    "due_date": inv.payment_due_date,
                }
            days_30_payables[key]["total"] += outstanding
            days_30_payables[key]["count"] += 1

    current_list = [
        SupplierCurrentPayable(
            supplier_id=sid,
            supplier_name=v["supplier_name"],
            total_outstanding=v["total"],
            invoice_count=v["count"],
        )
        for sid, v in current_payables.items()
    ]
    days30_list = [
        Supplier30DaysPayable(
            supplier_id=k[0],
            supplier_name=v["supplier_name"],
            statement_month=v["statement_month"],
            statement_year=v["statement_year"],
            total_outstanding=v["total"],
            due_date=v["due_date"],
            invoice_count=v["count"],
        )
        for k, v in days_30_payables.items()
    ]

    other_period_list = [
        SupplierCurrentPayable(
            supplier_id=k[0],
            supplier_name=v["supplier_name"],
            total_outstanding=v["total"],
            invoice_count=v["count"],
            invoice_month=v["invoice_month"],
            invoice_year=v["invoice_year"],
        )
        for k, v in sorted(other_period_payables.items(), key=lambda x: (x[0][1], x[0][2]))
    ]

    total_current = sum(x.total_outstanding for x in current_list)
    total_30 = sum(x.total_outstanding for x in days30_list)

    # True outstanding: every unpaid invoice regardless of term or date filter
    total_all_outstanding = sum(
        max(Decimal(str(inv.amount)) - Decimal(str(inv.deposit_paid or 0)), Decimal("0"))
        for inv in all_unpaid
    )

    paid_q = db.query(SupplierInvoice).join(Supplier).filter(
        SupplierInvoice.is_paid == True,
        SupplierInvoice.paid_date != None,
        exclude_truck_trailer,
    )
    if accessible is not None:
        paid_q = paid_q.filter(SupplierInvoice.entity_id.in_(accessible))
    if entity_id:
        paid_q = paid_q.filter(SupplierInvoice.entity_id == entity_id)
    paid_this_month = sum(
        inv.amount for inv in paid_q.all()
        if inv.paid_date and inv.paid_date.month == period_month and inv.paid_date.year == period_year
    )

    return SupplierPayablesDashboard(
        current_payables=current_list,
        days_30_payables=days30_list,
        other_period_payables=other_period_list,
        total_current=total_current,
        total_30_days=total_30,
        total_paid_this_month=Decimal(str(paid_this_month)),
        total_all_outstanding=total_all_outstanding,
    )


# ── List invoices by vehicle reg + month/year (for Profit Sheet) ─────────────

@router.get("/by-vehicle")
def list_invoices_by_vehicle(
    vehicle_reg: str = Query(...),
    month: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = vehicle_reg.strip().upper()

    # Match single-line invoices on the main-line reg, and multi-line/split
    # invoices on any of their sub-line regs (stored in line_items.unit).
    invoices = (
        db.query(SupplierInvoice)
        .options(joinedload(SupplierInvoice.line_items))
        .filter(
            SupplierInvoice.statement_month == month,
            SupplierInvoice.statement_year == year,
            SupplierInvoice.is_archived != True,
            or_(
                SupplierInvoice.vehicle_reg.ilike(vehicle_reg),
                SupplierInvoice.line_items.any(
                    SupplierInvoiceLineItem.unit.ilike(vehicle_reg)
                ),
            ),
        )
        .order_by(SupplierInvoice.invoice_date.asc(), SupplierInvoice.id.asc())
        .all()
    )

    def _amount_for_truck(inv: SupplierInvoice) -> float:
        """Incl-VAT amount of this invoice attributable to the requested reg.

        Multi-line/split invoices with per-sub-line regs contribute only the
        sub-lines matching this truck; everything else contributes its full total.
        """
        if inv.is_multi_line and inv.line_items:
            has_line_reg = any((li.unit or "").strip() for li in inv.line_items)
            if has_line_reg:
                return float(sum(
                    (Decimal(str(li.amount_incl_vat or 0))
                     for li in inv.line_items
                     if (li.unit or "").strip().upper() == target),
                    Decimal("0"),
                ))
        return float(inv.amount)

    result = []
    for inv in invoices:
        amount = _amount_for_truck(inv)
        if amount == 0:
            continue
        result.append({
            "id": inv.id,
            "supplier_name": inv.supplier.name if inv.supplier else None,
            "invoice_number": inv.invoice_number,
            "invoice_date": str(inv.invoice_date) if inv.invoice_date else None,
            "amount": amount,
            "vat_applicable": inv.vat_applicable,
            "is_diesel_supplier": bool(inv.supplier.is_diesel_supplier) if inv.supplier else False,
            "description": inv.description,
        })
    return result


# ── List invoices grouped by statement ───────────────────────────────────────

@router.get("/", response_model=List[SupplierStatementGroup])
def list_supplier_invoices(
    supplier_id: int = Query(...),
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    _check_entity_access(supplier.entity_id, current_user)

    q = db.query(SupplierInvoice).filter(SupplierInvoice.supplier_id == supplier_id, SupplierInvoice.is_archived != True)
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(SupplierInvoice.entity_id == entity_id)

    invoices = q.order_by(
        SupplierInvoice.statement_year.desc(),
        SupplierInvoice.statement_month.desc(),
        SupplierInvoice.invoice_date.asc(),
    ).all()

    # Pre-fetch diesel_fillup_id + slip_number for all invoices in one query
    inv_ids = [i.id for i in invoices]
    fillup_data_by_inv: dict = {}
    if inv_ids:
        rows = (
            db.query(DieselFillUp.supplier_invoice_id, DieselFillUp.id, DieselFillUp.slip_number)
            .filter(DieselFillUp.supplier_invoice_id.in_(inv_ids))
            .all()
        )
        fillup_data_by_inv = {sup_inv_id: {"fillup_id": fid, "slip_number": sn} for sup_inv_id, fid, sn in rows}

    # One query for all verifier initials, reused across every invoice (avoids N+1).
    initials_cache = build_initials_cache(db)

    def _to_out(inv) -> SupplierInvoiceOut:
        out = SupplierInvoiceOut.model_validate(inv)
        fillup_data = fillup_data_by_inv.get(inv.id, {})
        return out.model_copy(update={
            "diesel_fillup_id": fillup_data.get("fillup_id"),
            "slip_number": fillup_data.get("slip_number"),
            "is_multi_line": inv.is_multi_line,
            "line_items": [SupplierInvoiceLineItemOut.model_validate(li) for li in inv.line_items],
            **get_verification_display(db, inv, initials_cache),
        })

    # Group by (year, month)
    groups: dict = {}
    for inv in invoices:
        key = (inv.statement_year, inv.statement_month)
        if key not in groups:
            groups[key] = []
        groups[key].append(inv)

    result = []
    for (year, month), group_invs in groups.items():
        subtotal = sum(i.amount for i in group_invs)
        due_date = group_invs[0].payment_due_date if group_invs else None
        is_fully_paid = all(i.is_paid for i in group_invs)
        result.append(SupplierStatementGroup(
            statement_month=month,
            statement_year=year,
            invoices=[_to_out(i) for i in group_invs],
            subtotal=subtotal,
            payment_due_date=due_date,
            is_fully_paid=is_fully_paid,
        ))

    return result


# ── Pending verification (admin badge/modal) ──────────────────────────────────
# IMPORTANT: declared BEFORE /{invoice_id} so "pending-verification" isn't parsed
# as an invoice id.

@router.get("/pending-verification", response_model=List[PendingVerificationInvoice])
def list_pending_verification(
    days: int = Query(7, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recently-created supplier invoices not yet final-locked (verified3_by is
    null). Defaults to a 7-day window (new arrivals). Scoped to the user's
    accessible entities; newest first."""
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=days)
    q = db.query(SupplierInvoice).filter(
        SupplierInvoice.is_archived != True,
        SupplierInvoice.verified3_by.is_(None),
        SupplierInvoice.created_at >= cutoff,
    )
    accessible = _accessible_entity_ids(current_user)
    if accessible is not None:
        q = q.filter(SupplierInvoice.entity_id.in_(accessible))
    invoices = q.order_by(SupplierInvoice.created_at.desc()).all()

    initials_cache = build_initials_cache(db)
    ent_ids = {i.entity_id for i in invoices}
    ent_codes = {}
    if ent_ids:
        for eid, code in db.query(BusinessEntity.id, BusinessEntity.code).filter(
            BusinessEntity.id.in_(ent_ids)
        ).all():
            ent_codes[eid] = code

    result = []
    for inv in invoices:
        disp = get_verification_display(db, inv, initials_cache)
        name = inv.supplier.name if inv.supplier else (inv.supplier_name_text or "—")
        result.append(PendingVerificationInvoice(
            id=inv.id,
            supplier_id=inv.supplier_id,
            supplier_name=name,
            entity_id=inv.entity_id,
            entity_code=ent_codes.get(inv.entity_id),
            invoice_number=inv.invoice_number,
            invoice_date=inv.invoice_date,
            amount=inv.amount,
            statement_month=inv.statement_month,
            statement_year=inv.statement_year,
            created_at=inv.created_at,
            verified_by_initials=disp.get("verified_by_initials"),
            verified2_by_initials=disp.get("verified2_by_initials"),
        ))
    return result


# ── Single invoice ────────────────────────────────────────────────────────────

@router.get("/{invoice_id}", response_model=SupplierInvoiceOut)
def get_supplier_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)
    fillup = db.query(DieselFillUp).filter(DieselFillUp.supplier_invoice_id == invoice_id).first()
    out = SupplierInvoiceOut.model_validate(inv)
    return out.model_copy(update={
        **get_verification_display(db, inv),
        "slip_number": fillup.slip_number if fillup else None,
        "diesel_fillup_id": fillup.id if fillup else None,
    })


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/", response_model=SupplierInvoiceOut)
def create_supplier_invoice(
    payload: SupplierInvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)

    # A supplier is optional: an expense may instead carry a free-text supplier
    # name (one-off expenses captured against a name, not a registered supplier).
    custom_name = (payload.supplier_name_text or "").strip() or None
    supplier = None
    if payload.supplier_id is not None:
        supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
    elif not custom_name:
        raise HTTPException(
            status_code=422,
            detail="Provide either a supplier or a custom supplier name",
        )

    # Hard block duplicate (registered suppliers only): same supplier + invoice number + entity
    if supplier is not None:
        existing = db.query(SupplierInvoice).filter(
            SupplierInvoice.supplier_id == payload.supplier_id,
            SupplierInvoice.invoice_number == payload.invoice_number.strip(),
            SupplierInvoice.entity_id == payload.entity_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Invoice '{payload.invoice_number}' already exists for this supplier",
            )

    inv_date = payload.invoice_date
    due_date = calculate_supplier_due_date(inv_date, supplier.payment_term) if supplier else None

    # Use whatever statement period the user sent; fall back to the invoice date's
    # own month/year. Payment-term costing offsets belong in reports only.
    stmt_month = payload.statement_month if payload.statement_month is not None else inv_date.month
    stmt_year  = payload.statement_year  if payload.statement_year  is not None else inv_date.year

    inv = SupplierInvoice(
        **payload.model_dump(exclude={'statement_month', 'statement_year', 'supplier_name_text'}),
        supplier_name_text=custom_name if supplier is None else None,
        statement_month=stmt_month,
        statement_year=stmt_year,
        payment_due_date=due_date,
        created_by_id=current_user.id,
    )
    db.add(inv)
    supplier_label = supplier.name if supplier else custom_name
    log_action(
        db, "supplier_invoice.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="supplier_invoice",
        description=f"Created invoice {payload.invoice_number} for supplier {supplier_label}",
    )
    db.commit()
    db.refresh(inv)

    # A fixed (recurring) expense anchors its own carry-forward chain: the origin
    # row's group id is its own id. Later months are cloned with this same id.
    if inv.is_fixed_expense and not inv.fixed_expense_group_id:
        inv.fixed_expense_group_id = inv.id
        db.commit()
        db.refresh(inv)

    # Auto-create DieselFillUp when supplier is a diesel supplier and enough data is provided
    diesel_fillup_id = None
    if supplier and supplier.is_diesel_supplier and payload.vehicle_reg and payload.litres and payload.litres > 0:
        diesel_fillup_id = _auto_create_diesel_fillup(
            db=db,
            supplier_invoice=inv,
            supplier=supplier,
            vehicle_reg=payload.vehicle_reg,
            litres=Decimal(str(payload.litres)),
            invoice_amount=Decimal(str(payload.amount)),
            entity_id=payload.entity_id,
            user_id=current_user.id,
        )

    out = SupplierInvoiceOut.model_validate(inv)
    return out.model_copy(update={"diesel_fillup_id": diesel_fillup_id})


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{invoice_id}", response_model=SupplierInvoiceOut)
def update_supplier_invoice(
    invoice_id: int,
    payload: SupplierInvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)

    updates = payload.model_dump(exclude_none=True)

    # Final-verification lock: only payment-status fields and a free-text note
    # may still change (a note-only edit sends just `notes`).
    ensure_not_locked(inv, updates, {"is_paid", "paid_date", "payment_reference", "notes"})

    # Auto-set verified_at when marking verified
    if updates.get("is_verified") is True and not inv.is_verified:
        updates["verified_at"] = datetime.now(tz=timezone.utc)

    # Recalculate due date if invoice_date changed; only update statement period
    # when the user has not explicitly provided one in this request.
    if "invoice_date" in updates:
        supplier = db.query(Supplier).filter(Supplier.id == inv.supplier_id).first()
        new_date = updates["invoice_date"]
        updates["payment_due_date"] = calculate_supplier_due_date(new_date, supplier.payment_term)
        if "statement_month" not in updates:
            updates["statement_month"] = new_date.month
            updates["statement_year"] = new_date.year

    old_values, new_values = _changed_values(inv, updates)

    for field, value in updates.items():
        setattr(inv, field, value)

    # When invoice_number is filled in (e.g. Pending → confirmed), push to linked fill-ups
    if "invoice_number" in updates and inv.is_multi_line:
        _propagate_invoice_number_to_fillups(db, inv)

    log_action(
        db, "supplier_invoice.updated", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id, description=f"Updated invoice {inv.invoice_number}",
        old_values=old_values or None, new_values=new_values or None,
    )
    db.commit()
    db.refresh(inv)

    # If this edit results in litres + vehicle_reg being present on a single-line
    # diesel invoice with no fill-up yet, create/link it now. The create path only
    # does this when both are filled in up-front; without this, invoices saved
    # first and completed later never get a diesel log (no petrol icon, missing
    # from the truck's Diesel tab). Runs after the commit so a fill-up failure
    # can't roll back the invoice edit.
    if not inv.is_multi_line and inv.vehicle_reg and inv.litres and inv.litres > 0:
        supplier = db.query(Supplier).filter(Supplier.id == inv.supplier_id).first()
        if supplier and supplier.is_diesel_supplier:
            already = db.query(DieselFillUp).filter(
                DieselFillUp.supplier_invoice_id == inv.id
            ).first()
            if not already:
                _auto_create_diesel_fillup(
                    db=db,
                    supplier_invoice=inv,
                    supplier=supplier,
                    vehicle_reg=inv.vehicle_reg,
                    litres=Decimal(str(inv.litres)),
                    invoice_amount=Decimal(str(inv.amount)),
                    entity_id=inv.entity_id,
                    user_id=current_user.id,
                )

    return inv


# ── Verification ──────────────────────────────────────────────────────────────

@router.patch("/{invoice_id}/verify")
def verify_supplier_invoice(
    invoice_id: int,
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)

    before = (inv.verified_by, inv.verified2_by)
    apply_verify_step(inv, current_user, is_admin=(current_user.role == "admin"),
                      desired=intent_from_action(action))
    after = (inv.verified_by, inv.verified2_by)
    # apply_verify_step toggles: log which tick was added or removed. A no-op
    # (stale/contradictory click) leaves state unchanged — don't log it.
    if after != before:
        if after[0] and not before[0]:
            log_act, desc = "supplier_invoice.verified", f"Verified supplier invoice {inv.invoice_number} (step 1)"
        elif after[1] and not before[1]:
            log_act, desc = "supplier_invoice.verified", f"Verified supplier invoice {inv.invoice_number} (step 2)"
        elif before[1] and not after[1]:
            log_act, desc = "supplier_invoice.unverified", f"Removed step-2 verification on supplier invoice {inv.invoice_number}"
        else:
            log_act, desc = "supplier_invoice.unverified", f"Removed step-1 verification on supplier invoice {inv.invoice_number}"
        log_action(
            db, log_act, user_id=current_user.id,
            entity_id=inv.entity_id, resource_type="supplier_invoice",
            resource_id=invoice_id, description=desc,
        )
    db.commit()
    db.refresh(inv)
    d = {c.name: getattr(inv, c.name) for c in inv.__table__.columns}
    d.update(get_verification_display(db, inv))
    d["has_attachment"] = bool(inv.attachment_key)
    return d


@router.patch("/{invoice_id}/finalize")
def finalize_supplier_invoice(
    invoice_id: int,
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)
    was_locked = bool(inv.verified3_by)
    apply_finalize_step(inv, current_user, is_admin=(current_user.role == "admin"),
                        desired=intent_from_action(action))
    locked = bool(inv.verified3_by)
    # Only log when the lock state actually changed (a stale-tab no-op leaves it as-is).
    if locked != was_locked:
        log_action(
            db, "supplier_invoice.finalized" if locked else "supplier_invoice.unfinalized",
            user_id=current_user.id,
            entity_id=inv.entity_id, resource_type="supplier_invoice",
            resource_id=invoice_id,
            description=(f"Applied final lock on supplier invoice {inv.invoice_number}" if locked
                         else f"Removed final lock on supplier invoice {inv.invoice_number}"),
        )
    db.commit()
    db.refresh(inv)
    d = {c.name: getattr(inv, c.name) for c in inv.__table__.columns}
    d.update(get_verification_display(db, inv))
    d["has_attachment"] = bool(inv.attachment_key)
    return d


# ── Archive (soft delete) ─────────────────────────────────────────────────────

@router.patch("/{invoice_id}/archive")
def archive_supplier_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)
    ensure_not_locked(inv)

    inv.is_archived = True
    log_action(
        db, "supplier_invoice.archived", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id, description=f"Archived invoice {inv.invoice_number}",
    )
    db.commit()
    return {"detail": "Invoice archived"}


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{invoice_id}")
def delete_supplier_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)
    ensure_not_locked(inv)

    log_action(
        db, "supplier_invoice.deleted", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id, description=f"Deleted invoice {inv.invoice_number}",
    )
    db.query(DieselFillUp).filter(DieselFillUp.supplier_invoice_id == invoice_id).delete()
    db.delete(inv)
    db.commit()
    return {"detail": "Invoice deleted"}


# ── Mark statement group as paid ──────────────────────────────────────────────

@router.post("/statements/{supplier_id}/{year}/{month}/mark-paid")
def mark_statement_paid(
    supplier_id: int,
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    _check_entity_access(supplier.entity_id, current_user)

    now = datetime.now(tz=timezone.utc)
    unpaid = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.supplier_id == supplier_id,
            SupplierInvoice.statement_year == year,
            SupplierInvoice.statement_month == month,
            SupplierInvoice.is_paid == False,
        )
        .all()
    )

    if not unpaid:
        raise HTTPException(status_code=400, detail="No unpaid invoices in this statement period")

    for inv in unpaid:
        inv.is_paid = True
        inv.paid_date = now

    log_action(
        db, "supplier_invoice.statement_paid", user_id=current_user.id,
        entity_id=supplier.entity_id, resource_type="supplier_invoice",
        description=f"Marked {len(unpaid)} invoices paid for {supplier.name} {month}/{year}",
    )
    db.commit()
    return {"detail": f"{len(unpaid)} invoice(s) marked as paid"}


# ── Line item endpoints ───────────────────────────────────────────────────────

@router.post("/{invoice_id}/line-items", response_model=SupplierInvoiceLineItemOut)
def add_line_item(
    invoice_id: int,
    data: SupplierInvoiceLineItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)
    ensure_not_locked(inv)

    total_before = inv.amount
    li = SupplierInvoiceLineItem(invoice_id=invoice_id, **data.model_dump())
    db.add(li)
    db.flush()
    if data.item_code:
        _link_fillup_from_slip(db, inv, data.item_code)
    _maybe_create_line_fillup(db, inv, li, current_user.id)
    _recalc_invoice_total(db, inv)
    log_action(
        db, "supplier_invoice.line_added", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice", resource_id=inv.id,
        description=(
            f"Added line {li.unit or li.item_description or f'#{li.id}'} "
            f"(R{li.amount_incl_vat}) to invoice {inv.invoice_number}: "
            f"total R{total_before} → R{inv.amount}"
        ),
        new_values={
            "line_id": li.id, **_line_snapshot(li),
            "invoice_amount_before": _json_safe(total_before),
            "invoice_amount_after": _json_safe(inv.amount),
        },
    )
    db.commit()
    db.refresh(li)
    return SupplierInvoiceLineItemOut.model_validate(li)


@router.put("/{invoice_id}/line-items/{line_id}", response_model=SupplierInvoiceLineItemOut)
def update_line_item(
    invoice_id: int,
    line_id: int,
    data: SupplierInvoiceLineItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    li = db.query(SupplierInvoiceLineItem).filter(
        SupplierInvoiceLineItem.id == line_id,
        SupplierInvoiceLineItem.invoice_id == invoice_id,
    ).first()
    if not li:
        raise HTTPException(status_code=404, detail="Line item not found")
    _check_entity_access(li.invoice.entity_id, current_user)
    ensure_not_locked(li.invoice)

    updates = data.model_dump(exclude_unset=True)
    old_values, new_values = _changed_values(li, updates)
    inv = li.invoice
    total_before = inv.amount

    for k, v in updates.items():
        setattr(li, k, v)
    db.flush()
    if data.item_code:
        _link_fillup_from_slip(db, inv, data.item_code)
    _maybe_create_line_fillup(db, inv, li, current_user.id)
    _recalc_invoice_total(db, inv)
    # The edit form re-PUTs every line with re-indexed sort_order on each save —
    # only log when something other than sort_order actually changed.
    if any(k != "sort_order" for k in new_values):
        log_action(
            db, "supplier_invoice.line_updated", user_id=current_user.id,
            entity_id=inv.entity_id, resource_type="supplier_invoice", resource_id=inv.id,
            description=(
                f"Updated line {li.unit or li.item_description or f'#{li.id}'} "
                f"on invoice {inv.invoice_number}: total R{total_before} → R{inv.amount}"
            ),
            old_values={"line_id": li.id, **old_values},
            new_values={
                "line_id": li.id, **new_values,
                "invoice_amount_before": _json_safe(total_before),
                "invoice_amount_after": _json_safe(inv.amount),
            },
        )
        db.commit()
    db.refresh(li)
    return SupplierInvoiceLineItemOut.model_validate(li)


@router.delete("/{invoice_id}/line-items/{line_id}", status_code=204)
def delete_line_item(
    invoice_id: int,
    line_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    li = db.query(SupplierInvoiceLineItem).filter(
        SupplierInvoiceLineItem.id == line_id,
        SupplierInvoiceLineItem.invoice_id == invoice_id,
    ).first()
    if not li:
        raise HTTPException(status_code=404, detail="Line item not found")
    inv = li.invoice
    _check_entity_access(inv.entity_id, current_user)
    ensure_not_locked(inv)
    total_before = inv.amount
    snapshot = {"line_id": li.id, **_line_snapshot(li)}
    label = li.unit or li.item_description or f"#{li.id}"
    db.delete(li)
    db.flush()
    _recalc_invoice_total(db, inv)
    log_action(
        db, "supplier_invoice.line_deleted", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice", resource_id=inv.id,
        description=(
            f"Deleted line {label} (R{snapshot['amount_incl_vat']}) "
            f"from invoice {inv.invoice_number}: total R{total_before} → R{inv.amount}"
        ),
        old_values={
            **snapshot,
            "invoice_amount_before": _json_safe(total_before),
            "invoice_amount_after": _json_safe(inv.amount),
        },
    )
    db.commit()


# ── Attachment (physical invoice document) ─────────────────────────────────────
# Adding/replacing/removing the physical document is allowed even after the final
# lock (verified3_by) — like adding verification ticks, it changes no financial
# figures — so these endpoints deliberately do NOT call ensure_not_locked.

@router.post("/{invoice_id}/attachment", response_model=SupplierInvoiceOut)
async def upload_attachment(
    invoice_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)

    ext = ALLOWED_ATTACH_TYPES.get(file.content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Only PDF, JPG, PNG or WebP files are allowed")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_ATTACH_BYTES:
        raise HTTPException(status_code=400, detail="Attachment must be under 10MB")

    key = _attach_save(invoice_id, file_bytes, ext, file.content_type)

    inv.attachment_key = key
    inv.attachment_filename = file.filename or f"invoice.{ext}"
    inv.attachment_content_type = file.content_type
    inv.attachment_size = len(file_bytes)
    inv.attachment_uploaded_at = datetime.now(timezone.utc)
    inv.attachment_uploaded_by_id = current_user.id

    log_action(
        db, "supplier_invoice.attachment_added", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice", resource_id=inv.id,
        description=f"Attached document '{inv.attachment_filename}' to invoice {inv.invoice_number}",
    )
    db.commit()
    db.refresh(inv)

    fillup = db.query(DieselFillUp).filter(DieselFillUp.supplier_invoice_id == invoice_id).first()
    out = SupplierInvoiceOut.model_validate(inv)
    return out.model_copy(update={
        **get_verification_display(db, inv),
        "slip_number": fillup.slip_number if fillup else None,
        "diesel_fillup_id": fillup.id if fillup else None,
    })


@router.get("/{invoice_id}/attachment")
def view_attachment(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)
    if not inv.attachment_key:
        raise HTTPException(status_code=404, detail="No attachment for this invoice")

    file_bytes = _attach_read(inv.attachment_key)
    filename = inv.attachment_filename or inv.attachment_key
    return Response(
        content=file_bytes,
        media_type=inv.attachment_content_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete("/{invoice_id}/attachment")
def delete_attachment(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)
    if not inv.attachment_key:
        raise HTTPException(status_code=404, detail="No attachment for this invoice")

    removed_name = inv.attachment_filename
    _attach_delete(inv.attachment_key)
    inv.attachment_key = None
    inv.attachment_filename = None
    inv.attachment_content_type = None
    inv.attachment_size = None
    inv.attachment_uploaded_at = None
    inv.attachment_uploaded_by_id = None

    log_action(
        db, "supplier_invoice.attachment_removed", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice", resource_id=inv.id,
        description=f"Removed document '{removed_name}' from invoice {inv.invoice_number}",
    )
    db.commit()
    return {"detail": "Attachment removed"}


def _resolve_truck_by_reg(db: Session, entity_id: int, reg: str) -> Optional[Truck]:
    """Match a truck by real OR temp registration, space- and case-insensitively
    ('KXH 519 MP' from a supplier sheet must match a stored 'KXH519MP'). Without
    this, a formatting difference silently skips the diesel match and leaves the
    pending placeholder behind as a duplicate."""
    target = (reg or '').replace(' ', '').strip().upper()
    if not target:
        return None
    trucks = db.query(Truck).filter(Truck.entity_id == entity_id).all()
    for t in trucks:
        if (t.registration or '').replace(' ', '').strip().upper() == target:
            return t
    for t in trucks:
        if (t.temp_registration or '').replace(' ', '').strip().upper() == target:
            return t
    return None


def _archive_orphaned_placeholder(db: Session, old_inv_id, new_inv_id: int, user_id: int, slip: Optional[str] = None) -> bool:
    """When a bulk import absorbs a slip that was already logged, the fill-up's
    original auto-created placeholder invoice is left orphaned. Archive it so it
    stops showing on the Supplier Profile as a duplicate.

    An auto-created diesel placeholder carries EITHER no invoice number OR the depot
    slip number itself standing in as the number (see diesel._auto_link_or_create_
    supplier_invoice) — both are placeholders. A genuine imported/manual invoice has
    a real number we must never archive. Only touches a single-line placeholder with
    no line items of its own and no fill-ups still pointing at it after the re-link.
    Returns True if archived.
    """
    if not old_inv_id or old_inv_id == new_inv_id:
        return False
    old = db.query(SupplierInvoice).filter(SupplierInvoice.id == old_inv_id).first()
    if not old or old.is_archived:
        return False
    if old.is_multi_line or old.line_items:   # an imported/real invoice — leave it alone
        return False
    number = (old.invoice_number or '').strip()
    slip_norm = (slip or '').strip()
    # A placeholder has no number, or the slip we just absorbed used as a stand-in.
    # Anything else is a real invoice number → not a placeholder.
    if number and number.lower() != slip_norm.lower():
        return False
    remaining = db.query(DieselFillUp).filter(
        DieselFillUp.supplier_invoice_id == old_inv_id,
        DieselFillUp.is_archived != True,
    ).count()
    if remaining > 0:               # still backs other fill-ups
        return False
    old.is_archived = True
    log_action(
        db, "supplier_invoice.placeholder_merged", user_id=user_id,
        entity_id=old.entity_id, resource_type="supplier_invoice", resource_id=old.id,
        description=f"Archived placeholder invoice #{old.id} — its slip was absorbed into imported invoice #{new_inv_id}",
    )
    return True


# ── Bulk import ───────────────────────────────────────────────────────────────

@router.post("/bulk-import", response_model=BulkImportResult)
def bulk_import_invoices(
    payload: BulkImportPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    supplier = db.query(Supplier).filter_by(id=payload.supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    existing_numbers = {
        r[0] for r in db.query(SupplierInvoice.invoice_number).filter(
            SupplierInvoice.supplier_id == payload.supplier_id,
            SupplierInvoice.entity_id == payload.entity_id,
        ).all() if r[0]
    }

    created, skipped, skipped_numbers = 0, 0, []
    diesel_created, diesel_linked = 0, 0
    conflicts: List[DieselConflict] = []

    # Load diesel settings once per entity for fill-up creation
    diesel_settings = DieselCalculationService.get_diesel_settings(db, payload.entity_id)
    admin_fee_pct = Decimal(str(diesel_settings.admin_fee_pct)) if diesel_settings else Decimal("0")
    apply_admin_fee = diesel_settings.apply_admin_fee if diesel_settings else False

    for item in payload.invoices:
        num = (item.invoice_number or '').strip()
        if num in existing_numbers:
            skipped += 1
            skipped_numbers.append(num)
            continue

        inv_date = item.invoice_date
        inv_dt = datetime(inv_date.year, inv_date.month, inv_date.day)
        stmt_month, stmt_year = inv_date.month, inv_date.year

        inv = SupplierInvoice(
            supplier_id=payload.supplier_id,
            entity_id=payload.entity_id,
            invoice_date=inv_dt,
            invoice_number=num or None,
            amount=item.amount,
            vat_applicable=False,
            is_multi_line=True,
            statement_month=stmt_month,
            statement_year=stmt_year,
            payment_due_date=calculate_supplier_due_date(inv_dt, supplier.payment_term),
            created_by_id=current_user.id,
        )
        db.add(inv)
        db.flush()

        for li in item.line_items:
            slip_date_obj: Optional[date_type] = None
            if li.slip_date:
                try:
                    slip_date_obj = date_type.fromisoformat(li.slip_date[:10])
                except (ValueError, TypeError):
                    pass

            db.add(SupplierInvoiceLineItem(
                invoice_id=inv.id,
                item_code=li.item_code,
                item_description=li.item_description,
                unit=li.unit,
                quantity=li.quantity,
                amount_excl_vat=li.amount_excl_vat,
                amount_incl_vat=li.amount_incl_vat,
                sort_order=li.sort_order,
                line_date=slip_date_obj,
            ))

            # ── Diesel fill-up sync ──────────────────────────────────────────
            slip = (li.item_code or '').strip()
            if not slip or not li.unit or not li.quantity or li.quantity <= 0:
                continue
            if not li.amount_excl_vat or li.amount_excl_vat <= 0:
                continue

            litres_d = Decimal(str(li.quantity))
            excl_d   = Decimal(str(li.amount_excl_vat))
            rate_d   = (excl_d / litres_d).quantize(Decimal("0.0001"))
            fillup_date = slip_date_obj or inv_date

            # Resolve the truck first so the duplicate check is scoped to the
            # correct registration — the same slip number can legitimately appear
            # for different trucks, so matching on slip+entity alone would wrongly
            # block creation for a truck that hasn't been imported yet. Matches
            # space/case-insensitively and on temp registrations so a sheet's
            # formatting can't drop the match and orphan the placeholder.
            truck = _resolve_truck_by_reg(db, payload.entity_id, li.unit)
            if not truck:
                continue

            # Use the rate from the Excel rate column if supplied; fall back to
            # back-computing from amount÷litres.
            if li.rate_per_litre and li.rate_per_litre > 0:
                rate_d = Decimal(str(li.rate_per_litre)).quantize(Decimal("0.0001"))

            # Match a fill-up already logged for this slip + truck, regardless of the
            # date it was captured on (a slip number uniquely identifies one fuel
            # transaction; the logged date rarely equals the Excel slip date). This
            # lets the import absorb a pre-logged slip — re-linking it to the imported
            # invoice and archiving its pending placeholder — instead of duplicating it.
            existing_fillup = db.query(DieselFillUp).filter(
                DieselFillUp.slip_number == slip,
                DieselFillUp.truck_id == truck.id,
                DieselFillUp.entity_id == payload.entity_id,
                DieselFillUp.is_archived != True,
            ).order_by(DieselFillUp.fillup_date.desc()).first()

            if existing_fillup:
                litres_mismatch = abs(float(existing_fillup.litres or 0) - float(litres_d)) > 0.01
                # Even when litres agree, a different rate/amount is a real discrepancy
                # (one side has the wrong price) — surface it for review rather than
                # silently keeping the originally-logged figure. Compare the diesel
                # cost (litres × rate), which is what both the fill-up amount and the
                # import's amount_excl_vat represent.
                amount_mismatch = abs(float(existing_fillup.amount or 0) - float(excl_d)) > 0.01
                if litres_mismatch or amount_mismatch:
                    # Same truck + slip but different litres or amount — flag as conflict.
                    conflicts.append(DieselConflict(
                        slip_number=slip,
                        fillup_id=existing_fillup.id,
                        invoice_id=inv.id,
                        invoice_number=num or None,
                        existing=DieselConflictSide(
                            litres=Decimal(str(existing_fillup.litres)),
                            rate_per_litre=Decimal(str(existing_fillup.rate_per_litre)),
                            amount=Decimal(str(existing_fillup.amount)),
                            fillup_date=existing_fillup.fillup_date,
                            truck_registration=existing_fillup.truck.registration if existing_fillup.truck else None,
                        ),
                        incoming=DieselConflictSide(
                            litres=litres_d,
                            rate_per_litre=rate_d,
                            amount=excl_d,
                            fillup_date=fillup_date,
                            truck_registration=(li.unit or '').strip().upper(),
                        ),
                    ))
                else:
                    # Same truck, same slip, same litres — re-link the fill-up to the
                    # imported invoice, then archive the placeholder invoice it was
                    # auto-created under (otherwise it lingers as a duplicate "Pending"
                    # row on the Supplier Profile).
                    old_inv_id = existing_fillup.supplier_invoice_id
                    existing_fillup.invoice_number = num or None
                    existing_fillup.supplier_invoice_id = inv.id
                    diesel_linked += 1
                    _archive_orphaned_placeholder(db, old_inv_id, inv.id, current_user.id, slip=slip)
                continue

            amounts = DieselCalculationService.calculate_fillup_amounts(
                litres=litres_d,
                rate_per_litre=rate_d,
                admin_fee_pct=admin_fee_pct,
                apply_admin_fee=apply_admin_fee,
            )
            db.add(DieselFillUp(
                entity_id=payload.entity_id,
                truck_id=truck.id,
                supplier_id=payload.supplier_id,
                fillup_date=fillup_date,
                litres=litres_d,
                rate_per_litre=rate_d,
                invoice_number=num or None,
                slip_number=slip,
                supplier_invoice_id=inv.id,
                admin_fee_pct=admin_fee_pct,
                diesel_type=diesel_type_for_supplier(supplier),
                created_by=current_user.id,
                **amounts,
            ))
            diesel_created += 1

        db.flush()
        _recalc_invoice_total(db, inv)
        existing_numbers.add(num)
        created += 1

    log_action(
        db, "supplier_invoice.bulk_imported",
        user_id=current_user.id, entity_id=payload.entity_id,
        resource_type="supplier_invoice",
        description=(
            f"Bulk imported {created} invoices for {supplier.name}; "
            f"{diesel_created} diesel records created, {diesel_linked} linked"
        ),
    )
    db.commit()
    return BulkImportResult(
        created=created, skipped=skipped, skipped_numbers=skipped_numbers,
        diesel_created=diesel_created, diesel_linked=diesel_linked,
        conflicts=conflicts,
    )


# ── Diesel conflict resolution ────────────────────────────────────────────────

@router.post("/resolve-diesel-conflicts")
def resolve_diesel_conflicts(
    resolutions: List[DieselConflictResolution],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resolved = 0
    for res in resolutions:
        fillup = db.query(DieselFillUp).filter_by(id=res.fillup_id).first()
        invoice = db.query(SupplierInvoice).filter_by(id=res.invoice_id).first()
        if not fillup or not invoice:
            continue
        _check_entity_access(fillup.entity_id, current_user)

        # Re-link the fill-up to the resolved invoice, then archive the placeholder
        # it was auto-created under (same orphan the import's re-link branch clears —
        # the conflict path bypasses that, so do it here too).
        old_inv_id = fillup.supplier_invoice_id
        fillup.invoice_number = invoice.invoice_number
        fillup.supplier_invoice_id = invoice.id
        _archive_orphaned_placeholder(
            db, old_inv_id, invoice.id, current_user.id, slip=fillup.slip_number,
        )

        if res.use_import_values and res.litres and res.rate_per_litre:
            litres_d = Decimal(str(res.litres))
            rate_d   = Decimal(str(res.rate_per_litre))
            settings = DieselCalculationService.get_diesel_settings(db, fillup.entity_id)
            admin_fee_pct  = Decimal(str(settings.admin_fee_pct)) if settings else Decimal("0")
            apply_admin_fee = settings.apply_admin_fee if settings else False
            amounts = DieselCalculationService.calculate_fillup_amounts(
                litres=litres_d,
                rate_per_litre=rate_d,
                admin_fee_pct=admin_fee_pct,
                apply_admin_fee=apply_admin_fee,
            )
            fillup.litres = litres_d
            fillup.rate_per_litre = rate_d
            if res.fillup_date:
                fillup.fillup_date = res.fillup_date
            for k, v in amounts.items():
                setattr(fillup, k, v)

        resolved += 1

    db.commit()
    return {"resolved": resolved}

