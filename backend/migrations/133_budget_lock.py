"""Migration 133: budget lock columns.

A budget can now be LOCKED (mirrors the costing "Sent" lock): a locked budget
is final — no sections, lines, amounts or bank rows may be added, changed or
removed until it is unlocked. NULL locked_at = unlocked.

Idempotent (ADD COLUMN IF NOT EXISTS); PostgreSQL (prod) — SQLite dev gets the
columns from main.py's Base.metadata.create_all on a fresh database.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE budgets
        ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ
    """))
    conn.execute(text("""
        ALTER TABLE budgets
        ADD COLUMN IF NOT EXISTS locked_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    """))
