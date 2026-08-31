from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, case, extract
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from app.db.database import get_db
from app.core.security import get_current_user
from app.core.updates import sent_fields
from app.models.models import User, Supplier, Invoice, SupplierInvoice, DieselRate, DieselFillUp
from app.schemas.schemas import SupplierCreate, SupplierBulkCreate, SupplierUpdate, SupplierOut
from app.services.audit import log_action

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


from app.core.security import check_entity_access as _check_entity_access


@router.get("/", response_model=List[SupplierOut])
def list_suppliers(
    entity_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    is_diesel_supplier: Optional[bool] = Query(None),
    truck_registration: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Supplier)

    # Scope by accessible entities
    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(Supplier.entity_id.in_(access_ids))

    if entity_id:
        _check_entity_access(entity_id, current_user)
        query = query.filter(Supplier.entity_id == entity_id)

    if not include_inactive:
        query = query.filter(Supplier.is_active == True)

    if is_diesel_supplier is not None:
        query = query.filter(Supplier.is_diesel_supplier == is_diesel_supplier)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                Supplier.name.ilike(search_term),
                Supplier.trading_name.ilike(search_term),
                Supplier.contact_person.ilike(search_term),
                Supplier.email.ilike(search_term),
            )
        )

    if truck_registration:
        query = query.filter(Supplier.registration_number.ilike(truck_registration))

    return query.order_by(Supplier.name).offset(skip).limit(limit).all()


# NOTE: must be registered before /{supplier_id} or "summary" is parsed as an id.
@router.get("/summary")
def suppliers_financial_summary(
    entity_id: Optional[int] = Query(None),
    period: str = Query("month", pattern="^(month|year|lifetime)$"),
    year: Optional[int] = Query(None, ge=2020),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-supplier Paid / Outstanding totals for the Suppliers overview table.

    Supplier invoices are bucketed by invoice_date — the same convention as the
    SARS VAT and Income-vs-Expenses reports (not the statement period).
    """
    if period == "month" and not (year and month):
        raise HTTPException(status_code=400, detail="year and month are required for a monthly period")
    if period == "year" and not year:
        raise HTTPException(status_code=400, detail="year is required for a yearly period")

    query = (
        db.query(
            SupplierInvoice.supplier_id.label("supplier_id"),
            func.coalesce(func.sum(case(
                (SupplierInvoice.is_paid == True, SupplierInvoice.amount), else_=0,
            )), 0).label("paid"),
            func.coalesce(func.sum(case(
                (SupplierInvoice.is_paid == True, 0), else_=SupplierInvoice.amount,
            )), 0).label("outstanding"),
        )
        .join(Supplier, Supplier.id == SupplierInvoice.supplier_id)
        .filter(SupplierInvoice.is_archived == False)
    )

    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(Supplier.entity_id.in_(access_ids))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        query = query.filter(Supplier.entity_id == entity_id)

    if period == "month":
        query = query.filter(
            extract("year", SupplierInvoice.invoice_date) == year,
            extract("month", SupplierInvoice.invoice_date) == month,
        )
    elif period == "year":
        query = query.filter(extract("year", SupplierInvoice.invoice_date) == year)

    return [
        {
            "supplier_id": r.supplier_id,
            "paid": float(r.paid or 0),
            "outstanding": float(r.outstanding or 0),
        }
        for r in query.group_by(SupplierInvoice.supplier_id).all()
    ]


@router.get("/{supplier_id}", response_model=SupplierOut)
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    _check_entity_access(supplier.entity_id, current_user)
    return supplier


@router.post("/", response_model=SupplierOut)
def create_supplier(
    payload: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    supplier = Supplier(**payload.model_dump())
    db.add(supplier)
    log_action(
        db, "supplier.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="supplier",
        description=f"Created supplier {supplier.name}",
    )
    db.commit()
    db.refresh(supplier)
    return supplier


@router.post("/bulk", response_model=List[SupplierOut])
def create_supplier_bulk(
    payload: SupplierBulkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create the same supplier across multiple entities at once."""
    if not payload.entity_ids:
        raise HTTPException(status_code=400, detail="At least one entity must be selected")
    for eid in payload.entity_ids:
        _check_entity_access(eid, current_user)

    fields = payload.model_dump(exclude={"entity_ids"})
    try:
        created = []
        for eid in payload.entity_ids:
            supplier = Supplier(entity_id=eid, **fields)
            db.add(supplier)
            log_action(
                db, "supplier.created", user_id=current_user.id,
                entity_id=eid, resource_type="supplier",
                description=f"Created supplier {supplier.name}",
            )
            created.append(supplier)

        db.commit()
        for s in created:
            db.refresh(s)
        return created
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create suppliers")


@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    _check_entity_access(supplier.entity_id, current_user)

    updates = sent_fields(payload, "notes")
    old_vals = {k: str(getattr(supplier, k)) for k in updates}
    for field, value in updates.items():
        setattr(supplier, field, value)

    log_action(
        db, "supplier.updated", user_id=current_user.id,
        entity_id=supplier.entity_id, resource_type="supplier",
        resource_id=supplier_id, description=f"Updated supplier {supplier.name}",
        old_values=old_vals,
    )
    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    _check_entity_access(supplier.entity_id, current_user)
    supplier.is_active = False
    log_action(db, "supplier.deleted", user_id=current_user.id,
               entity_id=supplier.entity_id, resource_type="supplier",
               resource_id=supplier_id, description=f"Deactivated supplier {supplier.name}")
    db.commit()
    return {"detail": "Supplier deactivated"}


@router.delete("/{supplier_id}/permanent")
def permanently_delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    _check_entity_access(supplier.entity_id, current_user)

    # Refuse if other records still reference this supplier — archive instead.
    blockers = []
    for label, count in (
        ("invoice(s)",         db.query(Invoice).filter(Invoice.supplier_id == supplier_id).count()),
        ("supplier invoice(s)", db.query(SupplierInvoice).filter(SupplierInvoice.supplier_id == supplier_id).count()),
        ("diesel rate(s)",     db.query(DieselRate).filter(DieselRate.supplier_id == supplier_id).count()),
        ("diesel fill-up(s)",  db.query(DieselFillUp).filter(DieselFillUp.supplier_id == supplier_id).count()),
    ):
        if count:
            blockers.append(f"{count} {label}")
    if blockers:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot permanently delete supplier '{supplier.name}' — {', '.join(blockers)} reference it. Archive instead or remove those first.",
        )

    log_action(db, "supplier.permanently_deleted", user_id=current_user.id,
               entity_id=supplier.entity_id, resource_type="supplier",
               resource_id=supplier_id, description=f"Permanently deleted supplier {supplier.name}")
    db.delete(supplier)
    db.commit()
    return {"detail": "Supplier permanently deleted"}
