"""
Migration 026: Diesel ↔ Supplier Invoice linkage.

Adds:
  - litres column to supplier_invoices (for diesel fill-up data captured alongside the invoice)
  - supplier_invoice_id FK column to diesel_fillups (links auto-created fill-ups back to their source)

PostgreSQL/Supabase: run this migration via the SQL editor.
SQLite (local dev): columns added by _add() helper — safe to re-run.
"""

from sqlalchemy import text


def _add(conn, sql):
    try:
        conn.execute(text(sql))
    except Exception:
        pass  # column already present


def upgrade(conn):
    # supplier_invoices: litres captured for diesel invoices
    _add(conn, "ALTER TABLE supplier_invoices ADD COLUMN litres NUMERIC(10, 3);")

    # diesel_fillups: link back to the supplier invoice that triggered this fill-up
    _add(conn, "ALTER TABLE diesel_fillups ADD COLUMN supplier_invoice_id INTEGER REFERENCES supplier_invoices(id) ON DELETE SET NULL;")

    conn.commit()
