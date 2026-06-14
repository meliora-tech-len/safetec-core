"""Migration 090 — replace subcontractor_costing_notes with truck_costing_notes.

The carry-over awareness note is now scoped per truck + costing period instead
of per subcontractor + period. The old table (added in 088) is dropped; it held
only awareness notes and is safe to recreate.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("DROP TABLE IF EXISTS subcontractor_costing_notes"))
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS truck_costing_notes (
            id            SERIAL PRIMARY KEY,
            truck_id      INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
            month         INTEGER NOT NULL,
            year          INTEGER NOT NULL,
            note          TEXT,
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT uq_truck_costing_note_period UNIQUE (truck_id, month, year)
        )
    """))

    conn.commit()
