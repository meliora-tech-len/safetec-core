"""
Migration 031: Seed fleet_licence_warn_days app setting (default 30).
Safe to re-run — skips if the key already exists.
"""

from sqlalchemy import text


def upgrade(conn):
    exists = conn.execute(
        text("SELECT id FROM app_settings WHERE key = 'fleet_licence_warn_days'")
    ).fetchone()
    if not exists:
        conn.execute(text("""
            INSERT INTO app_settings (key, value, label, category)
            VALUES ('fleet_licence_warn_days', '30', 'Licence Expiry Warning Window', 'fleet')
        """))
    conn.commit()
