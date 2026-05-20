"""
Migration 037: Add subcontractor_name column to trucks table.

Keeps is_subcontractor boolean for filtering/logic; adds subcontractor_name
to store the actual name of the external party that owns the truck.

SQLite: applied by upgrade() — safe to re-run.
PostgreSQL/Supabase: ALTER TABLE trucks ADD COLUMN IF NOT EXISTS subcontractor_name VARCHAR(200);
"""

from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text("ALTER TABLE trucks ADD COLUMN subcontractor_name VARCHAR(200)"))
    except Exception:
        pass
    conn.commit()
