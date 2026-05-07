from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Truck, Trailer, TruckStatus, DriverAdditionalLoad, DriverPayCycle, Driver
from app.schemas.schemas import (
    TruckCreate, TruckUpdate, TruckOut, FleetStats, TrailerCreate,
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

    return FleetStats(
        total_trucks=len(trucks),
        active=sum(1 for t in trucks if t.status == TruckStatus.active),
        inactive=sum(1 for t in trucks if t.status == TruckStatus.inactive),
        maintenance=sum(1 for t in trucks if t.status == TruckStatus.maintenance),
        total_trailers=total_trailers,
    )


# ── Trucks list ───────────────────────────────────────────────────────────────

@router.get("/trucks", response_model=List[TruckOut])
def list_trucks(
    entity_id: Optional[int] = Query(None),
    extra_context: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    is_subcontractor: Optional[bool] = Query(None),
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
    if entity_id and extra_context:
        # Include trucks from this entity OR trucks from any entity with the given contract context.
        # Used so OBHI's filter also surfaces SFT trucks running on Intsimbi contracts.
        _check_entity_access(entity_id, current_user)
        q = q.filter(or_(Truck.entity_id == entity_id, Truck.contract_context == extra_context))
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

    return (
        q.order_by(Truck.entity_id, Truck.fleet_number, Truck.registration)
        .offset(skip)
        .limit(limit)
        .all()
    )


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
    return truck


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
    return truck


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
    return truck


# ── Delete truck ──────────────────────────────────────────────────────────────

@router.delete("/trucks/{truck_id}")
def delete_truck(
    truck_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can delete trucks")

    truck = db.query(Truck).filter(Truck.id == truck_id).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found")

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
