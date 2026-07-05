"""
Migration 109: diesel_fillups.depot_slip_number.

A second, authoritative slip-number column, distinct from the existing
slip_number (shown as "Trans ID" on screen). Some supplier imports
(Intsimbi) historically wrote a system transaction ID into slip_number
instead of the printed depot slip, so the two can now be tracked and
shown separately instead of one column doing double duty.
"""
from sqlalchemy import text


def upgrade(conn):
    # IF NOT EXISTS so a manual re-run (raw SQL) doesn't error on an existing column.
    conn.execute(text(
        "ALTER TABLE diesel_fillups ADD COLUMN IF NOT EXISTS depot_slip_number VARCHAR(100)"
    ))
    conn.commit()
