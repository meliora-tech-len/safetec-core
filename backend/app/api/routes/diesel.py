from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, DieselSettings, DieselRate, DieselFillUp,
    Supplier, Truck, TruckLoad, SupplierInvoice, BusinessEntity,
)
from app.schemas.schemas import (
    DieselSettingsOut, DieselSettingsUpdate,
    DieselRateCreate, DieselRateUpdate, DieselRateOut,
    DieselFillUpCreate, DieselFillUpUpdate, DieselFillUpOut,
    DieselFillUpSummary,
    DieselSummaryByTruck, DieselSupplierReconciliation, DieselAnnualMonthRow,
    DieselInvoiceReconciliationRow,
)
from app.services.diesel_service import DieselCalculationService
from app.services.audit import log_action
from app.services.verification import apply_verify_step, apply_finalize_step, get_verification_display

router = APIRouter(prefix="/api/diesel", tags=["diesel"])


def _sync_truckload_diesel(db: Session, truckload_id: int, fillup: DieselFillUp) -> None:
    """Copy diesel snapshot fields from a fill-up onto its linked TruckLoad."""
    tl = db.query(TruckLoad).filter(TruckLoad.id == truckload_id).first()
    if tl:
        tl.diesel_invoice = fillup.invoice_number
        tl.diesel_litres = fillup.litres
        tl.diesel_rate = fillup.rate_per_litre
        db.commit()


def _clear_truckload_diesel(db: Session, truckload_id: int) -> None:
    """Clear diesel snapshot fields on a TruckLoad when the linked fill-up is removed."""
    tl = db.query(TruckLoad).filter(TruckLoad.id == truckload_id).first()
    if tl:
        tl.diesel_invoice = None
        tl.diesel_litres = None
        tl.diesel_rate = None


def _auto_link_or_create_supplier_invoice(db: Session, fillup: DieselFillUp, user_id: int) -> None:
    """
    Called after a DieselFillUp is saved with an invoice_number or slip_number but no supplier_invoice_id.
    Links to an existing SupplierInvoice if found by invoice_number, otherwise auto-creates one.
    """
    inv_num = fillup.invoice_number.strip() if fillup.invoice_number else None

    # Only try to match an existing invoice when we have an invoice number to search by
    if inv_num:
        existing_inv = db.query(SupplierInvoice).filter(
            SupplierInvoice.supplier_id == fillup.supplier_id,
            SupplierInvoice.invoice_number == inv_num,
            SupplierInvoice.entity_id == fillup.entity_id,
        ).first()
        if existing_inv:
            fillup.supplier_invoice_id = existing_inv.id
            db.commit()
            return

    supplier = db.query(Supplier).filter(Supplier.id == fillup.supplier_id).first()
    if not supplier:
        return
    # Non-diesel suppliers don't get auto-invoices — log and skip rather than silently returning
    if not supplier.is_diesel_supplier:
        import logging
        logging.getLogger(__name__).warning(
            f"Diesel fill-up #{fillup.id}: supplier {supplier.id} ({supplier.name}) is not marked "
            f"as a diesel supplier — skipping auto-invoice creation"
        )
        return

    truck = db.query(Truck).filter(Truck.id == fillup.truck_id).first()
    vehicle_reg = truck.registration if truck else None

    inv_datetime = datetime(fillup.fillup_date.year, fillup.fillup_date.month, fillup.fillup_date.day, tzinfo=timezone.utc)

    inv = SupplierInvoice(
        entity_id=fillup.entity_id,
        supplier_id=fillup.supplier_id,
        invoice_number=inv_num,
        invoice_date=inv_datetime,
        # Amount owed to the diesel supplier = litres × rate (the diesel cost).
        # The internal admin fee stays on the fill-up (total_amount) and in costing,
        # so it must not inflate the supplier invoice / its displayed rate.
        amount=fillup.amount,
        litres=fillup.litres,
        vat_applicable=False,
        vehicle_reg=vehicle_reg,
        statement_month=fillup.fillup_date.month,
        statement_year=fillup.fillup_date.year,
        created_by_id=user_id,
    )
    db.add(inv)
    db.flush()

    fillup.supplier_invoice_id = inv.id
    ref = inv_num or fillup.slip_number or f"fill-up #{fillup.id}"
    log_action(
        db, "supplier_invoice.auto_created", user_id=user_id,
        entity_id=fillup.entity_id, resource_type="supplier_invoice",
        description=f"Auto-created supplier invoice {ref} from diesel fill-up for {vehicle_reg} ({fillup.litres}L)",
    )
    db.commit()


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


def _enrich_fillup(f: DieselFillUp, db=None) -> dict:
    d = {c.name: getattr(f, c.name) for c in f.__table__.columns}
    d["truck_registration"] = f.truck.registration if f.truck else None
    d["supplier_name"]      = f.supplier.name if f.supplier else None
    d["supplier_invoice_number"] = f.supplier_invoice.invoice_number if f.supplier_invoice else None
    if db:
        d.update(get_verification_display(db, f))
    return d


# ── Diesel Warnings (dashboard) ──────────────────────────────────────────────

@router.get("/warnings")
def get_diesel_warnings(
    entity_id: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return counts of diesel fill-ups missing slip# or invoice# for the dashboard.

    Scoped to the selected fill-up month/year (defaults to the current month)."""
    accessible = _accessible_entity_ids(current_user)
    now = datetime.now(tz=timezone.utc)
    period_month = month or now.month
    period_year  = year or now.year

    q = db.query(DieselFillUp).filter(
        DieselFillUp.is_archived == False,
        func.extract('month', DieselFillUp.fillup_date) == period_month,
        func.extract('year', DieselFillUp.fillup_date) == period_year,
    )
    if accessible is not None:
        q = q.filter(DieselFillUp.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(DieselFillUp.entity_id == entity_id)

    fillups = q.all()
    missing_slip = [
        {"id": f.id, "truck_id": f.truck_id, "supplier_id": f.supplier_id,
         "fillup_date": str(f.fillup_date), "invoice_number": f.invoice_number,
         "truck_registration": f.truck.registration if f.truck else None,
         "supplier_name": f.supplier.name if f.supplier else None}
        for f in fillups if not f.slip_number
    ]
    missing_invoice = [
        {"id": f.id, "truck_id": f.truck_id, "supplier_id": f.supplier_id,
         "fillup_date": str(f.fillup_date), "slip_number": f.slip_number,
         "truck_registration": f.truck.registration if f.truck else None,
         "supplier_name": f.supplier.name if f.supplier else None}
        for f in fillups if not f.supplier_invoice_id
    ]
    return {
        "missing_slip_count": len(missing_slip),
        "missing_invoice_count": len(missing_invoice),
        "missing_slip": missing_slip,
        "missing_invoice": missing_invoice,
    }


# ── Diesel Settings ───────────────────────────────────────────────────────────

@router.get("/settings", response_model=List[DieselSettingsOut])
def list_diesel_settings(
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return diesel settings for all accessible entities (or a single one)."""
    accessible = _accessible_entity_ids(current_user)
    q = db.query(DieselSettings)
    if accessible is not None:
        q = q.filter(DieselSettings.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(DieselSettings.entity_id == entity_id)
    return q.order_by(DieselSettings.entity_id).all()


@router.put("/settings/{entity_id}", response_model=DieselSettingsOut)
def update_diesel_settings(
    entity_id: int,
    payload: DieselSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.admin_fee_pct < 0 or payload.admin_fee_pct > 100:
        raise HTTPException(status_code=400, detail="admin_fee_pct must be between 0 and 100")

    settings = db.query(DieselSettings).filter(DieselSettings.entity_id == entity_id).first()
    if not settings:
        # Auto-create if missing (shouldn't happen after migration, but safe)
        settings = DieselSettings(entity_id=entity_id)
        db.add(settings)

    settings.admin_fee_pct = payload.admin_fee_pct
    settings.apply_admin_fee = payload.apply_admin_fee
    settings.additional_charge_per_ton = payload.additional_charge_per_ton
    settings.subcontractor_monthly_admin_fee = payload.subcontractor_monthly_admin_fee
    settings.updated_by = current_user.id
    settings.updated_at = datetime.now(tz=timezone.utc)

    # Recalculate all unpaid, non-archived subcontractor loads for this entity
    # so the new additional_charge_per_ton takes effect immediately.
    new_fee = Decimal(str(payload.additional_charge_per_ton))
    TWO_DP = Decimal("0.01")
    VAT = Decimal("1.15")

    sub_loads = (
        db.query(TruckLoad)
        .join(Truck, Truck.id == TruckLoad.truck_id)
        .filter(
            TruckLoad.entity_id == entity_id,
            TruckLoad.is_paid.is_(False),
            TruckLoad.is_archived.is_(False),
            Truck.is_subcontractor.is_(True),
        )
        .all()
    )

    # Cache truck-entity VAT status to avoid repeated queries
    _entity_vat: dict = {}

    def _sub_vat(truck: Truck) -> bool:
        if truck.entity_id not in _entity_vat:
            te = db.query(BusinessEntity).filter(BusinessEntity.id == truck.entity_id).first()
            _entity_vat[truck.entity_id] = te.vat_registered if te else True
        return _entity_vat[truck.entity_id]

    loads_updated = 0
    for load in sub_loads:
        load.subcontractor_admin_fee_per_ton = new_fee
        if load.tonnes is not None and load.rate_per_ton is not None:
            sub_rate = Decimal(str(load.rate_per_ton)) - new_fee
            excl     = Decimal(str(load.tonnes)) * sub_rate
            load.subcontractor_rate            = sub_rate.quantize(TWO_DP)
            load.subcontractor_amount_excl_vat = excl.quantize(TWO_DP)
            load.subcontractor_amount_incl_vat = (
                (excl * VAT) if _sub_vat(load.truck) else excl
            ).quantize(TWO_DP)
            loads_updated += 1

    log_action(
        db, "diesel_settings.updated", user_id=current_user.id,
        entity_id=entity_id, resource_type="diesel_settings",
        description=(
            f"Updated diesel admin fee to {payload.admin_fee_pct}% for entity {entity_id}; "
            f"{loads_updated} unpaid subcontractor loads recalculated"
        ),
    )
    db.commit()
    db.refresh(settings)

    out = DieselSettingsOut.model_validate(settings)
    out.loads_updated = loads_updated
    return out


# ── Diesel Rates ──────────────────────────────────────────────────────────────

@router.get("/rates", response_model=List[DieselRateOut])
def list_diesel_rates(
    entity_id: Optional[int] = Query(None),
    supplier_id: Optional[int] = Query(None),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)
    q = db.query(DieselRate)
    if accessible is not None:
        q = q.filter(DieselRate.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(DieselRate.entity_id == entity_id)
    if supplier_id:
        q = q.filter(DieselRate.supplier_id == supplier_id)
    if active_only:
        q = q.filter(DieselRate.is_active == True)

    rates = q.order_by(DieselRate.supplier_id, DieselRate.effective_date.desc()).all()
    result = []
    for r in rates:
        d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
        d["supplier_name"] = r.supplier.name if r.supplier else None
        result.append(d)
    return result


@router.get("/rates/supplier/{supplier_id}/current", response_model=Optional[DieselRateOut])
def get_current_rate_for_supplier(
    supplier_id: int,
    entity_id: int = Query(...),
    on_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(entity_id, current_user)
    check_date = on_date or date.today()
    rate = DieselCalculationService.get_active_rate(db, supplier_id, entity_id, check_date)
    if not rate:
        return None
    d = {c.name: getattr(rate, c.name) for c in rate.__table__.columns}
    d["supplier_name"] = rate.supplier.name if rate.supplier else None
    return d


@router.get("/rates/{rate_id}", response_model=DieselRateOut)
def get_diesel_rate(
    rate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate = db.query(DieselRate).filter(DieselRate.id == rate_id).first()
    if not rate:
        raise HTTPException(status_code=404, detail="Rate not found")
    _check_entity_access(rate.entity_id, current_user)
    d = {c.name: getattr(rate, c.name) for c in rate.__table__.columns}
    d["supplier_name"] = rate.supplier.name if rate.supplier else None
    return d


@router.post("/rates", response_model=DieselRateOut)
def create_diesel_rate(
    payload: DieselRateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    if payload.rate_per_litre <= 0:
        raise HTTPException(status_code=400, detail="Rate per litre must be greater than 0")

    # Warn if back-dated (still allow it)
    warnings = []
    existing_newer = db.query(DieselRate).filter(
        DieselRate.supplier_id == payload.supplier_id,
        DieselRate.entity_id == payload.entity_id,
        DieselRate.effective_date > payload.effective_date,
        DieselRate.is_active == True,
    ).first()
    if existing_newer:
        warnings.append("A newer rate already exists for this supplier — existing fill-ups are not affected.")

    rate = DieselRate(
        **payload.model_dump(),
        created_by=current_user.id,
    )
    db.add(rate)
    log_action(
        db, "diesel_rate.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="diesel_rate",
        description=f"Added diesel rate R{payload.rate_per_litre}/L from {payload.effective_date}",
    )
    db.commit()
    db.refresh(rate)
    d = {c.name: getattr(rate, c.name) for c in rate.__table__.columns}
    d["supplier_name"] = rate.supplier.name if rate.supplier else None
    return d


@router.put("/rates/{rate_id}", response_model=DieselRateOut)
def update_diesel_rate(
    rate_id: int,
    payload: DieselRateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Only notes and is_active are editable after creation."""
    rate = db.query(DieselRate).filter(DieselRate.id == rate_id).first()
    if not rate:
        raise HTTPException(status_code=404, detail="Rate not found")
    _check_entity_access(rate.entity_id, current_user)

    if payload.notes is not None:
        rate.notes = payload.notes
    if payload.is_active is not None:
        rate.is_active = payload.is_active
    if payload.effective_to is not None:
        rate.effective_to = payload.effective_to

    log_action(
        db, "diesel_rate.updated", user_id=current_user.id,
        entity_id=rate.entity_id, resource_type="diesel_rate",
        resource_id=rate_id, description=f"Updated diesel rate #{rate_id}",
    )
    db.commit()
    db.refresh(rate)
    d = {c.name: getattr(rate, c.name) for c in rate.__table__.columns}
    d["supplier_name"] = rate.supplier.name if rate.supplier else None
    return d


# ── Diesel Fill-Ups ───────────────────────────────────────────────────────────

@router.get("/fillups/summary", response_model=DieselFillUpSummary)
def get_fillup_summary(
    entity_id: Optional[int] = Query(None),
    truck_id: Optional[int] = Query(None),
    supplier_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    verified: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)
    q = db.query(DieselFillUp)
    if accessible is not None:
        q = q.filter(DieselFillUp.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(DieselFillUp.entity_id == entity_id)
    if truck_id:
        q = q.filter(DieselFillUp.truck_id == truck_id)
    if supplier_id:
        q = q.filter(DieselFillUp.supplier_id == supplier_id)
    if year:
        q = q.filter(func.extract("year", DieselFillUp.fillup_date) == year)
    if month:
        q = q.filter(func.extract("month", DieselFillUp.fillup_date) == month)
    if verified is not None:
        q = q.filter(DieselFillUp.verified == verified)
    q = q.filter(DieselFillUp.is_archived != True)

    rows = q.with_entities(
        func.count(DieselFillUp.id),
        func.coalesce(func.sum(DieselFillUp.litres), 0),
        func.coalesce(func.sum(DieselFillUp.amount), 0),
        func.coalesce(func.sum(DieselFillUp.admin_fee_amount), 0),
        func.coalesce(func.sum(DieselFillUp.admin_fee_vat), 0),
        func.coalesce(func.sum(DieselFillUp.total_amount), 0),
    ).one()

    return DieselFillUpSummary(
        total_fillups=rows[0],
        total_litres=Decimal(str(rows[1])),
        total_amount=Decimal(str(rows[2])),
        total_admin_fee=Decimal(str(rows[3])),
        total_admin_fee_vat=Decimal(str(rows[4])),
        grand_total=Decimal(str(rows[5])),
    )


@router.get("/fillups", response_model=List[DieselFillUpOut])
def list_fillups(
    entity_id: Optional[int] = Query(None),
    truck_id: Optional[int] = Query(None),
    supplier_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    verified: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)
    q = db.query(DieselFillUp)
    if accessible is not None:
        q = q.filter(DieselFillUp.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(DieselFillUp.entity_id == entity_id)
    if truck_id:
        q = q.filter(DieselFillUp.truck_id == truck_id)
    if supplier_id:
        q = q.filter(DieselFillUp.supplier_id == supplier_id)
    if year:
        q = q.filter(func.extract("year", DieselFillUp.fillup_date) == year)
    if month:
        q = q.filter(func.extract("month", DieselFillUp.fillup_date) == month)
    if verified is not None:
        q = q.filter(DieselFillUp.verified == verified)
    q = q.filter(DieselFillUp.is_archived != True)

    fillups = q.order_by(DieselFillUp.fillup_date.desc(), DieselFillUp.id.desc()).offset(skip).limit(limit).all()
    return [_enrich_fillup(f, db) for f in fillups]


@router.get("/fillups/truck/{truck_id}", response_model=List[DieselFillUpOut])
def list_fillups_by_truck(
    truck_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    _check_entity_access(truck.entity_id, current_user)

    fillups = (
        db.query(DieselFillUp)
        .filter(DieselFillUp.truck_id == truck_id, DieselFillUp.is_archived != True)
        .order_by(DieselFillUp.fillup_date.desc())
        .offset(skip).limit(limit).all()
    )
    return [_enrich_fillup(f) for f in fillups]


@router.get("/fillups/{fillup_id}", response_model=DieselFillUpOut)
def get_fillup(
    fillup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(DieselFillUp).filter(DieselFillUp.id == fillup_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fill-up not found")
    _check_entity_access(f.entity_id, current_user)
    return _enrich_fillup(f)


@router.post("/fillups", response_model=DieselFillUpOut)
def create_fillup(
    payload: DieselFillUpCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)

    if payload.litres <= 0:
        raise HTTPException(status_code=400, detail="Litres must be greater than 0")
    if payload.rate_per_litre <= 0:
        raise HTTPException(status_code=400, detail="Rate per litre must be greater than 0")
    if payload.fillup_date > date.today():
        raise HTTPException(status_code=400, detail="Fill-up date cannot be in the future")

    # Hard block duplicates (ignore archived records)
    if payload.slip_number and payload.truck_id:
        existing = db.query(DieselFillUp).filter(
            DieselFillUp.truck_id == payload.truck_id,
            DieselFillUp.supplier_id == payload.supplier_id,
            DieselFillUp.slip_number == payload.slip_number.strip(),
            DieselFillUp.is_archived == False,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Slip '{payload.slip_number}' already exists for this truck",
            )
    if payload.invoice_number and payload.supplier_id:
        existing = db.query(DieselFillUp).filter(
            DieselFillUp.supplier_id == payload.supplier_id,
            DieselFillUp.invoice_number == payload.invoice_number.strip(),
            DieselFillUp.is_archived == False,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Invoice '{payload.invoice_number}' already exists for this supplier",
            )

    # Get entity diesel settings for admin fee
    settings = DieselCalculationService.get_diesel_settings(db, payload.entity_id)
    admin_fee_pct = Decimal(str(settings.admin_fee_pct)) if settings else Decimal("0")
    apply_admin_fee = settings.apply_admin_fee if settings else False

    entity_obj = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
    vat_rate = Decimal(str(entity_obj.vat_rate)) if entity_obj and entity_obj.vat_rate else Decimal("0.15")

    amounts = DieselCalculationService.calculate_fillup_amounts(
        litres=payload.litres,
        rate_per_litre=payload.rate_per_litre,
        admin_fee_pct=admin_fee_pct,
        apply_admin_fee=apply_admin_fee,
        vat_rate=vat_rate,
    )

    f = DieselFillUp(
        entity_id=payload.entity_id,
        truck_id=payload.truck_id,
        supplier_id=payload.supplier_id,
        fillup_date=payload.fillup_date,
        litres=payload.litres,
        rate_per_litre=payload.rate_per_litre,
        invoice_number=payload.invoice_number,
        slip_number=payload.slip_number,
        truckload_id=payload.truckload_id,
        supplier_invoice_id=payload.supplier_invoice_id,
        notes=payload.notes,
        admin_fee_pct=admin_fee_pct,
        **amounts,
        created_by=current_user.id,
    )
    db.add(f)
    log_action(
        db, "diesel_fillup.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="diesel_fillup",
        description=f"Added {payload.litres}L diesel fill-up on {payload.fillup_date}",
    )
    db.commit()
    db.refresh(f)

    if f.truckload_id:
        _sync_truckload_diesel(db, f.truckload_id, f)

    if (f.invoice_number or f.slip_number) and not f.supplier_invoice_id and f.supplier_id:
        try:
            _auto_link_or_create_supplier_invoice(db, f, current_user.id)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error(
                f"Auto-link supplier invoice failed for fill-up #{f.id}: {exc}", exc_info=True
            )

    return _enrich_fillup(f)


@router.put("/fillups/{fillup_id}", response_model=DieselFillUpOut)
def update_fillup(
    fillup_id: int,
    payload: DieselFillUpUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(DieselFillUp).filter(DieselFillUp.id == fillup_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fill-up not found")
    _check_entity_access(f.entity_id, current_user)

    updates = payload.model_dump(exclude_none=True)

    # Recalculate amounts if litres or rate changes
    litres = Decimal(str(updates.get("litres", f.litres)))
    rate = Decimal(str(updates.get("rate_per_litre", f.rate_per_litre)))
    if "litres" in updates or "rate_per_litre" in updates:
        settings = DieselCalculationService.get_diesel_settings(db, f.entity_id)
        admin_fee_pct = Decimal(str(f.admin_fee_pct))  # keep snapshotted pct
        apply_admin_fee = settings.apply_admin_fee if settings else (admin_fee_pct > 0)
        entity_obj = db.query(BusinessEntity).filter(BusinessEntity.id == f.entity_id).first()
        vat_rate = Decimal(str(entity_obj.vat_rate)) if entity_obj and entity_obj.vat_rate else Decimal("0.15")
        amounts = DieselCalculationService.calculate_fillup_amounts(litres, rate, admin_fee_pct, apply_admin_fee, vat_rate)
        updates.update(amounts)

    for field, value in updates.items():
        setattr(f, field, value)

    log_action(
        db, "diesel_fillup.updated", user_id=current_user.id,
        entity_id=f.entity_id, resource_type="diesel_fillup",
        resource_id=fillup_id, description=f"Updated diesel fill-up #{fillup_id}",
    )
    db.commit()
    db.refresh(f)

    if f.truckload_id:
        _sync_truckload_diesel(db, f.truckload_id, f)

    # Keep the linked supplier invoice in step when the rate/litres change, so an
    # edited (e.g. custom once-off) rate flows through to the Supplier Profile
    # instead of the invoice keeping its original auto-filled amount.
    # The invoice amount is the diesel cost owed to the supplier — litres × rate,
    # EXCLUDING the internal admin fee (which stays on the fill-up / in costing).
    # Only sync a single-fill-up auto-created invoice — multi-line invoices (e.g.
    # WBG imports) hold per-slip data in line items and must not be overwritten.
    if ("litres" in updates or "rate_per_litre" in updates) and f.supplier_invoice_id:
        inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == f.supplier_invoice_id).first()
        if inv and not inv.is_multi_line:
            linked_count = db.query(func.count(DieselFillUp.id)).filter(
                DieselFillUp.supplier_invoice_id == inv.id,
                DieselFillUp.is_archived == False,
            ).scalar() or 0
            if linked_count <= 1:
                inv.amount = f.amount
                inv.litres = f.litres
                db.commit()

    # Auto-link supplier invoice if we now have a slip/invoice number and no existing link
    if (f.invoice_number or f.slip_number) and not f.supplier_invoice_id and f.supplier_id:
        try:
            _auto_link_or_create_supplier_invoice(db, f, current_user.id)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error(
                f"Auto-link supplier invoice failed for fill-up #{f.id}: {exc}", exc_info=True
            )

    return _enrich_fillup(f)


@router.patch("/fillups/{fillup_id}/archive")
def archive_fillup(
    fillup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(DieselFillUp).filter(DieselFillUp.id == fillup_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fill-up not found")
    _check_entity_access(f.entity_id, current_user)

    f.is_archived = True
    log_action(
        db, "diesel_fillup.archived", user_id=current_user.id,
        entity_id=f.entity_id, resource_type="diesel_fillup",
        resource_id=fillup_id, description=f"Archived diesel fill-up #{fillup_id}",
    )
    db.commit()
    return {"detail": "Fill-up archived"}


@router.delete("/fillups/{fillup_id}")
def delete_fillup(
    fillup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(DieselFillUp).filter(DieselFillUp.id == fillup_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fill-up not found")
    _check_entity_access(f.entity_id, current_user)

    if f.verified and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Cannot delete a verified fill-up. Contact an admin.")

    old_truckload_id = f.truckload_id
    log_action(
        db, "diesel_fillup.deleted", user_id=current_user.id,
        entity_id=f.entity_id, resource_type="diesel_fillup",
        resource_id=fillup_id, description=f"Deleted diesel fill-up #{fillup_id}",
    )
    db.delete(f)
    if old_truckload_id:
        _clear_truckload_diesel(db, old_truckload_id)
    db.commit()
    return {"detail": "Fill-up deleted"}


@router.patch("/fillups/{fillup_id}/verify")
def verify_fillup(
    fillup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(DieselFillUp).filter(DieselFillUp.id == fillup_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fill-up not found")
    _check_entity_access(f.entity_id, current_user)

    apply_verify_step(f, current_user, is_admin=(current_user.role == "admin"))
    log_action(
        db, "diesel_fillup.verified", user_id=current_user.id,
        entity_id=f.entity_id, resource_type="diesel_fillup",
        resource_id=fillup_id, description=f"Verified diesel fill-up #{fillup_id}",
    )
    db.commit()
    db.refresh(f)
    return _enrich_fillup(f, db)


@router.patch("/fillups/{fillup_id}/finalize")
def finalize_fillup(
    fillup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(DieselFillUp).filter(DieselFillUp.id == fillup_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fill-up not found")
    _check_entity_access(f.entity_id, current_user)
    apply_finalize_step(f, current_user, is_admin=(current_user.role == "admin"))
    log_action(
        db, "diesel_fillup.finalized", user_id=current_user.id,
        entity_id=f.entity_id, resource_type="diesel_fillup",
        resource_id=fillup_id, description=f"Applied final lock on diesel fill-up #{fillup_id}",
    )
    db.commit()
    db.refresh(f)
    return _enrich_fillup(f, db)


# ── Diesel Reports ────────────────────────────────────────────────────────────

@router.get("/reports/monthly-by-truck", response_model=List[DieselSummaryByTruck])
def report_monthly_by_truck(
    entity_id: int = Query(...),
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(entity_id, current_user)
    return DieselCalculationService.get_monthly_summary_by_truck(db, entity_id, year, month)


@router.get("/reports/monthly-by-supplier", response_model=List[DieselSupplierReconciliation])
def report_monthly_by_supplier(
    entity_id: int = Query(...),
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(entity_id, current_user)
    return DieselCalculationService.get_supplier_reconciliation(db, entity_id, year, month)


@router.get("/reports/cost-per-load")
def report_cost_per_load(
    truckload_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truckload = db.query(TruckLoad).filter(TruckLoad.id == truckload_id).first()
    if not truckload:
        raise HTTPException(status_code=404, detail="Truckload not found")
    _check_entity_access(truckload.entity_id, current_user)

    fillups = db.query(DieselFillUp).filter(DieselFillUp.truckload_id == truckload_id).all()
    total_cost = DieselCalculationService.get_diesel_cost_per_load(db, truckload_id)

    return {
        "truckload_id": truckload_id,
        "load_date": truckload.load_date,
        "truck_registration": truckload.truck.registration if truckload.truck else None,
        "mine_name": truckload.mine.name if truckload.mine else None,
        "tonnes": truckload.tonnes,
        "fillups": [_enrich_fillup(f) for f in fillups],
        "total_diesel_cost": str(total_cost),
        "diesel_cost_per_ton": str((total_cost / Decimal(str(truckload.tonnes))).quantize(Decimal("0.01"))) if truckload.tonnes else "0.00",
    }


@router.get("/reports/annual-summary", response_model=List[DieselAnnualMonthRow])
def report_annual_summary(
    entity_id: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(entity_id, current_user)
    return DieselCalculationService.get_annual_summary(db, entity_id, year)


@router.post("/fillups/repair-invoice-links")
def repair_invoice_links(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Admin-only. Retroactively creates/links SupplierInvoices for all DieselFillUps
    that have a slip_number or invoice_number but no supplier_invoice_id.
    Returns a count of how many were linked.
    """
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    unlinked = db.query(DieselFillUp).filter(
        DieselFillUp.supplier_invoice_id == None,
        DieselFillUp.supplier_id != None,
        DieselFillUp.is_archived == False,
        (DieselFillUp.invoice_number != None) | (DieselFillUp.slip_number != None),
    ).all()

    linked = 0
    skipped = []
    for f in unlinked:
        try:
            _auto_link_or_create_supplier_invoice(db, f, current_user.id)
            if f.supplier_invoice_id:
                linked += 1
        except Exception as exc:
            skipped.append({"fillup_id": f.id, "error": str(exc)})

    return {"linked": linked, "skipped": skipped, "total_checked": len(unlinked)}


# ── Invoice vs fill-up reconciliation ────────────────────────────────────────

@router.get("/invoice-reconciliation", response_model=List[DieselInvoiceReconciliationRow])
def diesel_invoice_reconciliation(
    entity_id: int = Query(...),
    statement_month: int = Query(...),
    statement_year: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Per diesel supplier: compare supplier invoice total against the sum of
    linked DieselFillUp records for the same period.
    """
    accessible = (
        None if current_user.role == "admin"
        else [a.entity_id for a in current_user.entity_access]
    )
    if accessible is not None and entity_id not in accessible:
        raise HTTPException(status_code=403, detail="Access denied to this entity")

    # ── Invoice totals per diesel supplier for the period ─────────────────────
    inv_rows = (
        db.query(
            Supplier.id.label("supplier_id"),
            Supplier.name.label("supplier_name"),
            func.count(SupplierInvoice.id).label("invoice_count"),
            func.coalesce(func.sum(SupplierInvoice.amount), 0).label("invoice_total"),
        )
        .join(SupplierInvoice, SupplierInvoice.supplier_id == Supplier.id)
        .filter(
            Supplier.is_diesel_supplier.is_(True),
            SupplierInvoice.entity_id == entity_id,
            SupplierInvoice.statement_month == statement_month,
            SupplierInvoice.statement_year == statement_year,
            SupplierInvoice.is_archived.is_(False),
        )
        .group_by(Supplier.id, Supplier.name)
        .all()
    )

    # ── Fill-up totals per supplier for invoices in the same period ───────────
    fillup_rows = (
        db.query(
            DieselFillUp.supplier_id.label("supplier_id"),
            func.count(DieselFillUp.id).label("fillup_count"),
            func.coalesce(func.sum(DieselFillUp.total_amount), 0).label("fillup_total"),
        )
        .join(SupplierInvoice, SupplierInvoice.id == DieselFillUp.supplier_invoice_id)
        .filter(
            DieselFillUp.entity_id == entity_id,
            SupplierInvoice.statement_month == statement_month,
            SupplierInvoice.statement_year == statement_year,
            DieselFillUp.is_archived.is_(False),
        )
        .group_by(DieselFillUp.supplier_id)
        .all()
    )

    fillup_by_supplier = {r.supplier_id: r for r in fillup_rows}

    result = []
    for inv in inv_rows:
        fu = fillup_by_supplier.get(inv.supplier_id)
        invoice_total = Decimal(str(inv.invoice_total))
        fillup_total  = Decimal(str(fu.fillup_total)) if fu else Decimal("0")
        diff = invoice_total - fillup_total
        result.append(DieselInvoiceReconciliationRow(
            supplier_id=inv.supplier_id,
            supplier_name=inv.supplier_name,
            invoice_count=inv.invoice_count,
            invoice_total=invoice_total.quantize(Decimal("0.01")),
            fillup_count=fu.fillup_count if fu else 0,
            fillup_total=fillup_total.quantize(Decimal("0.01")),
            difference=diff.quantize(Decimal("0.01")),
            is_matched=abs(diff) < Decimal("0.10"),
        ))

    return result
