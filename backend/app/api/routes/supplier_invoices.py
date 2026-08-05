import calendar
from datetime import datetime, timezone, timedelta, date as date_type
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy import or_, func
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Supplier, SupplierInvoice, SupplierInvoiceLineItem, SupplierStatement, PaymentTermType, Truck, TruckLoad, DieselFillUp, BusinessEntity
from app.schemas.schemas import (
    SupplierInvoiceCreate, SupplierInvoiceUpdate, SupplierInvoiceOut,
    SupplierInvoicePeriodUpdate,
    SupplierInvoiceLineItemCreate, SupplierInvoiceLineItemOut,
    SupplierStatementGroup, SupplierStatementOut, SupplierStatementNoteUpdate,
    SupplierPayablesDashboard, PendingVerificationInvoice,
    SupplierCurrentPayable, Supplier30DaysPayable, SupplierInvoiceLineSummary,
    BulkImportPayload, BulkImportResult,
    DieselConflict, DieselConflictSide, DieselConflictResolution,
)
from app.services.audit import log_action
from app.services.costing_sent import (
    ensure_not_on_sent_costing, build_sent_map, natural_invoice_period, roll_past_sent,
)
from app.services.verification import (
    apply_verify_step, apply_finalize_step, get_verification_display, ensure_not_locked,
    build_initials_cache, intent_from_action,
)
from app.services.diesel_service import DieselCalculationService, diesel_type_for_supplier
from app.services.diesel_lock import is_invoice_locked, locked_invoice_ids
from app.services.supplier_invoice_attachments import (
    MAX_ATTACH_BYTES,
    resolve_attach_type as _resolve_attach_type,
    save_attachment as _attach_save,
    read_attachment as _attach_read,
    delete_attachment as _attach_delete,
)

router = APIRouter(prefix="/api/supplier-invoices", tags=["supplier-invoices"])


def _norm_slip(s: Optional[str]) -> str:
    """Normalise a slip / depot code for matching: drop spaces, upper-case.

    Mirrors _resolve_truck_by_reg's reg normalisation. A diesel-sheet slip and the
    same slip on the supplier statement (item_code) routinely differ only by case
    or stray spaces; without this, absorption silently fails to find the pre-logged
    fill-up, creates a second one under the statement invoice, and leaves the
    placeholder behind as a duplicate on the Supplier Profile."""
    return (s or '').replace(' ', '').strip().upper()


def _slip_eq(value: str):
    """SQLAlchemy predicate matching a DieselFillUp's depot slip to `value`,
    space- and case-insensitively (DB-side; works on SQLite and PostgreSQL).

    Matches on depot_slip_number, the authoritative printed-slip field
    (migration 109) — every creation path in this file sets it, defaulting to
    slip_number when no separate value is supplied, so it's never null. Some
    older/backfilled rows (e.g. Intsimbi, where slip_number instead holds the
    system Trans ID) only agree with an import's parsed slip on this column;
    matching on slip_number there always misses and creates a duplicate."""
    return func.upper(func.replace(DieselFillUp.depot_slip_number, ' ', '')) == _norm_slip(value)


def _transid_eq(value: str):
    """SQLAlchemy predicate matching a DieselFillUp's TransID (stored in slip_number
    for Intsimbi) to `value`, space/case-insensitively DB-side.

    A printed depot slip can cover several pump transactions, so only the TransID
    uniquely identifies one fill. The Intsimbi importer keys off it so a re-import
    updates each transaction in place instead of duplicating it."""
    return func.upper(func.replace(DieselFillUp.slip_number, ' ', '')) == _norm_slip(value)


def _clear_intsimbi_slip_placeholders(
    db: Session, entity_id: int, supplier_id: int, slip: str, new_inv_id: int, user_id: int
) -> int:
    """Archive any pre-import "lump" fill-up captured under a printed slip.

    Intsimbi statements break a printed slip into one fill-up per TransID, but the
    user's pre-statement capture is a single lump keyed by the printed slip itself
    (its slip_number IS the slip, or it has no TransID). Left in place, that lump
    double-counts against the per-transaction fill-ups the import creates. Archive
    it — and its single-line placeholder invoice — so the import's records replace
    it. Genuine already-imported transactions (slip_number holds a real TransID that
    differs from the printed slip) are left alone; the TransID match handles those."""
    if not slip:
        return 0
    norm = _norm_slip(slip)
    candidates = db.query(DieselFillUp).filter(
        _slip_eq(slip),
        DieselFillUp.entity_id == entity_id,
        DieselFillUp.supplier_id == supplier_id,
        DieselFillUp.is_archived != True,
    ).all()
    cleared = 0
    for fu in candidates:
        sn = _norm_slip(fu.slip_number)
        if sn and sn != norm:
            continue  # a real TransID → a genuine transaction, not a lump placeholder
        old_inv_id = fu.supplier_invoice_id
        fu.is_archived = True
        _archive_orphaned_placeholder(db, old_inv_id, new_inv_id, user_id, slip=slip)
        cleared += 1
    return cleared


def _is_placeholder_invoice(db: Session, inv_id: Optional[int], slip: Optional[str]) -> bool:
    """True if inv_id is an auto-created diesel placeholder (single-line, no line
    items, and either no number or the depot slip standing in as the number) — the
    same test _archive_orphaned_placeholder uses to decide what it may archive.
    A recycled slip may absorb one of these; it must never re-point a real invoice."""
    if not inv_id:
        return False
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == inv_id).first()
    if not inv or inv.is_multi_line or inv.line_items:
        return False
    number = _norm_slip(inv.invoice_number)
    return (not number) or number == _norm_slip(slip)


def _link_fillup_from_slip(db: Session, invoice: SupplierInvoice, li: SupplierInvoiceLineItem, user_id: int) -> None:
    """Re-link the DieselFillUp matching this line's slip to this invoice (and copy its
    invoice_number), then archive the placeholder invoice the fill-up was previously
    auto-created under.

    Without the archive step a manually-captured multi-line invoice (e.g. a Merino/
    Oukop statement) re-points the fill-up but leaves its old single-line placeholder
    behind, so it lingers as a "Pending" duplicate on the Supplier Profile — exactly
    the symptom the bulk import already guards against.

    A slip number does NOT uniquely identify a fill-up: depots (WBG especially)
    recycle slip numbers across different trucks and dates. So scope the match to the
    line's truck and prefer the fill-up logged on the line's date — otherwise a reused
    slip would re-point (and steal) the wrong truck/date's fill-up. Fall back to any
    date only within the same truck, so a top-up (Merino/Oukop) pre-log captured on a
    nearby date is still absorbed."""
    slip_number = (li.item_code or "").strip()
    if not slip_number:
        return
    truck = _resolve_truck_by_reg(db, invoice.entity_id, (li.unit or "").strip())
    inv_date = invoice.invoice_date.date() if hasattr(invoice.invoice_date, "date") else invoice.invoice_date
    line_date = li.line_date or inv_date

    base = db.query(DieselFillUp).filter(
        _slip_eq(slip_number),
        DieselFillUp.entity_id == invoice.entity_id,
        DieselFillUp.is_archived != True,
    )
    if truck:
        base = base.filter(DieselFillUp.truck_id == truck.id)
    # Same truck + slip + date is the same fuel transaction — link it straight away.
    fillup = base.filter(DieselFillUp.fillup_date == line_date).first()
    if fillup is None:
        # No exact-date match. Fall back to a same-truck pre-log captured on another
        # date (top-up suppliers log before the statement, often on a nearby date) —
        # but ONLY if it isn't already reconciled onto a different real statement.
        # Without that guard a recycled slip would steal another invoice's fill-up.
        cand = base.order_by(DieselFillUp.fillup_date.desc()).first()
        if cand and (
            cand.supplier_invoice_id in (None, invoice.id)
            or _is_placeholder_invoice(db, cand.supplier_invoice_id, slip_number)
        ):
            fillup = cand
    if not fillup:
        return
    # Re-pointing a fill-up moves it off one invoice and onto another; leave it
    # alone if either side of that move has its diesel locked.
    if is_invoice_locked(db, invoice.id) or is_invoice_locked(db, fillup.supplier_invoice_id):
        return
    old_inv_id = fillup.supplier_invoice_id
    fillup.supplier_invoice_id = invoice.id
    if invoice.invoice_number:
        fillup.invoice_number = invoice.invoice_number
    db.flush()
    _archive_orphaned_placeholder(db, old_inv_id, invoice.id, user_id, slip=slip_number)


def _delete_line_fillups(db: Session, invoice: SupplierInvoice,
                         li: SupplierInvoiceLineItem, user_id: int) -> int:
    """Delete the diesel fill-up(s) this invoice line stands for.

    A diesel statement line IS a fill-up: `_maybe_create_line_fillup` and the bulk
    import create one per line (slip = item_code, truck = unit), and
    `_link_fillup_from_slip` absorbs a slip already logged in the Diesel module.
    Deleting the line without them left the log stranded on the Diesel Log with no
    invoice behind it — the whole-invoice delete already cascades this way.

    Scoped to fill-ups ON THIS INVOICE matching the line's slip (and truck, when the
    registration resolves), so nothing else can be caught. Note a printed slip that
    covers several pump transactions (Intsimbi, keyed by Trans ID) has no per-line
    Trans ID stored, so all of that slip's fill-ups on this invoice go together.
    """
    slip = (li.item_code or "").strip()
    if not slip:
        return 0
    q = db.query(DieselFillUp).filter(
        DieselFillUp.supplier_invoice_id == invoice.id,
        or_(
            _slip_eq(slip),
            func.upper(func.replace(DieselFillUp.slip_number, ' ', '')) == _norm_slip(slip),
        ),
    )
    truck = _resolve_truck_by_reg(db, invoice.entity_id, (li.unit or "").strip())
    if truck:
        q = q.filter(DieselFillUp.truck_id == truck.id)
    fillups = q.all()
    if not fillups:
        return 0

    for f in fillups:
        # Drop the diesel snapshot off any load that was reading from this fill-up
        if f.truckload_id:
            tl = db.query(TruckLoad).filter(TruckLoad.id == f.truckload_id).first()
            if tl:
                tl.diesel_invoice = None
                tl.diesel_litres = None
                tl.diesel_rate = None
        log_action(
            db, "diesel_fillup.deleted", user_id=user_id,
            entity_id=f.entity_id, resource_type="diesel_fillup", resource_id=f.id,
            description=(
                f"Deleted diesel fill-up #{f.id} ({f.litres}L, slip {slip}) with line "
                f"{li.unit or li.item_description or f'#{li.id}'} of invoice "
                f"{invoice.invoice_number or '(pending)'}"
            ),
        )
        db.delete(f)
    return len(fillups)


def _propagate_invoice_number_to_fillups(db: Session, invoice: SupplierInvoice, user_id: int) -> None:
    """After invoice_number is set/changed, push it to all DieselFillUps linked via sub-line slip numbers."""
    if not invoice.invoice_number:
        return
    for li in invoice.line_items:
        _link_fillup_from_slip(db, invoice, li, user_id)


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

    # Use the same robust matcher as the bulk import (space/case-insensitive, temp
    # regs) so a sheet's formatting can't skip the match and orphan a placeholder.
    truck = _resolve_truck_by_reg(db, invoice.entity_id, reg)
    if not truck:
        return

    inv_date = invoice.invoice_date.date() if hasattr(invoice.invoice_date, "date") else invoice.invoice_date
    fillup_date = li.line_date or inv_date

    # This invoice's diesel is locked — leave the Diesel Log alone. The invoice
    # and its line still save; only the fill-up side is skipped.
    if is_invoice_locked(db, invoice.id):
        return

    # Already a fill-up for this slip on this truck (created earlier, or linked
    # just now by _link_fillup_from_slip)? Then only ensure it points at this
    # invoice — never duplicate. A slip number is NOT unique (depots recycle them),
    # so the same slip on a *different date* is a genuinely different fill-up and
    # must not collapse into this one — hence the date match. The second clause
    # still catches a fill-up _link_fillup_from_slip just re-pointed to this
    # invoice (which may sit on a nearby date), so we don't duplicate it.
    existing = (
        db.query(DieselFillUp)
        .filter(
            _slip_eq(slip),
            DieselFillUp.truck_id == truck.id,
            DieselFillUp.entity_id == invoice.entity_id,
            DieselFillUp.is_archived != True,
            or_(
                DieselFillUp.fillup_date == fillup_date,
                DieselFillUp.supplier_invoice_id == invoice.id,
            ),
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
        depot_slip_number=slip,
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

        # This invoice's diesel is locked → don't touch the Diesel Log (the invoice
        # itself still saves; it simply gains no fill-up).
        if is_invoice_locked(db, supplier_invoice.id):
            return None

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
                _slip_eq(slip_number),
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
            depot_slip_number=slip_number,
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


def _check_invoice_access(inv: "SupplierInvoice", user: User):
    """Authorize an action on a supplier invoice.

    Invoices are surfaced (listed) under the *supplier's* entity, so access must
    be gated the same way — otherwise a row that shows on the supplier profile
    can still 403 on upload/view/delete when its own entity_id diverges from the
    supplier's (e.g. captured/imported under another entity). A user is allowed
    if they can access either the supplier's home entity or the invoice's own.
    """
    if user.role == "admin":
        return
    access_ids = {a.entity_id for a in user.entity_access}
    candidates = {inv.entity_id}
    if inv.supplier is not None:
        candidates.add(inv.supplier.entity_id)
    if inv.subcontractor is not None:
        candidates.add(inv.subcontractor.entity_id)
    if access_ids.isdisjoint(candidates):
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

    # The "Truck/Trailer (purchases)" supplier is shown only in the reports, never
    # on the dashboard — exclude it from every payables figure here. (Matches the
    # slash name only; the separate "Arqs Truck & Trailer" repair vendor stays.)
    exclude_truck_trailer = ~Supplier.name.ilike("%truck/trailer%")

    q = (
        db.query(SupplierInvoice)
        .join(Supplier)
        .options(joinedload(SupplierInvoice.entity))
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

    def to_line(inv, outstanding):
        return SupplierInvoiceLineSummary(
            id=inv.id,
            invoice_number=inv.invoice_number,
            supplier_id=inv.supplier_id,
            supplier_name=inv.supplier.name if inv.supplier else (inv.supplier_name_text or "—"),
            entity_code=inv.entity.code if inv.entity else None,
            invoice_date=inv.invoice_date,
            amount=Decimal(str(inv.amount)),
            outstanding_amount=outstanding,
            statement_month=inv.statement_month,
            statement_year=inv.statement_year,
            due_date=inv.payment_due_date,
            paid_date=inv.paid_date,
        )

    current_payables: dict = {}       # supplier_id -> {name, total, count}
    days_30_payables: dict = {}       # (supplier_id, year, month) -> {name, total, count, due_date}
    other_period_payables: dict = {}  # (supplier_id, year, month) -> current/cash from other months
    outstanding_current_invoices: List[SupplierInvoiceLineSummary] = []
    outstanding_days_30_invoices: List[SupplierInvoiceLineSummary] = []

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
                outstanding_current_invoices.append(to_line(inv, outstanding))
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
        else:  # days_30 — scoped to the selected statement period
            stmt_m = inv.statement_month or inv.invoice_date.month
            stmt_y = inv.statement_year  or inv.invoice_date.year
            if stmt_m != period_month or stmt_y != period_year:
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
            outstanding_days_30_invoices.append(to_line(inv, outstanding))

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

    paid_q = (
        db.query(SupplierInvoice)
        .join(Supplier)
        .options(joinedload(SupplierInvoice.entity))
        .filter(
            SupplierInvoice.is_paid == True,
            SupplierInvoice.paid_date != None,
            exclude_truck_trailer,
        )
    )
    if accessible is not None:
        paid_q = paid_q.filter(SupplierInvoice.entity_id.in_(accessible))
    if entity_id:
        paid_q = paid_q.filter(SupplierInvoice.entity_id == entity_id)

    paid_current_invoices: List[SupplierInvoiceLineSummary] = []
    paid_days_30_invoices: List[SupplierInvoiceLineSummary] = []
    for inv in paid_q.all():
        if not (inv.paid_date and inv.paid_date.month == period_month and inv.paid_date.year == period_year):
            continue
        line = to_line(inv, Decimal(str(inv.amount)))
        if inv.supplier.payment_term == PaymentTermType.current:
            paid_current_invoices.append(line)
        else:
            paid_days_30_invoices.append(line)

    total_paid_current = sum((l.amount for l in paid_current_invoices), Decimal("0"))
    total_paid_30_days = sum((l.amount for l in paid_days_30_invoices), Decimal("0"))
    paid_this_month = total_paid_current + total_paid_30_days

    return SupplierPayablesDashboard(
        current_payables=current_list,
        days_30_payables=days30_list,
        other_period_payables=other_period_list,
        total_current=total_current,
        total_30_days=total_30,
        total_paid_this_month=Decimal(str(paid_this_month)),
        total_paid_current=total_paid_current,
        total_paid_30_days=total_paid_30_days,
        total_all_outstanding=total_all_outstanding,
        outstanding_current_invoices=outstanding_current_invoices,
        outstanding_days_30_invoices=outstanding_days_30_invoices,
        paid_current_invoices=paid_current_invoices,
        paid_days_30_invoices=paid_days_30_invoices,
    )


# ── List invoices by vehicle reg + month/year (for Profit Sheet) ─────────────

def invoices_by_vehicle_regs(db: Session, regs, month: int, year: int) -> dict:
    """Supplier-invoice expense lines attributable to each of `regs` for one
    costing period, keyed by upper-case reg.

    This is the batched core of GET /by-vehicle. The Profit Sheet report needs
    the same figure for a whole fleet at once, and calling the single-reg path
    per truck meant one heavy query each — but a second implementation would be
    free to drift from the one the truck's own Profit Sheet tab shows, and these
    two must always agree. So there is one implementation and the endpoint below
    is a one-reg call into it.
    """
    targets = [r.strip().upper() for r in regs if r and r.strip()]
    if not targets:
        return {}
    target_set = set(targets)

    # Resolve each reg to its truck — needed for the entity (the Safetec
    # cash-timing exemption) and the id (the sent-costing roll-forward), the
    # same period rules Costing uses so an invoice lands in the same month on
    # both. A temp plate resolves to the same truck as its real one.
    trucks = (
        db.query(Truck)
        .filter(or_(
            func.upper(Truck.registration).in_(target_set),
            func.upper(Truck.temp_registration).in_(target_set),
        ))
        .all()
    )
    truck_by_reg: dict = {}
    for t in trucks:
        for reg in (t.registration, t.temp_registration):
            key = (reg or "").strip().upper()
            if key in target_set:
                truck_by_reg.setdefault(key, t)

    safetec_ids = {
        e.id for e in db.query(BusinessEntity).filter(
            func.upper(BusinessEntity.code) == "SFT"
        ).all()
    }
    sent_map = build_sent_map(db, [t.id for t in trucks])

    # Candidate window: statement periods from 3 months back (natural periods
    # that may have rolled forward through consecutive sent months into this
    # one) up to next month (cash invoices whose natural period is this month) —
    # mirrors the window used to build subcontractor costing.
    period_idx = year * 12 + (month - 1)
    stmt_idx = SupplierInvoice.statement_year * 12 + (SupplierInvoice.statement_month - 1)

    # Match single-line invoices on the main-line reg, and multi-line/split
    # invoices on any of their sub-line regs (stored in line_items.unit).
    candidates = (
        db.query(SupplierInvoice)
        .options(joinedload(SupplierInvoice.line_items))
        .filter(
            SupplierInvoice.is_archived != True,
            stmt_idx.between(period_idx - 3, period_idx + 1),
            or_(
                func.upper(SupplierInvoice.vehicle_reg).in_(target_set),
                SupplierInvoice.line_items.any(
                    func.upper(SupplierInvoiceLineItem.unit).in_(target_set)
                ),
            ),
        )
        .order_by(SupplierInvoice.invoice_date.asc(), SupplierInvoice.id.asc())
        .all()
    )

    def _in_period(inv: SupplierInvoice, truck) -> bool:
        is_safetec = bool(truck and truck.entity_id in safetec_ids)
        natural = natural_invoice_period(inv, is_safetec)
        if natural is None:
            return False
        if not truck or inv.is_fixed_expense:
            return natural == (year, month)
        return roll_past_sent(natural, truck.id, inv.created_at, sent_map) == (year, month)

    def _amount_for_reg(inv: SupplierInvoice, target: str) -> float:
        """Incl-VAT amount of this invoice attributable to one reg.

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

    result = {t: [] for t in target_set}
    for inv in candidates:
        # Only the regs this invoice actually names — its own vehicle_reg plus
        # any sub-line regs — are considered, so a fleet-wide call attributes
        # each invoice exactly where the single-reg call would have.
        # Uppercased but NOT trimmed, matching the SQL filter above exactly, so a
        # reg with stray whitespace is skipped here just as it is in the query.
        touched = {(inv.vehicle_reg or "").upper()}
        touched |= {(li.unit or "").upper() for li in (inv.line_items or [])}
        for target in touched & target_set:
            if not _in_period(inv, truck_by_reg.get(target)):
                continue
            amount = _amount_for_reg(inv, target)
            if amount == 0:
                continue
            result[target].append({
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


@router.get("/by-vehicle")
def list_invoices_by_vehicle(
    vehicle_reg: str = Query(...),
    month: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = vehicle_reg.strip().upper()
    return invoices_by_vehicle_regs(db, [target], month, year).get(target, [])


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

    # Resolve the owning subcontractor per invoice from its OWN entity's fleet, so
    # the column is correct regardless of which entity is active in the UI. Built
    # once for every entity present in this supplier's invoices (a supplier's rows
    # are usually one entity, but multi-entity captures are possible).
    owner_by_reg = _truck_owner_reg_map(db, {i.entity_id for i in invoices if i.vehicle_reg})

    def _to_out(inv) -> SupplierInvoiceOut:
        out = SupplierInvoiceOut.model_validate(inv)
        fillup_data = fillup_data_by_inv.get(inv.id, {})
        owner = owner_by_reg.get((inv.entity_id, _norm_reg_key(inv.vehicle_reg))) if inv.vehicle_reg else None
        return out.model_copy(update={
            "diesel_fillup_id": fillup_data.get("fillup_id"),
            "slip_number": fillup_data.get("slip_number"),
            "subcontractor_display_name": owner,
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

    # Month-header statements (document + note), keyed the same way as the groups.
    # Fetched for the whole supplier in one query; months without one stay null.
    statements = {
        (st.statement_year, st.statement_month): st
        for st in db.query(SupplierStatement).filter(SupplierStatement.supplier_id == supplier_id).all()
    }

    result = []
    for (year, month), group_invs in groups.items():
        subtotal = sum(i.amount for i in group_invs)
        due_date = group_invs[0].payment_due_date if group_invs else None
        is_fully_paid = all(i.is_paid for i in group_invs)
        st = statements.get((year, month))
        result.append(SupplierStatementGroup(
            statement_month=month,
            statement_year=year,
            invoices=[_to_out(i) for i in group_invs],
            subtotal=subtotal,
            payment_due_date=due_date,
            is_fully_paid=is_fully_paid,
            statement=_statement_out(db, st) if st else None,
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
    accessible entities; newest first. Includes one-off expenses (captured
    against a free-text name) flagged with their originating module."""
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=days)
    q = db.query(SupplierInvoice).filter(
        SupplierInvoice.is_archived != True,
        SupplierInvoice.verified3_by.is_(None),
        SupplierInvoice.verify_skipped != True,
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

    # One-off expenses are captured on a subcontractor's costing sheet and
    # attached via the truck's reg. Build a (entity, normalised-reg) →
    # subcontractor map once so each row can deep-link back to that sheet.
    reg_to_sub = _subcontractor_reg_map(
        db, {i.entity_id for i in invoices if i.supplier_id is None and i.vehicle_reg}
    )

    result = []
    for inv in invoices:
        disp = get_verification_display(db, inv, initials_cache)
        is_one_off = inv.supplier_id is None
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
            is_one_off=is_one_off,
            source_module=_one_off_source_module(inv) if is_one_off else None,
            source_url=_one_off_source_url(inv, reg_to_sub) if is_one_off else None,
            verified_by_initials=disp.get("verified_by_initials"),
            verified2_by_initials=disp.get("verified2_by_initials"),
        ))
    return result


@router.post("/{invoice_id}/skip-verification")
def skip_pending_verification(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dismiss an invoice from the admin 'to verify' list without final-locking
    it. The invoice is otherwise untouched and can still be verified normally.
    Idempotent — already-skipped invoices return cleanly."""
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_invoice_access(inv, current_user)

    if not inv.verify_skipped:
        inv.verify_skipped = True
        inv.verify_skipped_by = current_user.id
        inv.verify_skipped_at = datetime.now(tz=timezone.utc)
        log_action(
            db, "supplier_invoice.verify_skipped", user_id=current_user.id,
            entity_id=inv.entity_id, resource_type="supplier_invoice",
            resource_id=invoice_id,
            description=f"Skipped invoice {inv.invoice_number or '(no number)'} from the verify list",
        )
        db.commit()
    return {"detail": "Invoice skipped"}


def _one_off_source_module(inv: SupplierInvoice) -> str:
    """Best-effort label for where a one-off (no registered supplier) expense was
    captured, inferred from its distinguishing columns."""
    if inv.subcontractor_id is not None:
        return "Subcontractor"
    if inv.is_fixed_expense:
        return "Fixed expense"
    if inv.litres is not None:
        return "Diesel"
    return "Costing"


def _norm_reg_key(reg: Optional[str]) -> str:
    return (reg or "").replace(" ", "").strip().upper()


def _subcontractor_reg_map(db: Session, entity_ids: set) -> dict:
    """{(entity_id, normalised_reg): subcontractor_id} for every subcontractor
    truck in the given entities — both real and temp plates."""
    if not entity_ids:
        return {}
    mapping: dict = {}
    trucks = db.query(Truck).filter(
        Truck.subcontractor_id.isnot(None),
        Truck.entity_id.in_(entity_ids),
    ).all()
    for t in trucks:
        for reg in (t.registration, t.temp_registration):
            k = _norm_reg_key(reg)
            if k:
                mapping.setdefault((t.entity_id, k), t.subcontractor_id)
    return mapping


def _truck_owner_reg_map(db: Session, entity_ids: set) -> dict:
    """{(entity_id, normalised_reg): owner_display_name} for every truck in the
    given entities — real and temp plates. owner = FK subcontractor name →
    free-text subcontractor_name → operator (mirrors the fleet _enrich_truck
    chain and the frontend's ownerForReg). Real registrations take precedence
    over temp plates (setdefault, registration scanned first)."""
    if not entity_ids:
        return {}
    mapping: dict = {}
    trucks = (
        db.query(Truck)
        .options(joinedload(Truck.subcontractor))
        .filter(Truck.entity_id.in_(entity_ids))
        .all()
    )
    for t in trucks:
        owner = (t.subcontractor.name if t.subcontractor else None) or t.subcontractor_name or t.operator
        if not owner:
            continue
        for reg in (t.registration, t.temp_registration):
            k = _norm_reg_key(reg)
            if k:
                mapping.setdefault((t.entity_id, k), owner)
    return mapping


def _one_off_source_url(inv: SupplierInvoice, reg_to_sub: dict) -> Optional[str]:
    """Deep-link a one-off expense back to the subcontractor costing sheet it was
    captured on (resolved by the truck reg). None if it can't be resolved."""
    if not inv.vehicle_reg:
        return None
    sub_id = reg_to_sub.get((inv.entity_id, _norm_reg_key(inv.vehicle_reg)))
    if not sub_id:
        return None
    params = f"reg={quote(inv.vehicle_reg)}"
    if inv.statement_month and inv.statement_year:
        params += f"&month={inv.statement_month}&year={inv.statement_year}"
    return f"/subcontractors/{sub_id}?{params}"


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
    # No entity gate: an authenticated user who can reach the supplier's invoices
    # may view any of them, regardless of the row's stored entity_id.
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
    _check_invoice_access(inv, current_user)

    updates = payload.model_dump(exclude_none=True)

    # Final-verification lock: only payment-status fields and a free-text note
    # may still change (a note-only edit sends just `notes`).
    ensure_not_locked(inv, updates, {"is_paid", "paid_date", "payment_reference", "notes"})
    # Sent-costing lock: the invoice sits on a costing already sent to a
    # subcontractor — its values may not change. Workflow-status fields and the
    # invoice number (Pending → confirmed) stay editable.
    ensure_not_on_sent_costing(db, inv, updates, {"is_paid", "paid_date", "payment_reference", "notes", "invoice_number"})

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
        _propagate_invoice_number_to_fillups(db, inv, current_user.id)

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


# ── Period overrides ("Manage → Move") ─────────────────────────────────────────

@router.patch("/{invoice_id}/periods", response_model=SupplierInvoiceOut)
def move_supplier_invoice_periods(
    invoice_id: int,
    payload: SupplierInvoicePeriodUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Shift one invoice between months across three independent buckets —
    costing, the SARS / Income-vs-Expenses report, and the supplier-invoice
    listing (statement period). Every bucket is PINNED to exactly the month the
    user specifies: costing bypasses the cash-supplier "previous month" shift and
    the sent-costing roll-forward, so the chosen month is final and no automatic
    rule ever applies. The frontend flags each bucket's current month and sends
    concrete values; a null bucket falls back to the current month (no cash shift).

    This is a period-only change, deliberately allowed even on verified/locked or
    sent-costing invoices (pulling a late invoice OFF an already-sent costing is
    the whole point), and always audit-logged.
    """
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_invoice_access(inv, current_user)

    def _validate_pair(m, y, label):
        if (m is None) != (y is None):
            raise HTTPException(status_code=400, detail=f"{label} month and year must be set together")
        if m is not None and not (1 <= m <= 12):
            raise HTTPException(status_code=400, detail=f"{label} month must be between 1 and 12")

    _validate_pair(payload.costing_month, payload.costing_year, "Costing")
    _validate_pair(payload.report_month, payload.report_year, "Report")
    _validate_pair(payload.statement_month, payload.statement_year, "Statement")

    # The Manage tool pins exactly what the user specifies — no auto/cash rule.
    # The frontend always sends concrete months; if a bucket ever arrives null,
    # fall back to the invoice's current month (existing pin wins) WITHOUT the
    # cash "previous month" shift: costing → statement month, report → invoice date.
    costing_m, costing_y = payload.costing_month, payload.costing_year
    if costing_m is None:
        if inv.costing_period_month and inv.costing_period_year:
            costing_m, costing_y = inv.costing_period_month, inv.costing_period_year
        elif inv.statement_month and inv.statement_year:
            costing_m, costing_y = inv.statement_month, inv.statement_year

    report_m, report_y = payload.report_month, payload.report_year
    if report_m is None:
        if inv.report_period_month and inv.report_period_year:
            report_m, report_y = inv.report_period_month, inv.report_period_year
        elif inv.invoice_date:
            report_m, report_y = inv.invoice_date.month, inv.invoice_date.year

    updates = {
        "costing_period_month": costing_m,
        "costing_period_year": costing_y,
        "report_period_month": report_m,
        "report_period_year": report_y,
    }
    # Listing bucket = statement period. Original keeps the current concrete
    # statement (nothing to recompute); a full pair moves it.
    if payload.statement_month is not None and payload.statement_year is not None:
        updates["statement_month"] = payload.statement_month
        updates["statement_year"] = payload.statement_year

    old_values, new_values = _changed_values(inv, updates)
    for field, value in updates.items():
        setattr(inv, field, value)

    log_action(
        db, "supplier_invoice.periods_moved", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id,
        description=f"Moved periods on invoice {inv.invoice_number or inv.id}",
        old_values=old_values or None, new_values=new_values or None,
    )
    db.commit()
    db.refresh(inv)
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
    _check_invoice_access(inv, current_user)

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
    _check_invoice_access(inv, current_user)
    was_locked = bool(inv.verified3_by)
    # require_step1=False: the admin may final-lock on her own, without a prior
    # step-1 tick. Other users can still add their ticks afterwards (the lock
    # freezes values and existing ticks, not empty steps).
    apply_finalize_step(inv, current_user, is_admin=(current_user.role == "admin"),
                        require_step1=False, desired=intent_from_action(action))
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
    _check_invoice_access(inv, current_user)
    ensure_not_locked(inv)
    ensure_not_on_sent_costing(db, inv)

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
    _check_invoice_access(inv, current_user)
    ensure_not_locked(inv)
    ensure_not_on_sent_costing(db, inv)

    log_action(
        db, "supplier_invoice.deleted", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id, description=f"Deleted invoice {inv.invoice_number}",
    )
    db.query(DieselFillUp).filter(DieselFillUp.supplier_invoice_id == invoice_id).delete()
    db.delete(inv)
    db.commit()
    return {"detail": "Invoice deleted"}


# ── Remove a recurring (fixed) general expense ────────────────────────────────

@router.delete("/{invoice_id}/fixed-expense")
def remove_fixed_expense(
    invoice_id: int,
    scope: str = Query("forward", regex="^(forward|all)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a recurring (fixed) general expense.

    A plain delete on one month's row does not stick: the carry-forward
    (`_materialize_fixed_expenses`) re-creates it from the prior month's active
    occurrence the next time costing loads. This endpoint removes the whole
    chain instead:

    - scope="forward": stop the expense from this occurrence's month onward.
      The target month is archived (a tombstone that breaks the carry-forward
      chain) and any later months in the same group are deleted; earlier months
      are left untouched.
    - scope="all": permanently delete every occurrence across all months.
    """
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_invoice_access(inv, current_user)
    if not inv.is_fixed_expense:
        raise HTTPException(status_code=400, detail="Not a recurring (fixed) expense")

    gid = inv.fixed_expense_group_id or inv.id
    group = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.is_fixed_expense == True,
            SupplierInvoice.supplier_id.is_(None),
            or_(SupplierInvoice.fixed_expense_group_id == gid, SupplierInvoice.id == gid),
        )
        .all()
    )

    def _period(r):
        if r.statement_year is None or r.statement_month is None:
            return None
        return (r.statement_year, r.statement_month)

    target = _period(inv)

    if scope == "all":
        for r in group:
            ensure_not_locked(r)
        for r in group:
            log_action(
                db, "supplier_invoice.deleted", user_id=current_user.id,
                entity_id=r.entity_id, resource_type="supplier_invoice",
                resource_id=r.id, description=f"Removed recurring expense (all months): {r.supplier_name_text or ''}".strip(),
            )
            db.delete(r)
        db.commit()
        return {"detail": "Recurring expense removed from all months"}

    # scope == "forward": archive the target month, delete later months, keep earlier.
    affected = [r for r in group if (p := _period(r)) is not None and target is not None and p >= target]
    for r in affected:
        ensure_not_locked(r)
    for r in affected:
        if _period(r) == target:
            r.is_archived = True
            log_action(
                db, "supplier_invoice.archived", user_id=current_user.id,
                entity_id=r.entity_id, resource_type="supplier_invoice",
                resource_id=r.id, description=f"Stopped recurring expense from {target[1]}/{target[0]}: {r.supplier_name_text or ''}".strip(),
            )
        else:
            log_action(
                db, "supplier_invoice.deleted", user_id=current_user.id,
                entity_id=r.entity_id, resource_type="supplier_invoice",
                resource_id=r.id, description=f"Removed later recurring occurrence: {r.supplier_name_text or ''}".strip(),
            )
            db.delete(r)
    db.commit()
    return {"detail": "Recurring expense stopped from this month onward"}


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


# ── Monthly statement: document + note ────────────────────────────────────────
# The supplier's consolidated statement for a whole month, shown on the month
# header next to the totals. Independent of the per-invoice attachments above and
# of the verification lock — a statement document/note changes no financial
# figures, so these endpoints deliberately do NOT call ensure_not_locked.

def _statement_out(db: Session, st: SupplierStatement) -> SupplierStatementOut:
    """Serialise a statement, resolving the two "by" users to display names."""
    user_ids = {i for i in (st.note_updated_by_id, st.attachment_uploaded_by_id) if i}
    names = {}
    if user_ids:
        names = {
            uid: full_name
            for uid, full_name in db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()
        }
    return SupplierStatementOut(
        id=st.id,
        supplier_id=st.supplier_id,
        statement_month=st.statement_month,
        statement_year=st.statement_year,
        note=st.note,
        note_updated_at=st.note_updated_at,
        note_updated_by_name=names.get(st.note_updated_by_id),
        document_filename=st.attachment_filename,
        document_uploaded_at=st.attachment_uploaded_at,
        document_uploaded_by_name=names.get(st.attachment_uploaded_by_id),
    )


def _statement_supplier(db: Session, supplier_id: int, user: User) -> Supplier:
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    _check_entity_access(supplier.entity_id, user)
    return supplier


def _get_statement(db: Session, supplier_id: int, year: int, month: int) -> Optional[SupplierStatement]:
    return (
        db.query(SupplierStatement)
        .filter(
            SupplierStatement.supplier_id == supplier_id,
            SupplierStatement.statement_year == year,
            SupplierStatement.statement_month == month,
        )
        .first()
    )


def _get_or_create_statement(db: Session, supplier_id: int, year: int, month: int) -> SupplierStatement:
    """Statements are created lazily — a month only gets a row once the user
    actually attaches a document or writes a note for it."""
    st = _get_statement(db, supplier_id, year, month)
    if st is None:
        st = SupplierStatement(supplier_id=supplier_id, statement_year=year, statement_month=month)
        db.add(st)
        db.flush()
    return st


@router.put("/statements/{supplier_id}/{year}/{month}/note", response_model=SupplierStatementOut)
def update_statement_note(
    supplier_id: int,
    year: int,
    month: int,
    data: SupplierStatementNoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add, update or remove the note for a supplier's statement month. A blank
    note clears it; the row itself stays (it may still hold the document)."""
    supplier = _statement_supplier(db, supplier_id, current_user)

    note = (data.note or "").strip() or None
    st = _get_or_create_statement(db, supplier_id, year, month)
    previous = st.note
    st.note = note
    st.note_updated_at = datetime.now(timezone.utc) if note else None
    st.note_updated_by_id = current_user.id if note else None

    verb = "Removed" if not note else ("Updated" if previous else "Added")
    log_action(
        db, "supplier_statement.note_updated", user_id=current_user.id,
        entity_id=supplier.entity_id, resource_type="supplier_statement", resource_id=st.id,
        description=f"{verb} statement note for {supplier.name} {month}/{year}",
        old_values={"note": previous},
        new_values={"note": note},
    )
    db.commit()
    db.refresh(st)
    return _statement_out(db, st)


@router.post("/statements/{supplier_id}/{year}/{month}/document", response_model=SupplierStatementOut)
async def upload_statement_document(
    supplier_id: int,
    year: int,
    month: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload (or replace) the supplier's statement document for the whole month."""
    supplier = _statement_supplier(db, supplier_id, current_user)

    ext, content_type = _resolve_attach_type(file.content_type, file.filename)
    if not ext:
        raise HTTPException(status_code=400, detail="Only PDF, Excel, JPG, PNG or WebP files are allowed")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_ATTACH_BYTES:
        raise HTTPException(status_code=400, detail="Statement must be under 25MB")

    st = _get_or_create_statement(db, supplier_id, year, month)
    # A replacement with a different extension leaves the old object behind —
    # the key is prefix+id+ext, so only a same-extension re-upload overwrites it.
    if st.attachment_key:
        new_key = f"stmt_{st.id}.{ext}"
        if st.attachment_key != new_key:
            _attach_delete(st.attachment_key)

    st.attachment_key = _attach_save(st.id, file_bytes, ext, content_type, prefix="stmt")
    st.attachment_filename = file.filename or f"statement.{ext}"
    st.attachment_content_type = content_type
    st.attachment_size = len(file_bytes)
    st.attachment_uploaded_at = datetime.now(timezone.utc)
    st.attachment_uploaded_by_id = current_user.id

    log_action(
        db, "supplier_statement.document_added", user_id=current_user.id,
        entity_id=supplier.entity_id, resource_type="supplier_statement", resource_id=st.id,
        description=f"Attached statement '{st.attachment_filename}' to {supplier.name} {month}/{year}",
    )
    db.commit()
    db.refresh(st)
    return _statement_out(db, st)


@router.get("/statements/{supplier_id}/{year}/{month}/document")
def view_statement_document(
    supplier_id: int,
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _statement_supplier(db, supplier_id, current_user)
    st = _get_statement(db, supplier_id, year, month)
    if not st or not st.attachment_key:
        raise HTTPException(status_code=404, detail="No statement document for this month")

    file_bytes = _attach_read(st.attachment_key)
    filename = st.attachment_filename or st.attachment_key
    return Response(
        content=file_bytes,
        media_type=st.attachment_content_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete("/statements/{supplier_id}/{year}/{month}/document", response_model=SupplierStatementOut)
def delete_statement_document(
    supplier_id: int,
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = _statement_supplier(db, supplier_id, current_user)
    st = _get_statement(db, supplier_id, year, month)
    if not st or not st.attachment_key:
        raise HTTPException(status_code=404, detail="No statement document for this month")

    removed_name = st.attachment_filename
    _attach_delete(st.attachment_key)
    st.attachment_key = None
    st.attachment_filename = None
    st.attachment_content_type = None
    st.attachment_size = None
    st.attachment_uploaded_at = None
    st.attachment_uploaded_by_id = None

    log_action(
        db, "supplier_statement.document_removed", user_id=current_user.id,
        entity_id=supplier.entity_id, resource_type="supplier_statement", resource_id=st.id,
        description=f"Removed statement '{removed_name}' from {supplier.name} {month}/{year}",
    )
    db.commit()
    db.refresh(st)
    return _statement_out(db, st)


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
    _check_invoice_access(inv, current_user)
    ensure_not_locked(inv)
    ensure_not_on_sent_costing(db, inv, extra_reg=data.unit)

    total_before = inv.amount
    li = SupplierInvoiceLineItem(invoice_id=invoice_id, **data.model_dump())
    db.add(li)
    db.flush()
    if data.item_code:
        _link_fillup_from_slip(db, inv, li, current_user.id)
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
    ensure_not_on_sent_costing(db, li.invoice, extra_reg=data.unit)

    updates = data.model_dump(exclude_unset=True)
    old_values, new_values = _changed_values(li, updates)
    inv = li.invoice
    total_before = inv.amount

    for k, v in updates.items():
        setattr(li, k, v)
    db.flush()
    if data.item_code:
        _link_fillup_from_slip(db, inv, li, current_user.id)
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
    _check_invoice_access(inv, current_user)
    ensure_not_locked(inv)
    ensure_not_on_sent_costing(db, inv)
    total_before = inv.amount
    snapshot = {"line_id": li.id, **_line_snapshot(li)}
    label = li.unit or li.item_description or f"#{li.id}"
    # The line's diesel log goes with it. Refuse when that diesel is locked —
    # otherwise deleting lines would be a way around the invoice lock.
    if is_invoice_locked(db, inv.id):
        raise HTTPException(
            status_code=403,
            detail=f"The diesel on invoice {inv.invoice_number or f'#{inv.id}'} is locked — "
                   "unlock it before removing lines.",
        )
    fillups_deleted = _delete_line_fillups(db, inv, li, current_user.id)
    db.delete(li)
    db.flush()
    _recalc_invoice_total(db, inv)
    log_action(
        db, "supplier_invoice.line_deleted", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice", resource_id=inv.id,
        description=(
            f"Deleted line {label} (R{snapshot['amount_incl_vat']}) "
            f"from invoice {inv.invoice_number}: total R{total_before} → R{inv.amount}"
            + (f"; removed {fillups_deleted} diesel log(s)" if fillups_deleted else "")
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
    # No entity gate here: an authenticated user who can reach the supplier's
    # invoices may attach a document to any of them, regardless of the row's
    # stored entity_id (which can diverge from the supplier's home entity).

    ext, content_type = _resolve_attach_type(file.content_type, file.filename)
    if not ext:
        raise HTTPException(status_code=400, detail="Only PDF, Excel, JPG, PNG or WebP files are allowed")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_ATTACH_BYTES:
        raise HTTPException(status_code=400, detail="Attachment must be under 25MB")

    key = _attach_save(invoice_id, file_bytes, ext, content_type)

    inv.attachment_key = key
    inv.attachment_filename = file.filename or f"invoice.{ext}"
    inv.attachment_content_type = content_type
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
    number = _norm_slip(old.invoice_number)
    slip_norm = _norm_slip(slip)
    # A placeholder has no number, or the slip we just absorbed used as a stand-in.
    # Anything else is a real invoice number → not a placeholder. Normalised the
    # same way the slip match is, so case/spacing can't keep it from being archived.
    if number and number != slip_norm:
        return False
    # The session runs autoflush=False, so a caller's just-assigned
    # fillup.supplier_invoice_id is still pending — without this flush the count
    # below reads the pre-relink row from the DB, sees the fill-up still on the
    # placeholder, and bails, leaving it behind as a Pending duplicate.
    db.flush()
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


def _archive_filler_invoices_by_slip(db: Session, statement: SupplierInvoice, slip: str, user_id: int) -> int:
    """Archive invoice-ONLY "filler" placeholders whose invoice_number IS this slip,
    now that the slip is a real line on `statement`.

    `_archive_orphaned_placeholder` only fires off a fill-up re-link, so a filler
    captured as a single-line invoice with an amount but NO litres (hence no fill-up)
    is never reached — the import just builds a fresh fill-up and leaves the filler
    behind as a duplicate. This mops up exactly that case: same supplier+entity,
    single-line, no line items of its own, number == the slip, unpaid/unfinalised,
    and crucially NO fill-up (a fill-up-backed placeholder is left to the re-link
    path so we never double-handle or spuriously raise a conflict). Returns count.
    """
    norm = _norm_slip(slip)
    if not norm:
        return 0
    candidates = db.query(SupplierInvoice).filter(
        SupplierInvoice.entity_id == statement.entity_id,
        SupplierInvoice.supplier_id == statement.supplier_id,
        SupplierInvoice.id != statement.id,
        SupplierInvoice.is_archived != True,
        SupplierInvoice.is_multi_line != True,
        func.upper(func.replace(SupplierInvoice.invoice_number, ' ', '')) == norm,
    ).all()
    archived = 0
    for ph in candidates:
        if ph.line_items or ph.is_paid or ph.verified3_by:
            continue
        if db.query(DieselFillUp).filter(
            DieselFillUp.supplier_invoice_id == ph.id,
            DieselFillUp.is_archived != True,
        ).count() > 0:
            continue   # fill-up-backed → the re-link path handles it
        ph.is_archived = True
        archived += 1
        log_action(
            db, "supplier_invoice.placeholder_merged", user_id=user_id,
            entity_id=ph.entity_id, resource_type="supplier_invoice", resource_id=ph.id,
            description=f"Archived filler invoice #{ph.id} ({ph.invoice_number}) — slip absorbed into statement #{statement.id}",
        )
    return archived


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
    # Printed slips whose lump placeholder has already been cleared this import, so a
    # slip that spans several sheet lines only triggers the clear once (Intsimbi).
    intsimbi_cleared_slips: set = set()

    # Load diesel settings once per entity for fill-up creation
    diesel_settings = DieselCalculationService.get_diesel_settings(db, payload.entity_id)
    admin_fee_pct = Decimal(str(diesel_settings.admin_fee_pct)) if diesel_settings else Decimal("0")
    apply_admin_fee = diesel_settings.apply_admin_fee if diesel_settings else False
    entity_obj = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
    vat_rate = Decimal(str(entity_obj.vat_rate)) if entity_obj and entity_obj.vat_rate else Decimal("0.15")
    # Locked diesel invoices take no fill-ups — the invoices and their lines still
    # import, only the Diesel Log side is left untouched.
    diesel_locked = locked_invoice_ids(db, payload.entity_id)

    for item in payload.invoices:
        num = (item.invoice_number or '').strip()
        inv_date = item.invoice_date
        inv_dt = datetime(inv_date.year, inv_date.month, inv_date.day)
        stmt_month, stmt_year = inv_date.month, inv_date.year

        if num:
            if num in existing_numbers:
                skipped += 1
                skipped_numbers.append(num)
                continue
        else:
            # A day WBG hasn't consolidated yet: fills but no invoice number. Import
            # it as a "Pending" invoice, but don't duplicate one already imported for
            # this supplier+entity on this date — so a re-preview/re-import is safe
            # (and, since each new invoice is flushed below, so is a repeat within
            # this same payload).
            already = db.query(SupplierInvoice.id).filter(
                SupplierInvoice.supplier_id == payload.supplier_id,
                SupplierInvoice.entity_id == payload.entity_id,
                SupplierInvoice.invoice_date == inv_dt,
                or_(SupplierInvoice.invoice_number.is_(None), SupplierInvoice.invoice_number == ''),
                SupplierInvoice.is_archived != True,
            ).first()
            if already:
                skipped += 1
                skipped_numbers.append(f"(no number, {inv_date.isoformat()})")
                continue

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

            # Intsimbi carries a per-line admin fee; VAT applies to that fee only
            # (diesel is zero-rated). Fold fee + its VAT into the stored incl-VAT
            # amount so the invoice total (Σ incl) reflects what the supplier bills.
            line_admin_fee = Decimal(str(li.admin_fee)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if li.admin_fee is not None else None
            line_excl = Decimal(str(li.amount_excl_vat or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if line_admin_fee is not None:
                line_fee_vat = (line_admin_fee * vat_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                stored_incl = line_excl + line_admin_fee + line_fee_vat
            else:
                stored_incl = li.amount_incl_vat

            db.add(SupplierInvoiceLineItem(
                invoice_id=inv.id,
                item_code=li.item_code,
                item_description=li.item_description,
                unit=li.unit,
                quantity=li.quantity,
                amount_excl_vat=li.amount_excl_vat,
                amount_incl_vat=stored_incl,
                sort_order=li.sort_order,
                line_date=slip_date_obj,
            ))

            # ── Diesel fill-up sync ──────────────────────────────────────────
            slip = (li.item_code or '').strip()
            # Mop up an invoice-only "filler" numbered with this slip (captured
            # before the statement, with no fill-up) — the fill-up-driven absorption
            # below can't reach it. Runs regardless of the truck/litres guards.
            if slip:
                diesel_linked += _archive_filler_invoices_by_slip(db, inv, slip, current_user.id)
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

            # Diesel invoice lock — skip the fill-up sync entirely (no create, no
            # relink, no overwrite) for an invoice that has been closed off. A row
            # imported onto a brand-new invoice can't be locked yet, so this only
            # bites on a re-import over a reconciled invoice.
            if inv.id in diesel_locked:
                continue

            # Use the rate from the Excel rate column if supplied; fall back to
            # back-computing from amount÷litres.
            if li.rate_per_litre and li.rate_per_litre > 0:
                rate_d = Decimal(str(li.rate_per_litre)).quantize(Decimal("0.0001"))

            # ── Intsimbi: replace, don't merge ───────────────────────────────
            # A printed slip can cover several pump transactions (each its own
            # TransID), and the user's pre-import capture is a single lump under
            # that slip. So don't reconcile line-by-line against one fill-up:
            # clear any lump placeholder for the slip once, then take every
            # transaction straight from the sheet, keyed uniquely by TransID
            # (stored as slip_number; printed slip stays in depot_slip_number).
            # A re-import matches each transaction by TransID and overwrites it.
            if line_admin_fee is not None:
                trans_id = (li.trans_id or '').strip()
                if slip not in intsimbi_cleared_slips:
                    diesel_linked += _clear_intsimbi_slip_placeholders(
                        db, payload.entity_id, payload.supplier_id, slip, inv.id, current_user.id)
                    intsimbi_cleared_slips.add(slip)

                fee_vat = (line_admin_fee * vat_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                amounts = {
                    "amount": line_excl,
                    "admin_fee_amount": line_admin_fee,
                    "admin_fee_vat": fee_vat,
                    "total_amount": line_excl + line_admin_fee + fee_vat,
                }
                fill_admin_pct = (line_admin_fee / line_excl).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) if line_excl > 0 else Decimal("0")

                existing = None
                if trans_id:
                    existing = db.query(DieselFillUp).filter(
                        _transid_eq(trans_id),
                        DieselFillUp.truck_id == truck.id,
                        DieselFillUp.entity_id == payload.entity_id,
                        DieselFillUp.supplier_id == payload.supplier_id,
                        DieselFillUp.is_archived != True,
                    ).first()
                if existing:
                    old_inv_id = existing.supplier_invoice_id
                    existing.litres = litres_d
                    existing.rate_per_litre = rate_d
                    existing.fillup_date = fillup_date
                    existing.slip_number = trans_id
                    existing.depot_slip_number = slip
                    existing.admin_fee_pct = fill_admin_pct
                    existing.invoice_number = num or None
                    existing.supplier_invoice_id = inv.id
                    for field, value in amounts.items():
                        setattr(existing, field, value)
                    _archive_orphaned_placeholder(db, old_inv_id, inv.id, current_user.id, slip=slip)
                    diesel_linked += 1
                else:
                    db.add(DieselFillUp(
                        entity_id=payload.entity_id,
                        truck_id=truck.id,
                        supplier_id=payload.supplier_id,
                        fillup_date=fillup_date,
                        litres=litres_d,
                        rate_per_litre=rate_d,
                        invoice_number=num or None,
                        slip_number=trans_id or slip,
                        depot_slip_number=slip,
                        supplier_invoice_id=inv.id,
                        admin_fee_pct=fill_admin_pct,
                        diesel_type=diesel_type_for_supplier(supplier),
                        created_by=current_user.id,
                        **amounts,
                    ))
                    diesel_created += 1
                continue

            # Match a fill-up already logged for this slip + truck + date. The date is
            # part of the key because a slip number does NOT uniquely identify a fuel
            # transaction: depots (WBG especially) recycle slip numbers across dates
            # and trucks. Matching on slip + truck alone let a recycled slip re-point
            # the *previous* date's fill-up here — surfacing a false litres conflict
            # and, on resolution, stealing that fill-up off its real invoice. Keying on
            # the date makes a same-slip line on a new date a genuinely new fill-up
            # (created below), mirroring the diesel-sheet import's (truck, supplier,
            # slip, date) duplicate key.
            existing_fillup = db.query(DieselFillUp).filter(
                _slip_eq(slip),
                DieselFillUp.truck_id == truck.id,
                DieselFillUp.entity_id == payload.entity_id,
                DieselFillUp.fillup_date == fillup_date,
                DieselFillUp.is_archived != True,
            ).order_by(DieselFillUp.fillup_date.desc()).first()

            if existing_fillup:
                litres_mismatch = abs(float(existing_fillup.litres or 0) - float(litres_d)) > 0.01
                # Even when litres agree, a genuinely different rate/amount is a real
                # discrepancy (one side has the wrong price) — surface it for review.
                # But tolerate sub-rand rounding drift: a logged fill-up's amount is
                # recomputed as round(litres × rate, 2dp) off a back-computed 4dp rate
                # (rate = amount ÷ litres), so it can differ from the statement's raw
                # amount by ~litres × 0.00005. A flat 0.01 band turned that benign
                # arithmetic drift into a conflict, which left the placeholder stranded
                # (only conflict *resolution* archives it). Scale the band to litres so
                # only rand-level price errors — not penny rounding — flag as conflicts.
                amount_tol = max(0.05, float(litres_d) * 0.0002)
                amount_mismatch = abs(float(existing_fillup.amount or 0) - float(excl_d)) > amount_tol
                if litres_mismatch:
                    # Litres themselves disagree — a real discrepancy, surface for review.
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
                    # Same truck, same slip, same litres — the litres already match, so
                    # any amount/rate mismatch just means the fill-up was logged with an
                    # estimated rate before the supplier's invoice arrived. The import
                    # carries the invoiced rate, which is authoritative — apply it
                    # directly instead of prompting the user to pick a side.
                    if amount_mismatch:
                        amounts = DieselCalculationService.calculate_fillup_amounts(
                            litres=litres_d, rate_per_litre=rate_d,
                            admin_fee_pct=Decimal(str(existing_fillup.admin_fee_pct or 0)),
                            apply_admin_fee=apply_admin_fee, vat_rate=vat_rate,
                        )
                        existing_fillup.rate_per_litre = rate_d
                        for field, value in amounts.items():
                            setattr(existing_fillup, field, value)
                    old_inv_id = existing_fillup.supplier_invoice_id
                    existing_fillup.invoice_number = num or None
                    existing_fillup.supplier_invoice_id = inv.id
                    diesel_linked += 1
                    _archive_orphaned_placeholder(db, old_inv_id, inv.id, current_user.id, slip=slip)
                continue

            # Generic diesel suppliers (WBG etc.): admin fee is the entity's %.
            # Intsimbi lines never reach here — they carry a per-line admin fee and
            # are handled by the replace-by-TransID branch above.
            amounts = DieselCalculationService.calculate_fillup_amounts(
                litres=litres_d,
                rate_per_litre=rate_d,
                admin_fee_pct=admin_fee_pct,
                apply_admin_fee=apply_admin_fee,
            )
            fill_admin_pct = admin_fee_pct
            db.add(DieselFillUp(
                entity_id=payload.entity_id,
                truck_id=truck.id,
                supplier_id=payload.supplier_id,
                fillup_date=fillup_date,
                litres=litres_d,
                rate_per_litre=rate_d,
                invoice_number=num or None,
                slip_number=slip,
                depot_slip_number=slip,
                supplier_invoice_id=inv.id,
                admin_fee_pct=fill_admin_pct,
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


# ── One-off cleanup: archive stranded diesel placeholders ─────────────────────

@router.post("/cleanup-diesel-placeholders")
def cleanup_diesel_placeholders(
    entity_id: Optional[int] = Query(None),
    supplier_id: Optional[int] = Query(None),
    commit: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin-only, idempotent. Clears the "Pending" placeholder invoices left
    behind before the auto-archive fix: for every slip that now appears on a real
    multi-line statement invoice, re-link its fill-up onto that statement and
    archive the single-line placeholder it was auto-created under.

    DRY RUN by default (commit=false) — returns exactly what *would* be archived so
    it can be reviewed first; nothing is saved. Pass commit=true to apply.
    Optionally scope to one entity and/or supplier. Safe to run repeatedly."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    q = db.query(SupplierInvoice).filter(
        SupplierInvoice.is_multi_line == True,
        SupplierInvoice.is_archived != True,
    )
    if entity_id is not None:
        _check_entity_access(entity_id, current_user)
        q = q.filter(SupplierInvoice.entity_id == entity_id)
    if supplier_id is not None:
        q = q.filter(SupplierInvoice.supplier_id == supplier_id)
    multiline_invs = q.all()

    # Preload every candidate placeholder ONCE and index it in memory. The original
    # matched placeholders with a per-statement-line query that ran a function on
    # invoice_number (func.upper(func.replace(...)), non-indexable) — line×invoice
    # full-table scans that timed out the gateway (504) on prod's diesel-statement
    # volume. A single bulk load + dict lookup is equivalent but bounded to a couple
    # of queries. Keyed by (entity, supplier) so a placeholder only matches a
    # statement for the same supplier, exactly as the scoped query did.
    entity_ids = {inv.entity_id for inv in multiline_invs}
    supplier_ids = {inv.supplier_id for inv in multiline_invs}
    ph_by_slip: dict = {}   # (entity_id, supplier_id, norm_number) -> [placeholder]
    ph_blank: dict = {}     # (entity_id, supplier_id) -> [blank-number placeholder]
    if multiline_invs:
        for ph in db.query(SupplierInvoice).filter(
            SupplierInvoice.entity_id.in_(entity_ids),
            SupplierInvoice.supplier_id.in_(supplier_ids),
            SupplierInvoice.is_archived != True,
            SupplierInvoice.is_multi_line != True,
        ).all():
            num = (ph.invoice_number or '').strip()
            if num:
                ph_by_slip.setdefault((ph.entity_id, ph.supplier_id, _norm_slip(num)), []).append(ph)
            else:
                ph_blank.setdefault((ph.entity_id, ph.supplier_id), []).append(ph)

    archived: List[dict] = []
    seen_placeholders: set = set()

    for inv in multiline_invs:
        for li in inv.line_items:
            slip = (li.item_code or "").strip()
            if not slip:
                continue
            # Candidate placeholders: same supplier+entity, single-line, whose number
            # is this slip standing in as the number (the diesel auto-create pattern).
            # Looked up from the in-memory index built above.
            placeholders = ph_by_slip.get((inv.entity_id, inv.supplier_id, _norm_slip(slip)), [])
            for ph in placeholders:
                if ph.id == inv.id or ph.id in seen_placeholders or ph.line_items:
                    continue
                # Re-link this slip's fill-ups off the placeholder onto the statement
                # (Scenario B). When the manual flow already re-linked them, there are
                # none left and we just retire the empty placeholder (Scenario A).
                fups = db.query(DieselFillUp).filter(
                    DieselFillUp.supplier_invoice_id == ph.id,
                    DieselFillUp.is_archived != True,
                    _slip_eq(slip),
                ).all()
                for fu in fups:
                    fu.supplier_invoice_id = inv.id
                    if inv.invoice_number:
                        fu.invoice_number = inv.invoice_number
                db.flush()
                # Never archive a placeholder that still backs other (different-slip)
                # fill-ups — that would orphan real diesel records.
                remaining = db.query(DieselFillUp).filter(
                    DieselFillUp.supplier_invoice_id == ph.id,
                    DieselFillUp.is_archived != True,
                ).count()
                if remaining > 0:
                    continue
                ph.is_archived = True
                seen_placeholders.add(ph.id)
                archived.append({
                    "placeholder_invoice_id": ph.id,
                    "placeholder_number": ph.invoice_number,
                    "match": "slip",
                    "slip": slip,
                    "absorbed_into_invoice_id": inv.id,
                    "statement_number": inv.invoice_number,
                    "entity_id": inv.entity_id,
                    "supplier_id": inv.supplier_id,
                    "relinked_fillup_ids": [fu.id for fu in fups],
                })
                if commit:
                    log_action(
                        db, "supplier_invoice.placeholder_merged", user_id=current_user.id,
                        entity_id=ph.entity_id, resource_type="supplier_invoice", resource_id=ph.id,
                        description=(
                            f"Cleanup: archived placeholder invoice #{ph.id} (slip {slip}) — "
                            f"absorbed into statement #{inv.id}"
                        ),
                    )

    # ── Second pass: blank-number orphan shells ──────────────────────────────
    # Older placeholders were auto-created with NO invoice number (the fill-up had
    # neither a slip nor an invoice number yet) and have since had their fill-up
    # moved onto the statement. With a blank number AND no fill-up, neither the slip
    # match above nor a fill-up link can reach them — but auto-creation stamped them
    # with the truck's vehicle_reg + amount, so match those to a statement line and
    # retire the shell. Diesel suppliers only; never touches a paid/finalised invoice.
    for inv in multiline_invs:
        if not (inv.supplier and inv.supplier.is_diesel_supplier):
            continue
        # (normalised reg, rounded excl amount) for every line on the statement
        line_keys = {
            (_norm_slip(li.unit), round(float(li.amount_excl_vat), 2))
            for li in inv.line_items
            if li.unit and li.amount_excl_vat is not None
        }
        if not line_keys:
            continue
        blanks = ph_blank.get((inv.entity_id, inv.supplier_id), [])
        for ph in blanks:
            if ph.id == inv.id or ph.id in seen_placeholders or ph.line_items:
                continue
            if ph.is_paid or ph.verified3_by or not ph.vehicle_reg or ph.amount is None:
                continue
            # A shell has no fill-up of its own — the real diesel cost lives on the
            # statement line. If something still points here, it's real data: skip.
            if db.query(DieselFillUp).filter(
                DieselFillUp.supplier_invoice_id == ph.id,
                DieselFillUp.is_archived != True,
            ).count() > 0:
                continue
            if (_norm_slip(ph.vehicle_reg), round(float(ph.amount), 2)) not in line_keys:
                continue
            ph.is_archived = True
            seen_placeholders.add(ph.id)
            archived.append({
                "placeholder_invoice_id": ph.id,
                "placeholder_number": ph.invoice_number,
                "match": "reg+amount",
                "vehicle_reg": ph.vehicle_reg,
                "amount": float(ph.amount),
                "absorbed_into_invoice_id": inv.id,
                "statement_number": inv.invoice_number,
                "entity_id": inv.entity_id,
                "supplier_id": inv.supplier_id,
                "relinked_fillup_ids": [],
            })
            if commit:
                log_action(
                    db, "supplier_invoice.placeholder_merged", user_id=current_user.id,
                    entity_id=ph.entity_id, resource_type="supplier_invoice", resource_id=ph.id,
                    description=(
                        f"Cleanup: archived blank-number placeholder invoice #{ph.id} "
                        f"(reg {ph.vehicle_reg}, R{ph.amount}) — duplicate of a line on "
                        f"statement #{inv.id}"
                    ),
                )

    if commit:
        db.commit()
    else:
        db.rollback()

    return {
        "committed": commit,
        "archived_count": len(archived),
        "archived": archived,
    }

