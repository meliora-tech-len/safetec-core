"""
Migration 014: Fleet subcontractor flag + casual driver payroll rate.

Changes:
  - trucks: ADD COLUMN is_subcontractor BOOLEAN NOT NULL DEFAULT FALSE
  - payroll_settings: ADD COLUMN lohatla_casual_rate_per_load NUMERIC(12,2) NOT NULL DEFAULT 2610.00

PostgreSQL (Supabase): run this migration via the Supabase SQL editor.
SQLite (local dev): columns are added automatically by SQLAlchemy on startup,
  but you may run this manually if the DB already exists.

Raw SQL for Supabase:
  ALTER TABLE trucks
    ADD COLUMN IF NOT EXISTS is_subcontractor BOOLEAN NOT NULL DEFAULT FALSE;

  ALTER TABLE payroll_settings
    ADD COLUMN IF NOT EXISTS lohatla_casual_rate_per_load NUMERIC(12,2) NOT NULL DEFAULT 2610.00;
"""

from sqlalchemy import text


def upgrade(conn):
    # ── 1. Subcontractor flag on trucks ──────────────────────────────────────
    conn.execute(text("""
        ALTER TABLE trucks
        ADD COLUMN IF NOT EXISTS is_subcontractor BOOLEAN NOT NULL DEFAULT FALSE;
    """))

    # ── 2. Casual per-load rate on payroll_settings ───────────────────────────
    conn.execute(text("""
        ALTER TABLE payroll_settings
        ADD COLUMN IF NOT EXISTS lohatla_casual_rate_per_load NUMERIC(12,2) NOT NULL DEFAULT 2610.00;
    """))
