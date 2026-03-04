from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.db.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.models import User, Role
from app.schemas.schemas import RoleOut, RoleCreate
from app.services.audit import log_action

router = APIRouter(prefix="/api/roles", tags=["roles"])


@router.get("/", response_model=List[RoleOut])
def list_roles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Role).order_by(Role.display_name).all()


@router.post("/", response_model=RoleOut)
def create_role(
    payload: RoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    key = payload.key.strip().lower().replace(" ", "_")
    if not key:
        raise HTTPException(status_code=400, detail="Role key cannot be empty")
    if db.query(Role).filter(Role.key == key).first():
        raise HTTPException(status_code=400, detail=f"Role '{key}' already exists")

    role = Role(key=key, display_name=payload.display_name.strip(), is_protected=False)
    db.add(role)
    log_action(db, "role.created", user_id=current_user.id, resource_type="role",
               description=f"Created role '{key}' ({payload.display_name})")
    db.commit()
    db.refresh(role)
    return role


@router.delete("/{key}")
def delete_role(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    role = db.query(Role).filter(Role.key == key).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_protected:
        raise HTTPException(status_code=400, detail=f"Role '{key}' is protected and cannot be deleted")

    db.delete(role)
    log_action(db, "role.deleted", user_id=current_user.id, resource_type="role",
               description=f"Deleted role '{key}'")
    db.commit()
    return {"detail": f"Role '{key}' deleted"}
