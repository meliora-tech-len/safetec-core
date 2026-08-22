from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session, joinedload

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
    DieselImportRequest, DieselImportResult, DieselImportRowResult,
)
from app.services.diesel_service import (
    DieselCalculationService, diesel_type_for_supplier, apply_fillup_period,
    supplier_bills_own_admin_fee,
)
from app.services.vat import entity_vat
from app.services.invoice_lock import (
    ensure_fillup_unlocked, ensure_invoice_unlocked, exclude_locked_invoices,
    invoice_label, is_invoice_locked, lock_message, locked_invoice_ids,
    resolve_invoice_id,
)
from app.services.audit import log_action
from app.services.profit_sheet_lock import ensure_truck_month_open
from app.services.verification import (
    apply_verify_step, apply_finalize_step, get_verification_display, ensure_not_locked,
    intent_from_action,
)

router = APIRouter(prefix="/api/diesel", tags=["diesel"])


def _ensure_fillup_month_open(db: Session, truck_id, supplier_invoice_id, fillup_date):
    """Profit Sheet final lock: a fill-up counts under its linked invoice's
    statement period, falling back to the slip date (fillup_effective_period) —
    that period's sheet must still be open for the truck."""
    year = month = None
    if supplier_invoice_id:
        inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == supplier_invoice_id).first()
        if inv and inv.statement_year and inv.statement_month:
            year, month = inv.statement_year, inv.statement_month
    if year is None and fillup_date is not None:
        year, month = fillup_date.year, fillup_date.month
    if year is not None:
        ensure_truck_month_open(db, truck_id, year, month)


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


def _auto_link_or_create_supplier_invoice(db: Session, fillup: DieselFillUp, user_id: int, commit: bool = True) -> None:
    """
    Called after a DieselFillUp is saved with an invoice_number or slip_number but no supplier_invoice_id.
    Links to an existing SupplierInvoice if found by invoice_number, otherwise auto-creates one.
    Pass commit=False when running inside a larger transaction (e.g. the sheet import).
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
            if commit:
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
        # Imported fill-ups carry only a depot slip number — use it as the
        # invoice number so the supplier profile shows an identifiable document
        invoice_number=inv_num or (fillup.slip_number.strip() if fillup.slip_number else None),
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
    if commit:
        db.commit()


from app.core.security import check_entity_access as _check_entity_access


from app.core.security import accessible_entity_ids as _accessible_entity_ids


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

    Scoped to the selected fill-up month/year (defaults to the current month).
    Exception: OBHI handles diesel on a different cadence to the statement month,
    so its warnings are NOT period-scoped — every outstanding fill-up missing a
    slip#/invoice# is shown (the original, pre-statement-period behaviour)."""
    accessible = _accessible_entity_ids(current_user)
    now = datetime.now(tz=timezone.utc)
    period_month = month or now.month
    period_year  = year or now.year

    is_obhi = bool(entity_id) and db.query(BusinessEntity.code).filter(
        BusinessEntity.id == entity_id).scalar() == "OBHI"

    q = db.query(DieselFillUp).filter(DieselFillUp.is_archived == False)
    if not is_obhi:
        q = q.filter(
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

    # The fee % each existing fill-up was captured under, before this change.
    old_effective_pct = (
        Decimal(str(settings.admin_fee_pct or 0)) if settings.apply_admin_fee else Decimal("0")
    )

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

    # Cache truck-entity VAT status (registered, saved rate) to avoid repeated queries
    _entity_vat: dict = {}

    def _sub_vat(truck: Truck):
        if truck.entity_id not in _entity_vat:
            _entity_vat[truck.entity_id] = entity_vat(db, truck.entity_id)
        return _entity_vat[truck.entity_id]

    # Re-snapshot the admin fee onto existing fill-ups. Every creation path stores
    # the entity's fee % on the fill-up at capture time, so without this a change
    # here only takes effect on fill-ups logged from now on — which is how Safetec's
    # May/June 2026 admin fees ended up blank after the fee was switched off and
    # back on again (migration 119 repaired that batch).
    #
    # Only rows that were following the entity setting are touched, i.e. still
    # carrying the pre-change %. A fill-up on a different % holds a fee the supplier
    # itself billed per line (Intsimbi's 1.5%, back-computed from their statement) —
    # that is a real invoiced amount, not our markup, and must survive. Archived and
    # finally-verified rows are skipped too, as is anything on a locked diesel
    # invoice: the locks are what freeze a reconciled invoice against a later fee change.
    new_pct = Decimal(str(payload.admin_fee_pct))
    apply_fee = bool(payload.apply_admin_fee)
    new_effective_pct = new_pct if apply_fee else Decimal("0")
    entity_obj = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    entity_vat = Decimal(str(entity_obj.vat_rate)) if entity_obj and entity_obj.vat_rate else Decimal("0.15")

    fillups_updated = 0
    if new_effective_pct != old_effective_pct:
        stale_q = db.query(DieselFillUp).filter(
            DieselFillUp.entity_id == entity_id,
            DieselFillUp.is_archived.is_(False),
            DieselFillUp.verified3_by.is_(None),
            func.coalesce(DieselFillUp.admin_fee_pct, 0) == old_effective_pct,
        )
        stale_fillups = exclude_locked_invoices(db, stale_q, entity_id).all()
        for f in stale_fillups:
            amounts = DieselCalculationService.calculate_fillup_amounts(
                litres=Decimal(str(f.litres or 0)),
                rate_per_litre=Decimal(str(f.rate_per_litre or 0)),
                admin_fee_pct=new_pct,
                apply_admin_fee=apply_fee,
                vat_rate=entity_vat,
            )
            f.admin_fee_pct = new_effective_pct
            for field, value in amounts.items():
                setattr(f, field, value)
            fillups_updated += 1

    loads_updated = 0
    for load in sub_loads:
        load.subcontractor_admin_fee_per_ton = new_fee
        if load.tonnes is not None and load.rate_per_ton is not None:
            sub_rate = Decimal(str(load.rate_per_ton)) - new_fee
            excl     = Decimal(str(load.tonnes)) * sub_rate
            load.subcontractor_rate            = sub_rate.quantize(TWO_DP)
            load.subcontractor_amount_excl_vat = excl.quantize(TWO_DP)
            sub_registered, sub_rate = _sub_vat(load.truck)
            load.subcontractor_amount_incl_vat = (
                (excl * (Decimal("1") + sub_rate)) if sub_registered else excl
            ).quantize(TWO_DP)
            loads_updated += 1

    log_action(
        db, "diesel_settings.updated", user_id=current_user.id,
        entity_id=entity_id, resource_type="diesel_settings",
        description=(
            f"Updated diesel admin fee to {payload.admin_fee_pct}% for entity {entity_id}; "
            f"{loads_updated} unpaid subcontractor loads recalculated; "
            f"{fillups_updated} unlocked fill-ups re-costed"
        ),
    )
    db.commit()
    db.refresh(settings)

    out = DieselSettingsOut.model_validate(settings)
    out.loads_updated = loads_updated
    out.fillups_updated = fillups_updated
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

def _apply_period_filter(q, month: Optional[int], year: Optional[int]):
    """Filter fill-ups by their STATEMENT period rather than the slip date.

    Thin wrapper over `apply_fillup_period` (services/diesel_service.py), which
    is the one rule the diesel reports read off too. Archiving is left to the
    caller here because several of these queries filter it themselves.
    """
    return apply_fillup_period(q, year, month, include_archived=True)


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
    q = _apply_period_filter(q, month, year)
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
    q = _apply_period_filter(q, month, year)
    if verified is not None:
        q = q.filter(DieselFillUp.verified == verified)
    q = q.filter(DieselFillUp.is_archived != True)

    fillups = q.order_by(DieselFillUp.fillup_date.desc(), DieselFillUp.id.desc()).offset(skip).limit(limit).all()
    return [_enrich_fillup(f, db) for f in fillups]


@router.get("/fillups/slips")
def list_fillup_slips(
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lightweight, deduped list of distinct slip numbers (+ autofill fields) for
    the slip# dropdown. Avoids _enrich_fillup's per-row user/truck/supplier queries
    so it stays fast even with thousands of fill-ups."""
    accessible = _accessible_entity_ids(current_user)
    q = (
        db.query(
            DieselFillUp.slip_number,
            DieselFillUp.litres,
            DieselFillUp.rate_per_litre,
            Truck.registration,
        )
        .outerjoin(Truck, DieselFillUp.truck_id == Truck.id)
        .filter(
            DieselFillUp.is_archived != True,
            DieselFillUp.slip_number.isnot(None),
            DieselFillUp.slip_number != "",
        )
    )
    if accessible is not None:
        q = q.filter(DieselFillUp.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(DieselFillUp.entity_id == entity_id)
    q = q.order_by(DieselFillUp.fillup_date.desc(), DieselFillUp.id.desc())

    seen = set()
    out = []
    for slip, litres, rate, reg in q.all():
        if slip in seen:
            continue
        seen.add(slip)
        out.append({
            "slip_number": slip,
            "litres": litres,
            "rate_per_litre": rate,
            "truck_registration": reg,
        })
    return out


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

    entity_obj = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
    is_bkmo = bool(entity_obj) and entity_obj.code == "BKMO"

    if payload.litres <= 0:
        raise HTTPException(status_code=400, detail="Litres must be greater than 0")

    # BKMO can log a slip before its rate-per-litre is known (litres come off the
    # printed slip; R/L is filled in later by the Tradekor diesel import). The
    # placeholder is stored with rate 0 and rate_pending = True. Every other
    # entity must supply a rate up front.
    rate_pending = bool(payload.rate_pending) and is_bkmo
    # A hand-entered amount is an alternative to the rate — one implies the other,
    # so either alone is enough (a rate-pending placeholder has neither yet).
    has_amount = payload.amount is not None and payload.amount > 0 and not rate_pending
    if rate_pending:
        rate_per_litre = Decimal("0")
    else:
        rate_per_litre = payload.rate_per_litre
        if rate_per_litre <= 0 and not has_amount:
            raise HTTPException(status_code=400, detail="Enter a rate per litre or an amount")

    if payload.fillup_date > date.today():
        raise HTTPException(status_code=400, detail="Fill-up date cannot be in the future")

    # Diesel invoice lock — nothing may be added to an invoice that was closed
    # off, whether linked by id or by typing its invoice number (which auto-links)
    resolved_invoice_id = resolve_invoice_id(
        db, payload.entity_id, payload.supplier_id,
        payload.supplier_invoice_id, payload.invoice_number,
    )
    ensure_invoice_unlocked(db, resolved_invoice_id)
    _ensure_fillup_month_open(db, payload.truck_id, resolved_invoice_id, payload.fillup_date)

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

    vat_rate = Decimal(str(entity_obj.vat_rate)) if entity_obj and entity_obj.vat_rate else Decimal("0.15")

    # A hand-entered amount wins over litres × rate; with no rate typed, derive one
    # from it so the R/L column still reads sensibly.
    typed_amount = payload.amount if has_amount else None
    if typed_amount is not None and rate_per_litre <= 0 and payload.litres > 0:
        rate_per_litre = (Decimal(str(typed_amount)) / Decimal(str(payload.litres))).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP)

    amounts = DieselCalculationService.calculate_fillup_amounts(
        litres=payload.litres,
        rate_per_litre=rate_per_litre,
        admin_fee_pct=admin_fee_pct,
        apply_admin_fee=apply_admin_fee,
        vat_rate=vat_rate,
        amount=typed_amount,
    )

    # The tag is fixed per supplier (Merino & Oukop = top-up, everyone else =
    # fill-up) — derived here, never taken from the client.
    supplier_obj = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()

    f = DieselFillUp(
        entity_id=payload.entity_id,
        truck_id=payload.truck_id,
        supplier_id=payload.supplier_id,
        fillup_date=payload.fillup_date,
        litres=payload.litres,
        rate_per_litre=rate_per_litre,
        rate_pending=rate_pending,
        diesel_type=diesel_type_for_supplier(supplier_obj),
        invoice_number=payload.invoice_number,
        slip_number=payload.slip_number,
        depot_slip_number=payload.depot_slip_number or payload.slip_number,
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

    # A rate-pending placeholder has no known amount yet, so hold off on syncing
    # its (zero) rate onto the load and on creating a supplier invoice — both run
    # when the Tradekor import fills the rate in.
    if not rate_pending:
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


def _match_truck_by_reg(db: Session, entity_id: int, reg: str):
    """Find a truck in the entity by real OR temp registration.
    Case- and space-insensitive ('KXH 519 MP' matches 'KXH519MP'), so sheet
    formatting differences can't drop rows. Returns (truck, matched_by_temp)."""
    target = (reg or "").replace(" ", "").strip().upper()
    if not target:
        return None, False
    trucks = db.query(Truck).filter(Truck.entity_id == entity_id).all()
    for t in trucks:
        if (t.registration or "").replace(" ", "").strip().upper() == target:
            return t, False
    for t in trucks:
        if (t.temp_registration or "").replace(" ", "").strip().upper() == target:
            return t, True
    return None, False


@router.post("/import", response_model=DieselImportResult)
def import_diesel(
    payload: DieselImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import parsed diesel-sheet rows. The diesel supplier is resolved per row
    from its DIESEL DEPO (depot_suppliers map). Matches trucks by real/temp
    registration, derives rate = amount / litres, and applies the entity's 1%
    admin fee. With commit=false this is a dry-run preview (nothing is saved)."""
    _check_entity_access(payload.entity_id, current_user)

    entity_obj = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
    if not entity_obj or entity_obj.code != "BKMO":
        raise HTTPException(status_code=400, detail="Diesel sheet import is only available for Bokamosho (BKMO).")

    # Valid suppliers for this entity (id → name) and a case-insensitive depot map
    supplier_objs = {
        s.id: s
        for s in db.query(Supplier).filter(Supplier.entity_id == payload.entity_id).all()
    }
    supplier_names = {sid: s.name for sid, s in supplier_objs.items()}
    depot_map = { (k or "").strip().lower(): v for k, v in (payload.depot_suppliers or {}).items() }

    def resolve_supplier(depot: Optional[str]) -> Optional[int]:
        sid = depot_map.get((depot or "").strip().lower())
        if sid is None:
            sid = payload.default_supplier_id
        return sid if sid in supplier_names else None

    settings = DieselCalculationService.get_diesel_settings(db, payload.entity_id)
    admin_fee_pct = Decimal(str(settings.admin_fee_pct)) if settings else Decimal("0")
    apply_admin_fee = settings.apply_admin_fee if settings else False
    vat_rate = Decimal(str(entity_obj.vat_rate)) if entity_obj and entity_obj.vat_rate else Decimal("0.15")

    # Locked diesel invoices take no imported rows — flagged per row (and in the
    # dry-run preview) rather than failing the whole sheet, so the rest still lands.
    locked = locked_invoice_ids(db, payload.entity_id)

    result = DieselImportResult(total=len(payload.rows), committed=payload.commit)
    unmatched_regs: set[str] = set()
    # Profit Sheet lock state per (truck, year, month) — None = open, str = message
    ps_lock_cache: dict = {}
    # slips already seen in this batch (avoid in-file duplicates), keyed by (truck, supplier, slip)
    seen_batch: set[tuple] = set()
    # pending placeholders already resolved by an earlier row in this batch —
    # each placeholder may absorb exactly one imported row
    consumed_pending: set[int] = set()

    for row in payload.rows:
        litres = Decimal(str(row.litres or 0))
        amount = Decimal(str(row.amount or 0))
        rate = (amount / litres).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP) if litres > 0 else Decimal("0")

        rr = DieselImportRowResult(
            registration=row.registration, slip_number=row.slip_number,
            fillup_date=row.fillup_date, litres=litres, amount=amount,
            rate_per_litre=rate, depot=row.depot, status="invalid",
        )

        if litres <= 0 or amount <= 0:
            rr.status = "invalid"; rr.message = "Litres and amount must be greater than 0"
            result.invalid += 1; result.rows.append(rr); continue

        supplier_id = resolve_supplier(row.depot)
        if supplier_id is None:
            rr.status = "invalid"
            rr.message = f"No diesel supplier mapped for depot '{row.depot or '—'}'"
            result.invalid += 1; result.rows.append(rr); continue
        rr.supplier_id = supplier_id
        rr.supplier_name = supplier_names.get(supplier_id)

        truck, by_temp = _match_truck_by_reg(db, payload.entity_id, row.registration)
        if not truck:
            rr.status = "unmatched"; rr.message = "No truck with this registration (real or temp)"
            result.unmatched += 1
            unmatched_regs.add(row.registration.strip().upper())
            result.rows.append(rr); continue

        rr.truck_id = truck.id
        rr.truck_registration = truck.registration
        rr.matched_by_temp = by_temp

        # Profit Sheet final lock — flagged per row like the diesel invoice
        # lock, so the rest of the sheet still lands.
        ps_key = (truck.id, row.fillup_date.year, row.fillup_date.month)
        if ps_key not in ps_lock_cache:
            try:
                ensure_truck_month_open(db, truck, row.fillup_date.year, row.fillup_date.month)
                ps_lock_cache[ps_key] = None
            except HTTPException as exc:
                ps_lock_cache[ps_key] = exc.detail.get("message") if isinstance(exc.detail, dict) else str(exc.detail)
        if ps_lock_cache[ps_key]:
            rr.status = "invalid"; rr.message = ps_lock_cache[ps_key]
            result.invalid += 1; result.rows.append(rr); continue

        slip = (row.slip_number or "").strip()

        # Rate-pending placeholder resolution (BKMO): a slip was logged before its
        # R/L was known. Match it on truck + slip alone (case/space-insensitive,
        # ignoring the captured date/supplier — the import's values win) and fill
        # the rate in, rather than treating this row as a new fill-up or a dup.
        pending = None
        if slip:
            norm_slip = slip.replace(" ", "").upper()
            pending = next((
                p for p in db.query(DieselFillUp)
                .filter(
                    DieselFillUp.truck_id == truck.id,
                    DieselFillUp.rate_pending == True,  # noqa: E712
                    DieselFillUp.is_archived == False,
                    or_(
                        func.upper(func.replace(DieselFillUp.depot_slip_number, " ", "")) == norm_slip,
                        func.upper(func.replace(DieselFillUp.slip_number, " ", "")) == norm_slip,
                    ),
                )
                .order_by(DieselFillUp.fillup_date.desc())
                .all()
                if p.id not in consumed_pending
            ), None)

        # Litres fallback: the placeholder's captured slip is the depot's pump
        # slip, which rarely matches the summary's transaction id (and a
        # placeholder may have no slip at all). Match the nearest still-pending
        # placeholder on truck + supplier with litres within 0.5 L and date
        # within 3 days — pump printouts drift a few hundredths of a litre and
        # a day or two from the statement.
        matched_by_litres = False
        if pending is None:
            window = timedelta(days=3)
            candidates = [
                p for p in db.query(DieselFillUp).filter(
                    DieselFillUp.truck_id == truck.id,
                    DieselFillUp.supplier_id == supplier_id,
                    DieselFillUp.rate_pending == True,  # noqa: E712
                    DieselFillUp.is_archived == False,
                    DieselFillUp.litres >= litres - Decimal("0.5"),
                    DieselFillUp.litres <= litres + Decimal("0.5"),
                    DieselFillUp.fillup_date >= row.fillup_date - window,
                    DieselFillUp.fillup_date <= row.fillup_date + window,
                ).all()
                if p.id not in consumed_pending
            ]
            pending = min(
                candidates,
                key=lambda p: (abs((p.fillup_date - row.fillup_date).days),
                               abs(Decimal(str(p.litres)) - litres)),
                default=None,
            )
            matched_by_litres = pending is not None

        if pending is not None:
            # The placeholder may already be linked to a locked invoice — filling
            # its rate in would change values on a closed-off invoice.
            if pending.supplier_invoice_id in locked:
                rr.status = "invalid"
                rr.message = lock_message(invoice_label(db, pending.supplier_invoice_id))
                result.invalid += 1; result.rows.append(rr); continue
            consumed_pending.add(pending.id)
            result.updated += 1
            rr.status = "updated"
            rr.message = (
                "Filled rate into a pending slip (matched by litres + date); litres taken from the import"
                if matched_by_litres else
                "Filled rate into a pending slip; litres taken from the import"
            )
            if payload.commit:
                amounts = DieselCalculationService.calculate_fillup_amounts(
                    litres=litres, rate_per_litre=rate,
                    admin_fee_pct=admin_fee_pct, apply_admin_fee=apply_admin_fee, vat_rate=vat_rate,
                )
                pending.supplier_id     = supplier_id
                pending.fillup_date     = row.fillup_date
                pending.litres          = litres          # import litres always win
                pending.rate_per_litre  = rate
                pending.admin_fee_pct   = admin_fee_pct
                pending.diesel_type     = diesel_type_for_supplier(supplier_objs.get(supplier_id))
                if slip:
                    # The captured pump slip stays as the depot Slip #; the
                    # summary's transaction id becomes the Trans ID, so a
                    # re-import of the same sheet dedupes instead of
                    # re-creating this row as a fresh fill-up.
                    if not pending.depot_slip_number:
                        pending.depot_slip_number = pending.slip_number or slip
                    pending.slip_number = slip
                for k, v in amounts.items():
                    setattr(pending, k, v)
                pending.rate_pending = False
                db.flush()
                # Now that the amount is known, create/link the supplier invoice
                # and push the diesel snapshot onto any linked load.
                if (pending.invoice_number or pending.slip_number) and not pending.supplier_invoice_id:
                    _auto_link_or_create_supplier_invoice(db, pending, current_user.id, commit=False)
                if pending.truckload_id:
                    _sync_truckload_diesel(db, pending.truckload_id, pending)
            result.rows.append(rr)
            continue

        # Duplicate = same truck + supplier + slip ON THE SAME DATE. The date
        # must be part of the key: depots recycle slip numbers, and a truck's
        # old- and new-reg rows resolve to the same truck — without the date a
        # legitimate second fill-up would be silently dropped.
        batch_key = (truck.id, supplier_id, slip, row.fillup_date)
        dup = False
        if slip:
            if batch_key in seen_batch:
                dup = True
            else:
                existing = db.query(DieselFillUp).filter(
                    DieselFillUp.truck_id == truck.id,
                    DieselFillUp.supplier_id == supplier_id,
                    DieselFillUp.slip_number == slip,
                    DieselFillUp.fillup_date == row.fillup_date,
                    DieselFillUp.is_archived == False,
                ).first()
                dup = existing is not None
        if dup:
            rr.status = "duplicate"; rr.message = "Slip already exists for this truck on this date"
            result.duplicates += 1; result.rows.append(rr); continue

        result.matched += 1
        if slip:
            seen_batch.add(batch_key)

        if payload.commit:
            amounts = DieselCalculationService.calculate_fillup_amounts(
                litres=litres, rate_per_litre=rate,
                admin_fee_pct=admin_fee_pct, apply_admin_fee=apply_admin_fee, vat_rate=vat_rate,
            )
            f = DieselFillUp(
                entity_id=payload.entity_id, truck_id=truck.id, supplier_id=supplier_id,
                fillup_date=row.fillup_date, litres=litres, rate_per_litre=rate,
                slip_number=slip or None, depot_slip_number=slip or None, notes=(row.depot or None),
                admin_fee_pct=admin_fee_pct,
                diesel_type=diesel_type_for_supplier(supplier_objs.get(supplier_id)),
                **amounts, created_by=current_user.id,
            )
            db.add(f)
            db.flush()
            # Same as the manual fill-up path: create the supplier invoice so
            # the fill-up also shows on the diesel supplier's profile
            _auto_link_or_create_supplier_invoice(db, f, current_user.id, commit=False)
            result.created += 1
            rr.status = "created"
        else:
            rr.status = "matched"
        result.rows.append(rr)

    result.unmatched_registrations = sorted(unmatched_regs)
    # Present the imported rows sorted by registration so the preview/result
    # lists trucks alphabetically rather than in raw file order.
    result.rows.sort(key=lambda r: (r.registration or "").strip().upper())

    if payload.commit and (result.created or result.updated):
        log_action(
            db, "diesel_fillup.imported", user_id=current_user.id,
            entity_id=payload.entity_id, resource_type="diesel_fillup",
            description=(
                f"Imported {result.created} diesel fill-up(s)"
                + (f", filled rate into {result.updated} pending slip(s)" if result.updated else "")
            ),
        )
        db.commit()

    return result


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

    # The tag is fixed per supplier (Merino & Oukop = top-up, everyone else =
    # fill-up) — never taken from the client. Re-derived below only when the
    # supplier changes, so a notes-only edit doesn't trip the locks.
    updates.pop("diesel_type", None)

    # Final-verification lock: a free-text note may still be added/edited
    # (a note-only edit sends just `notes`).
    ensure_not_locked(f, updates, {"notes"})
    # Diesel invoice lock — same note-only exception
    ensure_fillup_unlocked(db, f, updates, {"notes"})
    # Profit Sheet final lock — same note-only exception, on both the current
    # period and (when the truck, date or invoice link moves) the target one.
    if not set(updates) <= {"notes"}:
        _ensure_fillup_month_open(db, f.truck_id, f.supplier_invoice_id, f.fillup_date)
        if {"truck_id", "fillup_date", "supplier_invoice_id"} & set(updates):
            _ensure_fillup_month_open(
                db,
                updates.get("truck_id", f.truck_id),
                updates.get("supplier_invoice_id", f.supplier_invoice_id),
                updates.get("fillup_date", f.fillup_date),
            )

    if "supplier_id" in updates:
        new_supplier = db.query(Supplier).filter(Supplier.id == updates["supplier_id"]).first()
        updates["diesel_type"] = diesel_type_for_supplier(new_supplier)

    # Recalculate amounts if litres, rate or the amount itself changes
    litres = Decimal(str(updates.get("litres", f.litres)))
    rate = Decimal(str(updates.get("rate_per_litre", f.rate_per_litre)))
    # A hand-entered amount is authoritative for the money; when it's the field that
    # changed, keep it exactly and rebuild the fee/VAT/total on it.
    typed_amount = Decimal(str(updates["amount"])) if "amount" in updates else None
    if typed_amount is not None and typed_amount <= 0:
        typed_amount = None
    if "litres" in updates or "rate_per_litre" in updates or typed_amount is not None:
        settings = DieselCalculationService.get_diesel_settings(db, f.entity_id)
        admin_fee_pct = Decimal(str(f.admin_fee_pct))  # keep snapshotted pct
        apply_admin_fee = settings.apply_admin_fee if settings else (admin_fee_pct > 0)
        entity_obj = db.query(BusinessEntity).filter(BusinessEntity.id == f.entity_id).first()
        vat_rate = Decimal(str(entity_obj.vat_rate)) if entity_obj and entity_obj.vat_rate else Decimal("0.15")
        # No rate typed alongside the amount → derive one so R/L still reads sensibly
        if typed_amount is not None and rate <= 0 and litres > 0:
            rate = (typed_amount / litres).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            updates["rate_per_litre"] = rate
        amounts = DieselCalculationService.calculate_fillup_amounts(
            litres, rate, admin_fee_pct, apply_admin_fee, vat_rate, amount=typed_amount)
        updates.update(amounts)
        # A real rate (or amount) typed in by hand resolves a pending placeholder.
        if (rate > 0 or typed_amount is not None) and f.rate_pending and "rate_pending" not in updates:
            updates["rate_pending"] = False

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
    if ("litres" in updates or "rate_per_litre" in updates or "amount" in updates) and f.supplier_invoice_id:
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
    ensure_not_locked(f)
    ensure_fillup_unlocked(db, f)
    _ensure_fillup_month_open(db, f.truck_id, f.supplier_invoice_id, f.fillup_date)

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
    ensure_not_locked(f)
    ensure_fillup_unlocked(db, f)
    _ensure_fillup_month_open(db, f.truck_id, f.supplier_invoice_id, f.fillup_date)

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
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(DieselFillUp).filter(DieselFillUp.id == fillup_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fill-up not found")
    _check_entity_access(f.entity_id, current_user)

    before = (f.verified_by, f.verified2_by)
    apply_verify_step(f, current_user, is_admin=(current_user.role == "admin"),
                      desired=intent_from_action(action))
    after = (f.verified_by, f.verified2_by)
    if after != before:
        added = (after[0] and not before[0]) or (after[1] and not before[1])
        log_action(
            db, "diesel_fillup.verified" if added else "diesel_fillup.unverified",
            user_id=current_user.id,
            entity_id=f.entity_id, resource_type="diesel_fillup",
            resource_id=fillup_id,
            description=f"{'Verified' if added else 'Removed verification on'} diesel fill-up #{fillup_id}",
        )
    db.commit()
    db.refresh(f)
    return _enrich_fillup(f, db)


@router.patch("/fillups/{fillup_id}/finalize")
def finalize_fillup(
    fillup_id: int,
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(DieselFillUp).filter(DieselFillUp.id == fillup_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fill-up not found")
    _check_entity_access(f.entity_id, current_user)
    was_locked = bool(f.verified3_by)
    # require_step1=False: the admin may final-lock on her own, without a prior
    # step-1 tick (ticks can still be added to empty steps afterwards).
    apply_finalize_step(f, current_user, is_admin=(current_user.role == "admin"),
                        require_step1=False, desired=intent_from_action(action))
    locked = bool(f.verified3_by)
    if locked != was_locked:
        log_action(
            db, "diesel_fillup.finalized" if locked else "diesel_fillup.unfinalized",
            user_id=current_user.id,
            entity_id=f.entity_id, resource_type="diesel_fillup",
            resource_id=fillup_id,
            description=f"{'Applied' if locked else 'Removed'} final lock on diesel fill-up #{fillup_id}",
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
        # Never auto-link a fill-up ONTO a locked (reconciled) invoice — that
        # would grow a closed-off total.
        target = resolve_invoice_id(db, f.entity_id, f.supplier_id, None, f.invoice_number)
        if target and is_invoice_locked(db, target):
            skipped.append({"fillup_id": f.id, "error": "target invoice is locked"})
            continue
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
    # We compare the invoice against the correct fill-up figure per supplier:
    #   • Intsimbi bills its admin fee on its own statement, so its invoice
    #     includes fuel + fee + VAT → compare against fill-up total_amount.
    #   • Every other diesel supplier's 1%/1.5% fee is our internal markup and is
    #     NOT on the supplier's invoice (see _auto_link_or_create_supplier_invoice,
    #     which sets invoice.amount = fill-up fuel `amount`) → compare against the
    #     fuel `amount` only, otherwise every supplier shows a spurious difference
    #     equal to their admin fee incl VAT.
    fillup_rows = (
        db.query(
            DieselFillUp.supplier_id.label("supplier_id"),
            func.count(DieselFillUp.id).label("fillup_count"),
            func.coalesce(func.sum(DieselFillUp.total_amount), 0).label("fillup_total"),
            func.coalesce(func.sum(DieselFillUp.amount), 0).label("fillup_fuel"),
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
        if fu:
            fillup_total = Decimal(str(
                fu.fillup_total if supplier_bills_own_admin_fee(inv.supplier_name) else fu.fillup_fuel
            ))
        else:
            fillup_total = Decimal("0")
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
