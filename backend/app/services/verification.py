"""
Shared 2-step verification helpers.

Step 1: any authorised user marks an item as checked.
Step 2: a *different* user gives final approval.
Un-verify: the step-1 verifier can undo step 1 (if step 2 not yet done);
           only an admin can un-verify once both steps are complete.
"""

from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import User


def _initials(full_name: str | None) -> str | None:
    if not full_name:
        return None
    return "".join(w[0].upper() for w in full_name.strip().split() if w)


def _fmt_date(dt) -> str | None:
    if not dt:
        return None
    if hasattr(dt, "strftime"):
        return dt.strftime("%Y.%m.%d")
    return str(dt)[:10].replace("-", ".")


def get_verification_display(db: Session, obj) -> dict:
    """
    Return display-ready verification info for an object that has
    verified_by / verified_at / verified2_by / verified2_at columns.
    """
    def _user_init(uid):
        if not uid:
            return None
        u = db.query(User).filter(User.id == uid).first()
        return _initials(u.full_name) if u else None

    v1_by = getattr(obj, "verified_by", None)
    v1_at = getattr(obj, "verified_at", None)
    v2_by = getattr(obj, "verified2_by", None)
    v2_at = getattr(obj, "verified2_at", None)

    return {
        "verified_by_initials": _user_init(v1_by),
        "verified_by_date":     _fmt_date(v1_at),
        "verified2_by_initials": _user_init(v2_by),
        "verified2_by_date":    _fmt_date(v2_at),
    }


def apply_verify_step(obj, current_user: User, is_admin: bool):
    """
    Advance or revert the 2-step verification state machine on `obj`.

    The object must have: is_verified (or verified), verified_by,
    verified_at, verified2_by, verified2_at columns.
    """
    now = datetime.now(tz=timezone.utc)

    # Normalise: diesel uses `verified`, others use `is_verified`
    _flag_attr = "verified" if hasattr(obj, "verified") and not hasattr(obj, "is_verified") else "is_verified"

    step1_done = bool(getattr(obj, _flag_attr, False))
    step2_done = bool(getattr(obj, "verified2_by", None))

    if not step1_done:
        # → do step 1
        setattr(obj, _flag_attr, True)
        obj.verified_by = current_user.id
        obj.verified_at = now
        obj.verified2_by = None
        obj.verified2_at = None

    elif not step2_done:
        if obj.verified_by == current_user.id and not is_admin:
            raise HTTPException(
                status_code=400,
                detail="The same person cannot complete both verification steps.",
            )
        # → do step 2
        obj.verified2_by = current_user.id
        obj.verified2_at = now

    else:
        # Both steps done — only admin can reset
        if not is_admin:
            raise HTTPException(
                status_code=403,
                detail="Only an admin can remove a completed 2-step verification.",
            )
        setattr(obj, _flag_attr, False)
        obj.verified_by  = None
        obj.verified_at  = None
        obj.verified2_by = None
        obj.verified2_at = None
