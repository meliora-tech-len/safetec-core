"""Single source for resolving an entity's VAT figures.

Every rand calculation must use the entity's SAVED rate (BusinessEntity.vat_rate)
— never a hardcoded 0.15 / 1.15 — so a statutory rate change is a data update,
not a code hunt. The 0.15 here is only the fallback for a missing row/NULL rate
(matches the column default in models.py).
"""
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.models import BusinessEntity

DEFAULT_VAT_RATE = Decimal("0.15")


def entity_vat(db: Session, entity_id) -> tuple:
    """(vat_registered, vat_rate) for the entity, defaulting to (True, 0.15)."""
    ent = (
        db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
        if entity_id is not None else None
    )
    if not ent:
        return True, DEFAULT_VAT_RATE
    rate = Decimal(str(ent.vat_rate)) if ent.vat_rate is not None else DEFAULT_VAT_RATE
    registered = ent.vat_registered if ent.vat_registered is not None else True
    return registered, rate


def entity_vat_rate(db: Session, entity_id) -> Decimal:
    return entity_vat(db, entity_id)[1]
