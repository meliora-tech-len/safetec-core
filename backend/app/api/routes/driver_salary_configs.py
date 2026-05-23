from datetime import datetime, timezone
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

HISTORY_LIMIT = 5


def _require_admin(user: User):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


def _enrich(cfg: DriverSalaryConfig) -> dict:
    d = {c.name: getattr(cfg, c.name) for c in cfg.__table__.columns}
    d["truck_registration"] = cfg.truck.registration if cfg.truck else None
    return d


# ── List configs ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[DriverSalaryConfigOut])
def list_salary_configs(
    entity_id: Optional[int] = Query(None),
    driver_name: Optional[str] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    q = db.query(DriverSalaryConfig)
    if entity_id:
        q = q.filter(DriverSalaryConfig.entity_id == entity_id)
    if driver_name:
        q = q.filter(DriverSalaryConfig.driver_name == driver_name)
    if active_only:
        q = q.filter(DriverSalaryConfig.is_active == True)
    configs = q.order_by(
        DriverSalaryConfig.entity_id,
        DriverSalaryConfig.driver_name,
        DriverSalaryConfig.created_at.desc(),
    ).all()
    return [DriverSalaryConfigOut(**_enrich(c)) for c in configs]


# ── History for a driver ──────────────────────────────────────────────────────

@router.get("/history", response_model=List[DriverSalaryConfigOut])
def salary_config_history(
    entity_id: int = Query(...),
    driver_name: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Last HISTORY_LIMIT records (active + inactive) for a driver, newest first."""
    _require_admin(current_user)
    configs = (
        db.query(DriverSalaryConfig)
        .filter(
            DriverSalaryConfig.entity_id == entity_id,
            DriverSalaryConfig.driver_name == driver_name,
        )
        .order_by(DriverSalaryConfig.created_at.desc())
        .limit(HISTORY_LIMIT)
        .all()
    )
    return [DriverSalaryConfigOut(**_enrich(c)) for c in configs]


# ── Create config ─────────────────────────────────────────────────────────────

@router.post("", response_model=DriverSalaryConfigOut)
def create_salary_config(
    payload: DriverSalaryConfigCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    now = datetime.now(tz=timezone.utc)

    # Deactivate any existing active config for this driver in this entity
    _deactivate_existing(db, payload.entity_id, payload.driver_name, now)

    cfg = DriverSalaryConfig(
        **payload.model_dump(),
        is_active=True,
        effective_from=payload.effective_from or now,
    )
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


# ── Update config (creates new version, deactivates old) ─────────────────────

@router.put("/{config_id}", response_model=DriverSalaryConfigOut)
def update_salary_config(
    config_id: int,
    payload: DriverSalaryConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    old = db.query(DriverSalaryConfig).filter(DriverSalaryConfig.id == config_id).first()
    if not old:
        raise HTTPException(status_code=404, detail="Salary config not found")

    now = datetime.now(tz=timezone.utc)
    update_data = payload.model_dump(exclude_none=True)

    # Deactivate old record
    old.is_active = False
    old.effective_to = now

    # Build new record merging old values with updates
    new_cfg = DriverSalaryConfig(
        entity_id=old.entity_id,
        truck_id=update_data.get("truck_id", old.truck_id),
        driver_name=update_data.get("driver_name", old.driver_name),
        base_salary_near_route=update_data.get("base_salary_near_route", old.base_salary_near_route),
        base_salary_far_route=update_data.get("base_salary_far_route", old.base_salary_far_route),
        extra_per_load_far=update_data.get("extra_per_load_far", old.extra_per_load_far),
        deduction_near=update_data.get("deduction_near", old.deduction_near),
        notes=update_data.get("notes", old.notes),
        effective_from=now,
        effective_to=None,
        is_active=True,
    )
    db.add(new_cfg)
    db.flush()

    log_action(
        db, "driver_salary_config.updated", user_id=current_user.id,
        entity_id=old.entity_id, resource_type="driver_salary_config",
        resource_id=new_cfg.id,
        description=f"Updated salary config for driver {new_cfg.driver_name} (supersedes #{config_id})",
    )
    db.commit()
    db.refresh(new_cfg)
    return DriverSalaryConfigOut(**_enrich(new_cfg))


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


# ── Internal helper ───────────────────────────────────────────────────────────

def _deactivate_existing(db: Session, entity_id: int, driver_name: str, now: datetime):
    """Mark all currently active configs for this driver as inactive."""
    db.query(DriverSalaryConfig).filter(
        DriverSalaryConfig.entity_id == entity_id,
        DriverSalaryConfig.driver_name == driver_name,
        DriverSalaryConfig.is_active == True,
    ).update({"is_active": False, "effective_to": now}, synchronize_session=False)
