from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Customer, Invoice, Statement
from app.schemas.schemas import CustomerCreate, CustomerUpdate, CustomerOut
from app.services.audit import log_action

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


@router.get("/", response_model=List[CustomerOut])
def list_customers(
    entity_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Customer)

    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(Customer.entity_id.in_(access_ids))

    if entity_id:
        _check_entity_access(entity_id, current_user)
        query = query.filter(Customer.entity_id == entity_id)

    if not include_inactive:
        query = query.filter(Customer.is_active == True)

    if search:
        s = f"%{search}%"
        query = query.filter(
            or_(
                Customer.name.ilike(s),
                Customer.trading_name.ilike(s),
                Customer.contact_person.ilike(s),
                Customer.email.ilike(s),
            )
        )

    return query.order_by(Customer.name).offset(skip).limit(limit).all()


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    _check_entity_access(customer.entity_id, current_user)
    return customer


@router.post("/", response_model=CustomerOut)
def create_customer(
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    customer = Customer(**payload.model_dump())
    db.add(customer)
    log_action(
        db, "customer.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="customer",
        description=f"Created customer {customer.name}",
    )
    db.commit()
    db.refresh(customer)
    return customer


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    _check_entity_access(customer.entity_id, current_user)

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(customer, field, value)

    log_action(
        db, "customer.updated", user_id=current_user.id,
        entity_id=customer.entity_id, resource_type="customer",
        resource_id=customer_id, description=f"Updated customer {customer.name}",
    )
    db.commit()
    db.refresh(customer)
    return customer


@router.delete("/{customer_id}")
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    _check_entity_access(customer.entity_id, current_user)
    customer.is_active = False
    log_action(db, "customer.deleted", user_id=current_user.id,
               entity_id=customer.entity_id, resource_type="customer",
               resource_id=customer_id, description=f"Deactivated customer {customer.name}")
    db.commit()
    return {"detail": "Customer deactivated"}


@router.delete("/{customer_id}/permanent")
def permanently_delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    _check_entity_access(customer.entity_id, current_user)

    # Refuse if other records still reference this customer — archive instead.
    blockers = []
    for label, count in (
        ("invoice(s)",   db.query(Invoice).filter(Invoice.customer_id == customer_id).count()),
        ("statement(s)", db.query(Statement).filter(Statement.customer_id == customer_id).count()),
    ):
        if count:
            blockers.append(f"{count} {label}")
    if blockers:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot permanently delete customer '{customer.name}' — {', '.join(blockers)} reference it. Archive instead or remove those first.",
        )

    log_action(db, "customer.permanently_deleted", user_id=current_user.id,
               entity_id=customer.entity_id, resource_type="customer",
               resource_id=customer_id, description=f"Permanently deleted customer {customer.name}")
    db.delete(customer)
    db.commit()
    return {"detail": "Customer permanently deleted"}
