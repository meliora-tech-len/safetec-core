"""Migration 092 — fixed (recurring) general expense columns.

A general expense flagged as fixed is carried forward into each later month's
costing. `is_fixed_expense` marks the flag; `fixed_expense_group_id` links all
clones in one carry-forward chain (= the origin invoice id).
"""
from sqlalchemy import text


def upgrade(conn):
    if conn.dialect.name == "postgresql":
        conn.execute(text(
            "ALTER TABLE supplier_invoices "
            "ADD COLUMN IF NOT EXISTS is_fixed_expense BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        conn.execute(text(
            "ALTER TABLE supplier_invoices "
            "ADD COLUMN IF NOT EXISTS fixed_expense_group_id INTEGER"
        ))
    else:
        # SQLite has no ADD COLUMN IF NOT EXISTS — probe the table first.
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(supplier_invoices)"))]
        if "is_fixed_expense" not in cols:
            conn.execute(text(
                "ALTER TABLE supplier_invoices "
                "ADD COLUMN is_fixed_expense BOOLEAN NOT NULL DEFAULT 0"
            ))
        if "fixed_expense_group_id" not in cols:
            conn.execute(text(
                "ALTER TABLE supplier_invoices ADD COLUMN fixed_expense_group_id INTEGER"
            ))

    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_supplier_invoices_fixed_expense_group_id "
        "ON supplier_invoices (fixed_expense_group_id)"
    ))

    conn.commit()
