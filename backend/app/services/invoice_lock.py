"""Supplier invoice lock — shared lock helpers.

A supplier invoice can be LOCKED once it reconciles. While locked, NOTHING on
it may be added, changed or removed — values, line items, delete/archive,
period moves and its diesel fill-ups all refuse — and the diesel-settings
admin-fee re-snapshot leaves it alone. Still allowed while locked (none of
these change a financial figure): paid status (is_paid / paid_date /
payment_reference), free-text notes, verification ticks and attachments.

Scope is one invoice, not a whole month: invoices are reconciled one by one
(filter to a supplier, close each invoice off as it balances). Nothing rolls
forward the way the subcontractor costing "Sent" lock does; `locked_at` is
recorded purely so the audit trail and the on-screen badge can say when the
invoice was closed off.

A fill-up is on the lock when its `supplier_invoice_id` points at a locked
invoice. Rows with no linked invoice can't be locked — there is nothing to lock
them by, and they're exactly the ones still awaiting an invoice number.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import DieselFillUp, SupplierInvoice, SupplierInvoiceLock


def get_lock(db: Session, supplier_invoice_id: Optional[int]) -> Optional[SupplierInvoiceLock]:
    if not supplier_invoice_id:
        return None
    return (
        db.query(SupplierInvoiceLock)
        .filter(SupplierInvoiceLock.supplier_invoice_id == supplier_invoice_id)
        .first()
    )


def locked_invoice_ids(db: Session, entity_id: Optional[int] = None) -> set:
    """{supplier_invoice_id, …} — every locked invoice, optionally scoped
    to one entity."""
    q = db.query(SupplierInvoiceLock.supplier_invoice_id)
    if entity_id is not None:
        q = q.filter(SupplierInvoiceLock.entity_id == entity_id)
    return {r[0] for r in q.all()}


def is_invoice_locked(db: Session, supplier_invoice_id: Optional[int]) -> bool:
    return get_lock(db, supplier_invoice_id) is not None


def invoice_label(db: Session, supplier_invoice_id: Optional[int]) -> str:
    """The invoice number to name in a lock message, falling back to the id."""
    if not supplier_invoice_id:
        return "this invoice"
    num = (
        db.query(SupplierInvoice.invoice_number)
        .filter(SupplierInvoice.id == supplier_invoice_id)
        .scalar()
    )
    return num or f"#{supplier_invoice_id}"


def lock_message(label: str) -> str:
    return (
        f"Invoice {label} is locked — nothing can be added, changed "
        "or removed against it. It must be unlocked first."
    )


def ensure_invoice_unlocked(db: Session, supplier_invoice_id: Optional[int]):
    """Raise 403 when this supplier invoice is locked."""
    if is_invoice_locked(db, supplier_invoice_id):
        raise HTTPException(status_code=403, detail=lock_message(invoice_label(db, supplier_invoice_id)))


def ensure_supplier_invoice_unlocked(db: Session, inv: SupplierInvoice,
                                     changed: dict | None = None,
                                     allowed_fields: set | None = None):
    """Raise 403 when this SupplierInvoice is locked. Pass `changed` (the
    _changed_values output, NOT the raw payload — forms re-send unchanged
    values) + `allowed_fields` to let workflow-status edits through, mirroring
    ensure_not_locked. changed=None means an unconditional structural change
    (delete, archive, add-line, move) — always blocked while locked."""
    if not is_invoice_locked(db, inv.id):
        return
    if changed is not None and allowed_fields is not None and set(changed) <= allowed_fields:
        return
    raise HTTPException(status_code=403, detail=lock_message(inv.invoice_number or f"#{inv.id}"))


def resolve_invoice_id(db: Session, entity_id: int, supplier_id: Optional[int],
                       supplier_invoice_id: Optional[int],
                       invoice_number: Optional[str]) -> Optional[int]:
    """Which supplier invoice a fill-up being captured will end up on: the id if
    one was passed, else the invoice its number matches for this supplier+entity
    (the same lookup `_auto_link_or_create_supplier_invoice` uses to link). Lets
    a new fill-up be blocked from attaching itself to a locked invoice."""
    if supplier_invoice_id:
        return supplier_invoice_id
    num = (invoice_number or "").strip()
    if not num or not supplier_id:
        return None
    return (
        db.query(SupplierInvoice.id)
        .filter(
            SupplierInvoice.supplier_id == supplier_id,
            SupplierInvoice.invoice_number == num,
            SupplierInvoice.entity_id == entity_id,
        )
        .scalar()
    )


def ensure_fillup_unlocked(db: Session, f: DieselFillUp,
                           updates: dict | None = None,
                           allowed_fields: set | None = None):
    """Raise 403 when the fill-up sits on a locked invoice. Pass `updates` +
    `allowed_fields` to let note-only edits through — mirrors ensure_not_locked.

    When the edit re-points the fill-up at a different invoice, the destination is
    checked too, so a locked invoice can't be added to from an open one.
    """
    if updates is not None and allowed_fields is not None and set(updates) <= allowed_fields:
        return
    ensure_invoice_unlocked(db, f.supplier_invoice_id)
    if updates and "supplier_invoice_id" in updates:
        ensure_invoice_unlocked(db, updates.get("supplier_invoice_id"))
    # An invoice number typed onto an unlinked fill-up would auto-link it; don't
    # let that attach to a locked invoice either.
    if updates and "invoice_number" in updates and not f.supplier_invoice_id:
        ensure_invoice_unlocked(db, resolve_invoice_id(
            db, f.entity_id, updates.get("supplier_id", f.supplier_id), None,
            updates.get("invoice_number"),
        ))


def exclude_locked_invoices(db: Session, q, entity_id: Optional[int] = None):
    """Drop fill-ups on locked invoices from a query. Used by the admin-fee
    re-snapshot so changing the entity's fee % can't rewrite an invoice that has
    already been reconciled and closed off."""
    ids = locked_invoice_ids(db, entity_id)
    if not ids:
        return q
    return q.filter(
        (DieselFillUp.supplier_invoice_id.is_(None))
        | (~DieselFillUp.supplier_invoice_id.in_(ids))
    )
