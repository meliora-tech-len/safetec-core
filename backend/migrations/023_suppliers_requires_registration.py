"""
Migration 023: Add requires_registration to suppliers.

requires_registration — when False, the supplier does not use a company
registration number (e.g. telecoms/utilities like Axxess). The field is
hidden in the UI and excluded from invoice documents.

Defaults to 1 (True) so all existing suppliers are unaffected.
"""

from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text(
            "ALTER TABLE suppliers ADD COLUMN requires_registration BOOLEAN NOT NULL DEFAULT 1;"
        ))
    except Exception:
        pass  # column already present
