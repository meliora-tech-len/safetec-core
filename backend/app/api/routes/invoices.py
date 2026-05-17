import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, timezone
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Invoice, InvoiceLineItem, BusinessEntity, Supplier
from app.schemas.schemas import InvoiceCreate, InvoiceUpdate, InvoiceOut, DashboardStats, InvoiceSummary
from app.services.audit import log_action
from app.services.invoice_numbering import generate_invoice_number
from app.services.pdf_generator import generate_invoice_pdf
from app.services.email import send_invoice_email

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _calculate_totals(line_items_data, vat_rate: Decimal, is_vat_exempt: bool = False):
    subtotal = sum(
        Decimal(str(item.quantity)) * Decimal(str(item.unit_price))
        for item in line_items_data
    )
    if is_vat_exempt:
        vat_amount = Decimal("0")
    else:
        vat_base = sum(
            Decimal(str(item.quantity)) * Decimal(str(item.unit_price))
            for item in line_items_data
            if not getattr(item, 'is_vat_exempt', False)
        )
        vat_amount = (vat_base * vat_rate).quantize(Decimal("0.01"))
    total = subtotal + vat_amount
    return subtotal.quantize(Decimal("0.01")), vat_amount, total.quantize(Decimal("0.01"))


@router.get("/", response_model=List[InvoiceOut])
def list_invoices(
    entity_id: Optional[int] = Query(None),
    supplier_id: Optional[int] = Query(None),
    document_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Invoice).options(
        joinedload(Invoice.line_items),
        joinedload(Invoice.supplier),
        joinedload(Invoice.entity),
    )

    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(Invoice.entity_id.in_(access_ids))

    if entity_id:
        _check_entity_access(entity_id, current_user)
        query = query.filter(Invoice.entity_id == entity_id)
    if supplier_id:
        query = query.filter(Invoice.supplier_id == supplier_id)
    if document_type:
        query = query.filter(Invoice.document_type == document_type)
    if status:
        query = query.filter(Invoice.status == status)
    if search:
        s = f"%{search}%"
        query = query.join(Supplier, isouter=True).filter(
            or_(Invoice.invoice_number.ilike(s), Supplier.name.ilike(s))
        )

    return query.order_by(Invoice.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/dashboard", response_model=DashboardStats)
def dashboard_stats(
    entity_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import func
    from app.models.models import InvoiceStatus

    base_query = db.query(Invoice)
    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        base_query = base_query.filter(Invoice.entity_id.in_(access_ids))
    if entity_id:
        base_query = base_query.filter(Invoice.entity_id == entity_id)

    invoices = base_query.options(joinedload(Invoice.supplier), joinedload(Invoice.entity)).all()

    now = datetime.now(timezone.utc)
    outstanding = sum(
        inv.total for inv in invoices
        if inv.status in ("sent", "overdue") and inv.document_type == "invoice"
    )
    paid_this_month = sum(
        inv.total for inv in invoices
        if inv.status == "paid"
        and inv.paid_date
        and inv.paid_date.month == now.month
        and inv.paid_date.year == now.year
    )
    overdue_count = sum(1 for inv in invoices if inv.status == "overdue")
    draft_count = sum(1 for inv in invoices if inv.status == "draft")
    ready_count = sum(1 for inv in invoices if inv.status == "ready")
    total_invoices = sum(1 for inv in invoices if inv.document_type == "invoice")
    total_quotes = sum(1 for inv in invoices if inv.document_type == "quote")

    recent = sorted(invoices, key=lambda x: x.created_at or datetime.min, reverse=True)[:8]
    recent_out = []
    for inv in recent:
        recent_out.append(InvoiceSummary(
            id=inv.id,
            invoice_number=inv.invoice_number,
            document_type=inv.document_type,
            status=inv.status,
            supplier_name=inv.supplier.name if inv.supplier else None,
            entity_code=inv.entity.code if inv.entity else None,
            total=inv.total,
            issue_date=inv.issue_date,
            due_date=inv.due_date,
        ))

    # Entity breakdown
    entity_map = {}
    for inv in invoices:
        if inv.entity_id not in entity_map:
            entity_map[inv.entity_id] = {
                "entity_id": inv.entity_id,
                "entity_code": inv.entity.code if inv.entity else "",
                "entity_name": inv.entity.name if inv.entity else "",
                "total_invoiced": Decimal("0"),
                "invoice_count": 0,
            }
        entity_map[inv.entity_id]["total_invoiced"] += inv.total
        entity_map[inv.entity_id]["invoice_count"] += 1

    return DashboardStats(
        total_invoices=total_invoices,
        total_quotes=total_quotes,
        outstanding_total=Decimal(str(outstanding)),
        paid_this_month=Decimal(str(paid_this_month)),
        overdue_count=overdue_count,
        draft_count=draft_count,
        ready_count=ready_count,
        recent_invoices=recent_out,
        entity_breakdown=list(entity_map.values()),
    )


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).options(
        joinedload(Invoice.line_items),
        joinedload(Invoice.supplier),
        joinedload(Invoice.entity),
    ).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)
    return invoice


@router.post("/", response_model=InvoiceOut)
def create_invoice(
    payload: InvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    invoice_number = generate_invoice_number(db, payload.entity_id, payload.document_type)

    vat_rate = payload.vat_rate if payload.vat_rate is not None else entity.vat_rate
    subtotal, vat_amount, total = _calculate_totals(payload.line_items, vat_rate, payload.is_vat_exempt)

    try:
        invoice = Invoice(
            entity_id=payload.entity_id,
            supplier_id=payload.supplier_id,
            document_type=payload.document_type,
            invoice_number=invoice_number,
            status=payload.status,
            is_vat_exempt=payload.is_vat_exempt,
            issue_date=payload.issue_date or datetime.now(timezone.utc),
            due_date=payload.due_date,
            notes=payload.notes,
            terms=payload.terms,
            subtotal=subtotal,
            vat_amount=vat_amount,
            total=total,
            vat_rate=vat_rate,
        )
        db.add(invoice)
        db.flush()

        for i, item_data in enumerate(payload.line_items):
            amount = (Decimal(str(item_data.quantity)) * Decimal(str(item_data.unit_price))).quantize(Decimal("0.01"))
            item = InvoiceLineItem(
                invoice_id=invoice.id,
                description=item_data.description,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                amount=amount,
                is_vat_exempt=item_data.is_vat_exempt,
                sort_order=item_data.sort_order or i,
            )
            db.add(item)

        doc_label = "Invoice" if payload.document_type == "invoice" else "Quote"
        log_action(
            db, f"{payload.document_type}.created", user_id=current_user.id,
            entity_id=payload.entity_id, resource_type="invoice",
            resource_id=invoice.id,
            description=f"{doc_label} {invoice_number} created for {supplier.name} — R {total:,.2f}",
        )
        db.commit()
        db.refresh(invoice)
        return db.query(Invoice).options(
            joinedload(Invoice.line_items), joinedload(Invoice.supplier), joinedload(Invoice.entity)
        ).filter(Invoice.id == invoice.id).first()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create invoice")


@router.put("/{invoice_id}", response_model=InvoiceOut)
def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)

    if invoice.status == "paid":
        raise HTTPException(status_code=400, detail="Cannot edit a paid invoice")

    try:
        old_status = invoice.status
        update_data = payload.model_dump(exclude={"line_items"}, exclude_none=True)
        for field, value in update_data.items():
            setattr(invoice, field, value)

        if payload.line_items is not None:
            db.query(InvoiceLineItem).filter(InvoiceLineItem.invoice_id == invoice_id).delete()
            entity = db.query(BusinessEntity).filter(BusinessEntity.id == invoice.entity_id).first()
            for i, item_data in enumerate(payload.line_items):
                amount = (Decimal(str(item_data.quantity)) * Decimal(str(item_data.unit_price))).quantize(Decimal("0.01"))
                db.add(InvoiceLineItem(
                    invoice_id=invoice.id,
                    description=item_data.description,
                    quantity=item_data.quantity,
                    unit_price=item_data.unit_price,
                    amount=amount,
                    is_vat_exempt=item_data.is_vat_exempt,
                    sort_order=item_data.sort_order or i,
                ))
            subtotal, vat_amount, total = _calculate_totals(payload.line_items, invoice.vat_rate, invoice.is_vat_exempt)
            invoice.subtotal = subtotal
            invoice.vat_amount = vat_amount
            invoice.total = total

        inv_supplier = db.query(Supplier).filter(Supplier.id == invoice.supplier_id).first()
        inv_supplier_name = inv_supplier.name if inv_supplier else "Unknown"
        status_note = f" — status changed to '{invoice.status}'" if payload.status and payload.status != old_status else ""
        log_action(db, "invoice.updated", user_id=current_user.id,
                   entity_id=invoice.entity_id, resource_type="invoice",
                   resource_id=invoice_id,
                   description=f"Updated {invoice.invoice_number} for {inv_supplier_name}{status_note}")
        db.commit()
        return db.query(Invoice).options(
            joinedload(Invoice.line_items), joinedload(Invoice.supplier), joinedload(Invoice.entity)
        ).filter(Invoice.id == invoice.id).first()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update invoice")


@router.delete("/{invoice_id}")
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)
    if invoice.status == "paid":
        raise HTTPException(status_code=400, detail="Cannot delete a paid invoice")
    invoice.status = "cancelled"
    cancelled_supplier = db.query(Supplier).filter(Supplier.id == invoice.supplier_id).first()
    cancelled_supplier_name = cancelled_supplier.name if cancelled_supplier else "Unknown"
    log_action(db, "invoice.cancelled", user_id=current_user.id,
               entity_id=invoice.entity_id, resource_type="invoice",
               resource_id=invoice_id,
               description=f"Cancelled {invoice.invoice_number} for {cancelled_supplier_name}")
    db.commit()
    return {"detail": "Invoice cancelled"}


@router.get("/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: int,
    theme: str = Query("dark", pattern="^(dark|light)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).options(
        joinedload(Invoice.line_items), joinedload(Invoice.supplier), joinedload(Invoice.entity)
    ).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)

    pdf_bytes = await asyncio.to_thread(
        generate_invoice_pdf, invoice, invoice.entity, invoice.supplier, theme=theme
    )

    # Advance draft → ready on first PDF generation
    if invoice.status == "draft":
        invoice.status = "ready"
        log_action(db, "invoice.ready", user_id=current_user.id,
                   entity_id=invoice.entity_id, resource_type="invoice",
                   resource_id=invoice_id,
                   description=f"{invoice.invoice_number} marked as ready (PDF generated)")
        db.commit()

    filename = f"{invoice.invoice_number}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{invoice_id}/send-email", status_code=200)
async def send_invoice_email_endpoint(
    invoice_id: int,
    theme: str = Query("dark", pattern="^(dark|light)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).options(
        joinedload(Invoice.line_items), joinedload(Invoice.supplier), joinedload(Invoice.entity)
    ).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)

    if not invoice.supplier or not invoice.supplier.email:
        raise HTTPException(status_code=422, detail="Supplier has no email address")

    pdf_bytes = await asyncio.to_thread(
        generate_invoice_pdf, invoice, invoice.entity, invoice.supplier, theme=theme
    )
    send_invoice_email(
        to=invoice.supplier.email,
        invoice_number=invoice.invoice_number,
        document_type=invoice.document_type,
        supplier_name=invoice.supplier.name,
        pdf_bytes=pdf_bytes,
    )
    doc_label = "Invoice" if invoice.document_type == "invoice" else "Quote"

    # Mark as sent when emailed via the app
    if invoice.status in ("draft", "ready"):
        invoice.status = "sent"

    log_action(db, "invoice.emailed", user_id=current_user.id,
               entity_id=invoice.entity_id, resource_type="invoice",
               resource_id=invoice_id,
               description=f"{doc_label} {invoice.invoice_number} emailed to {invoice.supplier.name} ({invoice.supplier.email})")
    db.commit()
    return {"detail": "Email sent"}
