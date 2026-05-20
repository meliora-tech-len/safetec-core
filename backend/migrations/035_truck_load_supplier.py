"""
Migration 035: Add supplier_id (nullable FK) to truck_loads.

Allows a load entry to be linked to a supplier so that the load
pulls through to that supplier's profile page.

SQLite: applied by upgrade() — safe to re-run.
PostgreSQL/Supabase: run the ALTER TABLE statement manually via the SQL editor.
"""

from sqlalchemy import text


def upgrade(conn):
    # SQLite-safe: ignore if column already exists
    try:
        conn.execute(text("""
            ALTER TABLE truck_loads
            ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL
        """))
    except Exception:
        pass
