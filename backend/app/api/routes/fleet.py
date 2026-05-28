from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Truck, Trailer, TruckStatus, DriverAdditionalLoad, DriverFoodPayment, DriverPayCycle, Driver, CasualTruckAssignment, PersonalVehicle, PersonalVehicleStatus, TruckMonthlyExpenses, Subcontractor, LicenceAlertAck, BusinessEntity
from app.schemas.schemas import (
    TruckCreate, TruckUpdate, TruckOut, FleetStats, TrailerCreate,
    PersonalVehicleCreate, PersonalVehicleUpdate, PersonalVehicleOut,
    TruckMonthlyExpensesBase, TruckMonthlyExpensesOut, LicenceAlertAckIn,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/fleet", tags=["fleet"])


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _accessible_entity_ids(user: User) -> Optional[List[int]]:
    """Return list of accessible entity IDs for non-admin users, or None for admin."""
    if user.role == "admin":
        return None
    return [a.entity_id for a in user.entity_access]


def _enrich_truck(truck: Truck) -> Truck:
    """Compute subcontractor_display_name from FK → free-text → operator fallback."""
    truck.subcontractor_display_name = (
        (truck.subcontractor.name if truck.subcontractor else None)
        or truck.subcontractor_name
        or truck.operator
    )
    truck.entity_is_subcontractor = truck.entity.is_subcontractor_entity if truck.entity else False
    return truck


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=FleetStats)
def get_fleet_stats(
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)

    q = db.query(Truck)
    if accessible is not None:
        q = q.filter(Truck.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(Truck.entity_id == entity_id)

    trucks = q.all()
    truck_ids = [t.id for t in trucks]

    total_trailers = db.query(func.count(Trailer.id)).filter(
        Trailer.truck_id.in_(truck_ids)
    ).scalar() if truck_ids else 0

    pv_q = db.query(func.count(PersonalVehicle.id)).filter(
        PersonalVehicle.status == PersonalVehicleStatus.active
    )
    if entity_id:
        pv_q = pv_q.filter(PersonalVehicle.entity_id == entity_id)
    total_personal_vehicles = pv_q.scalar() or 0

    return FleetStats(
        total_trucks=len(trucks),
        active=sum(1 for t in trucks if t.status == TruckStatus.active),
        inactive=sum(1 for t in trucks if t.status == TruckStatus.inactive),
        maintenance=sum(1 for t in trucks if t.status == TruckStatus.maintenance),
        total_trailers=total_trailers,
        total_personal_vehicles=total_personal_vehicles,
    )


# ── Trucks list ───────────────────────────────────────────────────────────────

@router.get("/trucks", response_model=List[TruckOut])
def list_trucks(
    entity_id: Optional[int] = Query(None),
    extra_context: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    is_subcontractor: Optional[bool] = Query(None),
    registration: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)

    q = db.query(Truck)
    if accessible is not None:
        q = q.filter(Truck.entity_id.in_(accessible))
    if registration:
        q = q.filter(Truck.registration.ilike(registration))
    if entity_id and extra_context:
        # Include trucks from this entity OR own-fleet trucks from any entity with the given
        # contract context. Subcontractor trucks are excluded from the cross-entity portion —
        # they belong to their entity only and should not bleed into other entities' views.
        _check_entity_access(entity_id, current_user)
        q = q.filter(or_(
            Truck.entity_id == entity_id,
            and_(Truck.contract_context == extra_context, Truck.is_subcontractor == False),
        ))
    elif entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(Truck.entity_id == entity_id)
    if status:
        q = q.filter(Truck.status == status)
    if is_subcontractor is not None:
        q = q.filter(Truck.is_subcontractor == is_subcontractor)
    if search:
        term = f"%{search}%"
        q = q.filter(
            or_(
                Truck.registration.ilike(term),
                Truck.make.ilike(term),
                Truck.model.ilike(term),
                Truck.driver_name.ilike(term),
                Truck.fleet_number.ilike(term),
            )
        )

    trucks_raw = q.offset(skip).limit(limit).all()

    def _sort_key(t):
        try:
            num = int((t.fleet_number or '').lstrip('#')) if t.fleet_number else 9999
        except (ValueError, TypeError):
            num = 9999
        return (t.entity_id, num, t.registration or '')

    return [_enrich_truck(t) for t in sorted(trucks_raw, key=_sort_key)]


# ── Single truck ──────────────────────────────────────────────────────────────

@router.get("/trucks/{truck_id}", response_model=TruckOut)
def get_truck(
    truck_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    _check_entity_access(truck.entity_id, current_user)
    return _enrich_truck(truck)


# ── Create truck ──────────────────────────────────────────────────────────────

@router.post("/trucks", response_model=TruckOut)
def create_truck(
    payload: TruckCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)

    trailer_data = payload.trailers or []
    truck_fields = payload.model_dump(exclude={"trailers"})
    if truck_fields.get("registration"):
        truck_fields["registration"] = truck_fields["registration"].strip().replace(" ", "")

    # Auto-link and mark as subcontractor when creating a truck for a subcontractor entity
    if not truck_fields.get("subcontractor_id"):
        entity = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
        if entity and entity.is_subcontractor_entity and entity.linked_subcontractor_id:
            truck_fields["subcontractor_id"] = entity.linked_subcontractor_id
            truck_fields["is_subcontractor"] = True

    try:
        truck = Truck(**truck_fields)
        db.add(truck)
        db.flush()  # get truck.id

        for t in trailer_data:
            trailer = Trailer(
                truck_id=truck.id,
                entity_id=payload.entity_id,
                **t.model_dump(),
            )
            db.add(trailer)

        log_action(
            db, "truck.created", user_id=current_user.id,
            entity_id=payload.entity_id, resource_type="truck",
            description=f"Created truck {truck.registration}",
        )
        db.commit()
        db.refresh(truck)
        return _enrich_truck(truck)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create truck")


# ── Update truck ──────────────────────────────────────────────────────────────

@router.put("/trucks/{truck_id}", response_model=TruckOut)
def update_truck(
    truck_id: int,
    payload: TruckUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    _check_entity_access(truck.entity_id, current_user)

    try:
        update_fields = payload.model_dump(exclude={"trailers"}, exclude_none=True)
        if "registration" in update_fields and update_fields["registration"]:
            update_fields["registration"] = update_fields["registration"].strip().replace(" ", "")
        for field, value in update_fields.items():
            setattr(truck, field, value)

        # Full replace on trailers if provided
        if payload.trailers is not None:
            db.query(Trailer).filter(Trailer.truck_id == truck_id).delete()
            for t in payload.trailers:
                trailer = Trailer(
                    truck_id=truck_id,
                    entity_id=truck.entity_id,
                    **t.model_dump(),
                )
                db.add(trailer)

        log_action(
            db, "truck.updated", user_id=current_user.id,
            entity_id=truck.entity_id, resource_type="truck",
            resource_id=truck_id, description=f"Updated truck {truck.registration}",
        )
        db.commit()
        db.refresh(truck)
        return _enrich_truck(truck)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update truck")


# ── Delete truck ──────────────────────────────────────────────────────────────

@router.delete("/trucks/{truck_id}")
def delete_truck(
    truck_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    _check_entity_access(truck.entity_id, current_user)

    log_action(
        db, "truck.deleted", user_id=current_user.id,
        entity_id=truck.entity_id, resource_type="truck",
        resource_id=truck_id, description=f"Deleted truck {truck.registration}",
    )
    db.delete(truck)
    db.commit()
    return {"detail": "Truck deleted"}


# ── Additional loads for a truck (cross-driver view) ──────────────────────────

@router.get("/trucks/{truck_id}/additional-loads")
def list_truck_additional_loads(
    truck_id: int,
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    _check_entity_access(truck.entity_id, current_user)

    rows = (
        db.query(DriverAdditionalLoad, Driver)
        .join(DriverPayCycle, DriverAdditionalLoad.pay_cycle_id == DriverPayCycle.id)
        .join(Driver, DriverPayCycle.driver_id == Driver.id)
        .filter(
            DriverAdditionalLoad.truck_registration == truck.registration,
            DriverPayCycle.pay_year  == year,
            DriverPayCycle.pay_month == month,
            DriverAdditionalLoad.is_archived != True,
        )
        .all()
    )

    result = []
    for al, driver in rows:
        d = {c.name: getattr(al, c.name) for c in al.__table__.columns}
        d["driver_id"]   = driver.id
        d["driver_name"] = f"{driver.first_name} {driver.last_name}".strip()
        result.append(d)
    return result


# ── Food payments for a truck (cross-driver view) ─────────────────────────────

@router.get("/trucks/{truck_id}/food-payments")
def list_truck_food_payments(
    truck_id: int,
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")
    _check_entity_access(truck.entity_id, current_user)

    casual_driver_ids = (
        db.query(CasualTruckAssignment.driver_id)
        .filter(CasualTruckAssignment.truck_id == truck_id)
        .subquery()
    )

    rows = (
        db.query(DriverFoodPayment, Driver)
        .join(DriverPayCycle, DriverFoodPayment.pay_cycle_id == DriverPayCycle.id)
        .join(Driver, DriverPayCycle.driver_id == Driver.id)
        .filter(
            or_(
                Driver.truck_id == truck_id,
                Driver.id.in_(casual_driver_ids),
            ),
            DriverPayCycle.pay_year == year,
            DriverPayCycle.pay_month == month,
        )
        .order_by(DriverFoodPayment.payment_date)
        .all()
    )

    result = []
    for fp, driver in rows:
        d = {c.name: getattr(fp, c.name) for c in fp.__table__.columns}
        d["driver_id"]   = driver.id
        d["driver_name"] = f"{driver.first_name} {driver.last_name}".strip()
        d["pay_year"]    = year
        d["pay_month"]   = month
        result.append(d)
    return result


# ── Personal Vehicles ─────────────────────────────────────────────────────────

@router.get("/personal-vehicles", response_model=List[PersonalVehicleOut])
def list_personal_vehicles(
    entity_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)
    q = db.query(PersonalVehicle)
    if accessible is not None:
        q = q.filter(PersonalVehicle.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(PersonalVehicle.entity_id == entity_id)
    if status:
        q = q.filter(PersonalVehicle.status == status)
    return q.order_by(PersonalVehicle.owner, PersonalVehicle.vehicle_type).all()


@router.post("/personal-vehicles", response_model=PersonalVehicleOut)
def create_personal_vehicle(
    payload: PersonalVehicleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    pv = PersonalVehicle(**payload.model_dump())
    db.add(pv)
    db.flush()
    log_action(
        db, "personal_vehicle.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="personal_vehicle",
        resource_id=pv.id,
        description=f"Created personal vehicle {pv.registration or pv.vehicle_type} ({pv.owner})",
    )
    db.commit()
    db.refresh(pv)
    return pv


@router.put("/personal-vehicles/{pv_id}", response_model=PersonalVehicleOut)
def update_personal_vehicle(
    pv_id: int,
    payload: PersonalVehicleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pv = db.query(PersonalVehicle).filter(PersonalVehicle.id == pv_id).first()
    if not pv:
        raise HTTPException(status_code=404, detail="Personal vehicle not found")
    _check_entity_access(pv.entity_id, current_user)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(pv, field, value)
    log_action(
        db, "personal_vehicle.updated", user_id=current_user.id,
        entity_id=pv.entity_id, resource_type="personal_vehicle",
        resource_id=pv_id,
        description=f"Updated personal vehicle {pv.registration or pv.vehicle_type} ({pv.owner})",
    )
    db.commit()
    db.refresh(pv)
    return pv


@router.delete("/personal-vehicles/{pv_id}")
def delete_personal_vehicle(
    pv_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pv = db.query(PersonalVehicle).filter(PersonalVehicle.id == pv_id).first()
    if not pv:
        raise HTTPException(status_code=404, detail="Personal vehicle not found")
    _check_entity_access(pv.entity_id, current_user)
    log_action(
        db, "personal_vehicle.deleted", user_id=current_user.id,
        entity_id=pv.entity_id, resource_type="personal_vehicle",
        resource_id=pv_id,
        description=f"Deleted personal vehicle {pv.registration or pv.vehicle_type} ({pv.owner})",
    )
    db.delete(pv)
    db.commit()
    return {"detail": "Personal vehicle deleted"}


# ── Licence alerts ────────────────────────────────────────────────────────────

@router.get("/licence-alerts")
def get_licence_alerts(
    entity_id: Optional[int] = Query(None),
    days: int = Query(60, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    accessible = _accessible_entity_ids(current_user)
    cutoff = datetime.now(timezone.utc) + timedelta(days=days)
    now = datetime.now(timezone.utc)
    items = []

    # Trucks
    tq = db.query(Truck).filter(Truck.licence_expiry.isnot(None))
    if accessible is not None:
        tq = tq.filter(Truck.entity_id.in_(accessible))
    if entity_id:
        tq = tq.filter(Truck.entity_id == entity_id)
    for truck in tq.all():
        expiry = truck.licence_expiry
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry <= cutoff:
            days_left = max(0, (expiry - now).days)
            items.append({
                "type": "truck",
                "id": truck.id,
                "registration": truck.registration,
                "description": f"{truck.make} {truck.model or ''}".strip(),
                "fleet_number": truck.fleet_number,
                "licence_expiry": truck.licence_expiry.isoformat(),
                "days_until_expiry": days_left,
                "expired": expiry < now,
                "entity_id": truck.entity_id,
            })

    # Trailers
    trailer_q = db.query(Trailer).filter(Trailer.licence_expiry.isnot(None))
    if accessible is not None:
        trailer_q = trailer_q.filter(Trailer.entity_id.in_(accessible))
    if entity_id:
        trailer_q = trailer_q.filter(Trailer.entity_id == entity_id)
    for trailer in trailer_q.all():
        expiry = trailer.licence_expiry
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry <= cutoff:
            days_left = max(0, (expiry - now).days)
            items.append({
                "type": "trailer",
                "id": trailer.id,
                "registration": trailer.registration,
                "description": f"Trailer (slot {trailer.slot})",
                "fleet_number": None,
                "licence_expiry": trailer.licence_expiry.isoformat(),
                "days_until_expiry": days_left,
                "expired": expiry < now,
                "entity_id": trailer.entity_id,
            })

    # Personal vehicles
    pv_q = db.query(PersonalVehicle).filter(
        PersonalVehicle.licence_expiry.isnot(None),
        PersonalVehicle.status == PersonalVehicleStatus.active,
    )
    if accessible is not None:
        pv_q = pv_q.filter(PersonalVehicle.entity_id.in_(accessible))
    if entity_id:
        pv_q = pv_q.filter(PersonalVehicle.entity_id == entity_id)
    for pv in pv_q.all():
        expiry = pv.licence_expiry
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry <= cutoff:
            days_left = max(0, (expiry - now).days)
            items.append({
                "type": "personal_vehicle",
                "id": pv.id,
                "registration": pv.registration,
                "description": f"{pv.owner or ''} — {pv.vehicle_type}".strip(" —"),
                "fleet_number": None,
                "licence_expiry": pv.licence_expiry.isoformat(),
                "days_until_expiry": days_left,
                "expired": expiry < now,
                "entity_id": pv.entity_id,
            })

    # Filter out acknowledged items
    acks = db.query(LicenceAlertAck).all()
    ack_set = set()
    for a in acks:
        exp = a.acknowledged_expiry
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        ack_set.add((a.resource_type, a.resource_id, exp.isoformat()))

    def _norm_expiry(iso: str) -> str:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()

    items = [i for i in items if (i["type"], i["id"], _norm_expiry(i["licence_expiry"])) not in ack_set]

    items.sort(key=lambda x: x["days_until_expiry"])
    return {"items": items, "count": len(items)}


# ── Acknowledge licence alert ─────────────────────────────────────────────────

@router.post("/licence-alerts/acknowledge")
def acknowledge_licence_alert(
    payload: LicenceAlertAckIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy import insert as sa_insert

    existing = db.query(LicenceAlertAck).filter(
        LicenceAlertAck.resource_type == payload.resource_type,
        LicenceAlertAck.resource_id == payload.resource_id,
        LicenceAlertAck.acknowledged_expiry == payload.acknowledged_expiry,
    ).first()
    if not existing:
        ack = LicenceAlertAck(
            resource_type=payload.resource_type,
            resource_id=payload.resource_id,
            acknowledged_expiry=payload.acknowledged_expiry,
            acknowledged_by=current_user.id,
        )
        db.add(ack)
        db.commit()
    return {"ok": True}


# ── Truck Monthly Expenses (Profit Sheet) ────────────────────────────────────

@router.get("/trucks/{truck_id}/monthly-expenses", response_model=TruckMonthlyExpensesOut)
def get_monthly_expenses(
    truck_id: int,
    year:  int = Query(...),
    month: int = Query(...),
    db:   Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(404, "Truck not found")
    _check_entity_access(truck.entity_id, current_user)

    record = db.query(TruckMonthlyExpenses).filter(
        TruckMonthlyExpenses.truck_id == truck_id,
        TruckMonthlyExpenses.year  == year,
        TruckMonthlyExpenses.month == month,
    ).first()

    if not record:
        return TruckMonthlyExpensesOut(truck_id=truck_id, year=year, month=month)
    return record


@router.put("/trucks/{truck_id}/monthly-expenses", response_model=TruckMonthlyExpensesOut)
def upsert_monthly_expenses(
    truck_id: int,
    year:  int = Query(...),
    month: int = Query(...),
    data:  TruckMonthlyExpensesBase = ...,
    db:   Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(404, "Truck not found")
    _check_entity_access(truck.entity_id, current_user)

    record = db.query(TruckMonthlyExpenses).filter(
        TruckMonthlyExpenses.truck_id == truck_id,
        TruckMonthlyExpenses.year  == year,
        TruckMonthlyExpenses.month == month,
    ).first()

    if not record:
        record = TruckMonthlyExpenses(truck_id=truck_id, year=year, month=month)
        db.add(record)

    for field, value in data.model_dump().items():
        setattr(record, field, value)

    db.commit()
    db.refresh(record)
    return record
