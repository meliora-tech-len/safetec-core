"""Add diesel_type column to diesel_fillups (fillup | topup, default fillup)."""
from sqlalchemy import text

def upgrade(conn):
    try:
        conn.execute(text("ALTER TABLE diesel_fillups ADD COLUMN diesel_type VARCHAR(10) DEFAULT 'fillup'"))
    except Exception:
        pass
    conn.commit()
