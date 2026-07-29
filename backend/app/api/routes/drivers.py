from datetime import datetime, timezone
import calendar
import logging

logger = logging.getLogger("safetec.drivers")
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, func, extract
from typing import List, Optional
from decimal import Decimal
from datetime import date

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, Driver, DriverType,
    DriverPayCycle, DriverTripLog, DriverAdditionalLoad, DriverFoodPayment,
    TruckLoad, TruckLoadDriverSplit, PayrollEntry, CasualTruckAssignment, Mine, Truck,
)
from app.schemas.schemas import (
    DriverCreate, DriverUpdate, DriverOut, DriverSummary, DriverStats,
    DriverPayCycleOut, DriverPayCycleUpdate,
    DriverTripLogCreate, DriverTripLogOut,
    DriverAdditionalLoadCreate, DriverAdditionalLoadUpdate, DriverAdditionalLoadOut,
    DriverFoodPaymentCreate, DriverFoodPaymentUpdate, DriverFoodPaymentOut,
    CasualTruckAssignmentOut,
)
from app.services.audit import log_action
from app.services.load_bonus import bonus_mine_ids
from app.services.payroll_calculator import calculate_pay_cycle
from app.services.payslip_generator import generate_payslip_pdf
from app.services.verification import (
    apply_verify_step, apply_finalize_step, get_verification_display, ensure_not_locked,
    build_initials_cache, intent_from_action,
)
from app.api.routes.payroll_settings import _get_current as _get_payroll_settings

router = APIRouter(prefix="/api/drivers", tags=["drivers"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _check_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    if entity_id not in [a.entity_id for a in user.entity_access]:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _accessible_ids(user: User) -> Optional[List[int]]:
    return None if user.role == "admin" else [a.entity_id for a in user.entity_access]


def _current_month_bounds():
    today = date.today()
    return today.replace(day=1), today


def _truck_subcontractor(truck: Optional[Truck]) -> Optional[str]:
    """Subcontractor a truck belongs to — linked record first, free-text fallback."""
    if truck is None:
        return None
    if truck.subcontractor is not None:
        return truck.subcontractor.name
    return truck.subcontractor_name or None


def _driver_subcontractor(driver: Driver) -> Optional[str]:
    """Drivers have no subcontractor of their own — it comes from the truck(s)
    they drive. A casual on several subcontractors' trucks shows all of them."""
    trucks = [driver.truck] + [a.truck for a in driver.casual_assignments]
    names = []
    for name in (_truck_subcontractor(t) for t in trucks):
        if name and name not in names:
            names.append(name)
    return ", ".join(names) or None


def _month_cycle_totals(db: Session, driver_ids: List[int], month_start: date) -> dict:
    """Net pay + food allowance for the month, per driver, straight off the pay
    cycle. The list used to read PayrollEntry.net_payable, but nothing ever
    writes a PayrollEntry row, so that column was always 0 — DriverPayCycle is
    the live source (same figures the payslip prints)."""
    if not driver_ids:
        return {}
    settings = _get_payroll_settings(db)
    cycles = db.query(DriverPayCycle).options(
        joinedload(DriverPayCycle.driver),
        joinedload(DriverPayCycle.additional_loads),
        joinedload(DriverPayCycle.food_payments),
    ).filter(
        DriverPayCycle.driver_id.in_(driver_ids),
        DriverPayCycle.pay_month == month_start.month,
        DriverPayCycle.pay_year == month_start.year,
    ).all()

    totals = {}
    for cycle in cycles:
        driver = cycle.driver
        calc = calculate_pay_cycle(
            cycle,
            settings,
            driver.driver_type.value if driver and driver.driver_type else "permanent",
            bool(driver and driver.exclude_mine_bonus),
        )
        totals[cycle.driver_id] = {
            "net_pay": calc["net_payable"],
            "food": calc["food_deduction"],
        }
    return totals


def _build_summary(driver: Driver, month_start: date, db: Session, cycle_map: dict) -> dict:
    start_dt = datetime(month_start.year, month_start.month, 1, tzinfo=timezone.utc)
    end_dt = (datetime(month_start.year + 1, 1, 1, tzinfo=timezone.utc)
              if month_start.month == 12
              else datetime(month_start.year, month_start.month + 1, 1, tzinfo=timezone.utc))

    if driver.driver_type == DriverType.casual:
        # Casual: count only loads attributed to this driver, not all truck loads
        load_count = db.query(func.count(TruckLoad.id)).filter(
            TruckLoad.driver_id == driver.id,
            TruckLoad.entity_id == driver.entity_id,
            TruckLoad.is_archived != True,
            TruckLoad.is_split_load != True,
            TruckLoad.driver_already_paid != True,
            TruckLoad.load_date >= start_dt,
            TruckLoad.load_date < end_dt,
        ).scalar() or 0
    elif driver.truck_id:
        load_count = db.query(func.count(TruckLoad.id)).filter(
            TruckLoad.truck_id == driver.truck_id,
            TruckLoad.entity_id == driver.entity_id,
            TruckLoad.is_archived != True,
            TruckLoad.is_split_load != True,
            TruckLoad.driver_already_paid != True,
            or_(TruckLoad.driver_id.is_(None), TruckLoad.driver_id == driver.id),
            TruckLoad.load_date >= start_dt,
            TruckLoad.load_date < end_dt,
        ).scalar() or 0
    else:
        load_count = 0
    casual_assignments = [
        {
            "id": a.id,
            "truck_id": a.truck_id,
            "driver_slot": a.driver_slot,
            "truck_registration": a.truck.registration if a.truck else None,
        }
        for a in driver.casual_assignments
    ]
    return {
        "id": driver.id,
        "entity_id": driver.entity_id,
        "employee_number": driver.employee_number,
        "first_name": driver.first_name,
        "last_name": driver.last_name,
        "driver_type": driver.driver_type,
        "truck_id": driver.truck_id,
        "driver_slot": driver.driver_slot,
        "truck_registration": driver.truck.registration if driver.truck else None,
        "subcontractor_name": _driver_subcontractor(driver),
        "is_active": driver.is_active,
        "load_count_this_month": load_count,
        "net_pay_this_month": cycle_map.get(driver.id, {}).get("net_pay", Decimal("0")),
        "food_total_this_month": cycle_map.get(driver.id, {}).get("food", Decimal("0")),
        "casual_assignments": casual_assignments,
    }


def _cycle_with_calc(
    cycle: DriverPayCycle,
    driver: Driver,
    db: Session,
    was_prefilled: bool = False,
) -> DriverPayCycleOut:
    settings = _get_payroll_settings(db)
    driver_type = driver.driver_type.value if driver.driver_type else "permanent"
    calc = calculate_pay_cycle(cycle, settings, driver_type=driver_type,
                               exclude_mine_bonus=bool(getattr(driver, "exclude_mine_bonus", False)))
    calc_serialisable = {k: float(v) if isinstance(v, Decimal) else v for k, v in calc.items()}
    out = DriverPayCycleOut.model_validate(cycle)
    out.calc = calc_serialisable
    out.was_prefilled = was_prefilled
    _vcache = build_initials_cache(db)
    out.additional_loads = [
        DriverAdditionalLoadOut.model_validate(al).model_copy(update=get_verification_display(db, al, _vcache))
        for al in cycle.additional_loads
    ]
    out.food_payments = [
        DriverFoodPaymentOut.model_validate(fp).model_copy(update=get_verification_display(db, fp, _vcache))
        for fp in cycle.food_payments
    ]
    # Enrich each auto trip with the reg of the truck it was driven on and whether
    # the underlying load was already paid in a prior period — derived live so the
    # flags stay accurate if the load changes. Trips with no linked load (manual
    # entries) keep the bare values.
    load_ids = [t.truck_load_id for t in cycle.trip_log if t.truck_load_id]
    load_map = {}
    if load_ids:
        rows = (
            db.query(TruckLoad.id, TruckLoad.truck_id, TruckLoad.driver_already_paid, Truck.registration)
            .outerjoin(Truck, TruckLoad.truck_id == Truck.id)
            .filter(TruckLoad.id.in_(load_ids))
            .all()
        )
        load_map = {r[0]: (r[1], bool(r[2]), r[3]) for r in rows}
    trip_out = []
    for t in cycle.trip_log:
        item = DriverTripLogOut.model_validate(t)
        info = load_map.get(t.truck_load_id)
        if info:
            truck_id, already_paid, reg = info
            item.vehicle_reg = reg
            item.already_paid = already_paid
            item.cross_truck = bool(driver.truck_id and truck_id and truck_id != driver.truck_id)
        trip_out.append(item)
    out.trip_log = trip_out
    return out


def _assmang_mine_ids(db: Session) -> list:
    """IDs of mines that earn the per-load bonus (Assmang + Mokala/Tawana/Sebilo)."""
    return bonus_mine_ids(db)


def _prefill_from_truckloads(driver: Driver, year: int, month: int, db: Session) -> dict:
    """
    Derive a pay cycle's load counts from TruckLoad rows for the given month/year.

    Permanent drivers: count loads on their assigned truck (7-load floor, rest extra).
    Casual drivers: count loads attributed to them on the load record (TruckLoad.driver_id),
    bucketed by mine group into casual_group_a/b_loads — the fields the casual payroll
    path reads. (Casuals have no truck_id; they're named per-load instead.)
    """
    empty = {
        "lohatla_base_loads":   0,
        "lohatla_extra_loads":  0,
        "casual_group_a_loads": 0,
        "casual_group_b_loads": 0,
        "assmang_loads":        0,
        "permanent_split_loads":      0,
        "casual_split_group_a_loads": 0,
        "casual_split_group_b_loads": 0,
        "assmang_split_loads":        0,
        "prefill_count":        0,
    }

    first_day = datetime(year, month, 1, tzinfo=timezone.utc)
    last_day_num = calendar.monthrange(year, month)[1]
    last_day = datetime(year, month, last_day_num, 23, 59, 59, tzinfo=timezone.utc)

    # Previous month window — loads dated there but flagged pay_deferred are paid in
    # THIS cycle (they were done last month but only paid now).
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
    prev_first = datetime(prev_year, prev_month, 1, tzinfo=timezone.utc)
    prev_last_num = calendar.monthrange(prev_year, prev_month)[1]
    prev_last = datetime(prev_year, prev_month, prev_last_num, 23, 59, 59, tzinfo=timezone.utc)

    # A load belongs to THIS pay cycle when it's dated in this month and not deferred,
    # OR dated last month and deferred forward. Deferring shifts only the pay cycle —
    # the load record (date, mine, tonnes, invoicing) stays in its own month.
    pay_period_clause = or_(
        and_(TruckLoad.load_date >= first_day, TruckLoad.load_date <= last_day,
             TruckLoad.pay_deferred != True),
        and_(TruckLoad.load_date >= prev_first, TruckLoad.load_date <= prev_last,
             TruckLoad.pay_deferred == True),
    )

    assmang_ids = set(_assmang_mine_ids(db))

    # Split-load lines attributed to this driver (each line = 0.5 of a load).
    # calculate_pay_cycle applies the ×0.5; we store the integer line count here.
    # Splits are bucketed by their STATEMENT period (coalesced with load_date) — not the
    # plain load_date window above — so an OBHI subcontractor split done in June but
    # statemented to July counts on the July cycle, matching the Truck Loads view.
    split_period_clause = and_(
        func.coalesce(TruckLoad.statement_month, extract("month", TruckLoad.load_date)) == month,
        func.coalesce(TruckLoad.statement_year,  extract("year",  TruckLoad.load_date)) == year,
    )
    split_rows = (
        db.query(TruckLoadDriverSplit)
        .join(TruckLoad, TruckLoadDriverSplit.truck_load_id == TruckLoad.id)
        .filter(
            TruckLoadDriverSplit.driver_id == driver.id,
            TruckLoad.entity_id == driver.entity_id,
            TruckLoad.is_archived != True,
            split_period_clause,
        )
        .all()
    )
    assmang_split = sum(1 for r in split_rows if r.mine_id in assmang_ids)

    if driver.driver_type == DriverType.casual:
        # Always count by driver_id — casual loads are attributed per-load, not by truck.
        # Brian shares JPL694EC with Kabelo; only loads with driver_id=Brian's id are his.
        logger.info("[prefill] casual driver_id=%s truck_id=%s — filtering by driver_id", driver.id, driver.truck_id)
        load_filter = TruckLoad.driver_id == driver.id
        loads = db.query(TruckLoad).filter(
            load_filter,
            TruckLoad.entity_id == driver.entity_id,
            TruckLoad.is_split_load != True,
            TruckLoad.is_archived != True,
            TruckLoad.driver_already_paid != True,
            pay_period_clause,
        ).all()
        group_a = sum(1 for l in loads if l.mine and l.mine.casual_group == 'A')
        group_b = len(loads) - group_a
        assmang_loads = sum(1 for l in loads if l.mine_id in assmang_ids)
        logger.info("[prefill] casual driver_id=%s year=%s month=%s → total=%s group_a=%s group_b=%s",
                    driver.id, year, month, len(loads), group_a, group_b)
        split_a = sum(1 for r in split_rows if r.mine and r.mine.casual_group == 'A')
        split_b = len(split_rows) - split_a
        return {
            **empty,
            "casual_group_a_loads": group_a,
            "casual_group_b_loads": group_b,
            "assmang_loads":        assmang_loads,
            "casual_split_group_a_loads": split_a,
            "casual_split_group_b_loads": split_b,
            "assmang_split_loads":        assmang_split,
            "prefill_count":        len(loads) + len(split_rows),
        }

    # Permanent: 7-load floor, rest are extra
    if not driver.truck_id:
        return empty

    perm_filter = [
        TruckLoad.entity_id == driver.entity_id,
        TruckLoad.is_archived != True,
        TruckLoad.is_split_load != True,
        TruckLoad.driver_already_paid != True,
        # Credit this permanent driver for: an unassigned load on his OWN truck
        # (default = him), OR any load explicitly tagged as driven by him — even on
        # another truck. The cross-truck case would otherwise fall through to nobody:
        # the other truck's driver count filters by ITS own driver_id, so a load this
        # driver physically drove on a borrowed truck went unpaid.
        or_(
            and_(TruckLoad.truck_id == driver.truck_id, TruckLoad.driver_id.is_(None)),
            TruckLoad.driver_id == driver.id,
        ),
        pay_period_clause,
    ]
    load_count = db.query(func.count(TruckLoad.id)).filter(*perm_filter).scalar() or 0
    assmang_loads = (db.query(func.count(TruckLoad.id)).filter(
        *perm_filter, TruckLoad.mine_id.in_(assmang_ids),
    ).scalar() or 0) if assmang_ids else 0
    base  = min(7, load_count)
    extra = max(0, load_count - 7)
    return {
        **empty,
        "lohatla_base_loads":  base,
        "lohatla_extra_loads": extra,
        "assmang_loads":       assmang_loads,
        "permanent_split_loads": len(split_rows),
        "assmang_split_loads":   assmang_split,
        "prefill_count":       load_count + len(split_rows),
    }


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=DriverStats)
def get_driver_stats(
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_ids(current_user)
    q = db.query(Driver)
    if accessible is not None:
        q = q.filter(Driver.entity_id.in_(accessible))
    if entity_id:
        _check_access(entity_id, current_user)
        q = q.filter(Driver.entity_id == entity_id)

    drivers = q.all()
    return DriverStats(
        total_drivers=len(drivers),
        permanent=sum(1 for d in drivers if d.driver_type == DriverType.permanent),
        casual=sum(1 for d in drivers if d.driver_type == DriverType.casual),
        active=sum(1 for d in drivers if d.is_active),
    )


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[DriverSummary])
def list_drivers(
    entity_id: Optional[int] = Query(None),
    driver_type: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(True),
    search: Optional[str] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12, description="Period for the load/food/net-pay columns; defaults to the current month"),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_ids(current_user)
    q = db.query(Driver).options(
        joinedload(Driver.truck).joinedload(Truck.subcontractor),
        joinedload(Driver.casual_assignments)
            .joinedload(CasualTruckAssignment.truck)
            .joinedload(Truck.subcontractor),
    )
    if accessible is not None:
        q = q.filter(Driver.entity_id.in_(accessible))
    if entity_id:
        _check_access(entity_id, current_user)
        q = q.filter(Driver.entity_id == entity_id)
    if driver_type:
        q = q.filter(Driver.driver_type == driver_type)
    if is_active is not None:
        q = q.filter(Driver.is_active == is_active)
    if search:
        term = f"%{search}%"
        q = q.filter(or_(
            Driver.first_name.ilike(term),
            Driver.last_name.ilike(term),
            Driver.employee_number.ilike(term),
        ))

    drivers = q.order_by(Driver.last_name, Driver.first_name).offset(skip).limit(limit).all()
    default_start, _ = _current_month_bounds()
    month_start = date(year or default_start.year, month or default_start.month, 1)
    cycle_map = _month_cycle_totals(db, [d.id for d in drivers], month_start)
    return [_build_summary(d, month_start, db, cycle_map) for d in drivers]


# ── Detail ────────────────────────────────────────────────────────────────────

@router.get("/{driver_id}", response_model=DriverOut)
def get_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    out = DriverOut.model_validate(driver)
    out.truck_registration = driver.truck.registration if driver.truck else None
    return out


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=DriverOut)
def create_driver(
    payload: DriverCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_access(payload.entity_id, current_user)
    if payload.truck_id and payload.driver_slot is not None:
        conflict = db.query(Driver).filter(
            Driver.truck_id == payload.truck_id,
            Driver.driver_slot == payload.driver_slot,
            Driver.is_active == True,
        ).first()
        if conflict:
            raise HTTPException(
                status_code=400,
                detail=f"Driver {payload.driver_slot} slot is already taken by {conflict.first_name} {conflict.last_name}",
            )
    driver = Driver(**payload.model_dump())
    db.add(driver)
    db.flush()
    log_action(db, "driver.created", user_id=current_user.id,
               entity_id=payload.entity_id, resource_type="driver",
               resource_id=driver.id,
               description=f"Created driver {driver.first_name} {driver.last_name}")
    db.commit()
    db.refresh(driver)
    out = DriverOut.model_validate(driver)
    out.truck_registration = driver.truck.registration if driver.truck else None
    return out


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{driver_id}", response_model=DriverOut)
def update_driver(
    driver_id: int,
    payload: DriverUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)

    update_data = payload.model_dump(exclude_unset=True)

    # Auto-clear slot when unassigning from a truck
    if "truck_id" in update_data and update_data["truck_id"] is None:
        update_data.setdefault("driver_slot", None)

    # Conflict check: only one driver per (truck_id, driver_slot)
    truck_changing = "truck_id" in update_data
    slot_changing = "driver_slot" in update_data
    if truck_changing or slot_changing:
        effective_truck_id = update_data.get("truck_id", driver.truck_id) if truck_changing else driver.truck_id
        effective_slot = update_data.get("driver_slot", driver.driver_slot) if slot_changing else driver.driver_slot
        if effective_truck_id is not None and effective_slot is not None:
            conflict = db.query(Driver).filter(
                Driver.truck_id == effective_truck_id,
                Driver.driver_slot == effective_slot,
                Driver.is_active == True,
                Driver.id != driver_id,
            ).first()
            if conflict:
                raise HTTPException(
                    status_code=400,
                    detail=f"Driver {effective_slot} slot is already taken by {conflict.first_name} {conflict.last_name}",
                )

    for field, value in update_data.items():
        setattr(driver, field, value)

    log_action(db, "driver.updated", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="driver",
               resource_id=driver_id,
               description=f"Updated driver {driver.first_name} {driver.last_name}")
    db.commit()
    db.refresh(driver)
    out = DriverOut.model_validate(driver)
    out.truck_registration = driver.truck.registration if driver.truck else None
    return out


@router.delete("/{driver_id}")
def delete_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    log_action(db, "driver.deleted", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="driver",
               resource_id=driver_id,
               description=f"Deleted driver {driver.first_name} {driver.last_name}")
    db.delete(driver)
    db.commit()
    return {"detail": "Driver deleted"}


# ── Casual multi-truck assignments ────────────────────────────────────────────

class TruckAssignPayload(BaseModel):
    truck_id: int
    driver_slot: int
    entity_id: int


@router.post("/{driver_id}/truck-assignments", response_model=CasualTruckAssignmentOut)
def add_truck_assignment(
    driver_id: int,
    payload: TruckAssignPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    if driver.driver_type != DriverType.casual:
        raise HTTPException(status_code=400, detail="Multi-truck assignments are only for casual drivers")

    # Idempotency: if this exact assignment already exists, just return it
    existing = db.query(CasualTruckAssignment).filter(
        CasualTruckAssignment.driver_id == driver_id,
        CasualTruckAssignment.truck_id == payload.truck_id,
        CasualTruckAssignment.driver_slot == payload.driver_slot,
    ).first()
    if existing:
        return {
            "id": existing.id,
            "truck_id": existing.truck_id,
            "driver_slot": existing.driver_slot,
            "truck_registration": existing.truck.registration if existing.truck else None,
        }

    # Conflict: another driver already occupies this slot on this truck
    conflict = db.query(CasualTruckAssignment).filter(
        CasualTruckAssignment.truck_id == payload.truck_id,
        CasualTruckAssignment.driver_slot == payload.driver_slot,
        CasualTruckAssignment.driver_id != driver_id,
    ).first()
    if conflict:
        raise HTTPException(
            status_code=400,
            detail=f"Driver {payload.driver_slot} slot on this truck is already taken",
        )

    assignment = CasualTruckAssignment(
        driver_id=driver_id,
        truck_id=payload.truck_id,
        driver_slot=payload.driver_slot,
        entity_id=payload.entity_id,
    )
    db.add(assignment)
    db.flush()
    log_action(db, "driver.truck_assigned", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="driver",
               resource_id=driver_id,
               description=f"Assigned {driver.first_name} {driver.last_name} to truck {payload.truck_id} slot {payload.driver_slot}")
    db.commit()
    db.refresh(assignment)
    return {
        "id": assignment.id,
        "truck_id": assignment.truck_id,
        "driver_slot": assignment.driver_slot,
        "truck_registration": assignment.truck.registration if assignment.truck else None,
    }


@router.delete("/{driver_id}/truck-assignments/{assignment_id}")
def remove_truck_assignment(
    driver_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)

    assignment = db.query(CasualTruckAssignment).filter(
        CasualTruckAssignment.id == assignment_id,
        CasualTruckAssignment.driver_id == driver_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    log_action(db, "driver.truck_unassigned", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="driver",
               resource_id=driver_id,
               description=f"Unassigned {driver.first_name} {driver.last_name} from truck {assignment.truck_id} slot {assignment.driver_slot}")
    db.delete(assignment)
    db.commit()
    return {"detail": "Assignment removed"}


@router.get("/{driver_id}/trucks")
def list_driver_trucks(
    driver_id: int,
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trucks this driver is linked to — the picker behind "which truck does this
    food allowance belong to". Mirrors the linkage the truck Food Allowance tab
    reads back (fleet.list_truck_food_payments): assigned truck, casual truck
    assignments, and any truck the driver is named on a load (or split-load line)
    for. When year/month are given, loads are narrowed to that month first; the
    remaining linked trucks still follow, then the rest of the entity's fleet, so
    the user is never stuck without a choice.
    """
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)

    order: List[int] = []
    source: dict = {}

    def add(truck_id, label):
        if truck_id and truck_id not in source:
            source[truck_id] = label
            order.append(truck_id)

    add(driver.truck_id, "Assigned truck")
    for a in driver.casual_assignments:
        add(a.truck_id, "Assigned (casual)")

    def load_truck_ids(period: bool):
        q = (
            db.query(TruckLoad.truck_id)
            .outerjoin(TruckLoadDriverSplit, TruckLoadDriverSplit.truck_load_id == TruckLoad.id)
            .filter(
                TruckLoad.truck_id.isnot(None),
                or_(TruckLoad.driver_id == driver_id, TruckLoadDriverSplit.driver_id == driver_id),
            )
        )
        if period:
            last_num = calendar.monthrange(year, month)[1]
            q = q.filter(
                TruckLoad.load_date >= datetime(year, month, 1, tzinfo=timezone.utc),
                TruckLoad.load_date <= datetime(year, month, last_num, 23, 59, 59, tzinfo=timezone.utc),
            )
        return [tid for (tid,) in q.distinct().all()]

    if year and month:
        for tid in load_truck_ids(period=True):
            add(tid, f"Loads in {calendar.month_abbr[month]} {year}")
    for tid in load_truck_ids(period=False):
        add(tid, "Previously driven")

    trucks = {t.id: t for t in db.query(Truck).filter(Truck.id.in_(order)).all()} if order else {}
    result = [
        {"id": tid, "registration": trucks[tid].registration,
         "fleet_number": trucks[tid].fleet_number, "source": source[tid]}
        for tid in order if tid in trucks
    ]

    # Everything else in the driver's entity, so an unlinked truck can still be picked.
    rest_q = db.query(Truck).filter(Truck.entity_id == driver.entity_id)
    if order:
        rest_q = rest_q.filter(~Truck.id.in_(order))
    rest = rest_q.order_by(Truck.registration).all()
    result += [
        {"id": t.id, "registration": t.registration, "fleet_number": t.fleet_number, "source": "Other truck"}
        for t in rest
    ]
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Pay cycles
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/{driver_id}/cycles")
def list_cycles(
    driver_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    cycles = (
        db.query(DriverPayCycle)
        .filter(DriverPayCycle.driver_id == driver_id)
        .order_by(DriverPayCycle.pay_year.desc(), DriverPayCycle.pay_month.desc())
        .all()
    )
    return [{"id": c.id, "pay_year": c.pay_year, "pay_month": c.pay_month} for c in cycles]


@router.get("/{driver_id}/cycles/{year}/{month}", response_model=DriverPayCycleOut)
def get_or_create_cycle(
    driver_id: int,
    year: int,
    month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info("[get_or_create_cycle] HIT driver_id=%s year=%s month=%s", driver_id, year, month)
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    logger.info("[get_or_create_cycle] driver=%s %s type=%s truck_id=%s",
                driver_id, f"{driver.first_name} {driver.last_name}", driver.driver_type, driver.truck_id)
    _check_access(driver.entity_id, current_user)

    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_year == year,
        DriverPayCycle.pay_month == month,
    ).first()

    was_prefilled = False
    if not cycle:
        settings = _get_payroll_settings(db)
        prefill = _prefill_from_truckloads(driver, year, month, db)
        cycle = DriverPayCycle(
            driver_id=driver_id,
            pay_year=year,
            pay_month=month,
            payroll_settings_id=settings.id,
            lohatla_base_loads=prefill["lohatla_base_loads"],
            lohatla_extra_loads=prefill["lohatla_extra_loads"],
            casual_group_a_loads=prefill["casual_group_a_loads"],
            casual_group_b_loads=prefill["casual_group_b_loads"],
            assmang_loads=prefill["assmang_loads"],
            permanent_split_loads=prefill["permanent_split_loads"],
            casual_split_group_a_loads=prefill["casual_split_group_a_loads"],
            casual_split_group_b_loads=prefill["casual_split_group_b_loads"],
            assmang_split_loads=prefill["assmang_split_loads"],
        )
        db.add(cycle)
        db.commit()
        db.refresh(cycle)
        was_prefilled = prefill["prefill_count"] > 0
    elif driver.driver_type == DriverType.casual:
        # Always resync casual load counts from truck data — the cycle may have
        # been created before loads were entered, or before this sync logic existed.
        logger.info("[cycle-open] existing casual cycle found — resyncing driver_id=%s %s/%s", driver_id, year, month)
        prefill = _prefill_from_truckloads(driver, year, month, db)
        cycle.casual_group_a_loads = prefill["casual_group_a_loads"]
        cycle.casual_group_b_loads = prefill["casual_group_b_loads"]
        cycle.assmang_loads        = prefill["assmang_loads"]
        cycle.casual_split_group_a_loads = prefill["casual_split_group_a_loads"]
        cycle.casual_split_group_b_loads = prefill["casual_split_group_b_loads"]
        cycle.assmang_split_loads        = prefill["assmang_split_loads"]
        logger.info("[cycle-open] resync done driver_id=%s → group_a=%s group_b=%s split_a=%s assmang_split=%s",
                    driver_id, cycle.casual_group_a_loads, cycle.casual_group_b_loads,
                    cycle.casual_split_group_a_loads, cycle.assmang_split_loads)
        db.commit()
        db.refresh(cycle)
    elif driver.driver_type == DriverType.permanent and driver.truck_id:
        # Resync permanent base/extra loads from truck data, mirroring the casual
        # branch above. Loads marked driver_already_paid (paid in a prior period)
        # are excluded by _prefill_from_truckloads, so the base/extra counts stay
        # in step with the trip log instead of holding a stale pre-flag total.
        logger.info("[cycle-open] existing permanent cycle found — resyncing driver_id=%s %s/%s", driver_id, year, month)
        prefill = _prefill_from_truckloads(driver, year, month, db)
        cycle.lohatla_base_loads  = prefill["lohatla_base_loads"]
        cycle.lohatla_extra_loads = prefill["lohatla_extra_loads"]
        cycle.assmang_loads       = prefill["assmang_loads"]
        cycle.permanent_split_loads = prefill["permanent_split_loads"]
        cycle.assmang_split_loads   = prefill["assmang_split_loads"]
        logger.info("[cycle-open] resync done driver_id=%s → base=%s extra=%s split=%s assmang_split=%s",
                    driver_id, cycle.lohatla_base_loads, cycle.lohatla_extra_loads,
                    cycle.permanent_split_loads, cycle.assmang_split_loads)
        db.commit()
        db.refresh(cycle)

    return _cycle_with_calc(cycle, driver, db, was_prefilled=was_prefilled)


@router.put("/{driver_id}/cycles/{year}/{month}", response_model=DriverPayCycleOut)
def update_cycle(
    driver_id: int,
    year: int,
    month: int,
    payload: DriverPayCycleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)

    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_year == year,
        DriverPayCycle.pay_month == month,
    ).first()

    if not cycle:
        settings = _get_payroll_settings(db)
        cycle = DriverPayCycle(
            driver_id=driver_id,
            pay_year=year,
            pay_month=month,
            payroll_settings_id=settings.id,
        )
        db.add(cycle)
        db.flush()

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(cycle, field, value)

    # Manual earnings overrides are nullable: an explicit null clears the override
    # back to the computed value. exclude_none above drops nulls, so apply these
    # from the explicitly-set fields (exclude_unset) where they can be set to None.
    explicit = payload.model_dump(exclude_unset=True)
    for field in ("basic_salary_override", "subsistence_override",
                  "load_incentive_override", "mine_bonus_override",
                  "nbcrfli_override", "provident_override", "wellness_override",
                  "sick_fund_override", "holiday_fund_override",
                  "leave_pay_override", "paye_override", "ctc_override"):
        if field in explicit:
            setattr(cycle, field, explicit[field])

    log_action(db, "pay_cycle.updated", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="pay_cycle",
               resource_id=cycle.id,
               description=f"Updated pay cycle {year}/{month} for {driver.first_name} {driver.last_name}")
    db.commit()
    db.refresh(cycle)
    return _cycle_with_calc(cycle, driver, db)


# ─── Trip log ──────────────────────────────────────────────────────────────────

def _get_cycle_or_404(driver_id: int, year: int, month: int, db: Session) -> DriverPayCycle:
    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_year == year,
        DriverPayCycle.pay_month == month,
    ).first()
    if not cycle:
        raise HTTPException(status_code=404, detail="Pay cycle not found")
    return cycle


def _get_or_create_cycle(driver_id: int, year: int, month: int, db: Session) -> DriverPayCycle:
    """Return the pay cycle, creating one (with current settings) if it doesn't exist yet."""
    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_year == year,
        DriverPayCycle.pay_month == month,
    ).first()
    if not cycle:
        from app.models.models import PayrollSettings
        settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
        cycle = DriverPayCycle(
            driver_id=driver_id,
            pay_year=year,
            pay_month=month,
            payroll_settings_id=settings.id if settings else None,
        )
        db.add(cycle)
        db.flush()
    return cycle


@router.post("/{driver_id}/cycles/{year}/{month}/trips", response_model=DriverTripLogOut)
def add_trip(
    driver_id: int, year: int, month: int,
    payload: DriverTripLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    cycle = _get_cycle_or_404(driver_id, year, month, db)
    trip = DriverTripLog(pay_cycle_id=cycle.id, **payload.model_dump())
    db.add(trip)
    db.flush()
    log_action(db, "trip_log.created", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="trip_log",
               resource_id=trip.id,
               description=f"Added trip log for {driver.first_name} {driver.last_name} on {payload.trip_date}")
    db.commit()
    db.refresh(trip)
    return trip


@router.delete("/{driver_id}/cycles/{year}/{month}/trips/{trip_id}")
def delete_trip(
    driver_id: int, year: int, month: int, trip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    trip = db.query(DriverTripLog).filter(DriverTripLog.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    log_action(db, "trip_log.deleted", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="trip_log",
               resource_id=trip_id,
               description=f"Deleted trip log #{trip_id} for {driver.first_name} {driver.last_name}")
    db.delete(trip)
    db.commit()
    return {"detail": "Trip deleted"}


# ─── Additional loads ─────────────────────────────────────────────────────────

@router.post("/{driver_id}/cycles/{year}/{month}/additional-loads", response_model=DriverAdditionalLoadOut)
def add_additional_load(
    driver_id: int, year: int, month: int,
    payload: DriverAdditionalLoadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    cycle = _get_or_create_cycle(driver_id, year, month, db)
    entry = DriverAdditionalLoad(pay_cycle_id=cycle.id, **payload.model_dump())
    db.add(entry)
    db.flush()
    log_action(db, "additional_load.created", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="additional_load",
               resource_id=entry.id,
               description=f"Added additional load for {driver.first_name} {driver.last_name} ({year}/{month})")
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/{driver_id}/cycles/{year}/{month}/additional-loads/{load_id}", response_model=DriverAdditionalLoadOut)
def update_additional_load(
    driver_id: int, year: int, month: int, load_id: int,
    payload: DriverAdditionalLoadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverAdditionalLoad).filter(DriverAdditionalLoad.id == load_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Additional load not found")
    updates = payload.model_dump(exclude_none=True)
    # Final-verification lock: only the paid status and a free-text note may
    # still change (a note-only edit sends just `notes`).
    ensure_not_locked(entry, updates, {"is_paid", "notes"})
    for field, value in updates.items():
        setattr(entry, field, value)
    log_action(db, "additional_load.updated", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="additional_load",
               resource_id=load_id,
               description=f"Updated additional load #{load_id} for {driver.first_name} {driver.last_name}")
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{driver_id}/cycles/{year}/{month}/additional-loads/{load_id}")
def delete_additional_load(
    driver_id: int, year: int, month: int, load_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverAdditionalLoad).filter(DriverAdditionalLoad.id == load_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Additional load not found")
    ensure_not_locked(entry)
    log_action(db, "additional_load.deleted", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="additional_load",
               resource_id=load_id,
               description=f"Deleted additional load #{load_id} for {driver.first_name} {driver.last_name}")
    db.delete(entry)
    db.commit()
    return {"detail": "Additional load deleted"}


@router.patch("/{driver_id}/cycles/{year}/{month}/additional-loads/{load_id}/archive")
def archive_additional_load(
    driver_id: int, year: int, month: int, load_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverAdditionalLoad).filter(DriverAdditionalLoad.id == load_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Additional load not found")
    ensure_not_locked(entry)
    entry.is_archived = True
    log_action(db, "additional_load.archived", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="additional_load",
               resource_id=load_id,
               description=f"Archived additional load #{load_id} for {driver.first_name} {driver.last_name}")
    db.commit()
    return {"detail": "Additional load archived"}


@router.patch("/{driver_id}/cycles/{year}/{month}/additional-loads/{load_id}/verify")
def verify_additional_load(
    driver_id: int, year: int, month: int, load_id: int,
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverAdditionalLoad).filter(DriverAdditionalLoad.id == load_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Additional load not found")
    before = (entry.verified_by, entry.verified2_by)
    apply_verify_step(entry, current_user, is_admin=(current_user.role == "admin"),
                      desired=intent_from_action(action))
    after = (entry.verified_by, entry.verified2_by)
    if after != before:
        added = (after[0] and not before[0]) or (after[1] and not before[1])
        log_action(db, "additional_load.verified" if added else "additional_load.unverified",
                   user_id=current_user.id,
                   entity_id=driver.entity_id, resource_type="additional_load",
                   resource_id=load_id,
                   description=f"{'Verified' if added else 'Removed verification on'} additional load #{load_id} for {driver.first_name} {driver.last_name}")
    db.commit()
    db.refresh(entry)
    d = {c.name: getattr(entry, c.name) for c in entry.__table__.columns}
    d.update(get_verification_display(db, entry))
    return d


@router.patch("/{driver_id}/cycles/{year}/{month}/additional-loads/{load_id}/finalize")
def finalize_additional_load(
    driver_id: int, year: int, month: int, load_id: int,
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverAdditionalLoad).filter(DriverAdditionalLoad.id == load_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Additional load not found")
    was_locked = bool(entry.verified3_by)
    # require_step1=False: the admin may final-lock on her own, without a prior
    # step-1 tick (ticks can still be added to empty steps afterwards).
    apply_finalize_step(entry, current_user, is_admin=(current_user.role == "admin"),
                        require_step1=False, desired=intent_from_action(action))
    locked = bool(entry.verified3_by)
    if locked != was_locked:
        log_action(db, "additional_load.finalized" if locked else "additional_load.unfinalized",
                   user_id=current_user.id,
                   entity_id=driver.entity_id, resource_type="additional_load",
                   resource_id=load_id,
                   description=f"{'Applied' if locked else 'Removed'} final lock on additional load #{load_id} for {driver.first_name} {driver.last_name}")
    db.commit()
    db.refresh(entry)
    d = {c.name: getattr(entry, c.name) for c in entry.__table__.columns}
    d.update(get_verification_display(db, entry))
    return d


# ─── Food payments ─────────────────────────────────────────────────────────

@router.post("/{driver_id}/cycles/{year}/{month}/food-payments", response_model=DriverFoodPaymentOut)
def add_food_payment(
    driver_id: int, year: int, month: int,
    payload: DriverFoodPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    cycle = _get_or_create_cycle(driver_id, year, month, db)
    data = payload.model_dump()
    # Every payment must be attributed to a truck so it shows under exactly one
    # truck's Food Allowance tab. The truck-profile tab sends truck_id explicitly;
    # the driver payslip page asks the user to pick one. A truck-less row falls
    # through to the legacy fallback and leaks onto every truck the (casual) driver
    # is merely named on a load for — the duplicate-entry bug — so refuse it.
    if data.get("truck_id") is None:
        data["truck_id"] = driver.truck_id
    if data.get("truck_id") is None:
        raise HTTPException(status_code=400, detail="Select the truck this food allowance belongs to")
    if not db.query(Truck.id).filter(Truck.id == data["truck_id"]).first():
        raise HTTPException(status_code=404, detail="Truck not found")
    entry = DriverFoodPayment(pay_cycle_id=cycle.id, **data)
    db.add(entry)
    db.flush()
    log_action(db, "food_payment.created", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="food_payment",
               resource_id=entry.id,
               description=f"Added food payment for {driver.first_name} {driver.last_name} ({year}/{month})")
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/{driver_id}/cycles/{year}/{month}/food-payments/{payment_id}", response_model=DriverFoodPaymentOut)
def update_food_payment(
    driver_id: int, year: int, month: int, payment_id: int,
    payload: DriverFoodPaymentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverFoodPayment).filter(DriverFoodPayment.id == payment_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Food payment not found")
    updates = payload.model_dump(exclude_none=True)
    # Final-verification lock: a free-text note may still be added/edited, and the
    # payment may still be re-attributed to the correct truck. Re-attribution moves
    # which truck's Food Allowance tab shows the row — it changes no amount, date or
    # verification state — and a wrong truck is exactly the kind of mistake only
    # noticed after the row was locked.
    ensure_not_locked(entry, updates, {"notes", "truck_id"})
    old_truck_id = entry.truck_id
    if "truck_id" in updates and updates["truck_id"] != old_truck_id:
        new_truck = db.query(Truck).filter(Truck.id == updates["truck_id"]).first()
        if not new_truck:
            raise HTTPException(status_code=404, detail="Truck not found")
    for field, value in updates.items():
        setattr(entry, field, value)
    description = f"Updated food payment #{payment_id} for {driver.first_name} {driver.last_name}"
    if entry.truck_id != old_truck_id:
        old_reg = None
        if old_truck_id:
            old_reg = db.query(Truck.registration).filter(Truck.id == old_truck_id).scalar()
        description += f" — truck {old_reg or 'unassigned'} → {new_truck.registration}"
    log_action(db, "food_payment.updated", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="food_payment",
               resource_id=payment_id,
               description=description)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{driver_id}/cycles/{year}/{month}/food-payments/{payment_id}")
def delete_food_payment(
    driver_id: int, year: int, month: int, payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverFoodPayment).filter(DriverFoodPayment.id == payment_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Food payment not found")
    ensure_not_locked(entry)
    log_action(db, "food_payment.deleted", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="food_payment",
               resource_id=payment_id,
               description=f"Deleted food payment #{payment_id} for {driver.first_name} {driver.last_name}")
    db.delete(entry)
    db.commit()
    return {"detail": "Food payment deleted"}


@router.patch("/{driver_id}/cycles/{year}/{month}/food-payments/{payment_id}/verify")
def verify_food_payment(
    driver_id: int, year: int, month: int, payment_id: int,
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverFoodPayment).filter(DriverFoodPayment.id == payment_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Food payment not found")
    before = (entry.verified_by, entry.verified2_by)
    apply_verify_step(entry, current_user, is_admin=(current_user.role == "admin"),
                      desired=intent_from_action(action))
    after = (entry.verified_by, entry.verified2_by)
    if after != before:
        added = (after[0] and not before[0]) or (after[1] and not before[1])
        log_action(db, "food_payment.verified" if added else "food_payment.unverified",
                   user_id=current_user.id,
                   entity_id=driver.entity_id, resource_type="food_payment",
                   resource_id=payment_id,
                   description=f"{'Verified' if added else 'Removed verification on'} food payment #{payment_id} for {driver.first_name} {driver.last_name}")
    db.commit()
    db.refresh(entry)
    d = {c.name: getattr(entry, c.name) for c in entry.__table__.columns}
    d.update(get_verification_display(db, entry))
    return d


@router.patch("/{driver_id}/cycles/{year}/{month}/food-payments/{payment_id}/finalize")
def finalize_food_payment(
    driver_id: int, year: int, month: int, payment_id: int,
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)
    entry = db.query(DriverFoodPayment).filter(DriverFoodPayment.id == payment_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Food payment not found")
    was_locked = bool(entry.verified3_by)
    # require_step1=False: the admin may final-lock on her own, without a prior
    # step-1 tick (ticks can still be added to empty steps afterwards).
    apply_finalize_step(entry, current_user, is_admin=(current_user.role == "admin"),
                        require_step1=False, desired=intent_from_action(action))
    locked = bool(entry.verified3_by)
    if locked != was_locked:
        log_action(db, "food_payment.finalized" if locked else "food_payment.unfinalized",
                   user_id=current_user.id,
                   entity_id=driver.entity_id, resource_type="food_payment",
                   resource_id=payment_id,
                   description=f"{'Applied' if locked else 'Removed'} final lock on food payment #{payment_id} for {driver.first_name} {driver.last_name}")
    db.commit()
    db.refresh(entry)
    d = {c.name: getattr(entry, c.name) for c in entry.__table__.columns}
    d.update(get_verification_display(db, entry))
    return d


# ─── Payslip PDF ────────────────────────────────────────────────────────────

@router.get("/{driver_id}/cycles/{year}/{month}/payslip-pdf")
def download_payslip_pdf(
    driver_id: int, year: int, month: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    _check_access(driver.entity_id, current_user)

    cycle = _get_or_create_cycle(driver_id, year, month, db)
    settings = _get_payroll_settings(db)
    driver_type = driver.driver_type.value if driver.driver_type else "permanent"
    calc = calculate_pay_cycle(cycle, settings, driver_type=driver_type,
                               exclude_mine_bonus=bool(getattr(driver, "exclude_mine_bonus", False)))
    calc_f = {k: float(v) if isinstance(v, Decimal) else v for k, v in calc.items()}

    # ── Casual: load breakdown for individual lines on the payslip ──────────────
    if driver_type == "casual":
        loads_a = getattr(cycle, "casual_group_a_loads", 0) or 0
        loads_b = getattr(cycle, "casual_group_b_loads", 0) or 0
        split_a = getattr(cycle, "casual_split_group_a_loads", 0) or 0
        split_b = getattr(cycle, "casual_split_group_b_loads", 0) or 0
        eff_a   = loads_a + split_a * 0.5
        eff_b   = loads_b + split_b * 0.5
        rate_a  = float(settings.casual_rate_group_a or 0)
        rate_b  = float(settings.casual_rate_group_b or 0)
        breakdown = []
        if eff_a > 0:
            breakdown.append({"loads": eff_a, "rate": rate_a, "amount": rate_a * eff_a})
        if eff_b > 0:
            breakdown.append({"loads": eff_b, "rate": rate_b, "amount": rate_b * eff_b})
        calc_f["casual_breakdown"] = breakdown

    # ── YTD from prior PayrollEntries (same driver, same year, months before current) ──
    ytd: dict = {}
    if driver_type == "permanent":
        prior_entries = db.query(PayrollEntry).filter(
            PayrollEntry.driver_id == driver_id,
            PayrollEntry.pay_year == year,
            PayrollEntry.pay_month < month,
        ).all()

        def _pe_taxable(e) -> float:
            # taxable earnings = gross excl subsistence + statutory accruals (sick/holiday/leave)
            return (float(e.gross or 0) - float(e.subsistence or 0)
                    + float(e.sick_fund or 0) + float(e.holiday_fund or 0) + float(e.leave_pay or 0))

        cur_taxable = (
            calc_f.get("gross", 0) - calc_f.get("total_subsistence", 0)
            + calc_f.get("sick_fund", 0) + calc_f.get("holiday_fund", 0) + calc_f.get("leave_pay", 0)
        )
        ytd = {
            "taxable_earnings": sum(_pe_taxable(e) for e in prior_entries) + cur_taxable,
            "taxable_perks":    sum(float(e.provident or 0) for e in prior_entries) + calc_f.get("provident", 0),
            "provident":        sum(float(e.provident or 0) for e in prior_entries) + calc_f.get("provident", 0),
            "tax_paid":         sum(float(e.paye or 0)      for e in prior_entries) + calc_f.get("paye", 0),
        }

    entity = driver.entity
    pdf_bytes = generate_payslip_pdf(driver, cycle, calc_f, entity, ytd=ytd)

    filename = f"payslip_{driver.last_name}_{driver.first_name}_{year}_{month:02d}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
