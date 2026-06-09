from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, aliased
from typing import List, Optional
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, AuditLog
from app.schemas.schemas import AuditLogOut, AuditLogPage

router = APIRouter(prefix="/api/audit", tags=["audit"])

# Actor = the user who performed the action (aliased so it doesn't collide with
# the current_user / any other User join). Used for search + sort by user name.
Actor = aliased(User)

SORT_COLUMNS = {
    "created_at": AuditLog.created_at,
    "action": AuditLog.action,
    "entity_id": AuditLog.entity_id,
    "user_name": Actor.full_name,
}

EXPORT_CAP = 20000  # safety ceiling for a single export


def _apply_access_scope(query, current_user: User):
    """Non-admins only see logs for entities they can access (or their own actions)."""
    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(
            (AuditLog.entity_id.in_(access_ids)) | (AuditLog.user_id == current_user.id)
        )
    return query


def _audit_query(
    db: Session, current_user: User, *,
    entity_id: Optional[int], resource_type: Optional[str], resource_id: Optional[int],
    month: Optional[int], year: Optional[int], q: Optional[str], action_group: Optional[str],
):
    """Build the filtered (but not yet ordered/paginated) audit query."""
    query = db.query(AuditLog).outerjoin(Actor, AuditLog.user_id == Actor.id)
    query = _apply_access_scope(query, current_user)

    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if resource_id:
        query = query.filter(AuditLog.resource_id == resource_id)
    if year:
        query = query.filter(func.extract('year', AuditLog.created_at) == year)
    if month:
        query = query.filter(func.extract('month', AuditLog.created_at) == month)
    if action_group:
        query = query.filter(AuditLog.action.like(f"{action_group}%"))
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(or_(
            func.lower(AuditLog.description).like(like),
            func.lower(AuditLog.action).like(like),
            func.lower(Actor.full_name).like(like),
        ))
    return query


@router.get("/", response_model=AuditLogPage)
def list_audit_logs(
    entity_id: Optional[int] = Query(None),
    resource_type: Optional[str] = Query(None),
    resource_id: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    q: Optional[str] = Query(None),
    action_group: Optional[str] = Query(None),
    sort: str = Query("created_at"),
    dir: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One page of audit logs for the given filters, plus the total match count."""
    query = _audit_query(
        db, current_user,
        entity_id=entity_id, resource_type=resource_type, resource_id=resource_id,
        month=month, year=year, q=q, action_group=action_group,
    )
    total = query.count()

    col = SORT_COLUMNS.get(sort, AuditLog.created_at)
    col = col.desc() if dir == "desc" else col.asc()
    items = (
        query.options(joinedload(AuditLog.user))
        .order_by(col, AuditLog.id.desc())  # id keeps ordering stable across pages
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/export", response_model=List[AuditLogOut])
def export_audit_logs(
    entity_id: Optional[int] = Query(None),
    resource_type: Optional[str] = Query(None),
    resource_id: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    q: Optional[str] = Query(None),
    action_group: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All matching audit logs for the current filters (capped), for export — so
    exports reflect the full filtered set, not just the page on screen."""
    query = _audit_query(
        db, current_user,
        entity_id=entity_id, resource_type=resource_type, resource_id=resource_id,
        month=month, year=year, q=q, action_group=action_group,
    )
    return (
        query.options(joinedload(AuditLog.user))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(EXPORT_CAP)
        .all()
    )


@router.get("/months")
def list_audit_months(
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Months that have at least one audit log, newest first, with entry counts.

    Powers the Audit Log month navigator so users can see — and jump to — every
    period that has activity, not just the most recent page."""
    y = func.extract('year', AuditLog.created_at)
    m = func.extract('month', AuditLog.created_at)

    query = db.query(y.label('year'), m.label('month'), func.count(AuditLog.id).label('count'))
    query = _apply_access_scope(query, current_user)
    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)

    rows = query.group_by(y, m).order_by(y.desc(), m.desc()).all()
    return [
        {"year": int(r.year), "month": int(r.month), "count": int(r.count)}
        for r in rows
        if r.year is not None and r.month is not None
    ]
