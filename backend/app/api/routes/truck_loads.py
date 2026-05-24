from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import List, Optional
from datetime import datetime, timezone
from decimal import Decimal

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, TruckLoad, TruckLoadLine, Mine, MineRate, Truck, Supplier,
    Driver, DriverType, DriverPayCycle, DriverTripLog, PayrollSettings,
    DieselSettings,
)
from app.schemas.schemas import (
    TruckLoadCreate, TruckLoadUpdate, TruckLoadOut,
    TruckLoadBulkCreate, TruckLoadSummary, TruckLoadLineOut,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/truck-loads", tags=["truck-loads"])

VAT_RATE = Decimal("1.15")



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


def _compute_amounts(load: TruckLoad):
    """Recalculate and set amount_excl_vat and amount_incl_vat on the ORM object."""
    if load.tonnes is not None and load.rate_per_ton is not None:
        excl = Decimal(str(load.tonnes)) * Decimal(str(load.rate_per_ton))
        load.amount_excl_vat = excl.quantize(Decimal("0.01"))
        load.amount_incl_vat = (excl * VAT_RATE).quantize(Decimal("0.01"))


def _compute_subcontractor_amounts(load: TruckLoad, db: Optional[Session] = None):
    """
    Compute the four subcontractor rate columns.

    Pass db=session on CREATE to look up the truck's is_subcontractor flag and snapshot
    DieselSettings.additional_charge_per_ton for this entity. The snapshot is stored in
    subcontractor_admin_fee_per_ton so that future DieselSettings changes do not alter
    historical records.

    On UPDATE omit db (or pass it only when truck_id changed) — the existing snapshot is
    reused and only the three derived fields are recomputed.
    """
    if db is not None:
        truck = db.query(Truck).filter(Truck.id == load.truck_id).first()
        if not truck or not truck.is_subcontractor:
            load.subcontractor_admin_fee_per_ton = None
            load.subcontractor_rate              = None
            load.subcontractor_amount_excl_vat   = None
            load.subcontractor_amount_incl_vat   = None
            return
        settings = db.query(DieselSettings).filter(
            DieselSettings.entity_id == load.entity_id
        ).first()
        load.subcontractor_admin_fee_per_ton = (
            Decimal(str(settings.additional_charge_per_ton)) if settings else Decimal("0")
        )

    fee = load.subcontractor_admin_fee_per_ton
    if fee is None:
        return  # non-subcontractor truck — nothing to derive

    if load.tonnes is not None and load.rate_per_ton is not None:
        sub_rate = Decimal(str(load.rate_per_ton)) - Decimal(str(fee))
        excl     = Decimal(str(load.tonnes)) * sub_rate
        load.subcontractor_rate            = sub_rate.quantize(Decimal("0.01"))
        load.subcontractor_amount_excl_vat = excl.quantize(Decimal("0.01"))
        load.subcontractor_amount_incl_vat = (excl * VAT_RATE).quantize(Decimal("0.01"))


def _resolve_rate(db: Session, mine_id: int, entity_id: int) -> Optional[Decimal]:
    """Return the currently active MineRate for mine+entity, or None."""
    rate = db.query(MineRate).filter(
        and_(
            MineRate.mine_id == mine_id,
            MineRate.entity_id == entity_id,
            MineRate.effective_to.is_(None),
        )
    ).first()
    return rate.rate_per_ton if rate else None


def _enrich(load: TruckLoad) -> dict:
    """Return a dict with computed/joined fields for the response."""
    d = {c.name: getattr(load, c.name) for c in load.__table__.columns}
    d["truck_registration"] = load.truck.registration if load.truck else None
    d["mine_name"]           = load.mine.name if load.mine else None
    d["supplier_name"]       = load.supplier.name if load.supplier else None
    d["lines"] = [
        TruckLoadLineOut(
            id=ln.id,
            driver_id=ln.driver_id,
            driver_name=(
                f"{ln.driver.first_name} {ln.driver.last_name}".strip()
                if ln.driver else None
            ),
            sort_order=ln.sort_order,
            notes=ln.notes,
        )
        for ln in (load.lines or [])
    ]
    return d


def _sync_driver_pay_cycle(truck_id: int, load_date: datetime, db: Session):
    """
    After any truck load change, find the active driver for this truck and
    re-sync their DriverPayCycle load counts for the affected month.
    No-ops silently if no driver is assigned to the truck.
    """
    driver = db.query(Driver).filter(
        Driver.truck_id == truck_id,
        Driver.is_active == True,
    ).first()
    if not driver:
        return

    year = load_date.year
    month = load_date.month
    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        month_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        month_end = datetime(year, month + 1, 1, tzinfo=timezone.utc)

    base_filter = [
        TruckLoad.truck_id == truck_id,
        TruckLoad.entity_id == driver.entity_id,
        TruckLoad.load_date >= month_start,
        TruckLoad.load_date < month_end,
    ]

    full_loads = db.query(func.count(TruckLoad.id)).filter(
        *base_filter, TruckLoad.is_split_load != True,
    ).scalar() or 0

    split_loads = db.query(TruckLoad).filter(
        *base_filter, TruckLoad.is_split_load == True,
    ).all()
    split_count = len(split_loads)

    if driver.driver_type == DriverType.permanent:
        lohatla_base  = min(7, full_loads)
        lohatla_extra = max(0, full_loads - 7)
        split_a = split_b = 0
    else:
        lohatla_base  = full_loads
        lohatla_extra = 0
        split_a = sum(1 for l in split_loads if l.mine and l.mine.casual_group == 'A')
        split_b = split_count - split_a

    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver.id,
        DriverPayCycle.pay_month == month,
        DriverPayCycle.pay_year  == year,
    ).first()

    if cycle:
        cycle.lohatla_base_loads  = lohatla_base
        cycle.lohatla_extra_loads = lohatla_extra
        if driver.driver_type == DriverType.permanent:
            cycle.permanent_split_loads = split_count
        else:
            cycle.casual_split_group_a_loads = split_a
            cycle.casual_split_group_b_loads = split_b
    else:
        settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
        cycle = DriverPayCycle(
            driver_id=driver.id,
            pay_month=month,
            pay_year=year,
            payroll_settings_id=settings.id if settings else None,
            lohatla_base_loads=lohatla_base,
            lohatla_extra_loads=lohatla_extra,
            permanent_split_loads=(split_count if driver.driver_type == DriverType.permanent else 0),
            casual_split_group_a_loads=(split_a if driver.driver_type != DriverType.permanent else 0),
            casual_split_group_b_loads=(split_b if driver.driver_type != DriverType.permanent else 0),
        )
        db.add(cycle)
        db.flush()

    return driver, cycle


def _add_trip_log(load: TruckLoad, db: Session):
    """Create a DriverTripLog entry for this load if a driver is assigned to the truck."""
    driver = db.query(Driver).filter(
        Driver.truck_id == load.truck_id,
        Driver.is_active == True,
    ).first()
    if not driver:
        return

    year  = load.load_date.year
    month = load.load_date.month

    # Ensure the pay cycle exists first
    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver.id,
        DriverPayCycle.pay_month == month,
        DriverPayCycle.pay_year  == year,
    ).first()
    if not cycle:
        # Will be created by _sync_driver_pay_cycle — flush needed first
        return

    mine_name = load.mine.name if load.mine else "Unknown"
    entry = DriverTripLog(
        pay_cycle_id=cycle.id,
        trip_date=load.load_date,
        mine_name=mine_name,
        truck_load_id=load.id,
        notes=f"Auto: truck load #{load.id}",
    )
    db.add(entry)


def _remove_trip_log(load_id: int, db: Session):
    """Delete the DriverTripLog entry that was auto-created for this truck load."""
    db.query(DriverTripLog).filter(
        DriverTripLog.truck_load_id == load_id
    ).delete(synchronize_session=False)


def _sync_split_driver_pay_cycle(driver_id: int, load_date: datetime, db: Session):
    """Re-sync split load counts for a driver who appears in truck_load_lines."""
    driver = db.query(Driver).filter(Driver.id == driver_id, Driver.is_active == True).first()
    if not driver:
        return

    year, month = load_date.year, load_date.month
    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    month_end = (datetime(year + 1, 1, 1, tzinfo=timezone.utc)
                 if month == 12 else datetime(year, month + 1, 1, tzinfo=timezone.utc))

    lines = (
        db.query(TruckLoadLine)
        .join(TruckLoad, TruckLoad.id == TruckLoadLine.truck_load_id)
        .filter(
            TruckLoadLine.driver_id == driver_id,
            TruckLoad.is_split_load == True,
            TruckLoad.load_date >= month_start,
            TruckLoad.load_date < month_end,
        ).all()
    )
    split_count = len(lines)

    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_month == month,
        DriverPayCycle.pay_year  == year,
    ).first()
    settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()

    if driver.driver_type == DriverType.permanent:
        if cycle:
            cycle.permanent_split_loads = split_count
        else:
            cycle = DriverPayCycle(
                driver_id=driver_id, pay_month=month, pay_year=year,
                payroll_settings_id=settings.id if settings else None,
                permanent_split_loads=split_count,
            )
            db.add(cycle)
            db.flush()
    else:
        split_a = sum(
            1 for ln in lines
            if ln.truck_load and ln.truck_load.mine and ln.truck_load.mine.casual_group == 'A'
        )
        split_b = split_count - split_a
        if cycle:
            cycle.casual_split_group_a_loads = split_a
            cycle.casual_split_group_b_loads = split_b
        else:
            cycle = DriverPayCycle(
                driver_id=driver_id, pay_month=month, pay_year=year,
                payroll_settings_id=settings.id if settings else None,
                casual_split_group_a_loads=split_a,
                casual_split_group_b_loads=split_b,
            )
            db.add(cycle)
            db.flush()


def _sync_lines_drivers(load: TruckLoad, load_date: datetime, db: Session):
    """Re-sync pay cycles for all drivers listed in a split load's lines."""
    for line in load.lines:
        if line.driver_id:
            _sync_split_driver_pay_cycle(line.driver_id, load_date, db)


def _replace_lines(load: TruckLoad, lines_in, db: Session):
    """Delete existing lines and insert new ones from payload."""
    db.query(TruckLoadLine).filter(
        TruckLoadLine.truck_load_id == load.id
    ).delete(synchronize_session=False)
    db.flush()
    if load.is_split_load and lines_in:
        for i, ln in enumerate(lines_in):
            db.add(TruckLoadLine(
                truck_load_id=load.id,
                driver_id=ln.driver_id,
                sort_order=ln.sort_order if ln.sort_order is not None else i,
                notes=ln.notes,
            ))
        db.flush()


# ── List loads ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[TruckLoadOut])
def list_truck_loads(
    entity_id: Optional[int] = Query(None),
    truck_id: Optional[int] = Query(None),
    mine_id: Optional[int] = Query(None),
    supplier_id: Optional[int] = Query(None),
    is_paid: Optional[bool] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)

    q = db.query(TruckLoad)
    if accessible is not None:
        q = q.filter(TruckLoad.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(TruckLoad.entity_id == entity_id)
    if truck_id:
        q = q.filter(TruckLoad.truck_id == truck_id)
    if mine_id:
        q = q.filter(TruckLoad.mine_id == mine_id)
    if supplier_id:
        q = q.filter(TruckLoad.supplier_id == supplier_id)
    if is_paid is not None:
        q = q.filter(TruckLoad.is_paid.is_(is_paid))
    if date_from:
        q = q.filter(TruckLoad.load_date >= date_from)
    if date_to:
        q = q.filter(TruckLoad.load_date <= date_to)
    q = q.filter(TruckLoad.is_archived != True)

    loads = q.order_by(TruckLoad.load_date.desc()).offset(skip).limit(limit).all()

    result = []
    for load in loads:
        d = _enrich(load)
        result.append(TruckLoadOut(**d))
    return result


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/summary", response_model=TruckLoadSummary)
def get_truck_load_summary(
    entity_id: Optional[int] = Query(None),
    truck_id: Optional[int] = Query(None),
    mine_id: Optional[int] = Query(None),
    is_paid: Optional[bool] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)

    q = db.query(
        func.count(TruckLoad.id),
        func.coalesce(func.sum(TruckLoad.tonnes), 0),
        func.coalesce(func.sum(TruckLoad.amount_excl_vat), 0),
        func.coalesce(func.sum(TruckLoad.amount_incl_vat), 0),
        func.coalesce(func.sum(TruckLoad.diesel_litres), 0),
    )

    if accessible is not None:
        q = q.filter(TruckLoad.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(TruckLoad.entity_id == entity_id)
    if truck_id:
        q = q.filter(TruckLoad.truck_id == truck_id)
    if mine_id:
        q = q.filter(TruckLoad.mine_id == mine_id)
    if is_paid is not None:
        q = q.filter(TruckLoad.is_paid.is_(is_paid))
    if date_from:
        q = q.filter(TruckLoad.load_date >= date_from)
    if date_to:
        q = q.filter(TruckLoad.load_date <= date_to)
    q = q.filter(TruckLoad.is_archived != True)

    row = q.one()
    return TruckLoadSummary(
        total_loads=row[0] or 0,
        total_tonnes=Decimal(str(row[1])),
        total_excl_vat=Decimal(str(row[2])),
        total_incl_vat=Decimal(str(row[3])),
        total_diesel_litres=Decimal(str(row[4])),
    )


# ── Create load ───────────────────────────────────────────────────────────────

@router.post("", response_model=TruckLoadOut)
def create_truck_load(
    payload: TruckLoadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)

    rate = payload.rate_per_ton
    if rate is None:
        rate = _resolve_rate(db, payload.mine_id, payload.entity_id)
        if rate is None:
            raise HTTPException(
                status_code=400,
                detail="No active mine rate found for this mine/entity. Provide rate_per_ton explicitly.",
            )

    lines_in = payload.lines or []
    load = TruckLoad(**payload.model_dump(exclude={"rate_per_ton", "lines"}), rate_per_ton=rate)
    _compute_amounts(load)
    _compute_subcontractor_amounts(load, db)
    db.add(load)
    db.flush()  # get load.id before syncing

    # Insert split load lines
    _replace_lines(load, lines_in, db)

    # Sync primary truck driver pay cycle
    _sync_driver_pay_cycle(load.truck_id, load.load_date, db)
    db.flush()

    # Sync split partner drivers
    _sync_lines_drivers(load, load.load_date, db)
    db.flush()

    # Add trip log entry (pay cycle now exists)
    _add_trip_log(load, db)

    log_action(
        db, "truck_load.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="truck_load",
        resource_id=load.id,
        description=f"Created truck load: truck {payload.truck_id}, mine {payload.mine_id}, {payload.tonnes}t",
    )
    db.commit()
    db.refresh(load)
    d = _enrich(load)
    return TruckLoadOut(**d)


# ── Bulk create ───────────────────────────────────────────────────────────────

@router.post("/bulk", response_model=List[TruckLoadOut])
def bulk_create_truck_loads(
    payload: TruckLoadBulkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Cache DieselSettings and truck subcontractor flags to avoid per-row queries
    _diesel_settings_cache: dict = {}
    _truck_is_sub_cache: dict = {}

    created = []
    for item in payload.loads:
        _check_entity_access(item.entity_id, current_user)

        rate = item.rate_per_ton
        if rate is None:
            rate = _resolve_rate(db, item.mine_id, item.entity_id)
            if rate is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"No active mine rate for mine {item.mine_id}/entity {item.entity_id}.",
                )

        load = TruckLoad(**item.model_dump(exclude={"rate_per_ton"}), rate_per_ton=rate)
        _compute_amounts(load)

        # Resolve subcontractor flag and diesel settings from cache
        if item.truck_id not in _truck_is_sub_cache:
            t = db.query(Truck).filter(Truck.id == item.truck_id).first()
            _truck_is_sub_cache[item.truck_id] = (t.is_subcontractor if t else False)
        if _truck_is_sub_cache[item.truck_id]:
            if item.entity_id not in _diesel_settings_cache:
                s = db.query(DieselSettings).filter(DieselSettings.entity_id == item.entity_id).first()
                _diesel_settings_cache[item.entity_id] = (
                    Decimal(str(s.additional_charge_per_ton)) if s else Decimal("0")
                )
            load.subcontractor_admin_fee_per_ton = _diesel_settings_cache[item.entity_id]
            _compute_subcontractor_amounts(load)  # reuse snapshot (no db)
        else:
            load.subcontractor_admin_fee_per_ton = None
            load.subcontractor_rate              = None
            load.subcontractor_amount_excl_vat   = None
            load.subcontractor_amount_incl_vat   = None

        db.add(load)
        db.flush()
        created.append(load)

    # Sync each unique truck/month combination once
    seen = set()
    for load in created:
        key = (load.truck_id, load.load_date.year, load.load_date.month)
        if key not in seen:
            _sync_driver_pay_cycle(load.truck_id, load.load_date, db)
            db.flush()
            seen.add(key)

    for load in created:
        _add_trip_log(load, db)

    log_action(
        db, "truck_load.bulk_created", user_id=current_user.id,
        resource_type="truck_load",
        description=f"Bulk created {len(created)} truck load records",
    )
    db.commit()
    for load in created:
        db.refresh(load)

    return [TruckLoadOut(**_enrich(l)) for l in created]


# ── Update load ───────────────────────────────────────────────────────────────

@router.put("/{load_id}", response_model=TruckLoadOut)
def update_truck_load(
    load_id: int,
    payload: TruckLoadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    load = db.query(TruckLoad).filter(TruckLoad.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Truck load not found")
    _check_entity_access(load.entity_id, current_user)

    old_truck_id  = load.truck_id
    old_load_date = load.load_date
    old_line_drivers = [(ln.driver_id, load.load_date) for ln in load.lines if ln.driver_id]

    updated_fields = payload.model_dump(exclude_none=True)
    lines_in = updated_fields.pop("lines", None)
    for field, value in updated_fields.items():
        setattr(load, field, value)

    _compute_amounts(load)
    # Re-snapshot only when truck changes; otherwise preserve historical snapshot
    _compute_subcontractor_amounts(load, db if "truck_id" in updated_fields else None)

    # Replace lines if provided or if split flag changed
    if lines_in is not None or "is_split_load" in updated_fields:
        from app.schemas.schemas import TruckLoadLineIn as _LineIn
        new_lines = [_LineIn(**ln) if isinstance(ln, dict) else ln for ln in (lines_in or [])]
        _replace_lines(load, new_lines, db)

    # If truck or date changed, re-sync both the old and new month
    new_truck_id  = load.truck_id
    new_load_date = load.load_date

    months_to_sync = {(old_truck_id, old_load_date), (new_truck_id, new_load_date)}
    for truck_id, ld in months_to_sync:
        _sync_driver_pay_cycle(truck_id, ld, db)

    # Sync old line drivers (their counts may have dropped) and new line drivers
    for d_id, d_date in old_line_drivers:
        _sync_split_driver_pay_cycle(d_id, d_date, db)
    _sync_lines_drivers(load, new_load_date, db)

    # Update the linked trip log entry date/mine if it moved
    trip_entry = db.query(DriverTripLog).filter(
        DriverTripLog.truck_load_id == load_id
    ).first()
    if trip_entry:
        trip_entry.trip_date = new_load_date
        if load.mine:
            trip_entry.mine_name = load.mine.name

    log_action(
        db, "truck_load.updated", user_id=current_user.id,
        entity_id=load.entity_id, resource_type="truck_load",
        resource_id=load_id, description=f"Updated truck load {load_id}",
    )
    db.commit()
    db.refresh(load)
    d = _enrich(load)
    return TruckLoadOut(**d)


# ── Archive load (soft delete) ───────────────────────────────────────────────

@router.patch("/{load_id}/archive")
def archive_truck_load(
    load_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    load = db.query(TruckLoad).filter(TruckLoad.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Truck load not found")
    _check_entity_access(load.entity_id, current_user)

    load.is_archived = True
    log_action(
        db, "truck_load.archived", user_id=current_user.id,
        entity_id=load.entity_id, resource_type="truck_load",
        resource_id=load_id, description=f"Archived truck load {load_id}",
    )
    db.commit()
    return {"detail": "Truck load archived"}


# ── Delete load ───────────────────────────────────────────────────────────────

@router.delete("/{load_id}")
def delete_truck_load(
    load_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can delete truck loads")

    load = db.query(TruckLoad).filter(TruckLoad.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Truck load not found")

    truck_id  = load.truck_id
    load_date = load.load_date
    line_drivers = [(ln.driver_id, load.load_date) for ln in load.lines if ln.driver_id]

    # Remove auto-created trip log entry before deleting the load
    _remove_trip_log(load_id, db)

    log_action(
        db, "truck_load.deleted", user_id=current_user.id,
        entity_id=load.entity_id, resource_type="truck_load",
        resource_id=load_id, description=f"Deleted truck load {load_id}",
    )
    db.delete(load)
    db.flush()

    # Re-sync the primary truck driver
    _sync_driver_pay_cycle(truck_id, load_date, db)

    # Re-sync split partner drivers (lines deleted by CASCADE; counts now lower)
    for d_id, d_date in line_drivers:
        _sync_split_driver_pay_cycle(d_id, d_date, db)

    db.commit()
    return {"detail": "Truck load deleted"}
