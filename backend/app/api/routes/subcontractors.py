import calendar
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, extract
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from decimal import Decimal
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Subcontractor, Truck, TruckLoad, SupplierInvoice, BusinessEntity, DieselSettings, DieselRate, Supplier, DieselFillUp, PaymentTermType
from app.schemas.schemas import (
    SubcontractorCreate, SubcontractorBulkCreate,
    SubcontractorUpdate, SubcontractorOut,
    TruckLoadOut, TruckOut, SupplierInvoiceOut,
    SubcontractorCostingOut, SubcontractorCostingSummary, SubcontractorTruckCostingOut,
    SupplierStatementGroup, SubcontractorInvoiceCreate,
    DieselFillUpCostingRow, DieselSupplierGroup,
)
from app.services.audit import log_action
from app.services.verification import get_verification_display

router = APIRouter(prefix="/api/subcontractors", tags=["subcontractors"])


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


@router.get("/", response_model=List[SubcontractorOut])
def list_subcontractors(
    entity_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Subcontractor)

    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(Subcontractor.entity_id.in_(access_ids))

    if entity_id:
        _check_entity_access(entity_id, current_user)
        query = query.filter(Subcontractor.entity_id == entity_id)

    if not include_inactive:
        query = query.filter(Subcontractor.is_active == True)

    if search:
        term = f"%{search}%"
        query = query.filter(or_(
            Subcontractor.name.ilike(term),
            Subcontractor.trading_name.ilike(term),
            Subcontractor.contact_person.ilike(term),
            Subcontractor.email.ilike(term),
        ))

    return query.order_by(Subcontractor.name).offset(skip).limit(limit).all()


@router.get("/{subcontractor_id}", response_model=SubcontractorOut)
def get_subcontractor(
    subcontractor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)
    linked = db.query(BusinessEntity).filter(
        BusinessEntity.linked_subcontractor_id == subcontractor_id
    ).first()
    out = SubcontractorOut.model_validate(sub)
    return out.model_copy(update={"linked_entity_id": linked.id if linked else None})


@router.post("/", response_model=SubcontractorOut)
def create_subcontractor(
    payload: SubcontractorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    sub = Subcontractor(**payload.model_dump())
    db.add(sub)
    log_action(
        db, "subcontractor.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="subcontractor",
        description=f"Created subcontractor {sub.name}",
    )
    db.commit()
    db.refresh(sub)
    return sub


@router.post("/bulk", response_model=List[SubcontractorOut])
def create_subcontractor_bulk(
    payload: SubcontractorBulkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create the same subcontractor across multiple entities at once."""
    if not payload.entity_ids:
        raise HTTPException(status_code=400, detail="At least one entity must be selected")
    for eid in payload.entity_ids:
        _check_entity_access(eid, current_user)

    fields = payload.model_dump(exclude={"entity_ids"})
    try:
        created = []
        for eid in payload.entity_ids:
            sub = Subcontractor(entity_id=eid, **fields)
            db.add(sub)
            log_action(
                db, "subcontractor.created", user_id=current_user.id,
                entity_id=eid, resource_type="subcontractor",
                description=f"Created subcontractor {sub.name}",
            )
            created.append(sub)
        db.commit()
        for s in created:
            db.refresh(s)
        return created
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create subcontractors")


@router.put("/{subcontractor_id}", response_model=SubcontractorOut)
def update_subcontractor(
    subcontractor_id: int,
    payload: SubcontractorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    old_vals = {k: str(getattr(sub, k)) for k in payload.model_dump(exclude_none=True)}
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(sub, field, value)

    log_action(
        db, "subcontractor.updated", user_id=current_user.id,
        entity_id=sub.entity_id, resource_type="subcontractor",
        resource_id=subcontractor_id, description=f"Updated subcontractor {sub.name}",
        old_values=old_vals,
    )
    db.commit()
    db.refresh(sub)
    return sub


# ── Per-subcontractor invoices ────────────────────────────────────────────────

def _invoice_to_out(db: Session, inv: SupplierInvoice) -> SupplierInvoiceOut:
    out = SupplierInvoiceOut.model_validate(inv)
    return out.model_copy(update={
        "supplier_name": inv.supplier.name if inv.supplier else None,
        **get_verification_display(db, inv),
    })


@router.get("/{subcontractor_id}/invoices", response_model=List[SupplierStatementGroup])
def get_subcontractor_invoices(
    subcontractor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.subcontractor_id == subcontractor_id,
            SupplierInvoice.is_archived == False,
        )
        .order_by(
            SupplierInvoice.statement_year.desc(),
            SupplierInvoice.statement_month.desc(),
            SupplierInvoice.invoice_date.desc(),
        )
        .all()
    )

    # Group by (statement_year, statement_month)
    from collections import defaultdict
    grouped: dict = defaultdict(list)
    for inv in invoices:
        key = (inv.statement_year or 0, inv.statement_month or 0)
        grouped[key].append(inv)

    result = []
    for (yr, mo) in sorted(grouped.keys(), reverse=True):
        invs = grouped[(yr, mo)]
        inv_outs = [_invoice_to_out(db, i) for i in invs]
        subtotal = sum(i.amount for i in invs)
        last_day = calendar.monthrange(yr, mo)[1] if yr and mo else None
        due_date = (
            datetime(yr, mo, last_day, 23, 59, 59, tzinfo=timezone.utc)
            if yr and mo else None
        )
        result.append(SupplierStatementGroup(
            statement_month=mo,
            statement_year=yr,
            invoices=inv_outs,
            subtotal=subtotal,
            payment_due_date=due_date,
            is_fully_paid=all(i.is_paid for i in invs),
        ))
    return result


@router.post("/{subcontractor_id}/invoices", response_model=SupplierInvoiceOut)
def create_subcontractor_invoice(
    subcontractor_id: int,
    payload: SubcontractorInvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    inv_date = payload.invoice_date
    if inv_date.tzinfo is None:
        inv_date = inv_date.replace(tzinfo=timezone.utc)

    last_day = calendar.monthrange(inv_date.year, inv_date.month)[1]
    due_date = inv_date.replace(day=last_day, hour=23, minute=59, second=59, microsecond=0)

    inv = SupplierInvoice(
        subcontractor_id=subcontractor_id,
        supplier_id=None,
        entity_id=sub.entity_id,
        invoice_date=inv_date,
        invoice_number=payload.invoice_number.strip(),
        amount=payload.amount,
        vat_applicable=payload.vat_applicable,
        vehicle_reg=payload.vehicle_reg.strip() if payload.vehicle_reg else None,
        description=payload.description.strip() if payload.description else None,
        notes=payload.notes.strip() if payload.notes else None,
        statement_month=inv_date.month,
        statement_year=inv_date.year,
        payment_due_date=due_date,
        created_by_id=current_user.id,
    )
    db.add(inv)
    log_action(
        db, "subcontractor_invoice.created", user_id=current_user.id,
        entity_id=sub.entity_id, resource_type="supplier_invoice",
        description=f"Created invoice {inv.invoice_number} for subcontractor {sub.name}",
    )
    db.commit()
    db.refresh(inv)
    return _invoice_to_out(db, inv)


# ── Costing breakdown ─────────────────────────────────────────────────────────

def _enrich_load(load: TruckLoad) -> TruckLoadOut:
    d = TruckLoadOut.model_validate(load).model_dump()
    d["truck_registration"] = load.truck.registration if load.truck else None
    d["mine_name"]           = load.mine.name if load.mine else None
    d["supplier_name"]       = load.supplier.name if load.supplier else None
    return TruckLoadOut(**d)


def _enrich_invoice(db: Session, inv: SupplierInvoice) -> SupplierInvoiceOut:
    out = SupplierInvoiceOut.model_validate(inv)
    return out.model_copy(update={
        "supplier_name": inv.supplier.name if inv.supplier else None,
        **get_verification_display(db, inv),
    })


def _build_subcontractor_costing(subcontractor_id: int, month: int, year: int, db: Session, current_user: User) -> SubcontractorCostingOut:
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    trucks = db.query(Truck).filter(Truck.subcontractor_id == subcontractor_id).all()

    D0 = Decimal("0")
    truck_results = []

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == sub.entity_id).first()
    is_vat_registered = entity.vat_registered if entity else True

    ds = db.query(DieselSettings).filter(DieselSettings.entity_id == sub.entity_id).first()
    fixed_admin_fee = Decimal(str(ds.subcontractor_monthly_admin_fee)) if ds else D0

    for truck in trucks:
        loads = (
            db.query(TruckLoad)
            .filter(
                TruckLoad.truck_id == truck.id,
                extract("month", TruckLoad.load_date) == month,
                extract("year",  TruckLoad.load_date) == year,
                TruckLoad.is_archived == False,
            )
            .order_by(TruckLoad.load_date)
            .all()
        )
        income_excl = sum(
            (Decimal(str(l.subcontractor_amount_excl_vat)) for l in loads if l.subcontractor_amount_excl_vat is not None),
            D0,
        )
        income_incl = sum(
            (Decimal(str(l.subcontractor_amount_incl_vat)) for l in loads if l.subcontractor_amount_incl_vat is not None),
            D0,
        )
        admin_fee = fixed_admin_fee

        # Cash/Current invoices belong to the PREVIOUS costing period, so to
        # populate costing for `month` we fetch their invoices from month+1.
        # 30-day invoices sit in the same month as their statement period.
        cash_stmt_month = month + 1 if month < 12 else 1
        cash_stmt_year  = year      if month < 12 else year + 1

        inv_list = (
            db.query(SupplierInvoice)
            .join(Supplier, Supplier.id == SupplierInvoice.supplier_id)
            .filter(
                SupplierInvoice.vehicle_reg == truck.registration,
                SupplierInvoice.is_archived == False,
                Supplier.is_diesel_supplier == False,
                or_(
                    and_(
                        Supplier.payment_term == PaymentTermType.days_30,
                        SupplierInvoice.statement_month == month,
                        SupplierInvoice.statement_year == year,
                    ),
                    and_(
                        Supplier.payment_term == PaymentTermType.current,
                        SupplierInvoice.statement_month == cash_stmt_month,
                        SupplierInvoice.statement_year == cash_stmt_year,
                    ),
                ),
            )
            .all()
            if truck.registration else []
        )

        exp_incl = admin_fee + sum((Decimal(str(i.amount)) for i in inv_list if i.vat_applicable), D0)
        exp_excl = sum((Decimal(str(i.amount)) for i in inv_list if not i.vat_applicable), D0)

        # Diesel fill-ups for this truck/month — grouped by supplier
        fillups = (
            db.query(DieselFillUp)
            .filter(
                DieselFillUp.truck_id == truck.id,
                extract("month", DieselFillUp.fillup_date) == month,
                extract("year",  DieselFillUp.fillup_date) == year,
                DieselFillUp.is_archived == False,
            )
            .order_by(DieselFillUp.fillup_date)
            .all()
        )
        by_supplier: dict = {}
        for f in fillups:
            by_supplier.setdefault(f.supplier_id, []).append(f)

        diesel_groups = []
        for sup_id, fups in by_supplier.items():
            sup_name = fups[0].supplier.name if fups[0].supplier else f"Supplier #{sup_id}"
            rows = []
            for f in fups:
                amt    = Decimal(str(f.amount))
                fee_ex = Decimal(str(f.admin_fee_amount))
                fee_vt = (fee_ex * Decimal("0.15")).quantize(Decimal("0.01"))
                fee_in = (fee_ex * Decimal("1.15")).quantize(Decimal("0.01"))
                rows.append(DieselFillUpCostingRow(
                    fillup_date=f.fillup_date,
                    slip_number=f.slip_number,
                    invoice_number=f.invoice_number,
                    supplier_name=sup_name,
                    litres=Decimal(str(f.litres)),
                    rate_per_litre=Decimal(str(f.rate_per_litre)),
                    amount_excl=amt,
                    admin_fee_excl=fee_ex,
                    admin_fee_vat=fee_vt,
                    admin_fee_incl=fee_in,
                    grand_total=(amt + fee_in).quantize(Decimal("0.01")),
                ))
            diesel_groups.append(DieselSupplierGroup(
                supplier_name=sup_name,
                rows=rows,
                tot_admin_fee_incl=sum((r.admin_fee_incl for r in rows), D0),
                tot_excl_admin_fee=sum((r.amount_excl for r in rows), D0),
                tot_grand_total=sum((r.grand_total for r in rows), D0),
            ))

        # Add diesel fill-up totals into the expense columns:
        # zero-rated diesel amount → Expenses Excl VAT
        # 1% admin fee (incl VAT)  → Expenses Incl VAT
        exp_excl += sum((g.tot_excl_admin_fee for g in diesel_groups), D0)
        exp_incl += sum((g.tot_admin_fee_incl  for g in diesel_groups), D0)
        income_for_net = income_excl if not is_vat_registered else income_incl
        net_payable = income_for_net - exp_excl - exp_incl

        truck.subcontractor_display_name = sub.name
        truck_results.append(SubcontractorTruckCostingOut(
            truck=TruckOut.model_validate(truck),
            loads=[_enrich_load(l) for l in loads],
            income_excl_vat=income_excl,
            income_incl_vat=income_incl,
            admin_fee=admin_fee,
            supplier_invoices=[_enrich_invoice(db, i) for i in inv_list],
            total_expenses_excl_vat=exp_excl,
            total_expenses_incl_vat=exp_incl,
            net_payable=net_payable,
            diesel_groups=diesel_groups,
        ))

    summary = SubcontractorCostingSummary(
        income_excl_vat=sum((t.income_excl_vat for t in truck_results), D0),
        income_incl_vat=sum((t.income_incl_vat for t in truck_results), D0),
        total_expenses_excl_vat=sum((t.total_expenses_excl_vat for t in truck_results), D0),
        total_expenses_incl_vat=sum((t.total_expenses_incl_vat for t in truck_results), D0),
        net_payable=sum((t.net_payable for t in truck_results), D0),
    )

    diesel_supplier_names = [
        row[0] for row in (
            db.query(Supplier.name)
            .join(DieselRate, DieselRate.supplier_id == Supplier.id)
            .filter(DieselRate.entity_id == sub.entity_id, DieselRate.is_active == True)
            .distinct()
            .order_by(Supplier.name)
            .all()
        )
    ]

    return SubcontractorCostingOut(
        subcontractor=SubcontractorOut.model_validate(sub),
        month=month,
        year=year,
        trucks=truck_results,
        summary=summary,
        diesel_suppliers=diesel_supplier_names,
        is_vat_registered=is_vat_registered,
    )


@router.get("/{subcontractor_id}/costing", response_model=SubcontractorCostingOut)
def get_subcontractor_costing(
    subcontractor_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _build_subcontractor_costing(subcontractor_id, month, year, db, current_user)


@router.get("/{subcontractor_id}/costing/export/pdf")
def export_costing_pdf(
    subcontractor_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import io
    from fastapi.responses import StreamingResponse
    from app.services.costing_exports import generate_costing_pdf

    costing = _build_subcontractor_costing(subcontractor_id, month, year, db, current_user)
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == sub.entity_id).first()

    pdf_bytes = generate_costing_pdf(costing, entity)
    name = sub.name.replace(" ", "-").lower()
    filename = f"costing-{name}-{year}-{month:02d}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{subcontractor_id}/costing/export/excel")
def export_costing_excel(
    subcontractor_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import io
    from fastapi.responses import StreamingResponse
    from app.services.costing_exports import generate_costing_excel

    costing = _build_subcontractor_costing(subcontractor_id, month, year, db, current_user)
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == sub.entity_id).first()

    xl_bytes = generate_costing_excel(costing, entity)
    name = sub.name.replace(" ", "-").lower()
    filename = f"costing-{name}-{year}-{month:02d}.xlsx"
    return StreamingResponse(
        io.BytesIO(xl_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{subcontractor_id}")
def delete_subcontractor(
    subcontractor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)
    sub.is_active = False
    log_action(
        db, "subcontractor.deleted", user_id=current_user.id,
        entity_id=sub.entity_id, resource_type="subcontractor",
        resource_id=subcontractor_id, description=f"Deactivated subcontractor {sub.name}",
    )
    db.commit()
    return {"detail": "Subcontractor deactivated"}
