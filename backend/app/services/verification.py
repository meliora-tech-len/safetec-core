"""
Shared 3-step verification helpers.

Step 1: any authorised user marks an item as checked.
Step 2: a *different* user adds their own verification tick.
Step 3 (final lock): any admin finalises — requires step 1 (step 2 optional).
         Only the admin who set step 3 can reverse it.

Un-verify rules:
- Step 1 can be undone by the person who did it (while step 3 not set).
- Step 2 can be undone by the person who did it (while step 3 not set).
- Step 3 can only be undone by the admin who set it.
- Once step 3 is set, existing ticks and the record's values are frozen, but
  a user who hasn't ticked yet may still ADD their verification to an empty
  step — e.g. the admin verified and locked before the assistant got to it.
"""

from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import User


def is_locked(obj) -> bool:
    """True when the final verification lock (step 3) is set on the record."""
    return bool(getattr(obj, "verified3_by", None))


def ensure_not_locked(obj, updates: dict | None = None, allowed_fields: set | None = None):
    """Raise 403 when `obj` carries the final verification lock.

    Pass `updates` (the requested field changes) together with `allowed_fields`
    to let pure workflow-status updates (e.g. marking paid) through on locked
    records. The lock is lifted by the admin who applied it removing her final
    verification — after that the record can be amended again.
    """
    if not is_locked(obj):
        return
    if updates is not None and allowed_fields is not None and set(updates) <= allowed_fields:
        return
    raise HTTPException(
        status_code=403,
        detail="This record is locked by final verification. The admin who applied "
               "the final verification must remove it before changes can be made.",
    )


def intent_from_action(action: str | None) -> bool | None:
    """Translate the client's action string into a verify/finalize `desired` intent.
    True = add/apply, False = remove/undo, None = legacy toggle (no intent sent)."""
    if action is None:
        return None
    a = action.strip().lower()
    if a in ("add", "apply", "verify", "lock", "set", "true"):
        return True
    if a in ("remove", "undo", "unlock", "clear", "false"):
        return False
    return None


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


def build_initials_cache(db: Session) -> dict:
    """One-query map of {user_id: initials} for use as `user_cache` when rendering
    a list of records. The user table is tiny (a handful of staff), so loading it
    whole once collapses the per-row, per-verifier User lookups (previously up to
    3 queries × N rows) into a single query for the whole screen."""
    return {
        uid: _initials(full_name)
        for uid, full_name in db.query(User.id, User.full_name).all()
    }


def get_verification_display(db: Session, obj, user_cache: dict | None = None) -> dict:
    """Return display-ready verification info for an object with verified_by / verified2_by / verified3_by columns.

    Pass `user_cache` (see build_initials_cache) when rendering many records to
    avoid an N+1 storm of User lookups.
    """
    def _user_init(uid):
        if not uid:
            return None
        if user_cache is not None:
            return user_cache.get(uid)
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


def apply_verify_step(obj, current_user: User, is_admin: bool, desired: bool | None = None):
    """
    Advance or revert steps 1/2 on `obj`.  Once step 3 is set, only adding a
    tick to an empty step is allowed — no undos.

    The object must have: is_verified (or verified), verified_by,
    verified_at, verified2_by, verified2_at, verified3_by columns.

    `desired` carries the *client's intent* so a stale browser tab can't flip a
    tick the wrong way:
      - True  = the user meant to ADD their verification
      - False = the user meant to REMOVE their own verification
      - None  = legacy blind toggle (kept for back-compat)
    When the natural toggle direction contradicts `desired`, the call is a no-op
    instead of silently doing the opposite.
    """
    now = datetime.now(tz=timezone.utc)

    _flag_attr = "verified" if hasattr(obj, "verified") and not hasattr(obj, "is_verified") else "is_verified"

    step1_done = bool(getattr(obj, _flag_attr, False))
    step2_done = bool(getattr(obj, "verified2_by", None))
    step3_done = bool(getattr(obj, "verified3_by", None))

    if step3_done:
        # Final lock freezes existing ticks (and the record itself), but a user
        # who hasn't verified yet may still add their tick to an empty step.
        if desired is False:
            return  # ticks are frozen under the final lock — nothing to remove
        if not step1_done:
            setattr(obj, _flag_attr, True)
            obj.verified_by = current_user.id
            obj.verified_at = now
        elif not step2_done and obj.verified_by != current_user.id:
            obj.verified2_by = current_user.id
            obj.verified2_at = now
        elif desired is None:
            raise HTTPException(
                status_code=403,
                detail="This record is locked by final approval and cannot be changed.",
            )
        # desired is True but there's no empty step left for this user → no-op
        return

    # Work out what the natural toggle would do: add a tick, remove one, or
    # nothing this user is allowed to touch.
    if not step1_done:
        action_is_add = True
    elif not step2_done:
        action_is_add = obj.verified_by != current_user.id  # add step 2, or undo own step 1
    elif obj.verified2_by == current_user.id:
        action_is_add = False  # undo own step 2
    else:
        action_is_add = None   # both steps held by others — nothing to do

    if action_is_add is None:
        if desired is None:
            raise HTTPException(
                status_code=403,
                detail="This verification is locked. Only the person who completed it can reverse it.",
            )
        return  # explicit intent on a tick that isn't this user's — no-op

    if desired is not None and desired != action_is_add:
        return  # stale / contradictory click — ignore rather than flip

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
        else:
            obj.verified2_by = current_user.id
            obj.verified2_at = now
    else:
        obj.verified2_by = None
        obj.verified2_at = None


def apply_finalize_step(obj, current_user: User, is_admin: bool, require_step1: bool = True,
                        desired: bool | None = None):
    """
    Apply or undo step 3 (admin final lock).

    - By default requires at least step 1 to be complete. Pass require_step1=False
      to let the owner lock a value on its own (her verification alone stands) —
      used by the per-value verification overlay.
    - Any admin can apply step 3 (step 2 is optional).
    - Only the admin who set step 3 can reverse it.

    `desired` carries the *client's intent* so a stale browser tab can't toggle a
    lock the wrong way (the bug behind "my final locks disappeared" when working
    with two windows open):
      - True  = the admin meant to APPLY the lock  → if already locked, no-op
                (NEVER silently unlock)
      - False = the admin meant to REMOVE the lock → if already unlocked, no-op
      - None  = legacy blind toggle (kept for back-compat)
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

    # Natural toggle direction: lock when currently unlocked, else unlock.
    is_apply = not step3_done
    if desired is not None and desired != is_apply:
        # The tab that issued this click was out of date (e.g. it still showed the
        # record unlocked because the lock was applied in another window). Ignore
        # rather than perform the opposite action.
        return

    if is_apply:
        if require_step1 and not step1_done:
            raise HTTPException(
                status_code=400,
                detail="At least one verification step must be completed before applying the final lock.",
            )
        obj.verified3_by = current_user.id
        obj.verified3_at = now
    else:
        if obj.verified3_by == current_user.id:
            obj.verified3_by = None
            obj.verified3_at = None
        else:
            raise HTTPException(
                status_code=403,
                detail="This record is fully locked. Only the admin who finalised it can reverse that.",
            )
