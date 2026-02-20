from sqlalchemy.orm import Session
from sqlalchemy import select, func
from app.models.models import BusinessEntity, Invoice


def generate_invoice_number(db: Session, entity_id: int, document_type: str = "invoice") -> str:
    """
    Auto-increment invoice/quote number per entity.
    Format: {PREFIX}{COUNTER:04d}  e.g. OBHI0001, SFT0023, TP0005
    """
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).with_for_update().first()
    if not entity:
        raise ValueError(f"Entity {entity_id} not found")

    prefix = entity.invoice_prefix or entity.code

    if document_type == "quote":
        entity.quote_counter += 1
        counter = entity.quote_counter
        prefix = f"Q{prefix}"
    else:
        entity.invoice_counter += 1
        counter = entity.invoice_counter

    db.flush()
    return f"{prefix}{counter:04d}"
