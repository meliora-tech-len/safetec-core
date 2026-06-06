"""
Migration 081 — defer a load's pay to the next month.

A load can be done in one month but only paid in the following month's payroll
(e.g. it was captured after that month's salaries were already run). The load
record stays in its own month (date, mine, tonnes, invoicing, costing unchanged);
only its payroll attribution shifts forward one month.

pay_deferred = TRUE → the load is excluded from its own month's pay cycle and
counted in the next month's cycle instead.

Existing cycles self-heal: opening a cycle re-syncs counts from truck loads.
"""
from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text(
            "ALTER TABLE truck_loads ADD COLUMN pay_deferred BOOLEAN NOT NULL DEFAULT FALSE"
        ))
    except Exception:
        pass  # column already exists
    conn.commit()
