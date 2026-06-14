"""Migration 089 — supplier_invoices.supplier_name_text column.

Free-text supplier name for one-off expenses captured against a name rather than
a registered supplier (supplier_id stays null in that case).
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text(
        "ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS supplier_name_text VARCHAR(300)"
    ))

    conn.commit()
