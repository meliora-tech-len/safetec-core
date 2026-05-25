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
)
from app.services.audit import log_action
from app.services.verification import apply_verify_step, get_verification_display
from app.services.diesel_service import DieselCalculationService

router = APIRouter(prefix="/api/supplier-invoices", tags=["supplier-invoices"])


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

        # Use the active DieselRate if available; otherwise derive from invoice amount / litres
        rate_record = DieselCalculationService.get_active_rate(db, supplier.id, entity_id, inv_date)
        if rate_record:
            rate_per_litre = Decimal(str(rate_record.rate_per_litre))
        else:
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

    current_payables: dict = {}   # supplier_id -> {name, total, count}
    days_30_payables: dict = {}   # (supplier_id, year, month) -> {name, total, count, due_date}

    for inv in all_unpaid:
        supplier = inv.supplier
        term = supplier.payment_term

        if term == PaymentTermType.current:
            # Only show if invoice is from this calendar month
            if inv.invoice_date.month == now.month and inv.invoice_date.year == now.year:
                key = inv.supplier_id
                if key not in current_payables:
                    current_payables[key] = {"supplier_name": supplier.name, "total": Decimal("0"), "count": 0}
                current_payables[key]["total"] += inv.amount
                current_payables[key]["count"] += 1
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
            days_30_payables[key]["total"] += inv.amount
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

    total_current = sum(x.total_outstanding for x in current_list)
    total_30 = sum(x.total_outstanding for x in days30_list)

    return SupplierPayablesDashboard(
        current_payables=current_list,
        days_30_payables=days30_list,
        total_current=total_current,
        total_30_days=total_30,
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

    inv = SupplierInvoice(
        **payload.model_dump(),
        statement_month=inv_date.month,
        statement_year=inv_date.year,
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

    # Recalculate due date if invoice_date changed
    if "invoice_date" in updates:
        supplier = db.query(Supplier).filter(Supplier.id == inv.supplier_id).first()
        new_date = updates["invoice_date"]
        updates["payment_due_date"] = calculate_supplier_due_date(new_date, supplier.payment_term)
        updates["statement_month"] = new_date.month
        updates["statement_year"] = new_date.year

    for field, value in updates.items():
        setattr(inv, field, value)

    log_action(
        db, "supplier_invoice.updated", user_id=current_user.id,
        entity_id=inv.entity_id, resource_type="supplier_invoice",
        resource_id=invoice_id, description=f"Updated invoice {inv.invoice_number}",
    )
    db.commit()
    db.refresh(inv)
    return inv


# ── 2-step verify ─────────────────────────────────────────────────────────────

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
