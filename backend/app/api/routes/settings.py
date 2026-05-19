from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.db.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.models import User, AppSetting
from app.schemas.schemas import AppSettingOut, AppSettingUpdate, AppSettingCreate
from app.services.audit import log_action

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/", response_model=List[AppSettingOut])
def list_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(AppSetting).order_by(AppSetting.category, AppSetting.key).all()


@router.get("/{key}", response_model=AppSettingOut)
def get_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not setting:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")
    return setting


@router.put("/{key}", response_model=AppSettingOut)
def update_setting(
    key: str,
    payload: AppSettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not setting:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")

    setting.value = payload.value
    if payload.label is not None:
        setting.label = payload.label
    if payload.category is not None:
        setting.category = payload.category
    setting.updated_by = current_user.id

    log_action(db, "setting.updated", user_id=current_user.id, resource_type="setting",
               description=f"Updated setting '{key}' to '{payload.value}'")
    db.commit()
    db.refresh(setting)
    return setting


@router.post("/", response_model=AppSettingOut)
def create_setting(
    payload: AppSettingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if db.query(AppSetting).filter(AppSetting.key == payload.key).first():
        raise HTTPException(status_code=400, detail=f"Setting '{payload.key}' already exists")

    setting = AppSetting(
        key=payload.key,
        value=payload.value,
        label=payload.label,
        category=payload.category,
        updated_by=current_user.id,
    )
    db.add(setting)
    log_action(db, "setting.created", user_id=current_user.id, resource_type="setting",
               description=f"Created setting '{payload.key}'")
    db.commit()
    db.refresh(setting)
    return setting


@router.delete("/{key}")
def delete_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # Protect critical system settings
    protected = {"vat_rate", "roles", "invoice_modules"}
    if key in protected:
        raise HTTPException(status_code=400, detail=f"Setting '{key}' is protected and cannot be deleted")

    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not setting:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")

    db.delete(setting)
    log_action(db, "setting.deleted", user_id=current_user.id, resource_type="setting",
               description=f"Deleted setting '{key}'")
    db.commit()
    return {"detail": f"Setting '{key}' deleted"}
