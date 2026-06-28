"""Migration 099 — "skip" a supplier invoice off the admin verify list.

`verify_skipped` dismisses a recently-created invoice from the admin
"to verify" badge/modal without final-locking it. The invoice is untouched
otherwise — it can still be verified normally. `verify_skipped_by` /
`verify_skipped_at` record who dismissed it and when.
"""
from sqlalchemy import text


def upgrade(conn):
    if conn.dialect.name == "postgresql":
        conn.execute(text(
            "ALTER TABLE supplier_invoices "
            "ADD COLUMN IF NOT EXISTS verify_skipped BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        conn.execute(text(
            "ALTER TABLE supplier_invoices "
            "ADD COLUMN IF NOT EXISTS verify_skipped_by INTEGER"
        ))
        conn.execute(text(
            "ALTER TABLE supplier_invoices "
            "ADD COLUMN IF NOT EXISTS verify_skipped_at TIMESTAMPTZ"
        ))
    else:
        # SQLite has no ADD COLUMN IF NOT EXISTS — probe the table first.
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(supplier_invoices)"))]
        if "verify_skipped" not in cols:
            conn.execute(text(
                "ALTER TABLE supplier_invoices "
                "ADD COLUMN verify_skipped BOOLEAN NOT NULL DEFAULT 0"
            ))
        if "verify_skipped_by" not in cols:
            conn.execute(text(
                "ALTER TABLE supplier_invoices ADD COLUMN verify_skipped_by INTEGER"
            ))
        if "verify_skipped_at" not in cols:
            conn.execute(text(
                "ALTER TABLE supplier_invoices ADD COLUMN verify_skipped_at DATETIME"
            ))

    conn.commit()
