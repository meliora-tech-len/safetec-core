"""
Migration 018: Add additional_charge_per_ton to diesel_settings.

Per-entity additional charge (R per ton) stored alongside the admin fee %.
Defaults to 0 so existing rows are unaffected.
"""

from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text("""
            ALTER TABLE diesel_settings
            ADD COLUMN additional_charge_per_ton NUMERIC(10,2) NOT NULL DEFAULT 0;
        """))
    except Exception:
        pass  # column already present
