"""
Shared 3-step verification helpers.

Step 1: any authorised user marks an item as checked.
Step 2: a *different* admin gives secondary approval.
Step 3 (final lock): any admin finalises — requires step 1 (step 2 optional).
         Only the admin who set step 3 can reverse it.

Un-verify rules:
- Step 1 can be undone by the person who did it (while step 3 not set).
- Step 2 can be undone by the person who did it (while step 3 not set).
- Step 3 can only be undone by the admin who set it.
- Nothing can change once step 3 is set (except by that same admin).
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
    """Return display-ready verification info for an object with verified_by / verified2_by / verified3_by columns."""
    def _user_init(uid):
        if not uid:
            return None
        u = db.query(User).filter(User.id == uid).first()
        return _initials(u.full_name) if u else None

    return {
        "verified_by_initials":  _user_init(getattr(obj, "verified_by", None)),
        "verified_by_date":      _fmt_date(getattr(obj, "verified_at", None)),
        "verified2_by_initials": _user_init(getattr(obj, "verified2_by", None)),
        "verified2_by_date":     _fmt_date(getattr(obj, "verified2_at", None)),
        "verified3_by_initials": _user_init(getattr(obj, "verified3_by", None)),
        "verified3_by_date":     _fmt_date(getattr(obj, "verified3_at", None)),
    }


def apply_verify_step(obj, current_user: User, is_admin: bool):
    """
    Advance or revert steps 1/2 on `obj`.  Blocked once step 3 is set.

    The object must have: is_verified (or verified), verified_by,
    verified_at, verified2_by, verified2_at, verified3_by columns.
    """
    now = datetime.now(tz=timezone.utc)

    _flag_attr = "verified" if hasattr(obj, "verified") and not hasattr(obj, "is_verified") else "is_verified"

    step1_done = bool(getattr(obj, _flag_attr, False))
    step2_done = bool(getattr(obj, "verified2_by", None))
    step3_done = bool(getattr(obj, "verified3_by", None))

    if step3_done:
        raise HTTPException(
            status_code=403,
            detail="This record is locked by final approval and cannot be changed.",
        )

    if not step1_done:
        setattr(obj, _flag_attr, True)
        obj.verified_by = current_user.id
        obj.verified_at = now
        obj.verified2_by = None
        obj.verified2_at = None

    elif not step2_done:
        if obj.verified_by == current_user.id:
            setattr(obj, _flag_attr, False)
            obj.verified_by = None
            obj.verified_at = None
        elif is_admin:
            obj.verified2_by = current_user.id
            obj.verified2_at = now
        else:
            raise HTTPException(
                status_code=403,
                detail="This verification was done by someone else and cannot be changed.",
            )

    else:
        if obj.verified2_by == current_user.id:
            obj.verified2_by = None
            obj.verified2_at = None
        else:
            raise HTTPException(
                status_code=403,
                detail="This verification is locked. Only the person who completed it can reverse it.",
            )


def apply_finalize_step(obj, current_user: User, is_admin: bool):
    """
    Apply or undo step 3 (admin final lock).

    - Requires at least step 1 to be complete.
    - Any admin can apply step 3 (step 2 is optional).
    - Only the admin who set step 3 can reverse it.
    """
    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Only administrators can apply the final verification lock.",
        )

    now = datetime.now(tz=timezone.utc)
    _flag_attr = "verified" if hasattr(obj, "verified") and not hasattr(obj, "is_verified") else "is_verified"
    step1_done = bool(getattr(obj, _flag_attr, False))
    step3_done = bool(getattr(obj, "verified3_by", None))

    if not step1_done:
        raise HTTPException(
            status_code=400,
            detail="At least one verification step must be completed before applying the final lock.",
        )

    if step3_done:
        if obj.verified3_by == current_user.id:
            obj.verified3_by = None
            obj.verified3_at = None
        else:
            raise HTTPException(
                status_code=403,
                detail="This record is fully locked. Only the admin who finalised it can reverse that.",
            )
    else:
        obj.verified3_by = current_user.id
        obj.verified3_at = now
