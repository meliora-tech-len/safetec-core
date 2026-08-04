from sqlalchemy.orm import Session
from app.models.models import BusinessEntity, Invoice


def prefix_for(entity: BusinessEntity, document_type: str) -> str:
    if document_type == "quote":
        return entity.quote_prefix or "QT"
    if document_type == "purchase_order":
        return entity.po_prefix or "PO"
    return entity.invoice_prefix or entity.code or "INV"


def padding_for(entity: BusinessEntity, document_type: str) -> int:
    """Digit width for the numeric part.

    POs may set their own; NULL means fall back to the entity-wide setting
    (BTP: invoices unpadded, POs two-digit).
    """
    if document_type == "purchase_order" and entity.po_number_padding is not None:
        return entity.po_number_padding
    return entity.invoice_number_padding if entity.invoice_number_padding is not None else 5


def format_number(prefix: str, counter: int, padding: int) -> str:
    """Build a document number, zero-padding the counter to `padding` digits.
    padding=0 means no padding (BTP739); padding=5 is legacy (OBHI03667)."""
    pad = padding if padding is not None else 5
    return f"{prefix}{counter:0{pad}d}"


def resolve_next_number(db: Session, entity: BusinessEntity, document_type: str):
    """
    Return (prefix, counter, number) for the next auto number, skipping any
    numbers already taken (typed manually on an invoice, or the counter was
    lowered in Settings). Does NOT advance the stored counter.
    """
    prefix = prefix_for(entity, document_type)
    padding = padding_for(entity, document_type)
    if document_type == "quote":
        counter = (entity.quote_counter or 0) + 1
    elif document_type == "purchase_order":
        # POs run their own sequence (migration 128); before that they shared
        # the invoice counter, which suggested PO775 on an entity whose POs
        # were actually PO01..PO03.
        counter = (entity.po_counter or 0) + 1
    else:
        counter = (entity.invoice_counter or 0) + 1
    while db.query(Invoice.id).filter(Invoice.invoice_number == format_number(prefix, counter, padding)).first():
        counter += 1
    return prefix, counter, format_number(prefix, counter, padding)


def peek_invoice_number(db: Session, entity_id: int, document_type: str = "invoice") -> str:
    """
    Return what the *next* auto number would be WITHOUT advancing the counter.
    Used to tell whether a caller-supplied invoice_number is the auto value
    (keep auto-generating) or a deliberate custom value (honor it as-is).
    Mirrors the format of generate_invoice_number().
    """
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    if not entity:
        raise ValueError(f"Entity {entity_id} not found")
    return resolve_next_number(db, entity, document_type)[2]


def generate_invoice_number(db: Session, entity_id: int, document_type: str = "invoice") -> str:
    """
    Auto-increment invoice/quote number per entity.
    Format: {PREFIX}{COUNTER:05d}  e.g. OBHI00001, SFT00023, QT00005, PO00012
    """
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).with_for_update().first()
    if not entity:
        raise ValueError(f"Entity {entity_id} not found")

    _, counter, number = resolve_next_number(db, entity, document_type)
    if document_type == "quote":
        entity.quote_counter = counter
    elif document_type == "purchase_order":
        entity.po_counter = counter
    else:
        entity.invoice_counter = counter

    db.flush()
    return number
