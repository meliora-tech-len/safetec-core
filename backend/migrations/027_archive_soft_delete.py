"""
Migration 027: Add is_archived flag for soft-delete support.

Adds is_archived (default FALSE) to:
  - truck_loads
  - diesel_fillups
  - supplier_invoices
  - driver_additional_loads

Archived records are excluded from all queries and calculations but remain
in the database for audit purposes. Use the /archive PATCH endpoints to
set is_archived = true (vs the DELETE endpoints which permanently remove).

PostgreSQL/Supabase: run via SQL editor.
SQLite (local dev): applied by _add() helper below — safe to re-run.
"""

from sqlalchemy import text


def _add(conn, sql):
    try:
        conn.execute(text(sql))
    except Exception:
        pass  # column already present


def upgrade(conn):
    _add(conn, "ALTER TABLE truck_loads ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;")
    _add(conn, "ALTER TABLE diesel_fillups ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;")
    _add(conn, "ALTER TABLE supplier_invoices ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;")
    _add(conn, "ALTER TABLE driver_additional_loads ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;")
    conn.commit()
