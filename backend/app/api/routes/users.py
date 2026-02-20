from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.db.database import get_db
from app.core.security import get_current_user, require_admin, get_password_hash
from app.models.models import User, UserEntityAccess
from app.schemas.schemas import UserCreate, UserUpdate, UserOut
from app.services.audit import log_action

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return db.query(User).all()


@router.post("/", response_model=UserOut)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=get_password_hash(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()

    for entity_id in (payload.entity_ids or []):
        access = UserEntityAccess(user_id=user.id, entity_id=entity_id)
        db.add(access)

    log_action(db, "user.created", user_id=current_user.id, resource_type="user",
               resource_id=user.id, description=f"Created user {user.email}")
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.email is not None:
        user.email = payload.email
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.hashed_password = get_password_hash(payload.password)

    if payload.entity_ids is not None:
        db.query(UserEntityAccess).filter(UserEntityAccess.user_id == user_id).delete()
        for entity_id in payload.entity_ids:
            db.add(UserEntityAccess(user_id=user_id, entity_id=entity_id))

    log_action(db, "user.updated", user_id=current_user.id, resource_type="user",
               resource_id=user.id, description=f"Updated user {user.email}")
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    log_action(db, "user.deleted", user_id=current_user.id, resource_type="user",
               resource_id=user_id, description=f"Deleted user {user.email}")
    db.commit()
    return {"detail": "User deleted"}
