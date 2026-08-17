from fastapi import APIRouter, Depends, HTTPException, Query
import logging

logger = logging.getLogger("safetec.truck_loads")
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func, and_, or_, case, extract
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
from app.services.load_bonus import bonus_mine_ids
from app.services.profit_sheet_lock import ensure_truck_month_open
from app.services.vat import entity_vat, DEFAULT_VAT_RATE
from app.core.security import (
    check_entity_access as _check_entity_access,
    accessible_entity_ids as _accessible_entity_ids,
)

router = APIRouter(prefix="/api/truck-loads", tags=["truck-loads"])


def _compute_amounts(load: TruckLoad, vat_registered: bool = True, vat_rate: Decimal = DEFAULT_VAT_RATE):
    """Recalculate and set amount_excl_vat and amount_incl_vat on the ORM object.
    `vat_rate` must be the billing entity's saved rate (services/vat.entity_vat)."""
    if load.tonnes is not None and load.rate_per_ton is not None:
        excl = Decimal(str(load.tonnes)) * Decimal(str(load.rate_per_ton))
        load.amount_excl_vat = excl.quantize(Decimal("0.01"))
        load.amount_incl_vat = (
            excl * (Decimal("1") + vat_rate) if vat_registered else excl
        ).quantize(Decimal("0.01"))


def _compute_subcontractor_amounts(load: TruckLoad, db: Optional[Session] = None,
                                   sub_vat_registered: bool = True,
                                   sub_vat_rate: Decimal = DEFAULT_VAT_RATE):
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
        sub_vat_registered, sub_vat_rate = entity_vat(db, truck.entity_id)

    fee = load.subcontractor_admin_fee_per_ton
    if fee is None:
        return  # non-subcontractor truck — nothing to derive

    if load.tonnes is not None and load.rate_per_ton is not None:
        sub_rate = Decimal(str(load.rate_per_ton)) - Decimal(str(fee))
        excl     = Decimal(str(load.tonnes)) * sub_rate
        load.subcontractor_rate            = sub_rate.quantize(Decimal("0.01"))
        load.subcontractor_amount_excl_vat = excl.quantize(Decimal("0.01"))
        load.subcontractor_amount_incl_vat = (
            excl * (Decimal("1") + sub_vat_rate) if sub_vat_registered else excl
        ).quantize(Decimal("0.01"))


def _resolve_rate(db: Session, mine_id: int, entity_id: int, on_date=None) -> Optional[Decimal]:
    """Return the MineRate for mine+entity effective on `on_date` (falls back to
    the currently open rate when no dated window matches, e.g. loads predating
    the rate history)."""
    if on_date is not None:
        rate = db.query(MineRate).filter(
            and_(
                MineRate.mine_id == mine_id,
                MineRate.entity_id == entity_id,
                MineRate.effective_from <= on_date,
                or_(MineRate.effective_to.is_(None), MineRate.effective_to > on_date),
            )
        ).order_by(MineRate.effective_from.desc()).first()
        if rate:
            return rate.rate_per_ton
    rate = db.query(MineRate).filter(
        and_(
            MineRate.mine_id == mine_id,
            MineRate.entity_id == entity_id,
            MineRate.effective_to.is_(None),
        )
    ).first()
    return rate.rate_per_ton if rate else None


def _driver_type(driver: Optional[Driver]) -> Optional[str]:
    """'permanent' / 'casual' as a plain string (the column is an Enum)."""
    if driver is None:
        return None
    return getattr(driver.driver_type, "value", driver.driver_type)


def _enrich(load: TruckLoad) -> dict:
    """Return a dict with computed/joined fields for the response."""
    d = {c.name: getattr(load, c.name) for c in load.__table__.columns}
    d["truck_registration"] = load.truck.registration if load.truck else None
    d["mine_name"]           = load.mine.name if load.mine else None
    d["supplier_name"]       = load.supplier.name if load.supplier else None
    d["driver_type"]         = _driver_type(load.driver)
    d["driver_splits"] = [
        {
            "id":          s.id,
            "driver_id":   s.driver_id,
            "mine_id":     s.mine_id,
            "share":       s.share,
            "slip_number": s.slip_number,
            "driver_name": (f"{s.driver.first_name} {s.driver.last_name}".strip()
                            if s.driver else None),
            "driver_type": _driver_type(s.driver),
            "mine_name":   s.mine.name if s.mine else None,
        }
        for s in (load.driver_splits or [])
    ]
    return d


def _assmang_mine_ids(db: Session) -> list:
    """IDs of mines that earn the per-load bonus (Assmang + Mokala/Tawana/Sebilo)."""
    return bonus_mine_ids(db)


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
    full_filter = [
        *base_filter, TruckLoad.is_split_load != True,
        TruckLoad.driver_already_paid != True,
        or_(TruckLoad.driver_id.is_(None), TruckLoad.driver_id == driver.id),
    ]
    full_loads = db.query(func.count(TruckLoad.id)).filter(*full_filter).scalar() or 0

    # Bonus loads — same attribution, restricted to the bonus mines (Assmang/Mokala/Tawana/Sebilo).
    assmang_ids = _assmang_mine_ids(db)
    assmang_loads = (db.query(func.count(TruckLoad.id)).filter(
        *full_filter, TruckLoad.mine_id.in_(assmang_ids),
    ).scalar() or 0) if assmang_ids else 0

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
        cycle.assmang_loads       = assmang_loads
    else:
        settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
        cycle = DriverPayCycle(
            driver_id=driver.id,
            pay_month=month,
            pay_year=year,
            payroll_settings_id=settings.id if settings else None,
            lohatla_base_loads=lohatla_base,
            lohatla_extra_loads=lohatla_extra,
            assmang_loads=assmang_loads,
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

    assmang_ids = set(_assmang_mine_ids(db))
    assmang_loads = sum(1 for l in loads if l.mine_id in assmang_ids)

    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_month == month,
        DriverPayCycle.pay_year  == year,
    ).first()

    if cycle:
        cycle.casual_group_a_loads = group_a
        cycle.casual_group_b_loads = group_b
        cycle.assmang_loads        = assmang_loads
    else:
        settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
        cycle = DriverPayCycle(
            driver_id=driver_id, pay_month=month, pay_year=year,
            payroll_settings_id=settings.id if settings else None,
            casual_group_a_loads=group_a,
            casual_group_b_loads=group_b,
            assmang_loads=assmang_loads,
        )
        db.add(cycle)
        db.flush()


def _effective_pay_period(load: TruckLoad):
    """(year, month) of the pay cycle a load belongs to.

    Normally the load's own month, but shifted one month forward when pay_deferred
    is set — the load was done this month but is only paid in next month's payroll.
    """
    year, month = load.load_date.year, load.load_date.month
    if getattr(load, "pay_deferred", False):
        return (year + 1, 1) if month == 12 else (year, month + 1)
    return year, month


def _add_trip_log(load: TruckLoad, db: Session):
    """Create a DriverTripLog entry for this load, on its effective pay cycle.

    Uses load.driver_id (the driver who actually drove) when set; falls back to the
    active driver assigned to the truck. This ensures casual drivers attributed on the
    load record get the trip, not the truck's permanent driver. A pay_deferred load's
    trip lands on next month's cycle (its pay carries forward).
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

    year, month = _effective_pay_period(load)

    # Ensure the pay cycle exists (create a bare one if needed — its load counts are
    # re-derived from truck loads whenever the cycle is opened).
    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver.id,
        DriverPayCycle.pay_month == month,
        DriverPayCycle.pay_year  == year,
    ).first()
    if not cycle:
        settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
        cycle = DriverPayCycle(
            driver_id=driver.id, pay_month=month, pay_year=year,
            payroll_settings_id=settings.id if settings else None,
        )
        db.add(cycle)
        db.flush()

    deferred = getattr(load, "pay_deferred", False)
    prefix = "PROJ: " if load.is_projection else ("CF: " if deferred else "")
    mine_name = f"{prefix}{load.mine.name}" if load.mine else ("PROJECTION" if load.is_projection else "Unknown")
    note_kind = "projection" if load.is_projection else ("carried-forward load" if deferred else "truck load")
    entry = DriverTripLog(
        pay_cycle_id=cycle.id,
        trip_date=load.load_date,
        mine_name=mine_name,
        truck_load_id=load.id,
        notes=f"Auto: {note_kind} #{load.id}",
    )
    db.add(entry)


def _remove_trip_log(load_id: int, db: Session):
    """Delete the DriverTripLog entry that was auto-created for this truck load."""
    db.query(DriverTripLog).filter(
        DriverTripLog.truck_load_id == load_id
    ).delete(synchronize_session=False)


def _load_effective_period(load: TruckLoad) -> tuple:
    """The (year, month) a load is paid in. Subcontractor loads carry a statement
    period distinct from load_date (the load is done one month, paid/statemented in
    another); the driver's split credit must follow that statement period so it lands
    in the same cycle the load shows under on the Truck Loads page. Falls back to the
    load_date month when no statement period is set (normal loads)."""
    if load.statement_month and load.statement_year:
        return load.statement_year, load.statement_month
    return load.load_date.year, load.load_date.month


def _ensure_load_month_open(db: Session, truck_id, load_date,
                            statement_year=None, statement_month=None):
    """Profit Sheet final lock: no load may be captured or changed for a truck
    whose sheet month is locked. Same period rule as the report — statement
    period first, load date otherwise."""
    if statement_year and statement_month:
        year, month = statement_year, statement_month
    elif load_date is not None:
        year, month = load_date.year, load_date.month
    else:
        return
    ensure_truck_month_open(db, truck_id, year, month)


def _sync_split_driver(driver_id: int, year: int, month: int, db: Session):
    """Re-sync split-load credit for a driver from their truck_load_driver_splits lines.

    Each line is 0.5 of a load. We store the line COUNT in the pay cycle (an integer
    number of half-loads); calculate_pay_cycle applies the ×0.5 — so one line → 0.5 load,
    two lines in the month → 1.0 load. Casual lines bucket by their own mine's casual_group.

    Loads are bucketed by their STATEMENT period (coalesced with load_date), matching the
    Truck Loads view and subcontractor costing — so an OBHI subcontractor split done in June
    but statemented to July counts on the driver's July cycle, not June."""
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        return

    split_loads = (
        db.query(TruckLoadDriverSplit)
        .join(TruckLoad, TruckLoadDriverSplit.truck_load_id == TruckLoad.id)
        .filter(
            TruckLoadDriverSplit.driver_id == driver_id,
            TruckLoad.entity_id == driver.entity_id,
            TruckLoad.is_archived != True,
            func.coalesce(TruckLoad.statement_month, extract("month", TruckLoad.load_date)) == month,
            func.coalesce(TruckLoad.statement_year,  extract("year",  TruckLoad.load_date)) == year,
        )
        .all()
    )
    split_count = len(split_loads)

    assmang_ids = set(_assmang_mine_ids(db))
    assmang_split = sum(1 for l in split_loads if l.mine_id in assmang_ids)

    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_month == month,
        DriverPayCycle.pay_year  == year,
    ).first()
    settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()

    if driver.driver_type == DriverType.permanent:
        if cycle:
            cycle.permanent_split_loads = split_count
            cycle.assmang_split_loads   = assmang_split
        else:
            cycle = DriverPayCycle(
                driver_id=driver_id, pay_month=month, pay_year=year,
                payroll_settings_id=settings.id if settings else None,
                permanent_split_loads=split_count,
                assmang_split_loads=assmang_split,
            )
            db.add(cycle)
            db.flush()
    else:
        split_a = sum(1 for l in split_loads if l.mine and l.mine.casual_group == 'A')
        split_b = split_count - split_a
        if cycle:
            cycle.casual_split_group_a_loads = split_a
            cycle.casual_split_group_b_loads = split_b
            cycle.assmang_split_loads        = assmang_split
        else:
            cycle = DriverPayCycle(
                driver_id=driver_id, pay_month=month, pay_year=year,
                payroll_settings_id=settings.id if settings else None,
                casual_split_group_a_loads=split_a,
                casual_split_group_b_loads=split_b,
                assmang_split_loads=assmang_split,
            )
            db.add(cycle)
            db.flush()


def _add_split_trip_logs(load: TruckLoad, db: Session):
    """Create one DriverTripLog per driver line on a split load (pay cycles must exist)."""
    eff_year, eff_month = _load_effective_period(load)
    for s in load.driver_splits:
        if not s.driver_id:
            continue
        cycle = db.query(DriverPayCycle).filter(
            DriverPayCycle.driver_id == s.driver_id,
            DriverPayCycle.pay_month == eff_month,
            DriverPayCycle.pay_year  == eff_year,
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

    # driver/splits are read for every row by _enrich (driver name + type) — pull
    # them in one go rather than a query per load.
    q = db.query(TruckLoad).options(
        joinedload(TruckLoad.driver),
        selectinload(TruckLoad.driver_splits).joinedload(TruckLoadDriverSplit.driver),
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


@router.get("/fleet-summary/export/pdf")
def export_fleet_summary_pdf(
    statement_month: int = Query(..., ge=1, le=12),
    statement_year: int = Query(..., ge=2020),
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The Summary tab's truck totals as a branded PDF (letterhead when a
    single entity is selected)."""
    import io
    from fastapi.responses import StreamingResponse
    from app.services.fleet_summary_export import generate_fleet_summary_pdf

    rows = get_fleet_summary(entity_id=entity_id, statement_month=statement_month,
                             statement_year=statement_year, db=db, current_user=current_user)
    entity = None
    if entity_id is not None:
        entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()

    pdf_bytes = generate_fleet_summary_pdf(rows, entity, statement_month, statement_year)
    ent_part = (entity.code or entity.name).replace(" ", "-").lower() if entity else "all"
    filename = f"truck-totals-{ent_part}-{statement_year}-{statement_month:02d}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
    _ensure_load_month_open(db, payload.truck_id, payload.load_date,
                            getattr(payload, "statement_year", None),
                            getattr(payload, "statement_month", None))

    rate = payload.rate_per_ton
    if rate is None:
        rate = _resolve_rate(db, payload.mine_id, payload.entity_id, payload.load_date)
        if rate is None:
            if payload.is_projection:
                rate = Decimal("0")
            else:
                raise HTTPException(
                    status_code=400,
                    detail="No active mine rate found for this mine/entity. Provide rate_per_ton explicitly.",
                )

    vat_reg, vat_rate = entity_vat(db, payload.entity_id)

    load = TruckLoad(**payload.model_dump(exclude={"rate_per_ton"}), rate_per_ton=rate)
    _compute_amounts(load, vat_registered=vat_reg, vat_rate=vat_rate)
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
        _ensure_load_month_open(db, item.truck_id, item.load_date,
                                getattr(item, "statement_year", None),
                                getattr(item, "statement_month", None))

        rate = item.rate_per_ton
        if rate is None:
            rate = _resolve_rate(db, item.mine_id, item.entity_id, item.load_date)
            if rate is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"No active mine rate for mine {item.mine_id}/entity {item.entity_id}.",
                )

        if item.entity_id not in _entity_vat_cache:
            _entity_vat_cache[item.entity_id] = entity_vat(db, item.entity_id)
        vat_reg, vat_rate = _entity_vat_cache[item.entity_id]

        load = TruckLoad(**item.model_dump(exclude={"rate_per_ton"}), rate_per_ton=rate)
        _compute_amounts(load, vat_registered=vat_reg, vat_rate=vat_rate)

        # Resolve subcontractor flag (+ owner entity for its VAT) and diesel settings from cache
        if item.truck_id not in _truck_is_sub_cache:
            t = db.query(Truck).filter(Truck.id == item.truck_id).first()
            _truck_is_sub_cache[item.truck_id] = (
                (t.is_subcontractor if t else False), (t.entity_id if t else None))
        truck_is_sub, owner_entity_id = _truck_is_sub_cache[item.truck_id]
        if truck_is_sub:
            if item.entity_id not in _diesel_settings_cache:
                s = db.query(DieselSettings).filter(DieselSettings.entity_id == item.entity_id).first()
                _diesel_settings_cache[item.entity_id] = (
                    Decimal(str(s.additional_charge_per_ton)) if s else Decimal("0")
                )
            load.subcontractor_admin_fee_per_ton = _diesel_settings_cache[item.entity_id]
            if owner_entity_id not in _entity_vat_cache:
                _entity_vat_cache[owner_entity_id] = entity_vat(db, owner_entity_id)
            sub_reg, sub_rate = _entity_vat_cache[owner_entity_id]
            # reuse snapshot (no db) — owner VAT resolved here, same as the single-load path
            _compute_subcontractor_amounts(load, sub_vat_registered=sub_reg, sub_vat_rate=sub_rate)
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
    _ensure_load_month_open(db, item.truck_id, item.load_date,
                            getattr(item, "statement_year", None),
                            getattr(item, "statement_month", None))

    rate = item.rate_per_ton
    if rate is None:
        rate = _resolve_rate(db, item.mine_id, item.entity_id, item.load_date)
        if rate is None:
            if item.is_projection:
                rate = Decimal("0")  # projections are placeholders — tonnes/rate unknown
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"No active mine rate for mine {item.mine_id}/entity {item.entity_id}. Provide rate_per_ton.",
                )
    vat_reg, vat_rate = entity_vat(db, item.entity_id)

    load = TruckLoad(**item.model_dump(exclude={"rate_per_ton"}), rate_per_ton=rate)
    load.is_split_load = True
    load.driver_id = None  # the main load is not tied to a single driver
    _compute_amounts(load, vat_registered=vat_reg, vat_rate=vat_rate)
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

    # Credit each distinct driver's payroll (0.5 per line), on the load's effective
    # (statement) period so subcontractor splits land in the right cycle.
    eff_year, eff_month = _load_effective_period(load)
    for did in {sp.driver_id for sp in payload.splits if sp.driver_id}:
        _sync_split_driver(did, eff_year, eff_month, db)
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
    old_split_period = _load_effective_period(load)

    # Profit Sheet final lock: the load's current month must be open ...
    ensure_truck_month_open(db, old_truck_id, *old_split_period)

    updated_fields = payload.model_dump(exclude_none=True)
    for field, value in updated_fields.items():
        setattr(load, field, value)

    # ... and so must the month/truck it is being moved onto.
    if {"truck_id", "load_date", "statement_year", "statement_month"} & set(updated_fields):
        ensure_truck_month_open(db, load.truck_id, *_load_effective_period(load))

    # When a load is marked paid and its load_date is in a previous month,
    # flag driver_already_paid so the pay-cycle sync excludes it — the driver's
    # payroll for that prior period has already been processed.
    if "is_paid" in updated_fields:
        now = datetime.now(tz=timezone.utc)
        ld  = load.load_date
        in_previous_month = (
            ld.year < now.year or
            (ld.year == now.year and ld.month < now.month)
        )
        if updated_fields["is_paid"] is True and in_previous_month and not load.driver_already_paid:
            load.driver_already_paid = True
        elif updated_fields["is_paid"] is False and load.driver_already_paid:
            # Unmarked as paid — restore to payroll so it can be counted again
            load.driver_already_paid = False

    vat_reg, vat_rate = entity_vat(db, load.entity_id)
    _compute_amounts(load, vat_registered=vat_reg, vat_rate=vat_rate)

    if "truck_id" in updated_fields:
        _compute_subcontractor_amounts(load, db)
    else:
        truck = db.query(Truck).filter(Truck.id == load.truck_id).first()
        # Re-snapshot if fee was never stored (load predates is_subcontractor flag being set)
        if truck and truck.is_subcontractor and load.subcontractor_admin_fee_per_ton is None:
            _compute_subcontractor_amounts(load, db)
        else:
            sub_vat_reg, sub_vat_rate = True, DEFAULT_VAT_RATE
            if truck and truck.is_subcontractor and truck.entity_id:
                sub_vat_reg, sub_vat_rate = entity_vat(db, truck.entity_id)
            _compute_subcontractor_amounts(load, sub_vat_registered=sub_vat_reg, sub_vat_rate=sub_vat_rate)

    new_truck_id  = load.truck_id
    new_load_date = load.load_date
    new_is_split  = load.is_split_load
    new_driver_id = load.driver_id

    # Sync pay cycles for affected drivers/trucks
    dates_to_sync = {old_load_date, new_load_date}
    if new_is_split:
        # Split load: re-sync every driver line for both old and new effective
        # (statement) periods, in case the date or statement period moved.
        split_periods = {old_split_period, _load_effective_period(load)}
        for did in {s.driver_id for s in load.driver_splits if s.driver_id}:
            for (yr, mo) in split_periods:
                _sync_split_driver(did, yr, mo, db)
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

    # Keep linked trip log entries aligned with the load. For split loads, just
    # realign the date in place. For regular loads, rebuild the auto entry so it
    # lands on the load's effective pay cycle (date change or pay_deferred toggle
    # moves the trip to the right month).
    if new_is_split:
        for te in db.query(DriverTripLog).filter(DriverTripLog.truck_load_id == load_id).all():
            te.trip_date = new_load_date
            if load.mine:
                te.mine_name = load.mine.name
    else:
        _remove_trip_log(load_id, db)
        db.flush()
        _add_trip_log(load, db)

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
    ensure_truck_month_open(db, load.truck_id, *_load_effective_period(load))

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
    ensure_truck_month_open(db, load.truck_id, *_load_effective_period(load))

    truck_id   = load.truck_id
    load_date  = load.load_date
    is_split   = load.is_split_load
    driver_id  = load.driver_id
    split_driver_ids = [s.driver_id for s in load.driver_splits if s.driver_id] if is_split else []
    split_period = _load_effective_period(load) if is_split else None

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
            _sync_split_driver(did, split_period[0], split_period[1], db)
    else:
        _sync_driver_pay_cycle(truck_id, load_date, db)
        if driver_id:
            _sync_casual_driver(driver_id, load_date, db)

    db.commit()
    return {"detail": "Truck load deleted"}
