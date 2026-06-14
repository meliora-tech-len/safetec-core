"""Migration 088 — subcontractor_costing_notes table.

A free-text note per subcontractor + costing period (month/year), used to flag
e.g. a loss carried over from the previous month. Awareness only — never part
of any costing total.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS subcontractor_costing_notes (
            id               SERIAL PRIMARY KEY,
            subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
            month            INTEGER NOT NULL,
            year             INTEGER NOT NULL,
            note             TEXT,
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT uq_costing_note_period UNIQUE (subcontractor_id, month, year)
        )
    """))

    conn.commit()
