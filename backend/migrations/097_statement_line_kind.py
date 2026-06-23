"""Migration 097 — statement line kind.

Adds statement_lines.kind so a line can be explicitly classified instead of
being inferred from the sign of its amount:
  'invoice'   — an outstanding amount (positive)
  'payment'   — a payment received (negative; shown in the green PAID column)
  'deduction' — a credit/deduction (negative; reduces Amount Due but is reported
                under its own DEDUCTIONS total, NOT as 'Paid')

Backward-compatible: existing rows default to 'invoice'. The app still treats a
legacy 'invoice' row with a negative amount as a payment, so old statements keep
rendering the same way.
"""
from sqlalchemy import text


def upgrade(conn):
    pg = conn.dialect.name == "postgresql"

    if pg:
        conn.execute(text(
            "ALTER TABLE statement_lines "
            "ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'invoice'"
        ))
    else:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(statement_lines)"))]
        if "kind" not in cols:
            conn.execute(text(
                "ALTER TABLE statement_lines ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'invoice'"
            ))

    conn.commit()
