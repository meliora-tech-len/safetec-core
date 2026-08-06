"""Migration 131: budget_income_assignments table.

The income modal now aggregates ticked candidates into two generic INCOME
lines (TRADEKOR INCOME ONLY / OTHER INCOME) instead of one line per PO. The
per-candidate bucket choice can't be recovered from those summed lines, so it
is stored here — one row per (budget, candidate source_key).

Idempotent (CREATE TABLE IF NOT EXISTS); PostgreSQL (prod) — SQLite dev gets
the table from main.py's Base.metadata.create_all on startup.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS budget_income_assignments (
            id SERIAL PRIMARY KEY,
            budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
            source_key VARCHAR(120) NOT NULL,
            bucket VARCHAR(20) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_budget_income_assignment UNIQUE (budget_id, source_key)
        )
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_budget_income_assignments_budget_id
        ON budget_income_assignments (budget_id)
    """))
