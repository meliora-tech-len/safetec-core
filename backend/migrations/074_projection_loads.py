"""
Migration 074 — Projection loads & driver-already-paid flag.

is_projection: placeholder load (driver confirmed more loads before month end,
               details unknown). Counts toward pay cycle; tonnes stored as 0.
driver_already_paid: this load's driver was already paid in a prior period
                     (e.g. paid as a projection in April, actual slip arrived
                     in May). Excluded from the current pay-cycle count.
"""
from sqlalchemy import text


def upgrade(conn):
    for col, definition in [
        ("is_projection",      "BOOLEAN NOT NULL DEFAULT 0"),
        ("driver_already_paid","BOOLEAN NOT NULL DEFAULT 0"),
    ]:
        try:
            conn.execute(text(f"ALTER TABLE truck_loads ADD COLUMN {col} {definition}"))
        except Exception:
            pass  # column already exists
    conn.commit()
