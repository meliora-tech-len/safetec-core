from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import List, Optional
from datetime import datetime, timezone

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Mine, MineRate, TruckLoad, Truck, BusinessEntity
from app.schemas.schemas import (
    MineCreate, MineUpdate, MineOut,
    MineRateCreate, MineRateOut,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/mines", tags=["mines"])


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

    # Re-rate loads already captured on/after the effective date that still carry
    # the superseded auto rate. Hand-typed rates (≠ old rate) are left alone, as
    # are paid loads — those are reported back so the user can review them.
    updated_loads = 0
    skipped_paid = 0
    if open_rate is not None:
        from app.api.routes.truck_loads import _compute_amounts, _compute_subcontractor_amounts

        affected = db.query(TruckLoad).filter(
            and_(
                TruckLoad.mine_id == mine_id,
                TruckLoad.entity_id == payload.entity_id,
                TruckLoad.is_archived.isnot(True),
                TruckLoad.is_projection.isnot(True),
                TruckLoad.load_date >= payload.effective_from,
                TruckLoad.rate_per_ton == open_rate.rate_per_ton,
            )
        ).all()

        entity = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
        vat_reg = entity.vat_registered if entity else True
        _sub_vat_cache: dict = {}

        for load in affected:
            if load.is_paid:
                skipped_paid += 1
                continue
            load.rate_per_ton = payload.rate_per_ton
            _compute_amounts(load, vat_registered=vat_reg)
            if load.subcontractor_admin_fee_per_ton is not None:
                if load.truck_id not in _sub_vat_cache:
                    truck = db.query(Truck).filter(Truck.id == load.truck_id).first()
                    sub_vat = True
                    if truck and truck.entity_id:
                        t_ent = db.query(BusinessEntity).filter(BusinessEntity.id == truck.entity_id).first()
                        sub_vat = t_ent.vat_registered if t_ent else True
                    _sub_vat_cache[load.truck_id] = sub_vat
                _compute_subcontractor_amounts(load, sub_vat_registered=_sub_vat_cache[load.truck_id])
            updated_loads += 1

    log_action(
        db, "mine_rate.created", user_id=current_user.id,
        resource_type="mine_rate",
        description=(
            f"Added rate R{payload.rate_per_ton}/t for mine {mine.name} entity {payload.entity_id}; "
            f"re-rated {updated_loads} load(s) dated on/after the effective date"
            + (f", skipped {skipped_paid} paid" if skipped_paid else "")
        ),
    )
    db.commit()
    db.refresh(new_rate)
    out = MineRateOut.model_validate(new_rate)
    out.retro_updated_loads = updated_loads
    out.retro_skipped_paid = skipped_paid
    return out
