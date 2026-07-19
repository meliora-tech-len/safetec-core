"""Migration 114 — backfill NULL advance/loan columns on driver_pay_cycles and lock them down.

A bulk seed of the OBHI July 2026 pay cycles (created 2026-06-29 14:27:43) inserted
rows without listing these six columns. On prod they have no server DEFAULT, so the
rows got NULL instead of 0 — unlike the ORM path (get_or_create_cycle), which applies
the model's Python-side default=0. DriverPayCycleOut declares these fields non-nullable,
so serialising any such row raises a ValidationError and the pay module 500s on load
(reported for driver Garth Jafta / OBHI, but 21 OBHI drivers were affected).

Fix both the data and the shape:
  1. Backfill every NULL to 0 / false.
  2. Give the columns a server DEFAULT and NOT NULL so a future column-omitting insert
     can never reintroduce NULL. This matches the model's default=0 intent.
"""
from sqlalchemy import text

_NUMERIC_COLS = [
    "subsistence_advance_paid",
    "staff_loan_balance",
    "staff_loan_deduction",
    "cash_advance_balance",
    "cash_advance_deduction",
]
_BOOL_COL = "subsistence_advance_verified"


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    # 1. Backfill existing NULLs.
    for col in _NUMERIC_COLS:
        conn.execute(text(
            f"UPDATE driver_pay_cycles SET {col} = 0 WHERE {col} IS NULL"
        ))
    conn.execute(text(
        f"UPDATE driver_pay_cycles SET {_BOOL_COL} = FALSE WHERE {_BOOL_COL} IS NULL"
    ))

    # 2. Enforce non-null with a server default going forward (PostgreSQL only;
    #    SQLite's driver_pay_cycles already declares DEFAULT 0 at create time and
    #    can't ALTER COLUMN in place).
    if is_pg:
        for col in _NUMERIC_COLS:
            conn.execute(text(
                f"ALTER TABLE driver_pay_cycles ALTER COLUMN {col} SET DEFAULT 0"
            ))
            conn.execute(text(
                f"ALTER TABLE driver_pay_cycles ALTER COLUMN {col} SET NOT NULL"
            ))
        conn.execute(text(
            f"ALTER TABLE driver_pay_cycles ALTER COLUMN {_BOOL_COL} SET DEFAULT FALSE"
        ))
        conn.execute(text(
            f"ALTER TABLE driver_pay_cycles ALTER COLUMN {_BOOL_COL} SET NOT NULL"
        ))

    conn.commit()
    print("  backfilled + locked down driver_pay_cycles advance/loan columns")
