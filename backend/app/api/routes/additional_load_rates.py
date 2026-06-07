from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, AdditionalLoadRate
from app.schemas.schemas import (
    AdditionalLoadRateCreate, AdditionalLoadRateUpdate, AdditionalLoadRateOut,
)

router = APIRouter(prefix="/api/additional-load-rates", tags=["additional-load-rates"])


def _check_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    if entity_id not in [a.entity_id for a in user.entity_access]:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _get(rate_id: int, db: Session) -> AdditionalLoadRate:
    rate = db.query(AdditionalLoadRate).filter(AdditionalLoadRate.id == rate_id).first()
    if not rate:
        raise HTTPException(status_code=404, detail="Rate not found")
    return rate


@router.get("/", response_model=List[AdditionalLoadRateOut])
def list_rates(
    entity_id:    Optional[int] = Query(None),
    db:           Session       = Depends(get_db),
    current_user: User          = Depends(get_current_user),
):
    q = db.query(AdditionalLoadRate)
    if entity_id:
        q = q.filter(AdditionalLoadRate.entity_id == entity_id)
    elif current_user.role != "admin":
        ids = [a.entity_id for a in current_user.entity_access]
        q = q.filter(AdditionalLoadRate.entity_id.in_(ids))
    return q.order_by(AdditionalLoadRate.name.asc()).all()


@router.post("/", response_model=AdditionalLoadRateOut, status_code=201)
def create_rate(
    data:         AdditionalLoadRateCreate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    _check_access(data.entity_id, current_user)
    rate = AdditionalLoadRate(
        entity_id = data.entity_id,
        name      = data.name.strip(),
        amount    = data.amount,
        is_active = data.is_active,
    )
    db.add(rate)
    db.commit()
    db.refresh(rate)
    return rate


@router.put("/{rate_id}", response_model=AdditionalLoadRateOut)
def update_rate(
    rate_id:      int,
    data:         AdditionalLoadRateUpdate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    rate = _get(rate_id, db)
    _check_access(rate.entity_id, current_user)
    if data.name      is not None: rate.name      = data.name.strip()
    if data.amount    is not None: rate.amount    = data.amount
    if data.is_active is not None: rate.is_active = data.is_active
    db.commit()
    db.refresh(rate)
    return rate


@router.delete("/{rate_id}", status_code=204)
def delete_rate(
    rate_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    rate = _get(rate_id, db)
    _check_access(rate.entity_id, current_user)
    db.delete(rate)
    db.commit()
