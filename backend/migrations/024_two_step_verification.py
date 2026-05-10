"""
Migration 024: Add 2-step verification to diesel_fillups, supplier_invoices,
driver_additional_loads, and driver_food_payments.

Step 1: any authorised user verifies.
Step 2: a different authorised user gives final approval.

Each step records the user ID and timestamp so the UI can display
"LE · 2026.05.10" initials + date badges.

Notes:
- diesel_fillups already has verified_by / verified_at — we only add step-2 columns.
- supplier_invoices gets verified_by + step-2 columns (verified_at already exists).
- driver_additional_loads and driver_food_payments get full step-1 + step-2 columns.
"""

from sqlalchemy import text


def _add(conn, sql):
    try:
        conn.execute(text(sql))
    except Exception:
        pass  # column already present


def upgrade(conn):
    # ── diesel_fillups ─────────────────────────────────────────────────────────
    _add(conn, "ALTER TABLE diesel_fillups ADD COLUMN verified2_by  INTEGER;")
    _add(conn, "ALTER TABLE diesel_fillups ADD COLUMN verified2_at  TIMESTAMP;")

    # ── supplier_invoices ──────────────────────────────────────────────────────
    _add(conn, "ALTER TABLE supplier_invoices ADD COLUMN verified_by  INTEGER;")
    _add(conn, "ALTER TABLE supplier_invoices ADD COLUMN verified2_by INTEGER;")
    _add(conn, "ALTER TABLE supplier_invoices ADD COLUMN verified2_at TIMESTAMP;")

    # ── driver_additional_loads ────────────────────────────────────────────────
    _add(conn, "ALTER TABLE driver_additional_loads ADD COLUMN verified_by  INTEGER;")
    _add(conn, "ALTER TABLE driver_additional_loads ADD COLUMN verified_at  TIMESTAMP;")
    _add(conn, "ALTER TABLE driver_additional_loads ADD COLUMN verified2_by INTEGER;")
    _add(conn, "ALTER TABLE driver_additional_loads ADD COLUMN verified2_at TIMESTAMP;")

    # ── driver_food_payments ───────────────────────────────────────────────────
    _add(conn, "ALTER TABLE driver_food_payments ADD COLUMN verified_by  INTEGER;")
    _add(conn, "ALTER TABLE driver_food_payments ADD COLUMN verified_at  TIMESTAMP;")
    _add(conn, "ALTER TABLE driver_food_payments ADD COLUMN verified2_by INTEGER;")
    _add(conn, "ALTER TABLE driver_food_payments ADD COLUMN verified2_at TIMESTAMP;")
