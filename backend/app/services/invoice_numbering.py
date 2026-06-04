from sqlalchemy.orm import Session
from sqlalchemy import select, func
from app.models.models import BusinessEntity, Invoice


def _format_number(entity: BusinessEntity, document_type: str, counter: int) -> str:
    prefix = entity.invoice_prefix or entity.code
    if document_type == "quote":
        prefix = f"Q{prefix}"
    return f"{prefix}{counter:05d}"


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
    if document_type == "quote":
        counter = (entity.quote_counter or 0) + 1
    else:
        counter = (entity.invoice_counter or 0) + 1
    return _format_number(entity, document_type, counter)


def generate_invoice_number(db: Session, entity_id: int, document_type: str = "invoice") -> str:
    """
    Auto-increment invoice/quote number per entity.
    Format: {PREFIX}{COUNTER:05d}  e.g. OBHI00001, SFT00023, TP00005
    """
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).with_for_update().first()
    if not entity:
        raise ValueError(f"Entity {entity_id} not found")

    if document_type == "quote":
        entity.quote_counter = (entity.quote_counter or 0) + 1
        counter = entity.quote_counter
    else:
        entity.invoice_counter = (entity.invoice_counter or 0) + 1
        counter = entity.invoice_counter

    db.flush()
    return _format_number(entity, document_type, counter)
