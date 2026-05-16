from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import SQLAlchemyError
from typing import List

from app.db.database import get_db
from app.core.security import get_current_user, require_admin, get_password_hash
from app.models.models import User, UserEntityAccess, BusinessEntity
from app.schemas.schemas import (
    UserCreate, UserUpdate, UserOut, UserPermissionsUpdate, PasswordReset
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/users", tags=["users"])


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    users = db.query(User).options(
        joinedload(User.entity_access).joinedload(UserEntityAccess.entity)
    ).all()
    for user in users:
        for access in user.entity_access:
            if access.entity:
                access.entity_code = access.entity.code
                access.entity_name = access.entity.name
    return users


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).options(
        joinedload(User.entity_access).joinedload(UserEntityAccess.entity)
    ).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    for access in user.entity_access:
        if access.entity:
            access.entity_code = access.entity.code
            access.entity_name = access.entity.name
    return user


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/", response_model=UserOut)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    try:
        user = User(
            email=payload.email,
            full_name=payload.full_name,
            hashed_password=get_password_hash(payload.password),
            role=payload.role,
        )
        db.add(user)
        db.flush()

        # Grant access to specified entities (all modules by default)
        default_modules = ["suppliers", "invoices"]
        for entity_id in (payload.entity_ids or []):
            entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
            if entity:
                access = UserEntityAccess(
                    user_id=user.id,
                    entity_id=entity_id,
                    allowed_modules=default_modules,
                )
                db.add(access)

        log_action(db, "user.created", user_id=current_user.id, resource_type="user",
                   resource_id=user.id, description=f"Created user {user.full_name} ({user.email}) with role '{user.role}'")
        db.commit()
        db.refresh(user)
        return user
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create user")


# ── Update (details) ──────────────────────────────────────────────────────────

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

    # Validate email uniqueness before entering the transaction
    if payload.email is not None:
        existing = db.query(User).filter(User.email == payload.email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")

    try:
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

        # Update entity access if provided (simple list of entity IDs, default modules)
        if payload.entity_ids is not None:
            db.query(UserEntityAccess).filter(UserEntityAccess.user_id == user_id).delete()
            default_modules = ["suppliers", "invoices"]
            for entity_id in payload.entity_ids:
                entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
                if entity:
                    access = UserEntityAccess(
                        user_id=user.id,
                        entity_id=entity_id,
                        allowed_modules=default_modules,
                    )
                    db.add(access)

        log_action(db, "user.updated", user_id=current_user.id, resource_type="user",
                   resource_id=user_id, description=f"Updated user {user.full_name} ({user.email})")
        db.commit()
        db.refresh(user)
        return user
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update user")


# ── Password Reset (admin sets new password) ───────────────────────────────────

@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: PasswordReset,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user.hashed_password = get_password_hash(payload.new_password)
    log_action(db, "user.password_reset", user_id=current_user.id, resource_type="user",
               resource_id=user_id, description=f"Password reset for {user.full_name} ({user.email})")
    db.commit()
    return {"detail": "Password updated successfully"}


# ── Permissions update (entity + module level) ────────────────────────────────

@router.put("/{user_id}/permissions", response_model=UserOut)
def update_permissions(
    user_id: int,
    payload: UserPermissionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        # Remove all existing access
        db.query(UserEntityAccess).filter(UserEntityAccess.user_id == user_id).delete()

        # Re-create with granular permissions
        for perm in payload.permissions:
            entity = db.query(BusinessEntity).filter(BusinessEntity.id == perm.entity_id).first()
            if not entity:
                continue
            access = UserEntityAccess(
                user_id=user_id,
                entity_id=perm.entity_id,
                can_create=perm.can_create,
                can_edit=perm.can_edit,
                can_delete=perm.can_delete,
                allowed_modules=perm.allowed_modules,
            )
            db.add(access)

        log_action(db, "user.permissions_updated", user_id=current_user.id, resource_type="user",
                   resource_id=user_id, description=f"Updated permissions for {user.full_name} ({user.email})")
        db.commit()
        db.refresh(user)

        # Enrich for response
        for access in user.entity_access:
            if access.entity:
                access.entity_code = access.entity.code
                access.entity_name = access.entity.name
        return user
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update permissions")


# ── Deactivate ────────────────────────────────────────────────────────────────

@router.delete("/{user_id}")
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = False
    log_action(db, "user.deactivated", user_id=current_user.id, resource_type="user",
               resource_id=user_id, description=f"Deactivated user {user.full_name} ({user.email})")
    db.commit()
    return {"detail": f"User '{user.email}' deactivated"}


# ── Reactivate ────────────────────────────────────────────────────────────────

@router.post("/{user_id}/reactivate", response_model=UserOut)
def reactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = True
    log_action(db, "user.reactivated", user_id=current_user.id, resource_type="user",
               resource_id=user_id, description=f"Reactivated user {user.full_name} ({user.email})")
    db.commit()
    db.refresh(user)
    return user
