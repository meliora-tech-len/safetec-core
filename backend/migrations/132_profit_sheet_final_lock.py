"""Migration 132 — Profit Sheet final lock.

One row per entity-month: the admin has final-locked the Profit Sheet report's
totals, which freezes capture for every reg on that sheet for that month —
truck loads, food allowance, diesel and truck-linked supplier-invoice expenses
all refuse new records until the admin unlocks.

`locked_by_id` is kept so the block screen can tell the user WHO to ask.
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS profit_sheet_locks (
                id           SERIAL PRIMARY KEY,
                entity_id    INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
                year         INTEGER NOT NULL,
                month        INTEGER NOT NULL,
                locked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                locked_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT uq_profit_sheet_lock UNIQUE (entity_id, year, month)
            )
        """))
    else:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS profit_sheet_locks (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id    INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
                year         INTEGER NOT NULL,
                month        INTEGER NOT NULL,
                locked_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                locked_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT uq_profit_sheet_lock UNIQUE (entity_id, year, month)
            )
        """))

    conn.commit()
    print("  created profit_sheet_locks")
