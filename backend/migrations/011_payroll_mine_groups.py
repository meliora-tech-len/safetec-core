"""
Migration 011: Add payroll_mine_groups table.

Stores dynamic mine route groups (e.g. Lohatla) with their own salary/
incentive/subs rates, replacing the hardcoded hotazel_*/lohatla_* columns
in payroll_settings for future extensibility.

Run against Supabase/PostgreSQL before deploying.
SQLite: table is auto-created by SQLAlchemy on startup.
"""

from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS payroll_mine_groups (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            base_salary NUMERIC(12,2) NOT NULL,
            incentive_per_load NUMERIC(12,2) NOT NULL DEFAULT 0,
            subs_per_load NUMERIC(12,2) NOT NULL DEFAULT 0,
            base_loads INTEGER NOT NULL DEFAULT 7,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        );
    """))

    # Seed Lohatla from the most recent payroll_settings row
    conn.execute(text("""
        INSERT INTO payroll_mine_groups
            (name, base_salary, incentive_per_load, subs_per_load, base_loads, notes)
        SELECT
            'Lohatla',
            lohatla_base_salary,
            lohatla_incentive_per_load,
            lohatla_subs_per_load,
            7,
            'Migrated from payroll settings'
        FROM payroll_settings
        ORDER BY id DESC
        LIMIT 1
        ON CONFLICT DO NOTHING;
    """))


def downgrade(conn):
    conn.execute(text("DROP TABLE IF EXISTS payroll_mine_groups CASCADE;"))
