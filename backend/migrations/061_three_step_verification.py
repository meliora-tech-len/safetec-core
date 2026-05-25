"""
Migration 061: Add step-3 (admin final lock) to the 4 verification tables.

verified3_by / verified3_at columns added to:
  - diesel_fillups
  - supplier_invoices
  - driver_additional_loads
  - driver_food_payments

Once an admin populates verified3_by, the record is fully locked.
"""

from sqlalchemy import text


def _add(conn, sql):
    try:
        conn.execute(text(sql))
    except Exception:
        pass


def upgrade(conn):
    _add(conn, "ALTER TABLE diesel_fillups          ADD COLUMN verified3_by INTEGER;")
    _add(conn, "ALTER TABLE diesel_fillups          ADD COLUMN verified3_at TIMESTAMP;")
    _add(conn, "ALTER TABLE supplier_invoices       ADD COLUMN verified3_by INTEGER;")
    _add(conn, "ALTER TABLE supplier_invoices       ADD COLUMN verified3_at TIMESTAMP;")
    _add(conn, "ALTER TABLE driver_additional_loads ADD COLUMN verified3_by INTEGER;")
    _add(conn, "ALTER TABLE driver_additional_loads ADD COLUMN verified3_at TIMESTAMP;")
    _add(conn, "ALTER TABLE driver_food_payments    ADD COLUMN verified3_by INTEGER;")
    _add(conn, "ALTER TABLE driver_food_payments    ADD COLUMN verified3_at TIMESTAMP;")
