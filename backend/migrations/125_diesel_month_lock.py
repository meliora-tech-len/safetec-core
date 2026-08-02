"""Migration 125 — Diesel month lock.

Adds `diesel_locks`: one row per entity + diesel period (month/year) recording
that the month was locked, when, and by whom. A locked month accepts no value
changes — no fill-ups added, edited, archived, deleted or imported into it, and
the admin-fee re-snapshot skips it. Unlike the subcontractor costing "Sent"
flag there is no roll-forward: the lock date is recorded for the audit trail
only, entries captured afterwards simply belong to a later month.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS diesel_locks (
            id           SERIAL PRIMARY KEY,
            entity_id    INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            month        INTEGER NOT NULL,
            year         INTEGER NOT NULL,
            locked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            locked_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT uq_diesel_lock_period UNIQUE (entity_id, month, year)
        )
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_diesel_locks_entity
        ON diesel_locks (entity_id)
    """))

    conn.commit()
