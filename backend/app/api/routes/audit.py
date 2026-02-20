from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, AuditLog
from app.schemas.schemas import AuditLogOut

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/", response_model=List[AuditLogOut])
def list_audit_logs(
    entity_id: Optional[int] = Query(None),
    resource_type: Optional[str] = Query(None),
    resource_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(AuditLog).options(joinedload(AuditLog.user))

    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(
            (AuditLog.entity_id.in_(access_ids)) | (AuditLog.user_id == current_user.id)
        )

    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if resource_id:
        query = query.filter(AuditLog.resource_id == resource_id)

    return query.order_by(AuditLog.timestamp.desc()).offset(skip).limit(limit).all()
