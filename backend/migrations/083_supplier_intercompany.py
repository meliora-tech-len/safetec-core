"""
Migration 083: supplier intercompany flag.

Marks a supplier as an intercompany counterparty (e.g. OBHI, Border) so the
SARS/VAT expense breakdown can group its invoices separately from diesel,
subcontractor and other supplier invoices.
"""
from sqlalchemy import text


def upgrade(conn):
    # IF NOT EXISTS so a manual re-run (raw SQL) doesn't error on an existing column.
    conn.execute(text(
        "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_intercompany BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    conn.commit()
