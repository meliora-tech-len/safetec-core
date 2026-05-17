"""
Migration 032: Add line_type column to invoice_line_items.

Supported values: 'item' (default) | 'header' | 'note' | 'spacer'
Backward-compatible — existing rows get 'item' as default.

SQLite: applied by _add() — safe to re-run.
PostgreSQL/Supabase: run the SQL block below via the SQL editor.
"""

from sqlalchemy import text


def _add(conn, sql):
    try:
        conn.execute(text(sql))
    except Exception:
        pass  # column already present


def upgrade(conn):
    _add(conn,
         "ALTER TABLE invoice_line_items "
         "ADD COLUMN line_type VARCHAR(20) NOT NULL DEFAULT 'item'")
    conn.commit()


# ── PostgreSQL (run manually in Supabase SQL editor) ──────────────────────────
#
# ALTER TABLE invoice_line_items
#   ADD COLUMN IF NOT EXISTS line_type VARCHAR(20) NOT NULL DEFAULT 'item';
