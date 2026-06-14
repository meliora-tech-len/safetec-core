"""Migration 086 — truck_washes table (basic wash capture).

Description + registration + amount, scoped per truck and period. Capture-only —
no costing/payroll effect for now.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS truck_washes (
            id                   SERIAL PRIMARY KEY,
            truck_id             INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
            entity_id            INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            description          VARCHAR(200) NOT NULL,
            vehicle_registration VARCHAR(50),
            amount               NUMERIC(12,2) NOT NULL,
            period_month         INTEGER NOT NULL,
            period_year          INTEGER NOT NULL,
            notes                VARCHAR(500),
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_truck_washes_truck_period ON truck_washes(truck_id, period_year, period_month)"))

    conn.commit()
