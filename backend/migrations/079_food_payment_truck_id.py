"""
Migration 079 — Attribute food allowances to the truck they were captured against.

DriverFoodPayment.truck_id records which truck's Food Allowance tab the payment was
entered from. The payment is still credited to the driver's pay cycle (one payslip
line), but a casual driver linked to multiple trucks must only appear under the
capturing truck — not duplicated under every truck they are linked to.

Nullable: legacy rows keep truck_id = NULL and fall back to the old driver-link
display behaviour.
"""
from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text(
            "ALTER TABLE driver_food_payments "
            "ADD COLUMN truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL"
        ))
    except Exception:
        pass  # column already exists
    conn.commit()
