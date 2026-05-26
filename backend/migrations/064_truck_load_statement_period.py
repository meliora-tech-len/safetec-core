"""
Migration 064 — Add statement_month / statement_year to truck_loads.
Backfills from load_date so existing records have a period set.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE truck_loads
        ADD COLUMN IF NOT EXISTS statement_month INTEGER
    """))
    conn.execute(text("""
        ALTER TABLE truck_loads
        ADD COLUMN IF NOT EXISTS statement_year INTEGER
    """))

    # Backfill from load_date
    conn.execute(text("""
        UPDATE truck_loads
        SET
          statement_month = EXTRACT(MONTH FROM load_date)::INTEGER,
          statement_year  = EXTRACT(YEAR  FROM load_date)::INTEGER
        WHERE statement_month IS NULL
    """))

    conn.commit()
