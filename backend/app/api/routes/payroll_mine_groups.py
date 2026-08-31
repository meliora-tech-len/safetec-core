from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.db.database import get_db
from app.core.security import get_current_user, require_admin
from app.core.updates import sent_fields
from app.models.models import User, PayrollMineGroup
from app.schemas.schemas import (
    PayrollMineGroupCreate, PayrollMineGroupUpdate, PayrollMineGroupOut,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/payroll-mine-groups", tags=["payroll-mine-groups"])

HISTORY_PER_GROUP = 5


def _seed_lohatla(db: Session):
    """Ensure Lohatla group exists on first startup."""
    from app.models.models import PayrollSettings
    if db.query(PayrollMineGroup).count() == 0:
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
    """
    Returns active groups plus the last HISTORY_PER_GROUP records per group name
    (including the active one) so the frontend can display rate history.
    """
    _seed_lohatla(db)
    all_groups = (
        db.query(PayrollMineGroup)
        .order_by(PayrollMineGroup.name, PayrollMineGroup.id.desc())
        .all()
    )

    # Cap to last HISTORY_PER_GROUP per group name, preserving order newest-first
    seen: dict[str, int] = {}
    result = []
    for g in all_groups:
        count = seen.get(g.name, 0)
        if count < HISTORY_PER_GROUP:
            result.append(g)
            seen[g.name] = count + 1

    return result


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=PayrollMineGroupOut)
def create_group(
    payload: PayrollMineGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # Deactivate any existing active group with the same name
    _deactivate_by_name(db, payload.name)

    group = PayrollMineGroup(**payload.model_dump(), is_active=True)
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


# ── Update (creates new version, deactivates old) ─────────────────────────────

@router.put("/{group_id}", response_model=PayrollMineGroupOut)
def update_group(
    group_id: int,
    payload: PayrollMineGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    old = db.query(PayrollMineGroup).filter(PayrollMineGroup.id == group_id).first()
    if not old:
        raise HTTPException(status_code=404, detail="Mine group not found")

    update_data = sent_fields(payload, "notes")

    # Deactivate all active records for this group name
    _deactivate_by_name(db, old.name)

    new_group = PayrollMineGroup(
        name=update_data.get("name", old.name),
        base_salary=update_data.get("base_salary", old.base_salary),
        incentive_per_load=update_data.get("incentive_per_load", old.incentive_per_load),
        subs_per_load=update_data.get("subs_per_load", old.subs_per_load),
        base_loads=update_data.get("base_loads", old.base_loads),
        notes=update_data.get("notes", old.notes),
        is_active=True,
    )
    db.add(new_group)
    db.flush()
    log_action(
        db, "payroll_mine_group.updated", user_id=current_user.id,
        resource_type="payroll_mine_group", resource_id=new_group.id,
        description=f"Updated payroll mine group: {new_group.name} (supersedes #{group_id})",
    )
    db.commit()
    db.refresh(new_group)
    return new_group


# ── Delete (soft deactivate) ──────────────────────────────────────────────────

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


# ── Internal helper ───────────────────────────────────────────────────────────

def _deactivate_by_name(db: Session, name: str):
    """Mark all active groups with this name as inactive."""
    db.query(PayrollMineGroup).filter(
        PayrollMineGroup.name == name,
        PayrollMineGroup.is_active == True,
    ).update({"is_active": False}, synchronize_session=False)
