"""
Migration 021: Add lohatla_casual_rate_per_load to payroll_settings.

Flat per-load rate for casual drivers on the Lohatla route.
Default matches the model default of 2610.00.

PostgreSQL: run via Supabase SQL editor.
SQLite: handled below with duplicate-column guard.
"""

from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text("""
            ALTER TABLE payroll_settings
            ADD COLUMN lohatla_casual_rate_per_load NUMERIC(12, 2) NOT NULL DEFAULT 2610.00;
        """))
    except Exception:
        pass  # column already present
