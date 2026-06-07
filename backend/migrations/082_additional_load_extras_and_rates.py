"""Migration 082 — Safetec additional-load extra fields + per-customer rates.

Adds delivery_note / tons / waiting_for_slips / is_paid to driver_additional_loads,
and creates additional_load_rates (per-customer flat rate, e.g. KOUGA R200).
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("ALTER TABLE driver_additional_loads ADD COLUMN IF NOT EXISTS delivery_note VARCHAR(200)"))
    conn.execute(text("ALTER TABLE driver_additional_loads ADD COLUMN IF NOT EXISTS tons NUMERIC(10,2)"))
    conn.execute(text("ALTER TABLE driver_additional_loads ADD COLUMN IF NOT EXISTS waiting_for_slips BOOLEAN NOT NULL DEFAULT FALSE"))
    conn.execute(text("ALTER TABLE driver_additional_loads ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS additional_load_rates (
            id         SERIAL PRIMARY KEY,
            entity_id  INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            name       VARCHAR(200) NOT NULL,
            amount     NUMERIC(12,2) NOT NULL,
            is_active  BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_additional_load_rates_entity ON additional_load_rates(entity_id)"))

    conn.commit()
