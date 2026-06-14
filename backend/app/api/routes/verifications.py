"""
Generic per-value verification overlay.

Attaches the shared 3-step verification (services/verification.py) to arbitrary
computed values identified by a stable `target` string, without touching the
modules' own data or endpoints. Used as a 2-tier flow: step 1 = user verify,
step 3 = admin/owner final lock (highlight). Step 2 is left unused.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, ValueVerification
from app.schemas.schemas import ValueVerificationActionIn, ValueVerificationOut
from app.services.audit import log_action
from app.services.verification import (
    apply_verify_step, apply_finalize_step, get_verification_display,
)

router = APIRouter(prefix="/api/verifications", tags=["verifications"])


def _check_entity_access(entity_id: Optional[int], user: User):
    if user.role == "admin" or entity_id is None:
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _to_out(db: Session, row: ValueVerification) -> dict:
    out = {
        "target": row.target,
        "is_verified": bool(row.is_verified),
        "verified_by": row.verified_by,
        "verified2_by": row.verified2_by,
        "verified3_by": row.verified3_by,
    }
    out.update(get_verification_display(db, row))
    return out


def _get_or_create(db: Session, target: str, entity_id: Optional[int]) -> ValueVerification:
    row = db.query(ValueVerification).filter(ValueVerification.target == target).first()
    if row:
        return row
    row = ValueVerification(target=target, entity_id=entity_id)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        # Concurrent create — fall back to the existing row.
        db.rollback()
        row = db.query(ValueVerification).filter(ValueVerification.target == target).first()
    return row


@router.get("", response_model=List[ValueVerificationOut])
def list_verifications(
    prefix: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All verification rows whose target starts with `prefix` (one call per screen)."""
    rows = (
        db.query(ValueVerification)
        .filter(ValueVerification.target.like(f"{prefix}%"))
        .all()
    )
    return [_to_out(db, r) for r in rows]


@router.patch("/verify", response_model=ValueVerificationOut)
def verify_value(
    payload: ValueVerificationActionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    row = _get_or_create(db, payload.target, payload.entity_id)
    before = (row.verified_by, row.verified2_by)
    apply_verify_step(row, current_user, is_admin=(current_user.role == "admin"))
    after = (row.verified_by, row.verified2_by)
    # apply_verify_step toggles: log whether a tick was added or removed
    added = (after[0] and not before[0]) or (after[1] and not before[1])
    log_action(
        db, "value.verified" if added else "value.unverified",
        user_id=current_user.id,
        entity_id=row.entity_id, resource_type="value_verification",
        resource_id=row.id,
        description=f"{'Verified' if added else 'Removed verification on'} value {row.target}",
    )
    db.commit()
    db.refresh(row)
    return _to_out(db, row)


@router.patch("/finalize", response_model=ValueVerificationOut)
def finalize_value(
    payload: ValueVerificationActionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    row = _get_or_create(db, payload.target, payload.entity_id)
    # require_step1=False: the owner may lock a value on her own, no prior user step.
    apply_finalize_step(row, current_user, is_admin=(current_user.role == "admin"), require_step1=False)
    locked = bool(row.verified3_by)
    log_action(
        db, "value.finalized" if locked else "value.unfinalized",
        user_id=current_user.id,
        entity_id=row.entity_id, resource_type="value_verification",
        resource_id=row.id,
        description=f"{'Final lock on' if locked else 'Removed final lock on'} value {row.target}",
    )
    db.commit()
    db.refresh(row)
    return _to_out(db, row)
