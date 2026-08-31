from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import date
from decimal import Decimal
from app.db.database import get_db
from app.core.security import get_current_user
from app.core.updates import sent_fields
from app.models.models import User, InvoiceTemplate, InvoiceTemplateLineItem
from app.schemas.schemas import (
    InvoiceTemplateCreate, InvoiceTemplateUpdate, InvoiceTemplateOut,
)

router = APIRouter(prefix="/api/invoice-templates", tags=["invoice-templates"])


from app.core.security import check_entity_access as _check_entity_access


def _load_template(template_id: int, db: Session) -> InvoiceTemplate:
    tmpl = (
        db.query(InvoiceTemplate)
        .options(
            joinedload(InvoiceTemplate.line_items),
            joinedload(InvoiceTemplate.supplier),
            joinedload(InvoiceTemplate.customer),
            joinedload(InvoiceTemplate.entity),
        )
        .filter(InvoiceTemplate.id == template_id)
        .first()
    )
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tmpl


@router.get("/", response_model=List[InvoiceTemplateOut])
def list_templates(
    entity_id: Optional[int] = Query(None),
    document_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(InvoiceTemplate).options(
        joinedload(InvoiceTemplate.line_items),
        joinedload(InvoiceTemplate.supplier),
        joinedload(InvoiceTemplate.customer),
        joinedload(InvoiceTemplate.entity),
    )
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(InvoiceTemplate.entity_id == entity_id)
    else:
        if current_user.role != "admin":
            access_ids = [a.entity_id for a in current_user.entity_access]
            q = q.filter(InvoiceTemplate.entity_id.in_(access_ids))
    if document_type:
        q = q.filter(InvoiceTemplate.document_type == document_type)
    return q.order_by(InvoiceTemplate.entity_id, InvoiceTemplate.name).all()


@router.get("/{template_id}", response_model=InvoiceTemplateOut)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tmpl = _load_template(template_id, db)
    _check_entity_access(tmpl.entity_id, current_user)
    return tmpl


@router.post("/", response_model=InvoiceTemplateOut)
def create_template(
    data: InvoiceTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(data.entity_id, current_user)
    tmpl = InvoiceTemplate(
        entity_id=data.entity_id,
        supplier_id=data.supplier_id,
        customer_id=data.customer_id,
        name=data.name,
        document_type=data.document_type,
        is_vat_exempt=data.is_vat_exempt,
        vat_rate=data.vat_rate,
        notes=data.notes,
        print_note=data.print_note,
        terms=data.terms,
    )
    db.add(tmpl)
    db.flush()
    for i, li in enumerate(data.line_items):
        db.add(InvoiceTemplateLineItem(
            template_id=tmpl.id,
            description=li.description,
            is_vat_exempt=li.is_vat_exempt,
            sort_order=i,
            line_type=li.line_type,
            quantity=li.quantity,
            unit_price=li.unit_price,
            amount=li.amount,
        ))
    db.commit()
    return _load_template(tmpl.id, db)


@router.put("/{template_id}", response_model=InvoiceTemplateOut)
def update_template(
    template_id: int,
    data: InvoiceTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tmpl = db.query(InvoiceTemplate).filter(InvoiceTemplate.id == template_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    _check_entity_access(tmpl.entity_id, current_user)

    updates = sent_fields(data, "notes")
    for field in ("supplier_id", "customer_id", "name", "document_type",
                  "is_vat_exempt", "vat_rate", "notes", "print_note", "terms"):
        if field in updates:
            setattr(tmpl, field, updates[field])

    if data.line_items is not None:
        db.query(InvoiceTemplateLineItem).filter(
            InvoiceTemplateLineItem.template_id == template_id
        ).delete()
        for i, li in enumerate(data.line_items):
            db.add(InvoiceTemplateLineItem(
                template_id=template_id,
                description=li.description,
                is_vat_exempt=li.is_vat_exempt,
                sort_order=i,
                line_type=li.line_type,
                quantity=li.quantity,
                unit_price=li.unit_price,
                amount=li.amount,
            ))

    db.commit()
    return _load_template(template_id, db)


@router.delete("/{template_id}")
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tmpl = db.query(InvoiceTemplate).filter(InvoiceTemplate.id == template_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    _check_entity_access(tmpl.entity_id, current_user)
    db.delete(tmpl)
    db.commit()
    return {"ok": True}


@router.post("/{template_id}/clone-payload")
def clone_payload(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a pre-filled InvoiceCreate payload (no amounts) for the frontend to open in the form."""
    tmpl = _load_template(template_id, db)
    _check_entity_access(tmpl.entity_id, current_user)

    today = date.today().isoformat()
    return {
        "entity_id": tmpl.entity_id,
        "supplier_id": tmpl.supplier_id,
        "customer_id": tmpl.customer_id,
        "document_type": tmpl.document_type,
        "is_vat_exempt": tmpl.is_vat_exempt,
        "vat_rate": float(tmpl.vat_rate) if tmpl.vat_rate else 0.15,
        "notes": tmpl.notes,
        "print_note": tmpl.print_note,
        "terms": tmpl.terms,
        "issue_date": today,
        "due_date": None,
        "line_items": [
            {
                "description": li.description or "",
                "quantity": float(li.quantity) if li.quantity is not None else None,
                "unit_price": float(li.unit_price) if li.unit_price is not None else None,
                "amount": float(li.amount) if li.amount is not None else None,
                "is_vat_exempt": li.is_vat_exempt,
                "sort_order": li.sort_order,
                "line_type": li.line_type,
                "loading_number": "",
                "offloading_number": "",
            }
            for li in sorted(tmpl.line_items, key=lambda x: x.sort_order)
        ],
        "supplier": {"id": tmpl.supplier.id, "name": tmpl.supplier.name} if tmpl.supplier else None,
        "customer": {"id": tmpl.customer.id, "name": tmpl.customer.name} if tmpl.customer else None,
        "template_name": tmpl.name,
    }
