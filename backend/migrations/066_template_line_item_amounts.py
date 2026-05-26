"""
Migration 066: Add quantity, unit_price, amount to invoice_template_line_items
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("ALTER TABLE invoice_template_line_items ADD COLUMN quantity NUMERIC(12,4)"))
    conn.execute(text("ALTER TABLE invoice_template_line_items ADD COLUMN unit_price NUMERIC(12,2)"))
    conn.execute(text("ALTER TABLE invoice_template_line_items ADD COLUMN amount NUMERIC(12,2)"))
