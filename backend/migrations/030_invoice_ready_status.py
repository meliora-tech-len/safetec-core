"""
Migration 030: Add 'ready' value to invoicestatus enum.

SQLite: no action needed — status is stored as VARCHAR, new value works automatically.
PostgreSQL/Supabase: run the SQL block manually via the SQL editor.
"""

from sqlalchemy import text


def upgrade(conn):
    # SQLite: no-op (VARCHAR enum, value accepted automatically)
    pass


# ── PostgreSQL equivalent (run manually in Supabase SQL editor) ───────────────
#
# ALTER TYPE invoicestatus ADD VALUE IF NOT EXISTS 'ready' AFTER 'draft';
