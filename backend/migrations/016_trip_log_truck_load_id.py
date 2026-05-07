"""
Migration 016: Add truck_load_id to driver_trip_logs.

Links auto-created trip log entries back to the originating TruckLoad so that
deleting a truck load can find and remove its corresponding trip log entry.

PostgreSQL: run via Supabase SQL editor.
SQLite: handled below (ALTER TABLE ADD COLUMN, catching duplicate-column errors).
"""

from sqlalchemy import text


def upgrade(conn):
    # SQLite does not support IF NOT EXISTS on ALTER TABLE ADD COLUMN,
    # so we catch the error if the column already exists.
    try:
        conn.execute(text("""
            ALTER TABLE driver_trip_logs
            ADD COLUMN truck_load_id INTEGER REFERENCES truck_loads(id) ON DELETE SET NULL;
        """))
    except Exception:
        pass  # column already present
