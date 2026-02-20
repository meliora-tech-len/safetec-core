from sqlalchemy.orm import Session
from app.models.models import AuditLog
from typing import Optional, Any


def log_action(
    db: Session,
    action: str,
    user_id: Optional[int] = None,
    entity_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[int] = None,
    description: Optional[str] = None,
    ip_address: Optional[str] = None,
    old_values: Optional[Any] = None,
    new_values: Optional[Any] = None,
):
    log = AuditLog(
        user_id=user_id,
        entity_id=entity_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        description=description,
        ip_address=ip_address,
        old_values=old_values,
        new_values=new_values,
    )
    db.add(log)
    db.flush()
    return log
