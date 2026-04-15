from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
from decimal import Decimal
from datetime import date

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, Driver, DriverType,
    DriverPayCycle, DriverTripLog, DriverAdditionalLoad, DriverFoodPayment,
)
from app.schemas.schemas import (
    DriverCreate, DriverUpdate, DriverOut, DriverSummary, DriverStats,
    DriverPayCycleOut, DriverPayCycleUpdate,
    DriverTripLogCreate, DriverTripLogOut,
    DriverAdditionalLoadCreate, DriverAdditionalLoadUpdate, DriverAdditionalLoadOut,
    DriverFoodPaymentCreate, DriverFoodPaymentUpdate, DriverFoodPaymentOut,
)
from app.services.audit import log_action
from app.services.payroll_calculator import calculate_pay_cycle
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


def _build_summary(driver: Driver, month_start: date) -> dict:
    load_count = sum(1 for l in driver.loads if l.load_date >= month_start)
    payments_total = sum(
        (p.amount or Decimal("0")) for p in driver.payments if p.payment_date >= month_start
    )
    return {
        "id": driver.id,
        "entity_id": driver.entity_id,
        "employee_number": driver.employee_number,
        "first_name": driver.first_name,
        "last_name": driver.last_name,
        "driver_type": driver.driver_type,
        "truck_registration": driver.truck.registration if driver.truck else None,
        "is_active": driver.is_active,
        "load_count_this_month": load_count,
        "total_payments_this_month": payments_total,
    }


def _cycle_with_calc(cycle: DriverPayCycle, driver: Driver, db: Session) -> dict:
    settings = _get_payroll_settings(db)
    calc = calculate_pay_cycle(cycle, settings)
    # Convert Decimal to float for JSON serialisation
    calc_serialisable = {k: float(v) if isinstance(v, Decimal) else v for k, v in calc.items()}
    out = DriverPayCycleOut.model_validate(cycle)
    out.calc = calc_serialisable
    return out


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
    skip: int = Query(0, ge=0),
    limit: int = Query(200, le=500),
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
    month_start, _ = _current_month_bounds()
    return [_build_summary(d, month_start) for d in drivers]


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

    for field, value in payload.model_dump(exclude_unset=True).items():
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


# ── Soft delete ───────────────────────────────────────────────────────────────

@router.delete("/{driver_id}")
def delete_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    driver.is_active = False
    log_action(db, "driver.deactivated", user_id=current_user.id,
               entity_id=driver.entity_id, resource_type="driver",
               resource_id=driver_id,
               description=f"Deactivated driver {driver.first_name} {driver.last_name}")
    db.commit()
    return {"detail": "Driver deactivated"}


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
        db.commit()
        db.refresh(cycle)

    return _cycle_with_calc(cycle, driver, db)


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

    db.commit()
    db.refresh(cycle)
    return _cycle_with_calc(cycle, driver, db)


# ─── Trip log ─────────────────────────────────────────────────────────────────

def _get_cycle_or_404(driver_id: int, year: int, month: int, db: Session) -> DriverPayCycle:
    cycle = db.query(DriverPayCycle).filter(
        DriverPayCycle.driver_id == driver_id,
        DriverPayCycle.pay_year == year,
        DriverPayCycle.pay_month == month,
    ).first()
    if not cycle:
        raise HTTPException(status_code=404, detail="Pay cycle not found")
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
    cycle = _get_cycle_or_404(driver_id, year, month, db)
    entry = DriverAdditionalLoad(pay_cycle_id=cycle.id, **payload.model_dump())
    db.add(entry)
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
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(entry, field, value)
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
    db.delete(entry)
    db.commit()
    return {"detail": "Additional load deleted"}


# ─── Food payments ────────────────────────────────────────────────────────────

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
    cycle = _get_cycle_or_404(driver_id, year, month, db)
    entry = DriverFoodPayment(pay_cycle_id=cycle.id, **payload.model_dump())
    db.add(entry)
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
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(entry, field, value)
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
    db.delete(entry)
    db.commit()
    return {"detail": "Food payment deleted"}
