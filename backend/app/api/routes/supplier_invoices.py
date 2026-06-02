import calendar
from datetime import datetime, timezone, date as date_type
from decimal import Decimal
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Supplier, SupplierInvoice, SupplierInvoiceLineItem, PaymentTermType, Truck, DieselFillUp
from app.schemas.schemas import (
    SupplierInvoiceCreate, SupplierInvoiceUpdate, SupplierInvoiceOut,
    SupplierInvoiceLineItemCreate, SupplierInvoiceLineItemOut,
    SupplierStatementGroup, SupplierPayablesDashboard,
    SupplierCurrentPayable, Supplier30DaysPayable,
    BulkImportPayload, BulkImportResult,
    DieselConflict, DieselConflictSide, DieselConflictResolution,
)
from app.services.audit import log_action
from app.services.verification import apply_verify_step, apply_finalize_step, get_verification_display
from app.services.diesel_service import DieselCalculationService

router = APIRouter(prefix="/api/supplier-invoices", tags=["supplier-invoices"])


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


def _recalc_invoice_total(db: Session, invoice: SupplierInvoice) -> None:
    from sqlalchemy import func as sa_func
    result = db.query(
        sa_func.coalesce(sa_func.sum(SupplierInvoiceLineItem.amount_incl_vat), 0)
    ).filter(SupplierInvoiceLineItem.invoice_id == invoice.id).scalar()
    invoice.amount = Decimal(str(result))
    db.commit()
    db.refresh(invoice)


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
    """
    try:
        truck = (
            db.query(Truck)
            .filter(
                Truck.registration.ilike(vehicle_reg),
                Truck.entity_id == entity_id,
            )
            .first()
        )
        if not truck:
            return None

        inv_date = supplier_invoice.invoice_date.date() if hasattr(supplier_invoice.invoice_date, 'date') else supplier_invoice.invoice_date

        # Link to existing DieselFillUp if same supplier + invoice number already exists
        existing_fillup = db.query(DieselFillUp).filter(
            DieselFillUp.supplier_id == supplier.id,
            DieselFillUp.invoice_number == supplier_invoice.invoice_number,
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
            supplier_invoice_id=supplier_invoice.id,
            admin_fee_pct=admin_fee_pct,
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)
    now = datetime.now(tz=timezone.utc)

    q = db.query(SupplierInvoice).join(Supplier).filter(SupplierInvoice.is_paid == False, SupplierInvoice.is_archived != True)

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
            if stmt_m == now.month and stmt_y == now.year:
                # Statement period is current month — normal bucket
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
        else:  # days_30
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

    paid_q = db.query(SupplierInvoice).filter(
        SupplierInvoice.is_paid == True,
        SupplierInvoice.paid_date != None,
    )
    if accessible is not None:
        paid_q = paid_q.filter(SupplierInvoice.entity_id.in_(accessible))
    if entity_id:
        paid_q = paid_q.filter(SupplierInvoice.entity_id == entity_id)
    paid_this_month = sum(
        inv.amount for inv in paid_q.all()
        if inv.paid_date and inv.paid_date.month == now.month and inv.paid_date.year == now.year
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
    invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.vehicle_reg.ilike(vehicle_reg),
            SupplierInvoice.statement_month == month,
            SupplierInvoice.statement_year == year,
            SupplierInvoice.is_archived != True,
        )
        .order_by(SupplierInvoice.invoice_date.asc(), SupplierInvoice.id.asc())
        .all()
    )
    return [
        {
            "id": inv.id,
            "supplier_name": inv.supplier.name if inv.supplier else None,
            "invoice_number": inv.invoice_number,
            "invoice_date": str(inv.invoice_date) if inv.invoice_date else None,
            "amount": float(inv.amount),
            "vat_applicable": inv.vat_applicable,
            "description": inv.description,
        }
        for inv in invoices
    ]


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

    def _to_out(inv) -> SupplierInvoiceOut:
        out = SupplierInvoiceOut.model_validate(inv)
        fillup_data = fillup_data_by_inv.get(inv.id, {})
        return out.model_copy(update={
            "diesel_fillup_id": fillup_data.get("fillup_id"),
            "slip_number": fillup_data.get("slip_number"),
            "is_multi_line": inv.is_multi_line,
            "line_items": [SupplierInvoiceLineItemOut.model_validate(li) for li in inv.line_items],
            **get_verification_display(db, inv),
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
    supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    _check_entity_access(payload.entity_id, current_user)

    # Hard block duplicate: same supplier + invoice number + entity
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
    due_date = calculate_supplier_due_date(inv_date, supplier.payment_term)

    # Use whatever statement period the user sent; fall back to the invoice date's
    # own month/year. Payment-term costing offsets belong in reports only.
    stmt_month = payload.statement_month if payload.statement_month is not None else inv_date.month
    stmt_year  = payload.statement_year  if payload.statement_year  is not None else inv_date.year

    inv = SupplierInvoice(
        **payload.model_dump(exclude={'statement_month', 'statement_year'}),
        statement_month=stmt_month,
        statement_year=stmt_year,
        payment_due_date=due_date,
        created_by_id=current_user.id,
    )
    db.add(inv)
    log_action(
        db, "supplier_invoice.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="supplier_invoice",
        description=f"Created invoice {payload.invoice_number} for supplier {supplier.name}",
    )
    db.commit()
    db.refresh(inv)

    # Auto-create DieselFillUp when supplier is a diesel supplier and enough data is provided
    diesel_fillup_id = None
    if supplier.is_diesel_supplier and payload.vehicle_reg and payload.litres and payload.litres > 0:
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

    for field, value in updates.items():
        setattr(inv, field, value)

    # When invoice_number is filled in (e.g. Pending → confirmed), push to linked fill-ups
    if "invoice_number" in updates and inv.is_multi_line:
        _propagate_invoice_number_to_fillups(db, inv)

    log_action(
        db, "supplier_invoice.updated", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id, description=f"Updated invoice {inv.invoice_number}",
    )
    db.commit()
    db.refresh(inv)
    return inv


# ── Verification ──────────────────────────────────────────────────────────────

@router.patch("/{invoice_id}/verify")
def verify_supplier_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)

    apply_verify_step(inv, current_user, is_admin=(current_user.role == "admin"))
    log_action(
        db, "supplier_invoice.verified", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id, description=f"Verified supplier invoice {inv.invoice_number}",
    )
    db.commit()
    db.refresh(inv)
    d = {c.name: getattr(inv, c.name) for c in inv.__table__.columns}
    d.update(get_verification_display(db, inv))
    return d


@router.patch("/{invoice_id}/finalize")
def finalize_supplier_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(inv.entity_id, current_user)
    apply_finalize_step(inv, current_user, is_admin=(current_user.role == "admin"))
    log_action(
        db, "supplier_invoice.finalized", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id,
        description=f"Applied final lock on supplier invoice {inv.invoice_number}",
    )
    db.commit()
    db.refresh(inv)
    d = {c.name: getattr(inv, c.name) for c in inv.__table__.columns}
    d.update(get_verification_display(db, inv))
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

    li = SupplierInvoiceLineItem(invoice_id=invoice_id, **data.model_dump())
    db.add(li)
    db.flush()
    if data.item_code:
        _link_fillup_from_slip(db, inv, data.item_code)
    _recalc_invoice_total(db, inv)
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

    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(li, k, v)
    db.flush()
    if data.item_code:
        _link_fillup_from_slip(db, li.invoice, data.item_code)
    _recalc_invoice_total(db, li.invoice)
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
    db.delete(li)
    db.flush()
    _recalc_invoice_total(db, inv)


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
            # block creation for a truck that hasn't been imported yet.
            truck = db.query(Truck).filter(
                Truck.registration.ilike(li.unit.strip()),
                Truck.entity_id == payload.entity_id,
            ).first()
            if not truck:
                continue

            # Use the rate from the Excel rate column if supplied; fall back to
            # back-computing from amount÷litres.
            if li.rate_per_litre and li.rate_per_litre > 0:
                rate_d = Decimal(str(li.rate_per_litre)).quantize(Decimal("0.0001"))

            existing_fillup = db.query(DieselFillUp).filter(
                DieselFillUp.slip_number == slip,
                DieselFillUp.truck_id == truck.id,
                DieselFillUp.entity_id == payload.entity_id,
                DieselFillUp.fillup_date == fillup_date,
            ).first()

            if existing_fillup:
                if abs(float(existing_fillup.litres or 0) - float(litres_d)) > 0.01:
                    # Same truck + slip but different litres — flag as conflict.
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
                    # Same truck, same slip, same litres — stamp invoice link only.
                    existing_fillup.invoice_number = num or None
                    existing_fillup.supplier_invoice_id = inv.id
                    diesel_linked += 1
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

        fillup.invoice_number = invoice.invoice_number
        fillup.supplier_invoice_id = invoice.id

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

