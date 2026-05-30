from fastapi import APIRouter, Depends, HTTPException, Query
import logging

logger = logging.getLogger("safetec.truck_loads")
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_, case
from typing import List, Optional
from datetime import datetime, timezone
from decimal import Decimal

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, TruckLoad, TruckLoadDriverSplit, Mine, MineRate, Truck, Supplier,
    Driver, DriverType, DriverPayCycle, DriverTripLog, PayrollSettings,
    DieselSettings, BusinessEntity,
)
from app.schemas.schemas import (
    TruckLoadCreate, TruckLoadUpdate, TruckLoadOut,
    TruckLoadBulkCreate, TruckLoadSummary, TruckFleetSummaryRow,
    SplitLoadCreate, SplitLoadOut,
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


def _compute_amounts(load: TruckLoad, vat_registered: bool = True):
    """Recalculate and set amount_excl_vat and amount_incl_vat on the ORM object."""
    if load.tonnes is not None and load.rate_per_ton is not None:
        excl = Decimal(str(load.tonnes)) * Decimal(str(load.rate_per_ton))
        load.amount_excl_vat = excl.quantize(Decimal("0.01"))
        load.amount_incl_vat = (excl * VAT_RATE if vat_registered else excl).quantize(Decimal("0.01"))


def _compute_subcontractor_amounts(load: TruckLoad, db: Optional[Session] = None, sub_vat_registered: bool = True):
    """
    Compute the four subcontractor rate columns.

    Pass db=session on CREATE to look up the truck's is_subcontractor flag and snapshot
    DieselSettings.additional_charge_per_ton for this entity. The snapshot is stored in
    subcontractor_admin_fee_per_ton so that future DieselSettings changes do not alter
    historical records.

    On UPDATE omit db (or pass it only when truck_id changed) — the existing snapshot is
    reused and only the three derived fields are recomputed.

    sub_vat_registered: the VAT-registration status of the truck-owner entity (subcontractor).
    When False, amount_incl_vat == amount_excl_vat (no VAT added to payout).
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
        truck_entity = db.query(BusinessEntity).filter(BusinessEntity.id == truck.entity_id).first()
        sub_vat_registered = truck_entity.vat_registered if truck_entity else True

    fee = load.subcontractor_admin_fee_per_ton
    if fee is None:
        return  # non-subcontractor truck — nothing to derive

    if load.tonnes is not None and load.rate_per_ton is not None:
        sub_rate = Decimal(str(load.rate_per_ton)) - Decimal(str(fee))
        excl     = Decimal(str(load.tonnes)) * sub_rate
        load.subcontractor_rate            = sub_rate.quantize(Decimal("0.01"))
        load.subcontractor_amount_excl_vat = excl.quantize(Decimal("0.01"))
        load.subcontractor_amount_incl_vat = (excl * VAT_RATE if sub_vat_registered else excl).quantize(Decimal("0.01"))


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
    d["driver_splits"] = [
        {
            "id":          s.id,
            "driver_id":   s.driver_id,
            "mine_id":     s.mine_id,
            "share":       s.share,
            "slip_number": s.slip_number,
            "driver_name": (f"{s.driver.first_name} {s.driver.last_name}".strip()
                            if s.driver else None),
            "mine_name":   s.mine.name if s.mine else None,
        }
        for s in (load.driver_splits or [])
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

    # Full loads only. Split loads are credited via truck_load_driver_splits and
    # owned by _sync_split_driver — this function never touches the split columns.
    # Loads marked driver_already_paid were paid in a prior period (projection),
    # so they must not be counted again in this pay cycle.
    # Loads attributed to another driver on the load record (driver_id) are that
    # driver's — they belong to _sync_casual_driver, not the truck's permanent driver.
    full_loads = db.query(func.count(TruckLoad.id)).filter(
        *base_filter, TruckLoad.is_split_load != True,
        TruckLoad.driver_already_paid != True,
        or_(TruckLoad.driver_id.is_(None), TruckLoad.driver_id == driver.id),
    ).scalar() or 0

    if driver.driver_type == DriverType.permanent:
        lohatla_base  = min(7, full_loads)
        lohatla_extra = max(0, full_loads - 7)
    else:
        lohatla_base  = full_loads
        lohatla_extra = 0

    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver.id,
        DriverPayCycle.pay_month == month,
        DriverPayCycle.pay_year  == year,
    ).first()

    if cycle:
        cycle.lohatla_base_loads  = lohatla_base
        cycle.lohatla_extra_loads = lohatla_extra
    else:
        settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
        cycle = DriverPayCycle(
            driver_id=driver.id,
            pay_month=month,
            pay_year=year,
            payroll_settings_id=settings.id if settings else None,
            lohatla_base_loads=lohatla_base,
            lohatla_extra_loads=lohatla_extra,
        )
        db.add(cycle)
        db.flush()

    return driver, cycle


def _sync_casual_driver(driver_id: int, load_date: datetime, db: Session):
    """Re-sync a casual driver's full-load credit from the TruckLoad rows attributed
    to them (TruckLoad.driver_id), for the affected month.

    Casual pay is per-load by mine group: each load buckets into casual_group_a_loads
    (group 'A' mines) or casual_group_b_loads (group 'B' or ungrouped mines) — these
    are the only load fields the casual payroll path reads. No-ops for permanent
    drivers (their loads are owned by _sync_driver_pay_cycle via the truck)."""
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver or driver.driver_type != DriverType.casual:
        return

    year, month = load_date.year, load_date.month
    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    month_end = (datetime(year + 1, 1, 1, tzinfo=timezone.utc)
                 if month == 12 else datetime(year, month + 1, 1, tzinfo=timezone.utc))

    # Always count by driver_id — casual loads are attributed per-load.
    load_filter = TruckLoad.driver_id == driver_id
    logger.info("[sync_casual] driver_id=%s — filtering by driver_id", driver_id)

    loads = db.query(TruckLoad).filter(
        load_filter,
        TruckLoad.entity_id == driver.entity_id,
        TruckLoad.is_split_load != True,
        TruckLoad.is_archived != True,
        TruckLoad.driver_already_paid != True,
        TruckLoad.load_date >= month_start,
        TruckLoad.load_date < month_end,
    ).all()
    logger.info("[sync_casual] driver_id=%s %s/%s → %s loads found", driver_id, year, month, len(loads))

    group_a = sum(1 for l in loads if l.mine and l.mine.casual_group == 'A')
    group_b = len(loads) - group_a

    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_month == month,
        DriverPayCycle.pay_year  == year,
    ).first()

    if cycle:
        cycle.casual_group_a_loads = group_a
        cycle.casual_group_b_loads = group_b
    else:
        settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
        cycle = DriverPayCycle(
            driver_id=driver_id, pay_month=month, pay_year=year,
            payroll_settings_id=settings.id if settings else None,
            casual_group_a_loads=group_a,
            casual_group_b_loads=group_b,
        )
        db.add(cycle)
        db.flush()


def _add_trip_log(load: TruckLoad, db: Session):
    """Create a DriverTripLog entry for this load.

    Uses load.driver_id (the driver who actually drove) when set; falls back to the
    active driver assigned to the truck. This ensures casual drivers attributed on the
    load record get the trip, not the truck's permanent driver.
    """
    if load.driver_id:
        driver = db.query(Driver).filter(Driver.id == load.driver_id).first()
    else:
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

    prefix = "PROJ: " if load.is_projection else ""
    mine_name = f"{prefix}{load.mine.name}" if load.mine else ("PROJECTION" if load.is_projection else "Unknown")
    entry = DriverTripLog(
        pay_cycle_id=cycle.id,
        trip_date=load.load_date,
        mine_name=mine_name,
        truck_load_id=load.id,
        notes=f"Auto: {'projection' if load.is_projection else 'truck load'} #{load.id}",
    )
    db.add(entry)


def _remove_trip_log(load_id: int, db: Session):
    """Delete the DriverTripLog entry that was auto-created for this truck load."""
    db.query(DriverTripLog).filter(
        DriverTripLog.truck_load_id == load_id
    ).delete(synchronize_session=False)


def _sync_split_driver(driver_id: int, load_date: datetime, db: Session):
    """Re-sync split-load credit for a driver from their truck_load_driver_splits lines.

    Each line is 0.5 of a load. We store the line COUNT in the pay cycle (an integer
    number of half-loads); calculate_pay_cycle applies the ×0.5 — so one line → 0.5 load,
    two lines in the month → 1.0 load. Casual lines bucket by their own mine's casual_group."""
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        return

    year, month = load_date.year, load_date.month
    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    month_end = (datetime(year + 1, 1, 1, tzinfo=timezone.utc)
                 if month == 12 else datetime(year, month + 1, 1, tzinfo=timezone.utc))

    split_loads = (
        db.query(TruckLoadDriverSplit)
        .join(TruckLoad, TruckLoadDriverSplit.truck_load_id == TruckLoad.id)
        .filter(
            TruckLoadDriverSplit.driver_id == driver_id,
            TruckLoad.entity_id == driver.entity_id,
            TruckLoad.is_archived != True,
            TruckLoad.load_date >= month_start,
            TruckLoad.load_date < month_end,
        )
        .all()
    )
    split_count = len(split_loads)

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
        split_a = sum(1 for l in split_loads if l.mine and l.mine.casual_group == 'A')
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


def _add_split_trip_logs(load: TruckLoad, db: Session):
    """Create one DriverTripLog per driver line on a split load (pay cycles must exist)."""
    for s in load.driver_splits:
        if not s.driver_id:
            continue
        cycle = db.query(DriverPayCycle).filter(
            DriverPayCycle.driver_id == s.driver_id,
            DriverPayCycle.pay_month == load.load_date.month,
            DriverPayCycle.pay_year  == load.load_date.year,
        ).first()
        if not cycle:
            continue
        mine_name = s.mine.name if s.mine else (load.mine.name if load.mine else "Unknown")
        db.add(DriverTripLog(
            pay_cycle_id=cycle.id,
            trip_date=load.load_date,
            mine_name=mine_name,
            truck_load_id=load.id,
            notes=f"Auto: split load #{load.id} (0.5)",
        ))


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
    statement_month: Optional[int] = Query(None),
    statement_year: Optional[int] = Query(None),
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
    if statement_month is not None and statement_year is not None:
        q = q.filter(TruckLoad.statement_month == statement_month, TruckLoad.statement_year == statement_year)
    else:
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
    statement_month: Optional[int] = Query(None),
    statement_year: Optional[int] = Query(None),
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
        func.coalesce(func.sum(TruckLoad.subcontractor_amount_excl_vat), 0),
        func.coalesce(func.sum(TruckLoad.subcontractor_amount_incl_vat), 0),
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
    if statement_month is not None and statement_year is not None:
        q = q.filter(TruckLoad.statement_month == statement_month, TruckLoad.statement_year == statement_year)
    else:
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
        total_subcontractor_excl_vat=Decimal(str(row[5])),
        total_subcontractor_incl_vat=Decimal(str(row[6])),
    )


# ── Fleet summary (cross-truck overview) ─────────────────────────────────────

@router.get("/fleet-summary", response_model=List[TruckFleetSummaryRow])
def get_fleet_summary(
    entity_id: Optional[int] = Query(None),
    statement_month: Optional[int] = Query(None),
    statement_year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)
    if entity_id is not None and accessible is not None and entity_id not in accessible:
        raise HTTPException(status_code=403, detail="Access denied to this entity")

    missing_invoice_expr = func.sum(
        case(
            (or_(TruckLoad.diesel_invoice.is_(None), TruckLoad.diesel_invoice == ""), 1),
            else_=0,
        )
    )

    q = (
        db.query(
            Truck.id.label("truck_id"),
            Truck.registration.label("truck_registration"),
            Truck.fleet_number.label("fleet_number"),
            Truck.entity_id.label("entity_id"),
            BusinessEntity.name.label("entity_name"),
            BusinessEntity.code.label("entity_code"),
            func.count(TruckLoad.id).label("total_loads"),
            func.coalesce(func.sum(TruckLoad.tonnes), 0).label("total_tonnes"),
            func.coalesce(func.sum(TruckLoad.amount_excl_vat), 0).label("total_excl_vat"),
            func.coalesce(func.sum(TruckLoad.amount_incl_vat), 0).label("total_incl_vat"),
            func.coalesce(missing_invoice_expr, 0).label("loads_missing_invoice"),
        )
        .join(BusinessEntity, BusinessEntity.id == Truck.entity_id)
        .join(TruckLoad, TruckLoad.truck_id == Truck.id)
        .filter(TruckLoad.is_archived.is_(False))
    )

    if entity_id is not None:
        q = q.filter(Truck.entity_id == entity_id, TruckLoad.entity_id == entity_id)
    elif accessible is not None:
        q = q.filter(Truck.entity_id.in_(accessible))
    if statement_month is not None:
        q = q.filter(TruckLoad.statement_month == statement_month)
    if statement_year is not None:
        q = q.filter(TruckLoad.statement_year == statement_year)

    rows = (
        q.group_by(
            Truck.id, Truck.registration, Truck.fleet_number,
            Truck.entity_id, BusinessEntity.name, BusinessEntity.code,
        )
        .order_by(BusinessEntity.name, Truck.fleet_number, Truck.registration)
        .all()
    )

    return [
        TruckFleetSummaryRow(
            truck_id=r.truck_id,
            truck_registration=r.truck_registration,
            fleet_number=r.fleet_number,
            entity_id=r.entity_id,
            entity_name=r.entity_name,
            entity_code=r.entity_code,
            total_loads=r.total_loads,
            total_tonnes=Decimal(str(r.total_tonnes)),
            total_excl_vat=Decimal(str(r.total_excl_vat)),
            total_incl_vat=Decimal(str(r.total_incl_vat)),
            loads_missing_invoice=int(r.loads_missing_invoice),
        )
        for r in rows
    ]


# ── Recalculate sub amounts ───────────────────────────────────────────────────

@router.post("/recalculate-sub")
def recalculate_sub_amounts(
    truck_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Backfill subcontractor rate/amount columns for all non-archived loads of a truck."""
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    if not truck.is_subcontractor:
        raise HTTPException(status_code=400, detail="Truck is not a subcontractor truck")
    _check_entity_access(truck.entity_id, current_user)

    loads = db.query(TruckLoad).filter(
        TruckLoad.truck_id == truck_id,
        TruckLoad.is_archived != True,
    ).all()

    for load in loads:
        _compute_subcontractor_amounts(load, db)

    db.commit()
    return {"updated": len(loads)}


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
            if payload.is_projection:
                rate = Decimal("0")
            else:
                raise HTTPException(
                    status_code=400,
                    detail="No active mine rate found for this mine/entity. Provide rate_per_ton explicitly.",
                )

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
    vat_reg = entity.vat_registered if entity else True

    load = TruckLoad(**payload.model_dump(exclude={"rate_per_ton"}), rate_per_ton=rate)
    _compute_amounts(load, vat_registered=vat_reg)
    _compute_subcontractor_amounts(load, db)
    db.add(load)
    db.flush()

    # Regular single load: credit the truck's permanent driver, plus the casual
    # driver named on the load record (if any). Splits go through POST /split.
    _sync_driver_pay_cycle(load.truck_id, load.load_date, db)
    if load.driver_id:
        _sync_casual_driver(load.driver_id, load.load_date, db)
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
    # Cache DieselSettings, entity VAT status, and truck subcontractor flags to avoid per-row queries
    _diesel_settings_cache: dict = {}
    _entity_vat_cache: dict = {}
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

        if item.entity_id not in _entity_vat_cache:
            ent = db.query(BusinessEntity).filter(BusinessEntity.id == item.entity_id).first()
            _entity_vat_cache[item.entity_id] = ent.vat_registered if ent else True

        load = TruckLoad(**item.model_dump(exclude={"rate_per_ton"}), rate_per_ton=rate)
        _compute_amounts(load, vat_registered=_entity_vat_cache[item.entity_id])

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

    # Sync each casual driver named on a load once per affected month
    seen_casual = set()
    for load in created:
        if not load.driver_id:
            continue
        key = (load.driver_id, load.load_date.year, load.load_date.month)
        if key not in seen_casual:
            _sync_casual_driver(load.driver_id, load.load_date, db)
            db.flush()
            seen_casual.add(key)

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


# ── Create split load ─────────────────────────────────────────────────────────

@router.post("/split", response_model=SplitLoadOut)
def create_split_load(
    payload: SplitLoadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create ONE truck load (full tonnes/rate/amount) plus its driver lines.

    The main load is the billing/revenue record and counts as one load. Each driver
    line credits 0.5 of a load to that driver's payroll — tonnes play no role."""
    item = payload.load
    _check_entity_access(item.entity_id, current_user)

    rate = item.rate_per_ton
    if rate is None:
        rate = _resolve_rate(db, item.mine_id, item.entity_id)
        if rate is None:
            raise HTTPException(
                status_code=400,
                detail=f"No active mine rate for mine {item.mine_id}/entity {item.entity_id}. Provide rate_per_ton.",
            )
    ent = db.query(BusinessEntity).filter(BusinessEntity.id == item.entity_id).first()

    load = TruckLoad(**item.model_dump(exclude={"rate_per_ton"}), rate_per_ton=rate)
    load.is_split_load = True
    load.driver_id = None  # the main load is not tied to a single driver
    _compute_amounts(load, vat_registered=ent.vat_registered if ent else True)
    _compute_subcontractor_amounts(load, db)
    db.add(load)
    db.flush()

    for order, sp in enumerate(payload.splits):
        db.add(TruckLoadDriverSplit(
            truck_load_id=load.id,
            driver_id=sp.driver_id,
            mine_id=sp.mine_id,
            share=sp.share if sp.share is not None else Decimal("0.5"),
            slip_number=sp.slip_number,
            sort_order=order,
        ))
    db.flush()
    db.refresh(load)

    # Credit each distinct driver's payroll (0.5 per line)
    for did in {sp.driver_id for sp in payload.splits if sp.driver_id}:
        _sync_split_driver(did, load.load_date, db)
    db.flush()

    _add_split_trip_logs(load, db)

    log_action(
        db, "truck_load.split_created", user_id=current_user.id,
        entity_id=item.entity_id, resource_type="truck_load",
        resource_id=load.id,
        description=f"Created split load #{load.id} with {len(payload.splits)} drivers",
    )
    db.commit()
    db.refresh(load)
    return SplitLoadOut(load=TruckLoadOut(**_enrich(load)))


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

    old_truck_id   = load.truck_id
    old_load_date  = load.load_date
    old_is_split   = load.is_split_load
    old_driver_id  = load.driver_id

    updated_fields = payload.model_dump(exclude_none=True)
    for field, value in updated_fields.items():
        setattr(load, field, value)

    load_entity = db.query(BusinessEntity).filter(BusinessEntity.id == load.entity_id).first()
    vat_reg = load_entity.vat_registered if load_entity else True
    _compute_amounts(load, vat_registered=vat_reg)

    if "truck_id" in updated_fields:
        _compute_subcontractor_amounts(load, db)
    else:
        truck = db.query(Truck).filter(Truck.id == load.truck_id).first()
        # Re-snapshot if fee was never stored (load predates is_subcontractor flag being set)
        if truck and truck.is_subcontractor and load.subcontractor_admin_fee_per_ton is None:
            _compute_subcontractor_amounts(load, db)
        else:
            sub_vat_reg = True
            if truck and truck.is_subcontractor and truck.entity_id:
                truck_ent = db.query(BusinessEntity).filter(BusinessEntity.id == truck.entity_id).first()
                sub_vat_reg = truck_ent.vat_registered if truck_ent else True
            _compute_subcontractor_amounts(load, sub_vat_registered=sub_vat_reg)

    new_truck_id  = load.truck_id
    new_load_date = load.load_date
    new_is_split  = load.is_split_load
    new_driver_id = load.driver_id

    # Sync pay cycles for affected drivers/trucks
    dates_to_sync = {old_load_date, new_load_date}
    if new_is_split:
        # Split load: re-sync every driver line for both old and new dates
        for did in {s.driver_id for s in load.driver_splits if s.driver_id}:
            for ld in dates_to_sync:
                _sync_split_driver(did, ld, db)
    else:
        # Regular load: sync by truck (permanent driver) ...
        for truck_id in {old_truck_id, new_truck_id}:
            for ld in dates_to_sync:
                _sync_driver_pay_cycle(truck_id, ld, db)
        # ... and re-sync the casual driver named on the load (old + new, in case
        # the attribution or date changed) so both sides reflect the move.
        for did in {old_driver_id, new_driver_id}:
            if did:
                for ld in dates_to_sync:
                    _sync_casual_driver(did, ld, db)

    # Keep linked trip log entries aligned with the (possibly new) load date
    trip_entries = db.query(DriverTripLog).filter(
        DriverTripLog.truck_load_id == load_id
    ).all()
    for te in trip_entries:
        te.trip_date = new_load_date
    if len(trip_entries) == 1 and load.mine:
        trip_entries[0].mine_name = load.mine.name

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
    # All authenticated users may delete truck loads

    load = db.query(TruckLoad).filter(TruckLoad.id == load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Truck load not found")

    truck_id   = load.truck_id
    load_date  = load.load_date
    is_split   = load.is_split_load
    driver_id  = load.driver_id
    split_driver_ids = [s.driver_id for s in load.driver_splits if s.driver_id] if is_split else []

    _remove_trip_log(load_id, db)

    log_action(
        db, "truck_load.deleted", user_id=current_user.id,
        entity_id=load.entity_id, resource_type="truck_load",
        resource_id=load_id, description=f"Deleted truck load {load_id}",
    )
    db.delete(load)  # cascade removes truck_load_driver_splits
    db.flush()

    if is_split:
        for did in set(split_driver_ids):
            _sync_split_driver(did, load_date, db)
    else:
        _sync_driver_pay_cycle(truck_id, load_date, db)
        if driver_id:
            _sync_casual_driver(driver_id, load_date, db)

    db.commit()
    return {"detail": "Truck load deleted"}
