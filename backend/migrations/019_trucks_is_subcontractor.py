"""
Migration 019: Add is_subcontractor to trucks.

Adds a boolean column (default FALSE / NOT NULL) that flags trucks belonging
to sub-contractors rather than the entity's own fleet.

PostgreSQL: run via Supabase SQL editor.
SQLite: handled below (ALTER TABLE ADD COLUMN with duplicate-column guard).
"""

from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text("""
            ALTER TABLE trucks
            ADD COLUMN is_subcontractor BOOLEAN NOT NULL DEFAULT 0;
        """))
    except Exception:
        pass  # column already present
