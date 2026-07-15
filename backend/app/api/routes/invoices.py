import asyncio
import logging
import os
import re
import zipfile
import httpx
from pathlib import Path
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, extract
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, timezone
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Invoice, InvoiceLineItem, BusinessEntity, Supplier, Customer
from app.schemas.schemas import InvoiceCreate, InvoiceUpdate, InvoiceOut, DashboardStats, InvoiceSummary, EntityProfitLoss
from app.services.audit import log_action
from app.services.invoice_numbering import generate_invoice_number, peek_invoice_number
from app.services.po_number import po_number_for_invoice
from app.services.pdf_generator import generate_invoice_pdf
from app.services.email import send_invoice_email

router = APIRouter(prefix="/api/invoices", tags=["invoices"])
logger = logging.getLogger("safetec.invoices")

# ── PO attachment storage (the source purchase-order document) ────────────────
# Mirrors the supplier-invoice attachment pattern (supplier_invoices.py): files
# are stored privately (never on a public URL) and streamed back through the
# authenticated GET endpoint below. Restricted to PDF only — the whole point of
# this attachment is to be merged into the invoice PDF on download.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ATTACH_BUCKET = "invoices"

DATABASE_URL = os.getenv("DATABASE_URL", "")
IS_LOCAL = DATABASE_URL.startswith("sqlite") or not SUPABASE_URL

LOCAL_ATTACH_DIR = Path(__file__).resolve().parents[3] / "uploads" / "invoices"
MAX_ATTACH_BYTES = 25 * 1024 * 1024  # 25 MB


def _attach_save(invoice_id: int, file_bytes: bytes) -> str:
    """Persist the PO PDF and return its storage key (deterministic per invoice,
    so a re-upload overwrites the previous file)."""
    key = f"inv_{invoice_id}.pdf"
    if IS_LOCAL:
        LOCAL_ATTACH_DIR.mkdir(parents=True, exist_ok=True)
        (LOCAL_ATTACH_DIR / key).write_bytes(file_bytes)
    else:
        upload_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
        resp = httpx.put(
            upload_url, content=file_bytes,
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/pdf",
                "x-upsert": "true",
            },
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"Attachment upload failed: {resp.text}")
    return key


def _attach_read(key: str) -> bytes:
    """Read the stored PO PDF bytes (local disk or private Supabase object)."""
    if IS_LOCAL:
        path = LOCAL_ATTACH_DIR / key
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Attachment file not found")
        return path.read_bytes()
    download_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
    resp = httpx.get(download_url, headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"})
    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Attachment file not found")
    return resp.content


def _attach_delete(key: str) -> None:
    """Remove the stored file. Best-effort: clearing the DB metadata is what matters."""
    if IS_LOCAL:
        try:
            (LOCAL_ATTACH_DIR / key).unlink(missing_ok=True)
        except OSError:
            pass
    else:
        delete_url = f"{SUPABASE_URL}/storage/v1/object/{ATTACH_BUCKET}/{key}"
        try:
            httpx.request("DELETE", delete_url, headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"})
        except httpx.HTTPError:
            pass


def _merge_with_attachment(pdf_bytes: bytes, invoice: Invoice) -> bytes:
    """Append the invoice's attached PO PDF (if any) to its generated PDF, so a
    single download carries both. Best-effort — a missing/corrupt attachment
    falls back to the invoice PDF alone rather than failing the download."""
    if not invoice.attachment_key:
        return pdf_bytes
    try:
        attach_bytes = _attach_read(invoice.attachment_key)
        from pypdf import PdfReader, PdfWriter
        writer = PdfWriter()
        for reader in (PdfReader(BytesIO(pdf_bytes)), PdfReader(BytesIO(attach_bytes))):
            for page in reader.pages:
                writer.add_page(page)
        out = BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        logger.exception(
            "Failed to merge PO attachment (invoice %s, key %s) — falling back to invoice-only PDF",
            invoice.id, invoice.attachment_key,
        )
        return pdf_bytes


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _line_amount(item) -> Decimal:
    """Return the effective amount for a line item.
    header, note, and spacer rows always contribute R 0.
    For item rows: use the explicit amount field when provided (non-zero),
    so PO-import net values are respected; fall back to qty × price only
    when no amount is supplied.
    """
    if getattr(item, 'line_type', 'item') != 'item':
        return Decimal('0')
    if item.amount:
        explicit = Decimal(str(item.amount))
        if explicit != Decimal('0'):
            return explicit.quantize(Decimal("0.01"))
    qty   = item.quantity   if item.quantity   is not None else None
    price = item.unit_price if item.unit_price is not None else None
    if qty is not None and price is not None:
        return (Decimal(str(qty)) * Decimal(str(price))).quantize(Decimal("0.01"))
    return Decimal("0")


def _calculate_totals(line_items_data, vat_rate: Decimal, is_vat_exempt: bool = False):
    subtotal = sum(_line_amount(item) for item in line_items_data)
    if is_vat_exempt:
        vat_amount = Decimal("0")
    else:
        vat_base = sum(
            _line_amount(item) for item in line_items_data
            if not getattr(item, 'is_vat_exempt', False)
        )
        vat_amount = (vat_base * vat_rate).quantize(Decimal("0.01"))
    total = subtotal + vat_amount
    return subtotal.quantize(Decimal("0.01")), vat_amount, total.quantize(Decimal("0.01"))


@router.get("/", response_model=List[InvoiceOut])
def list_invoices(
    entity_id: Optional[int] = Query(None),
    supplier_id: Optional[int] = Query(None),
    customer_id: Optional[int] = Query(None),
    document_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Invoice).options(
        joinedload(Invoice.line_items),
        joinedload(Invoice.supplier),
        joinedload(Invoice.customer),
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
    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    if document_type:
        query = query.filter(Invoice.document_type == document_type)
    if status:
        query = query.filter(Invoice.status == status)
    if month:
        query = query.filter(extract("month", Invoice.issue_date) == month)
    if year:
        query = query.filter(extract("year", Invoice.issue_date) == year)
    if search:
        s = f"%{search}%"
        query = (
            query
            .outerjoin(Supplier, Invoice.supplier_id == Supplier.id)
            .outerjoin(Customer, Invoice.customer_id == Customer.id)
            .filter(or_(
                Invoice.invoice_number.ilike(s),
                Supplier.name.ilike(s),
                Customer.name.ilike(s),
            ))
        )

    return query.order_by(Invoice.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/dashboard", response_model=DashboardStats)
def dashboard_stats(
    entity_id: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
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

    all_docs = base_query.options(
        joinedload(Invoice.supplier), joinedload(Invoice.customer), joinedload(Invoice.entity)
    ).all()

    now = datetime.now(timezone.utc)
    # Period being viewed — defaults to the current month. Issue-based metrics
    # (outstanding/overdue/drafts/breakdown/recent) are scoped to documents issued
    # in this period; "collected" is scoped to documents paid in this period.
    period_month = month or now.month
    period_year  = year or now.year

    def in_period(d):
        return d is not None and d.month == period_month and d.year == period_year

    invoices = [inv for inv in all_docs if in_period(inv.issue_date)]

    outstanding = sum(
        inv.total for inv in invoices
        if inv.status in ("sent", "overdue", "accepted") and inv.document_type == "invoice"
    )
    paid_this_month = sum(
        inv.total for inv in all_docs
        if inv.status == "paid" and in_period(inv.paid_date)
    )
    overdue_count = sum(1 for inv in invoices if inv.status == "overdue")
    draft_count = sum(1 for inv in invoices if inv.status == "draft")
    ready_count = sum(1 for inv in invoices if inv.status == "ready")
    total_invoices = sum(1 for inv in invoices if inv.document_type == "invoice")
    total_quotes = sum(1 for inv in invoices if inv.document_type == "quote")

    def to_summary(inv):
        return InvoiceSummary(
            id=inv.id,
            invoice_number=inv.invoice_number,
            document_type=inv.document_type,
            status=inv.status,
            supplier_name=(inv.supplier.name if inv.supplier else (inv.customer.name if inv.customer else None)),
            customer_name=(inv.customer.name if inv.customer else None),
            entity_code=inv.entity.code if inv.entity else None,
            total=inv.total,
            issue_date=inv.issue_date,
            due_date=inv.due_date,
            paid_date=inv.paid_date,
        )

    recent = sorted(invoices, key=lambda x: x.created_at or datetime.min, reverse=True)[:8]
    recent_out = [to_summary(inv) for inv in recent]

    # Itemized proof for the Debtors drill-down modals — same filters used above
    # to compute outstanding_total / paid_this_month.
    outstanding_invoices_list = sorted(
        (inv for inv in invoices if inv.status in ("sent", "overdue", "accepted") and inv.document_type == "invoice"),
        key=lambda x: x.issue_date or datetime.min, reverse=True,
    )
    paid_invoices_list = sorted(
        (inv for inv in all_docs if inv.status == "paid" and in_period(inv.paid_date)),
        key=lambda x: x.paid_date or datetime.min, reverse=True,
    )
    outstanding_invoices_out = [to_summary(inv) for inv in outstanding_invoices_list]
    paid_invoices_out = [to_summary(inv) for inv in paid_invoices_list]

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
        outstanding_invoices=outstanding_invoices_out,
        paid_invoices=paid_invoices_out,
    )


# Entities that get a profit/loss panel on the dashboard, in display order.
_PROFIT_LOSS_ENTITY_CODES = ["BTP", "TP"]


@router.get("/profit-loss", response_model=List[EntityProfitLoss])
def profit_loss_summary(
    entity_id: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Per-entity profit/loss for Border Trade Post (BTP) and Thembi (TP), scoped to
    the selected statement period. When an entity_id is given, only that entity's
    panel is returned (empty if it isn't BTP/TP) so each entity dashboard shows
    only its own figures.

    Invoices generated : every invoice (not quotes) issued in the period, any status
                         except cancelled, incl. VAT (Invoice.total).
    Supplier invoices  : every supplier invoice whose statement period falls in the
                         month (falling back to invoice_date), excl. archived, full
                         amount.
    Profit/loss        : invoices_total − supplier_invoices_total.

    Each side also carries the rows it was summed from, so the dashboard card can
    show exactly which invoices make up the figure.
    """
    from sqlalchemy import func
    from app.models.models import SupplierInvoice, DocumentType, InvoiceStatus
    from app.schemas.schemas import SupplierInvoiceLineSummary

    now = datetime.now(timezone.utc)
    period_month = month or now.month
    period_year  = year or now.year

    entities = (
        db.query(BusinessEntity)
        .filter(BusinessEntity.code.in_(_PROFIT_LOSS_ENTITY_CODES))
        .all()
    )
    if entity_id:
        entities = [e for e in entities if e.id == entity_id]
    if current_user.role != "admin":
        access_ids = {a.entity_id for a in current_user.entity_access}
        entities = [e for e in entities if e.id in access_ids]
    if not entities:
        return []

    entity_ids = [e.id for e in entities]

    invoices = (
        db.query(Invoice)
        .options(joinedload(Invoice.supplier), joinedload(Invoice.customer), joinedload(Invoice.entity))
        .filter(
            Invoice.entity_id.in_(entity_ids),
            Invoice.document_type == DocumentType.invoice,
            Invoice.status != InvoiceStatus.cancelled,
            func.extract("month", Invoice.issue_date) == period_month,
            func.extract("year", Invoice.issue_date) == period_year,
        )
        .order_by(Invoice.issue_date.desc())
        .all()
    )
    inv_by_entity: dict = {}
    for inv in invoices:
        inv_by_entity.setdefault(inv.entity_id, []).append(InvoiceSummary(
            id=inv.id,
            invoice_number=inv.invoice_number,
            document_type=inv.document_type,
            status=inv.status,
            supplier_name=(inv.supplier.name if inv.supplier else (inv.customer.name if inv.customer else None)),
            customer_name=(inv.customer.name if inv.customer else None),
            entity_code=inv.entity.code if inv.entity else None,
            total=inv.total,
            issue_date=inv.issue_date,
            due_date=inv.due_date,
            paid_date=inv.paid_date,
        ))

    sup_invoices = (
        db.query(SupplierInvoice)
        .options(joinedload(SupplierInvoice.supplier), joinedload(SupplierInvoice.entity))
        .filter(
            SupplierInvoice.entity_id.in_(entity_ids),
            SupplierInvoice.is_archived != True,
            func.coalesce(
                SupplierInvoice.statement_month,
                func.extract("month", SupplierInvoice.invoice_date),
            ) == period_month,
            func.coalesce(
                SupplierInvoice.statement_year,
                func.extract("year", SupplierInvoice.invoice_date),
            ) == period_year,
        )
        .order_by(SupplierInvoice.invoice_date.desc())
        .all()
    )
    sup_by_entity: dict = {}
    for si in sup_invoices:
        sup_by_entity.setdefault(si.entity_id, []).append(SupplierInvoiceLineSummary(
            id=si.id,
            invoice_number=si.invoice_number,
            supplier_id=si.supplier_id,
            supplier_name=si.supplier.name if si.supplier else (si.supplier_name_text or "—"),
            entity_code=si.entity.code if si.entity else None,
            invoice_date=si.invoice_date,
            amount=Decimal(str(si.amount)),
            outstanding_amount=Decimal(str(si.amount)) - Decimal(str(si.deposit_paid or 0)),
            statement_month=si.statement_month,
            statement_year=si.statement_year,
            due_date=si.payment_due_date,
            paid_date=si.paid_date,
        ))

    order = {code: i for i, code in enumerate(_PROFIT_LOSS_ENTITY_CODES)}
    entities.sort(key=lambda e: order.get(e.code, len(order)))

    out: List[EntityProfitLoss] = []
    for e in entities:
        inv_lines = inv_by_entity.get(e.id, [])
        sup_lines = sup_by_entity.get(e.id, [])
        inv_total = sum((l.total for l in inv_lines), Decimal("0"))
        sup_total = sum((l.amount for l in sup_lines), Decimal("0"))
        out.append(EntityProfitLoss(
            entity_id=e.id,
            entity_code=e.code,
            entity_name=e.name,
            invoices_total=inv_total,
            invoices_count=len(inv_lines),
            supplier_invoices_total=sup_total,
            supplier_invoices_count=len(sup_lines),
            profit_loss=inv_total - sup_total,
            invoices=inv_lines,
            supplier_invoices=sup_lines,
        ))
    return out


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).options(
        joinedload(Invoice.line_items),
        joinedload(Invoice.supplier),
        joinedload(Invoice.customer),
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

    if not payload.supplier_id and not payload.customer_id:
        raise HTTPException(status_code=422, detail="Either supplier_id or customer_id is required")

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    recipient_name = "Unknown"
    if payload.supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
        recipient_name = supplier.name
    if payload.customer_id:
        customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")
        recipient_name = customer.name

    vat_rate = payload.vat_rate if payload.vat_rate is not None else (entity.vat_rate if entity.vat_rate is not None else Decimal("0.15"))

    try:
        # If the caller supplied an invoice number that differs from the auto value
        # (e.g. a PO-import where the user typed a custom number in the editable field),
        # honor it instead of auto-generating — and don't burn a counter value.
        # Otherwise fall back to the per-entity auto sequence.
        provided = (payload.invoice_number or "").strip()
        if provided and provided != peek_invoice_number(db, payload.entity_id, payload.document_type):
            if db.query(Invoice).filter(Invoice.invoice_number == provided).first():
                raise HTTPException(status_code=400, detail=f"Invoice number '{provided}' is already in use.")
            invoice_number = provided
        else:
            invoice_number = generate_invoice_number(db, payload.entity_id, payload.document_type)
        subtotal, vat_amount, total = _calculate_totals(payload.line_items, vat_rate, payload.is_vat_exempt)

        invoice = Invoice(
            entity_id=payload.entity_id,
            supplier_id=payload.supplier_id,
            customer_id=payload.customer_id,
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
            po_number=po_number_for_invoice(payload.notes, payload.line_items),
        )
        db.add(invoice)
        db.flush()

        for i, item_data in enumerate(payload.line_items):
            item = InvoiceLineItem(
                invoice_id=invoice.id,
                description=item_data.description,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                amount=_line_amount(item_data),
                is_vat_exempt=item_data.is_vat_exempt,
                sort_order=item_data.sort_order or i,
                line_type=item_data.line_type,
                loading_number=item_data.loading_number,
                offloading_number=item_data.offloading_number,
            )
            db.add(item)

        doc_label = "Invoice" if payload.document_type == "invoice" else "Quote"
        log_action(
            db, f"{payload.document_type}.created", user_id=current_user.id,
            entity_id=payload.entity_id, resource_type="invoice",
            resource_id=invoice.id,
            description=f"{doc_label} {invoice_number} created for {recipient_name} — R {total:,.2f}",
        )
        db.commit()
        db.refresh(invoice)
        return db.query(Invoice).options(
            joinedload(Invoice.line_items),
            joinedload(Invoice.supplier),
            joinedload(Invoice.customer),
            joinedload(Invoice.entity),
        ).filter(Invoice.id == invoice.id).first()
    except SQLAlchemyError as e:
        db.rollback()
        detail = str(e.orig) if hasattr(e, 'orig') and e.orig else "Failed to create invoice"
        raise HTTPException(status_code=500, detail=detail)


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

    # A paid invoice is locked against content edits, but its status may be
    # reverted (e.g. it was marked paid by mistake). Allow the request only
    # when it changes the status away from "paid"; block plain field edits.
    if invoice.status == "paid" and not (payload.status and payload.status != "paid"):
        raise HTTPException(
            status_code=400,
            detail="Cannot edit a paid invoice. Change its status first if you need to make corrections.",
        )

    # invoice_number is globally unique — guard a collision with a clear message
    # instead of letting the DB raise an opaque IntegrityError on flush.
    new_num = (payload.invoice_number or "").strip()
    if new_num and new_num != invoice.invoice_number:
        clash = db.query(Invoice).filter(
            Invoice.invoice_number == new_num,
            Invoice.id != invoice_id,
        ).first()
        if clash:
            raise HTTPException(
                status_code=400,
                detail=f"Invoice number '{new_num}' is already in use by another document.",
            )

    try:
        old_status = invoice.status
        update_data = payload.model_dump(exclude={"line_items"}, exclude_none=True)
        for field, value in update_data.items():
            setattr(invoice, field, value)

        # Reverting a paid invoice clears the recorded payment so it stays consistent.
        if old_status == "paid" and invoice.status != "paid":
            invoice.paid_date = None
            invoice.payment_reference = None

        if payload.line_items is not None:
            db.query(InvoiceLineItem).filter(InvoiceLineItem.invoice_id == invoice_id).delete()
            entity = db.query(BusinessEntity).filter(BusinessEntity.id == invoice.entity_id).first()
            for i, item_data in enumerate(payload.line_items):
                db.add(InvoiceLineItem(
                    invoice_id=invoice.id,
                    description=item_data.description,
                    quantity=item_data.quantity,
                    unit_price=item_data.unit_price,
                    amount=_line_amount(item_data),
                    is_vat_exempt=item_data.is_vat_exempt,
                    sort_order=item_data.sort_order or i,
                    line_type=item_data.line_type,
                    loading_number=item_data.loading_number,
                    offloading_number=item_data.offloading_number,
                ))
            subtotal, vat_amount, total = _calculate_totals(payload.line_items, invoice.vat_rate, invoice.is_vat_exempt)
            invoice.subtotal = subtotal
            invoice.vat_amount = vat_amount
            invoice.total = total

        # The PO number lives in the notes / header line item, so re-derive it
        # whenever either could have changed — an edit that removes the PO Ref
        # must drop the link, not leave a stale one behind.
        if payload.notes is not None or payload.line_items is not None:
            items = payload.line_items if payload.line_items is not None else (
                db.query(InvoiceLineItem)
                .filter(InvoiceLineItem.invoice_id == invoice_id)
                .order_by(InvoiceLineItem.sort_order)
                .all()
            )
            invoice.po_number = po_number_for_invoice(invoice.notes, items)

        if invoice.supplier_id:
            inv_rec = db.query(Supplier).filter(Supplier.id == invoice.supplier_id).first()
            inv_rec_name = inv_rec.name if inv_rec else "Unknown"
        elif invoice.customer_id:
            inv_rec = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
            inv_rec_name = inv_rec.name if inv_rec else "Unknown"
        else:
            inv_rec_name = "Unknown"
        status_note = f" — status changed to '{invoice.status}'" if payload.status and payload.status != old_status else ""
        log_action(db, "invoice.updated", user_id=current_user.id,
                   entity_id=invoice.entity_id, resource_type="invoice",
                   resource_id=invoice_id,
                   description=f"Updated {invoice.invoice_number} for {inv_rec_name}{status_note}")
        db.commit()
        return db.query(Invoice).options(
            joinedload(Invoice.line_items),
            joinedload(Invoice.supplier),
            joinedload(Invoice.customer),
            joinedload(Invoice.entity),
        ).filter(Invoice.id == invoice.id).first()
    except SQLAlchemyError as e:
        db.rollback()
        detail = str(e.orig) if getattr(e, 'orig', None) else "Failed to update invoice"
        raise HTTPException(status_code=500, detail=detail)


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
    if invoice.supplier_id:
        del_rec = db.query(Supplier).filter(Supplier.id == invoice.supplier_id).first()
        del_rec_name = del_rec.name if del_rec else "Unknown"
    elif invoice.customer_id:
        del_rec = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
        del_rec_name = del_rec.name if del_rec else "Unknown"
    else:
        del_rec_name = "Unknown"
    log_action(db, "invoice.deleted", user_id=current_user.id,
               entity_id=invoice.entity_id, resource_type="invoice",
               resource_id=invoice_id,
               description=f"Deleted {invoice.invoice_number} for {del_rec_name}")
    db.delete(invoice)
    db.commit()
    return {"detail": "Invoice deleted"}


@router.get("/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: int,
    theme: str = Query("dark", pattern="^(dark|light)$"),
    include_attachment: bool = Query(True, description="Merge the attached PO into the download when present"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).options(
        joinedload(Invoice.line_items),
        joinedload(Invoice.supplier),
        joinedload(Invoice.customer),
        joinedload(Invoice.entity),
    ).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)

    def _build():
        pdf_bytes = generate_invoice_pdf(
            invoice, invoice.entity, invoice.supplier, customer=invoice.customer, theme=theme
        )
        if include_attachment:
            pdf_bytes = _merge_with_attachment(pdf_bytes, invoice)
        return pdf_bytes

    pdf_bytes = await asyncio.to_thread(_build)

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


# ── PO attachment (the source purchase-order document) ────────────────────────

@router.post("/{invoice_id}/attachment", response_model=InvoiceOut)
async def upload_invoice_attachment(
    invoice_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).options(
        joinedload(Invoice.line_items), joinedload(Invoice.supplier),
        joinedload(Invoice.customer), joinedload(Invoice.entity),
    ).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)

    if (file.content_type or "").lower() != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(file_bytes) > MAX_ATTACH_BYTES:
        raise HTTPException(status_code=400, detail="Attachment must be under 25MB")

    key = _attach_save(invoice_id, file_bytes)

    invoice.attachment_key = key
    invoice.attachment_filename = file.filename or f"invoice_{invoice_id}.pdf"
    invoice.attachment_content_type = "application/pdf"
    invoice.attachment_size = len(file_bytes)
    invoice.attachment_uploaded_at = datetime.now(timezone.utc)
    invoice.attachment_uploaded_by_id = current_user.id

    log_action(
        db, "invoice.attachment_added", user_id=current_user.id,
        entity_id=invoice.entity_id, resource_type="invoice", resource_id=invoice.id,
        description=f"Attached PO document '{invoice.attachment_filename}' to invoice {invoice.invoice_number}",
    )
    db.commit()
    db.refresh(invoice)
    return invoice


@router.get("/{invoice_id}/attachment")
def view_invoice_attachment(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)
    if not invoice.attachment_key:
        raise HTTPException(status_code=404, detail="No attachment for this invoice")

    file_bytes = _attach_read(invoice.attachment_key)
    filename = invoice.attachment_filename or invoice.attachment_key
    return Response(
        content=file_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete("/{invoice_id}/attachment")
def delete_invoice_attachment(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)
    if not invoice.attachment_key:
        raise HTTPException(status_code=404, detail="No attachment for this invoice")

    removed_name = invoice.attachment_filename
    _attach_delete(invoice.attachment_key)
    invoice.attachment_key = None
    invoice.attachment_filename = None
    invoice.attachment_content_type = None
    invoice.attachment_size = None
    invoice.attachment_uploaded_at = None
    invoice.attachment_uploaded_by_id = None

    log_action(
        db, "invoice.attachment_removed", user_id=current_user.id,
        entity_id=invoice.entity_id, resource_type="invoice", resource_id=invoice.id,
        description=f"Removed PO document '{removed_name}' from invoice {invoice.invoice_number}",
    )
    db.commit()
    return {"detail": "Attachment removed"}


class BulkPdfRequest(BaseModel):
    invoice_ids: List[int] = Field(..., min_length=1, max_length=500)
    merge: bool = False  # True → single combined PDF; False → ZIP of separate PDFs
    include_attachments: bool = True  # merge each invoice's attached PO into its PDF when present


def _safe_filename(name: str) -> str:
    """Strip characters that are unsafe in a download filename (slashes etc.)."""
    return re.sub(r'[^A-Za-z0-9._-]', '_', (name or 'invoice').strip()) or 'invoice'


@router.post("/bulk-pdf")
async def download_invoices_bulk_pdf(
    payload: BulkPdfRequest,
    theme: str = Query("dark", pattern="^(dark|light)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download many invoices at once — either a ZIP of individual PDFs
    (merge=False) or a single merged PDF (merge=True)."""
    # Preserve the order the client requested, de-duplicating ids.
    ordered_ids = list(dict.fromkeys(payload.invoice_ids))

    invoices = db.query(Invoice).options(
        joinedload(Invoice.line_items),
        joinedload(Invoice.supplier),
        joinedload(Invoice.customer),
        joinedload(Invoice.entity),
    ).filter(Invoice.id.in_(ordered_ids)).all()

    by_id = {inv.id: inv for inv in invoices}
    selected = []
    for inv_id in ordered_ids:
        inv = by_id.get(inv_id)
        if not inv:
            raise HTTPException(status_code=404, detail=f"Invoice {inv_id} not found")
        _check_entity_access(inv.entity_id, current_user)
        selected.append(inv)

    def _build():
        rendered = []  # (invoice, pdf_bytes)
        for inv in selected:
            pdf_bytes = generate_invoice_pdf(
                inv, inv.entity, inv.supplier, customer=inv.customer, theme=theme
            )
            if payload.include_attachments:
                pdf_bytes = _merge_with_attachment(pdf_bytes, inv)
            rendered.append((inv, pdf_bytes))

        if payload.merge:
            from pypdf import PdfReader, PdfWriter
            writer = PdfWriter()
            for _inv, pdf_bytes in rendered:
                reader = PdfReader(BytesIO(pdf_bytes))
                for page in reader.pages:
                    writer.add_page(page)
            out = BytesIO()
            writer.write(out)
            return out.getvalue()

        # ZIP of separate PDFs — disambiguate duplicate invoice numbers.
        buf = BytesIO()
        used = {}
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for inv, pdf_bytes in rendered:
                base = _safe_filename(inv.invoice_number)
                used[base] = used.get(base, 0) + 1
                name = base if used[base] == 1 else f"{base}_{used[base]}"
                zf.writestr(f"{name}.pdf", pdf_bytes)
        return buf.getvalue()

    content = await asyncio.to_thread(_build)

    # Advance any drafts → ready, mirroring the single-PDF endpoint.
    drafted = False
    for inv in selected:
        if inv.status == "draft":
            inv.status = "ready"
            log_action(db, "invoice.ready", user_id=current_user.id,
                       entity_id=inv.entity_id, resource_type="invoice",
                       resource_id=inv.id,
                       description=f"{inv.invoice_number} marked as ready (PDF generated)")
            drafted = True
    if drafted:
        db.commit()

    stamp = datetime.now().strftime("%Y%m%d")
    if payload.merge:
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="invoices-merged-{stamp}.pdf"'},
        )
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="invoices-{stamp}.zip"'},
    )


@router.post("/split-pos")
async def split_po_pdf(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Split a combined Tradekor PO PDF into one PDF per purchase order.

    Each page carries its own order number (POH...). Consecutive pages sharing
    the same number belong to the same PO; a page with no detectable number is
    treated as a continuation of the current PO. Returns a ZIP of the split
    PDFs named by PO number. Nothing is stored — pure split-and-download.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    def _build():
        from pypdf import PdfReader, PdfWriter
        try:
            reader = PdfReader(BytesIO(content))
        except Exception:
            raise HTTPException(status_code=400, detail="Could not read the PDF. Make sure it is a valid PO file.")

        # Group consecutive pages by their order number.
        groups = []  # [{"po_number": str, "pages": [int]}]
        current = None
        for i, page in enumerate(reader.pages):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            m = re.search(r"POH\s*\d{6,}", text)
            po = m.group(0).replace(" ", "").upper() if m else None
            if po:
                if current is None or current["po_number"] != po:
                    current = {"po_number": po, "pages": []}
                    groups.append(current)
                current["pages"].append(i)
            else:
                # Continuation page with no number — keep it with the current PO.
                if current is None:
                    current = {"po_number": f"PO_{i + 1}", "pages": []}
                    groups.append(current)
                current["pages"].append(i)

        if not groups:
            raise HTTPException(
                status_code=422,
                detail="No purchase orders found. The PDF has no readable POH order numbers.",
            )

        buf = BytesIO()
        used = {}
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for g in groups:
                writer = PdfWriter()
                for idx in g["pages"]:
                    writer.add_page(reader.pages[idx])
                out = BytesIO()
                writer.write(out)
                base = _safe_filename(g["po_number"])
                used[base] = used.get(base, 0) + 1
                name = base if used[base] == 1 else f"{base}_{used[base]}"
                zf.writestr(f"{name}.pdf", out.getvalue())
        return buf.getvalue(), len(groups)

    payload, count = await asyncio.to_thread(_build)

    stamp = datetime.now().strftime("%Y%m%d")
    return Response(
        content=payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="split-pos-{stamp}.zip"',
            "X-PO-Count": str(count),
        },
    )


@router.post("/{invoice_id}/send-email", status_code=200)
async def send_invoice_email_endpoint(
    invoice_id: int,
    theme: str = Query("dark", pattern="^(dark|light)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).options(
        joinedload(Invoice.line_items),
        joinedload(Invoice.supplier),
        joinedload(Invoice.customer),
        joinedload(Invoice.entity),
    ).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _check_entity_access(invoice.entity_id, current_user)

    recipient = invoice.supplier or invoice.customer
    if not recipient or not recipient.email:
        raise HTTPException(status_code=422, detail="Supplier/customer has no email address")

    def _build():
        pdf_bytes = generate_invoice_pdf(
            invoice, invoice.entity, invoice.supplier, customer=invoice.customer, theme=theme
        )
        return _merge_with_attachment(pdf_bytes, invoice)

    pdf_bytes = await asyncio.to_thread(_build)
    send_invoice_email(
        to=recipient.email,
        invoice_number=invoice.invoice_number,
        document_type=invoice.document_type,
        supplier_name=recipient.name,
        pdf_bytes=pdf_bytes,
    )
    doc_label = "Invoice" if invoice.document_type == "invoice" else "Quote"

    # Mark as sent when emailed via the app
    if invoice.status in ("draft", "ready"):
        invoice.status = "sent"

    log_action(db, "invoice.emailed", user_id=current_user.id,
               entity_id=invoice.entity_id, resource_type="invoice",
               resource_id=invoice_id,
               description=f"{doc_label} {invoice.invoice_number} emailed to {recipient.name} ({recipient.email})")
    db.commit()
    return {"detail": "Email sent"}
