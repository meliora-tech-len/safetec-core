"""Migration 126 — Diesel lock moves from the month to the invoice.

Replaces migration 125's per-entity-per-month `diesel_locks` with
`diesel_invoice_locks`: one row per supplier invoice, recording that the diesel
logged against that invoice is closed off. Locking per invoice is what the work
actually follows — you filter the Diesel Log to a supplier and close off each
invoice as it reconciles, instead of freezing a whole month at once.

`diesel_locks` is dropped: it was never used (zero rows in production), so
there is nothing to carry over. Run this AT/AFTER the deploy of the matching
code, not before — the previous release queries diesel_locks on every fill-up
write, so dropping it while that release is live 500s those endpoints.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS diesel_invoice_locks (
            id                  SERIAL PRIMARY KEY,
            supplier_invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
            entity_id           INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            locked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            locked_by_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT uq_diesel_invoice_lock UNIQUE (supplier_invoice_id)
        )
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_diesel_invoice_locks_entity
        ON diesel_invoice_locks (entity_id)
    """))
    conn.execute(text("DROP TABLE IF EXISTS diesel_locks"))

    conn.commit()
