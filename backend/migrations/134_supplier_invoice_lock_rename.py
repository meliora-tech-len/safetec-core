"""Migration 134 — the diesel invoice lock becomes the supplier invoice lock.

Renames `diesel_invoice_locks` to `supplier_invoice_locks`. The lock is no
longer diesel-only: while a supplier invoice is locked, NOTHING on it may be
added, changed or removed — values, line items, delete/archive, period moves
and its diesel fill-ups all refuse. Still allowed while locked: paid status
(is_paid / paid_date / payment_reference), free-text notes, verification ticks
and attachments — none of those change a financial figure.

Rows carry over as-is, so invoices already locked in production stay locked.

Run this AT/AFTER the deploy of the matching code, not before — the previous
release queries diesel_invoice_locks on every diesel write, and the new release
queries supplier_invoice_locks, so the rename and the deploy go together.
Rollback = the reverse renames plus the previous image.
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        conn.execute(text("ALTER TABLE IF EXISTS diesel_invoice_locks RENAME TO supplier_invoice_locks"))
        conn.execute(text("ALTER INDEX IF EXISTS ix_diesel_invoice_locks_entity RENAME TO ix_supplier_invoice_locks_entity"))
        conn.execute(text("ALTER SEQUENCE IF EXISTS diesel_invoice_locks_id_seq RENAME TO supplier_invoice_locks_id_seq"))
        conn.execute(text("""
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_diesel_invoice_lock') THEN
                ALTER TABLE supplier_invoice_locks RENAME CONSTRAINT uq_diesel_invoice_lock TO uq_supplier_invoice_lock;
              END IF;
            END $$;
        """))
    else:
        exists = conn.execute(text(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='diesel_invoice_locks'"
        )).first()
        if exists:
            conn.execute(text("ALTER TABLE diesel_invoice_locks RENAME TO supplier_invoice_locks"))
        # Fresh dev DBs get supplier_invoice_locks from Base.metadata.create_all.

    conn.commit()
    print("  renamed diesel_invoice_locks -> supplier_invoice_locks")
