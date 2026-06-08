"""
Migration 082: generic per-value verification overlay.

Creates `value_verifications` — attaches the standard 3-step verification
(verified / verified2 / verified3) to an arbitrary computed value identified by
a stable `target` string (e.g. "costing:11:2026-05:truck:3:net_payable").
Decoupled from the modules' own tables so it survives on-the-fly recomputation.
"""

from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS value_verifications (
            id           SERIAL PRIMARY KEY,
            entity_id    INTEGER REFERENCES business_entities(id) ON DELETE CASCADE,
            target       VARCHAR(255) NOT NULL UNIQUE,
            is_verified  BOOLEAN DEFAULT FALSE,
            verified_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            verified_at  TIMESTAMPTZ,
            verified2_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            verified2_at TIMESTAMPTZ,
            verified3_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            verified3_at TIMESTAMPTZ,
            created_at   TIMESTAMPTZ DEFAULT now(),
            updated_at   TIMESTAMPTZ
        );
    """))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_value_verifications_target ON value_verifications (target);"
    ))
    conn.commit()
