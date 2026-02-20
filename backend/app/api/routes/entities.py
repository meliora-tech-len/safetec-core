from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.db.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.models import User, BusinessEntity
from app.schemas.schemas import EntityCreate, EntityUpdate, EntityOut
from app.services.audit import log_action

router = APIRouter(prefix="/api/entities", tags=["entities"])


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


@router.get("/", response_model=List[EntityOut])
def list_entities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "admin":
        return db.query(BusinessEntity).filter(BusinessEntity.is_active == True).all()
    access_ids = [a.entity_id for a in current_user.entity_access]
    return db.query(BusinessEntity).filter(
        BusinessEntity.id.in_(access_ids),
        BusinessEntity.is_active == True,
    ).all()


@router.get("/{entity_id}", response_model=EntityOut)
def get_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_accessible_entity(entity_id, current_user, db)


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
