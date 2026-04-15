from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.db.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.models import User, PayrollMineGroup
from app.schemas.schemas import (
    PayrollMineGroupCreate, PayrollMineGroupUpdate, PayrollMineGroupOut,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/payroll-mine-groups", tags=["payroll-mine-groups"])


def _seed_lohatla(db: Session):
    """Ensure Lohatla group exists on first startup."""
    from app.models.models import PayrollSettings
    if db.query(PayrollMineGroup).count() == 0:
        # Pull current values from PayrollSettings if available
        ps = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()
        group = PayrollMineGroup(
            name="Lohatla",
            base_salary=ps.lohatla_base_salary if ps else 16481.55,
            incentive_per_load=ps.lohatla_incentive_per_load if ps else 2610.00,
            subs_per_load=ps.lohatla_subs_per_load if ps else 459.66,
            base_loads=7,
            is_active=True,
            notes="Migrated from payroll settings",
        )
        db.add(group)
        db.commit()


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[PayrollMineGroupOut])
def list_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _seed_lohatla(db)
    return db.query(PayrollMineGroup).order_by(PayrollMineGroup.id).all()


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=PayrollMineGroupOut)
def create_group(
    payload: PayrollMineGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    group = PayrollMineGroup(**payload.model_dump())
    db.add(group)
    db.flush()
    log_action(
        db, "payroll_mine_group.created", user_id=current_user.id,
        resource_type="payroll_mine_group", resource_id=group.id,
        description=f"Created payroll mine group: {payload.name}",
    )
    db.commit()
    db.refresh(group)
    return group


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{group_id}", response_model=PayrollMineGroupOut)
def update_group(
    group_id: int,
    payload: PayrollMineGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    group = db.query(PayrollMineGroup).filter(PayrollMineGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Mine group not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(group, field, value)

    log_action(
        db, "payroll_mine_group.updated", user_id=current_user.id,
        resource_type="payroll_mine_group", resource_id=group_id,
        description=f"Updated payroll mine group: {group.name}",
    )
    db.commit()
    db.refresh(group)
    return group


# ── Delete (soft) ─────────────────────────────────────────────────────────────

@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    group = db.query(PayrollMineGroup).filter(PayrollMineGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Mine group not found")

    group.is_active = False
    log_action(
        db, "payroll_mine_group.deactivated", user_id=current_user.id,
        resource_type="payroll_mine_group", resource_id=group_id,
        description=f"Deactivated payroll mine group: {group.name}",
    )
    db.commit()
    return {"detail": f"Mine group '{group.name}' deactivated"}
