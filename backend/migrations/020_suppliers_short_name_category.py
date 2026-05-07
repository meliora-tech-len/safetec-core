"""
Migration 020: Add short_name and category to suppliers.

short_name  – abbreviated display name for dropdowns / reports (e.g. "WBG")
category    – operational grouping (e.g. "Diesel", "Wash Bay", "Mechanical")

PostgreSQL: run via Supabase SQL editor.
SQLite: handled below with duplicate-column guard.
"""

from sqlalchemy import text


def upgrade(conn):
    for ddl in [
        "ALTER TABLE suppliers ADD COLUMN short_name VARCHAR(100);",
        "ALTER TABLE suppliers ADD COLUMN category   VARCHAR(100);",
    ]:
        try:
            conn.execute(text(ddl))
        except Exception:
            pass  # column already present
