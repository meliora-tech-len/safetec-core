from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import List, Optional
from datetime import datetime, timezone

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Mine, MineRate
from app.schemas.schemas import (
    MineCreate, MineUpdate, MineOut,
    MineRateCreate, MineRateOut,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/mines", tags=["mines"])


def _require_admin(user: User):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


# ── List mines ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[MineOut])
def list_mines(
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Mine)
    if active_only:
        q = q.filter(Mine.is_active.is_(True))
    return q.order_by(Mine.name).all()


# ── Get single mine ───────────────────────────────────────────────────────────

@router.get("/{mine_id}", response_model=MineOut)
def get_mine(
    mine_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mine = db.query(Mine).filter(Mine.id == mine_id).first()
    if not mine:
        raise HTTPException(status_code=404, detail="Mine not found")
    return mine


# ── Create mine ───────────────────────────────────────────────────────────────

@router.post("", response_model=MineOut)
def create_mine(
    payload: MineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    mine = Mine(**payload.model_dump())
    db.add(mine)
    log_action(
        db, "mine.created", user_id=current_user.id,
        resource_type="mine", description=f"Created mine {mine.name}",
    )
    db.commit()
    db.refresh(mine)
    return mine


# ── Update mine ───────────────────────────────────────────────────────────────

@router.put("/{mine_id}", response_model=MineOut)
def update_mine(
    mine_id: int,
    payload: MineUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    mine = db.query(Mine).filter(Mine.id == mine_id).first()
    if not mine:
        raise HTTPException(status_code=404, detail="Mine not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(mine, field, value)

    log_action(
        db, "mine.updated", user_id=current_user.id,
        resource_type="mine", resource_id=mine_id,
        description=f"Updated mine {mine.name}",
    )
    db.commit()
    db.refresh(mine)
    return mine


# ── Soft delete mine ──────────────────────────────────────────────────────────

@router.delete("/{mine_id}")
def deactivate_mine(
    mine_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    mine = db.query(Mine).filter(Mine.id == mine_id).first()
    if not mine:
        raise HTTPException(status_code=404, detail="Mine not found")

    mine.is_active = False
    log_action(
        db, "mine.deactivated", user_id=current_user.id,
        resource_type="mine", resource_id=mine_id,
        description=f"Deactivated mine {mine.name}",
    )
    db.commit()
    return {"detail": "Mine deactivated"}


# ── Rate history for a mine ───────────────────────────────────────────────────

@router.get("/{mine_id}/rates", response_model=List[MineRateOut])
def list_mine_rates(
    mine_id: int,
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mine = db.query(Mine).filter(Mine.id == mine_id).first()
    if not mine:
        raise HTTPException(status_code=404, detail="Mine not found")

    q = db.query(MineRate).filter(MineRate.mine_id == mine_id)
    if entity_id:
        q = q.filter(MineRate.entity_id == entity_id)
    return q.order_by(MineRate.entity_id, MineRate.effective_from.desc()).all()


# ── Add a new rate ─────────────────────────────────────────────────────────────

@router.post("/{mine_id}/rates", response_model=MineRateOut)
def add_mine_rate(
    mine_id: int,
    payload: MineRateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)

    mine = db.query(Mine).filter(Mine.id == mine_id).first()
    if not mine:
        raise HTTPException(status_code=404, detail="Mine not found")

    # Close any currently open rate for same mine+entity
    open_rate = db.query(MineRate).filter(
        and_(
            MineRate.mine_id == mine_id,
            MineRate.entity_id == payload.entity_id,
            MineRate.effective_to.is_(None),
        )
    ).first()
    if open_rate:
        open_rate.effective_to = payload.effective_from

    new_rate = MineRate(
        mine_id=mine_id,
        **payload.model_dump(),
    )
    db.add(new_rate)
    log_action(
        db, "mine_rate.created", user_id=current_user.id,
        resource_type="mine_rate",
        description=f"Added rate R{payload.rate_per_ton}/t for mine {mine.name} entity {payload.entity_id}",
    )
    db.commit()
    db.refresh(new_rate)
    return new_rate
