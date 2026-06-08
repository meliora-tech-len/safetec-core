"""
Migration 083: supplier intercompany flag.

Marks a supplier as an intercompany counterparty (e.g. OBHI, Border) so the
SARS/VAT expense breakdown can group its invoices separately from diesel,
subcontractor and other supplier invoices.
"""
from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text(
            "ALTER TABLE suppliers ADD COLUMN is_intercompany BOOLEAN NOT NULL DEFAULT FALSE"
        ))
    except Exception:
        pass  # column already exists
    conn.commit()
