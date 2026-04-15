from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, DriverSalaryConfig, Truck
from app.schemas.schemas import (
    DriverSalaryConfigCreate, DriverSalaryConfigUpdate, DriverSalaryConfigOut,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/driver-salary-configs", tags=["driver-salary-configs"])


def _require_admin(user: User):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _enrich(cfg: DriverSalaryConfig) -> dict:
    d = {c.name: getattr(cfg, c.name) for c in cfg.__table__.columns}
    d["truck_registration"] = cfg.truck.registration if cfg.truck else None
    return d


# ── List configs ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[DriverSalaryConfigOut])
def list_salary_configs(
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    q = db.query(DriverSalaryConfig)
    if entity_id:
        q = q.filter(DriverSalaryConfig.entity_id == entity_id)
    configs = q.order_by(DriverSalaryConfig.entity_id, DriverSalaryConfig.driver_name).all()
    return [DriverSalaryConfigOut(**_enrich(c)) for c in configs]


# ── Create config ─────────────────────────────────────────────────────────────

@router.post("", response_model=DriverSalaryConfigOut)
def create_salary_config(
    payload: DriverSalaryConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    cfg = DriverSalaryConfig(**payload.model_dump())
    db.add(cfg)
    db.flush()
    log_action(
        db, "driver_salary_config.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="driver_salary_config",
        resource_id=cfg.id,
        description=f"Created salary config for driver {payload.driver_name}",
    )
    db.commit()
    db.refresh(cfg)
    return DriverSalaryConfigOut(**_enrich(cfg))


# ── Update config ─────────────────────────────────────────────────────────────

@router.put("/{config_id}", response_model=DriverSalaryConfigOut)
def update_salary_config(
    config_id: int,
    payload: DriverSalaryConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    cfg = db.query(DriverSalaryConfig).filter(DriverSalaryConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Salary config not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(cfg, field, value)

    log_action(
        db, "driver_salary_config.updated", user_id=current_user.id,
        entity_id=cfg.entity_id, resource_type="driver_salary_config",
        resource_id=config_id,
        description=f"Updated salary config for driver {cfg.driver_name}",
    )
    db.commit()
    db.refresh(cfg)
    return DriverSalaryConfigOut(**_enrich(cfg))


# ── Delete config ─────────────────────────────────────────────────────────────

@router.delete("/{config_id}")
def delete_salary_config(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    cfg = db.query(DriverSalaryConfig).filter(DriverSalaryConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Salary config not found")

    log_action(
        db, "driver_salary_config.deleted", user_id=current_user.id,
        entity_id=cfg.entity_id, resource_type="driver_salary_config",
        resource_id=config_id,
        description=f"Deleted salary config for driver {cfg.driver_name}",
    )
    db.delete(cfg)
    db.commit()
    return {"detail": "Salary config deleted"}
