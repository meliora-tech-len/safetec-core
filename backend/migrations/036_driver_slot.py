"""
Migration 036: Add driver_slot (1 or 2) to drivers table.

Allows two drivers to be assigned to the same truck as Driver 1 and Driver 2,
supporting alternating or shared driving arrangements.

SQLite: applied by upgrade() — safe to re-run.
PostgreSQL/Supabase: run the two statements manually via the SQL editor.
"""

from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text("ALTER TABLE drivers ADD COLUMN driver_slot INTEGER"))
    except Exception:
        pass
    # Migrate existing assignments — all previously assigned drivers become Driver 1
    conn.execute(text(
        "UPDATE drivers SET driver_slot = 1 WHERE truck_id IS NOT NULL AND driver_slot IS NULL"
    ))
    conn.commit()
