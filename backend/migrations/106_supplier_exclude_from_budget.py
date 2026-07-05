"""
Migration 106: supplier budget-exclusion flag.

Lets a supplier be excluded from the Budgets module's "Pull from system"
auto-fill entirely (e.g. a supplier the user never wants reflected in a
budget), independent of its diesel/intercompany/payment-term classification.
"""
from sqlalchemy import text


def upgrade(conn):
    # IF NOT EXISTS so a manual re-run (raw SQL) doesn't error on an existing column.
    conn.execute(text(
        "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS exclude_from_budget BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    conn.commit()
