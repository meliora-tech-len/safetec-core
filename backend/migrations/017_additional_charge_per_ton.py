"""
Migration 017: Add additional_charge_per_ton to diesel_rates.

Adds an optional per-ton surcharge column to diesel rate records.
Defaults to 0 so existing rows are unaffected.

PostgreSQL: run via Supabase SQL editor.
SQLite: handled below (ALTER TABLE ADD COLUMN, catching duplicate-column errors).
"""

from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text("""
            ALTER TABLE diesel_rates
            ADD COLUMN additional_charge_per_ton NUMERIC(10,2) NOT NULL DEFAULT 0;
        """))
    except Exception:
        pass  # column already present
