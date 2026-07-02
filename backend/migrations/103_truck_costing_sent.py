"""Migration 103 — subcontractor costing "Sent" flag.

Adds `truck_costing_sent`: one row per truck + costing period (month/year)
recording that the costing was sent to the subcontractor. A sent costing is
locked (no values added or removed), and expenses captured AFTER the sent
date roll forward into the next month's costing instead of retroactively
changing a statement the subcontractor already received.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS truck_costing_sent (
            id         SERIAL PRIMARY KEY,
            truck_id   INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
            month      INTEGER NOT NULL,
            year       INTEGER NOT NULL,
            sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            sent_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT uq_truck_costing_sent_period UNIQUE (truck_id, month, year)
        )
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_truck_costing_sent_truck
        ON truck_costing_sent (truck_id)
    """))

    conn.commit()
