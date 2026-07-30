"""Migration 122 — budgets.external_profit: "Profit According to Johan's Profit Sheet".

The Safetec budget summary reconciles the budget's own profit against the profit
on Johan's separate profit sheet. That sheet doesn't exist in this system, so the
figure can't be derived — the user types it in per budget (i.e. per base month)
and it is stored here. NULL = not captured yet; the card shows a dash.

Display-only: it never feeds Expenses, Profit or Actual Profit.
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"
    col = "NUMERIC(15, 2)" if is_pg else "NUMERIC"
    conn.execute(text(f"ALTER TABLE budgets ADD COLUMN external_profit {col}"))


def downgrade(conn):
    conn.execute(text("ALTER TABLE budgets DROP COLUMN external_profit"))
