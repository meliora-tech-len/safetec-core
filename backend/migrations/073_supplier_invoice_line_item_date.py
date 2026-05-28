"""
Migration 073 — Add line_date to supplier_invoice_line_items.
Stores the individual transaction/slip date from WBG imports.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE supplier_invoice_line_items
        ADD COLUMN IF NOT EXISTS line_date DATE
    """))
    conn.commit()
