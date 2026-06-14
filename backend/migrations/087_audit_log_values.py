"""
Migration 087 — Add old_values / new_values to audit_logs.

AuditLog.old_values and AuditLog.new_values (JSON) store the field-level before/after
snapshot for record edits, surfaced in the audit trail. The model columns were added
earlier but never had a tracked migration, so a fresh deploy would be missing them.
This backfills the columns on existing databases.

Nullable: legacy rows keep NULL (no diff was captured at the time).
"""
from sqlalchemy import text


def upgrade(conn):
    for column in ("old_values", "new_values"):
        try:
            conn.execute(text(
                f"ALTER TABLE audit_logs ADD COLUMN {column} JSON"
            ))
        except Exception:
            pass  # column already exists
    conn.commit()
