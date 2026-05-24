import os
import httpx
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from sqlalchemy.orm import Session
from typing import List

from app.db.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.models import User, BusinessEntity
from app.schemas.schemas import EntityCreate, EntityUpdate, EntityOut, NextNumberOut
from app.services.audit import log_action

router = APIRouter(prefix="/api/entities", tags=["entities"])

# ── Supabase Storage config ───────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET_NAME = "entity-branding"

# ── Local storage (SQLite / no Supabase) ─────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "")
IS_LOCAL = DATABASE_URL.startswith("sqlite") or not SUPABASE_URL

LOCAL_LOGO_DIR = Path(__file__).resolve().parents[3] / "static" / "logos"


def _ensure_local_dir() -> None:
    LOCAL_LOGO_DIR.mkdir(parents=True, exist_ok=True)


def _save_local(file_bytes: bytes, file_name: str, base_url: str) -> str:
    """Save logo to backend/static/logos/, return the absolute URL the frontend can use."""
    _ensure_local_dir()
    (LOCAL_LOGO_DIR / file_name).write_bytes(file_bytes)
    return f"{base_url}static/logos/{file_name}"


def _supabase_upload(file_bytes: bytes, file_name: str, content_type: str) -> str:
    """Upload to Supabase Storage, return public URL."""
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET_NAME}/{file_name}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    resp = httpx.put(upload_url, content=file_bytes, headers=headers)
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"Logo upload failed: {resp.text}")
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{file_name}"


def _get_accessible_entity(entity_id: int, user: User, db: Session) -> BusinessEntity:
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    if user.role == "admin":
        return entity
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")
    return entity


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[EntityOut])
def list_entities(
    include_inactive: bool = Query(False),
    include_subcontractor: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(BusinessEntity)
    if not include_inactive:
        q = q.filter(BusinessEntity.is_active == True)
    if not include_subcontractor:
        q = q.filter(BusinessEntity.is_subcontractor_entity != True)

    if current_user.role == "admin":
        return q.all()

    access_ids = [a.entity_id for a in current_user.entity_access]
    return q.filter(BusinessEntity.id.in_(access_ids)).all()


@router.get("/{entity_id}", response_model=EntityOut)
def get_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_accessible_entity(entity_id, current_user, db)


# ── Next invoice/quote number (does NOT increment counter) ────────────────────

@router.get("/{entity_id}/next-number", response_model=NextNumberOut)
def next_invoice_number(
    entity_id: int,
    doc_type: str = Query("invoice", pattern="^(invoice|quote|purchase_order)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entity = _get_accessible_entity(entity_id, current_user, db)

    if doc_type == "invoice":
        prefix = entity.invoice_prefix or entity.code or "INV"
        counter = (entity.invoice_counter or 0) + 1
    elif doc_type == "purchase_order":
        prefix = "PO"
        counter = (entity.invoice_counter or 0) + 1
    else:
        prefix = entity.quote_prefix or "QT"
        counter = (entity.quote_counter or 0) + 1

    next_number = f"{prefix}{str(counter).zfill(5)}"
    return NextNumberOut(next_number=next_number, prefix=prefix, counter=counter)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/", response_model=EntityOut)
def create_entity(
    payload: EntityCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if db.query(BusinessEntity).filter(BusinessEntity.code == payload.code).first():
        raise HTTPException(status_code=400, detail="Entity code already exists")
    entity = BusinessEntity(**payload.model_dump())
    db.add(entity)
    log_action(db, "entity.created", user_id=current_user.id, resource_type="entity",
               description=f"Created entity {entity.name}")
    db.commit()
    db.refresh(entity)
    return entity


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{entity_id}", response_model=EntityOut)
def update_entity(
    entity_id: int,
    payload: EntityUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(entity, field, value)

    log_action(db, "entity.updated", user_id=current_user.id, resource_type="entity",
               resource_id=entity_id, description=f"Updated entity {entity.name}")
    db.commit()
    db.refresh(entity)
    return entity


# ── Logo upload ───────────────────────────────────────────────────────────────

@router.post("/{entity_id}/logo", response_model=EntityOut)
async def upload_logo(
    request: Request,
    entity_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    allowed_types = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only PNG, JPG, SVG, or WebP images are allowed")

    file_bytes = await file.read()
    if len(file_bytes) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo must be under 2MB")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "png"
    file_name = f"{entity.code.lower()}_logo.{ext}"

    if IS_LOCAL:
        base_url = str(request.base_url)  # e.g. "http://localhost:8000/"
        logo_url = _save_local(file_bytes, file_name, base_url)
    else:
        logo_url = _supabase_upload(file_bytes, file_name, file.content_type)

    entity.logo_url = logo_url

    log_action(db, "entity.logo_uploaded", user_id=current_user.id, resource_type="entity",
               resource_id=entity_id, description=f"Uploaded logo for {entity.name}")
    db.commit()
    db.refresh(entity)
    return entity


# ── Archive (soft delete) ─────────────────────────────────────────────────────

@router.delete("/{entity_id}")
def archive_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    entity.is_active = False
    log_action(db, "entity.archived", user_id=current_user.id, resource_type="entity",
               resource_id=entity_id, description=f"Archived entity {entity.name}")
    db.commit()
    return {"detail": f"Entity '{entity.name}' archived"}


# ── Restore ───────────────────────────────────────────────────────────────────

@router.post("/{entity_id}/restore", response_model=EntityOut)
def restore_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    entity.is_active = True
    log_action(db, "entity.restored", user_id=current_user.id, resource_type="entity",
               resource_id=entity_id, description=f"Restored entity {entity.name}")
    db.commit()
    db.refresh(entity)
    return entity
