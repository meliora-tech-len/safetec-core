from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Client
from app.schemas.schemas import ClientCreate, ClientUpdate, ClientOut
from app.services.audit import log_action

router = APIRouter(prefix="/api/clients", tags=["clients"])


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


@router.get("/", response_model=List[ClientOut])
def list_clients(
    entity_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Client)

    # Scope by accessible entities
    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(Client.entity_id.in_(access_ids))

    if entity_id:
        _check_entity_access(entity_id, current_user)
        query = query.filter(Client.entity_id == entity_id)

    if not include_inactive:
        query = query.filter(Client.is_active == True)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                Client.name.ilike(search_term),
                Client.trading_name.ilike(search_term),
                Client.contact_person.ilike(search_term),
                Client.email.ilike(search_term),
            )
        )

    return query.order_by(Client.name).offset(skip).limit(limit).all()


@router.get("/{client_id}", response_model=ClientOut)
def get_client(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    _check_entity_access(client.entity_id, current_user)
    return client


@router.post("/", response_model=ClientOut)
def create_client(
    payload: ClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    client = Client(**payload.model_dump())
    db.add(client)
    log_action(
        db, "client.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="client",
        description=f"Created client {client.name}",
    )
    db.commit()
    db.refresh(client)
    return client


@router.put("/{client_id}", response_model=ClientOut)
def update_client(
    client_id: int,
    payload: ClientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    _check_entity_access(client.entity_id, current_user)

    old_vals = {k: str(getattr(client, k)) for k in payload.model_dump(exclude_none=True)}
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(client, field, value)

    log_action(
        db, "client.updated", user_id=current_user.id,
        entity_id=client.entity_id, resource_type="client",
        resource_id=client_id, description=f"Updated client {client.name}",
        old_values=old_vals,
    )
    db.commit()
    db.refresh(client)
    return client


@router.delete("/{client_id}")
def delete_client(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    _check_entity_access(client.entity_id, current_user)
    # Soft delete
    client.is_active = False
    log_action(db, "client.deleted", user_id=current_user.id,
               entity_id=client.entity_id, resource_type="client",
               resource_id=client_id, description=f"Deactivated client {client.name}")
    db.commit()
    return {"detail": "Client deactivated"}
