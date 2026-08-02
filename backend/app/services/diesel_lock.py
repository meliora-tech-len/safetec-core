"""Diesel month lock — shared period + lock helpers.

A diesel month (entity + month/year) can be LOCKED. While locked no fill-up
values may be added, changed or removed in that month, and the diesel-settings
admin-fee re-snapshot leaves it alone. Only a free-text note stays editable —
notes are awareness only and never part of a total.

Deliberately simpler than the subcontractor costing "Sent" lock: nothing rolls
forward into the next month. `locked_at` is recorded purely so the audit trail
and the on-screen badge can say when the month was closed off.

The period a fill-up falls in must match what the Diesel Log shows, i.e. the
statement period of its linked supplier invoice, falling back to the fill-up's
own date (see `_apply_period_filter` in routes/diesel.py) — otherwise a row
visible under a locked month could still be edited.
"""
from datetime import date as date_type
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.models import DieselFillUp, DieselLock, SupplierInvoice


def locked_periods(db: Session, entity_id: int) -> set:
    """{(year, month), …} — every locked diesel month for this entity."""
    return {
        (r.year, r.month)
        for r in db.query(DieselLock).filter(DieselLock.entity_id == entity_id).all()
    }


def get_lock(db: Session, entity_id: int, month: int, year: int) -> Optional[DieselLock]:
    return (
        db.query(DieselLock)
        .filter(
            DieselLock.entity_id == entity_id,
            DieselLock.month == month,
            DieselLock.year == year,
        )
        .first()
    )


def period_for(db: Session, fillup_date: date_type,
               supplier_invoice_id: Optional[int] = None) -> Optional[tuple]:
    """The diesel (year, month) a fill-up belongs to: the statement period of its
    linked supplier invoice, else the fill-up's own date."""
    if supplier_invoice_id:
        row = (
            db.query(SupplierInvoice.statement_year, SupplierInvoice.statement_month)
            .filter(SupplierInvoice.id == supplier_invoice_id)
            .first()
        )
        if row and row[0] and row[1]:
            return (row[0], row[1])
    if fillup_date is None:
        return None
    return (fillup_date.year, fillup_date.month)


def fillup_period(db: Session, f: DieselFillUp) -> Optional[tuple]:
    return period_for(db, f.fillup_date, f.supplier_invoice_id)


def period_for_invoice(inv, fillup_date: Optional[date_type]) -> Optional[tuple]:
    """Same rule as `period_for`, for callers that already hold the supplier
    invoice object (it may not be committed yet, so its id can't be looked up)."""
    year = getattr(inv, "statement_year", None) if inv is not None else None
    month = getattr(inv, "statement_month", None) if inv is not None else None
    if year and month:
        return (year, month)
    if fillup_date is None:
        return None
    return (fillup_date.year, fillup_date.month)


def lock_message(month: int, year: int) -> str:
    return (
        f"The {month:02d}/{year} diesel month is locked — no values can be added, "
        "changed or removed. It must be unlocked first."
    )


def is_locked_period(db: Session, entity_id: int, period: Optional[tuple]) -> bool:
    if period is None:
        return False
    return get_lock(db, entity_id, period[1], period[0]) is not None


def ensure_period_unlocked(db: Session, entity_id: int, period: Optional[tuple]):
    """Raise 403 when this (year, month) is a locked diesel month."""
    if period is None:
        return
    if get_lock(db, entity_id, period[1], period[0]) is not None:
        raise HTTPException(status_code=403, detail=lock_message(period[1], period[0]))


def ensure_fillup_unlocked(db: Session, f: DieselFillUp,
                           updates: dict | None = None,
                           allowed_fields: set | None = None):
    """Raise 403 when the fill-up sits in a locked diesel month. Pass `updates`
    + `allowed_fields` to let note-only edits through — mirrors ensure_not_locked.

    When the edit moves the fill-up (new date or a different supplier invoice)
    the destination month is checked too, so a locked month can't be filled from
    an open one.
    """
    if updates is not None and allowed_fields is not None and set(updates) <= allowed_fields:
        return
    ensure_period_unlocked(db, f.entity_id, fillup_period(db, f))
    if updates and ("fillup_date" in updates or "supplier_invoice_id" in updates):
        dest = period_for(
            db,
            updates.get("fillup_date", f.fillup_date),
            updates.get("supplier_invoice_id", f.supplier_invoice_id),
        )
        ensure_period_unlocked(db, f.entity_id, dest)


def exclude_locked_periods(db: Session, q, entity_id: int):
    """Drop fill-ups that fall in a locked diesel month from a query. Used by the
    admin-fee re-snapshot so changing the entity's fee % can't rewrite a month
    that has been closed off."""
    pairs = locked_periods(db, entity_id)
    if not pairs:
        return q
    q = q.outerjoin(SupplierInvoice, SupplierInvoice.id == DieselFillUp.supplier_invoice_id)
    eff_year = func.coalesce(SupplierInvoice.statement_year, func.extract("year", DieselFillUp.fillup_date))
    eff_month = func.coalesce(SupplierInvoice.statement_month, func.extract("month", DieselFillUp.fillup_date))
    for year, month in pairs:
        q = q.filter(~and_(eff_year == year, eff_month == month))
    return q
