"""Migration 096 — budget auto-fill source tracking.

Adds the columns needed for "pull from system" budget auto-population:
  budget_lines.source       — 'manual' (user-added) | 'auto' (system-generated)
  budget_lines.source_key   — what an auto line tracks, e.g. 'supplier:42'
  budget_line_values.is_overridden — set when a user hand-edits an auto cell so a
                                      later refresh leaves that value alone.

All backward-compatible (defaults preserve existing rows as manual / not-overridden).
"""
from sqlalchemy import text


def upgrade(conn):
    pg = conn.dialect.name == "postgresql"

    if pg:
        conn.execute(text(
            "ALTER TABLE budget_lines "
            "ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual'"
        ))
        conn.execute(text(
            "ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS source_key VARCHAR(120)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_budget_lines_source_key ON budget_lines (source_key)"
        ))
        conn.execute(text(
            "ALTER TABLE budget_line_values "
            "ADD COLUMN IF NOT EXISTS is_overridden BOOLEAN NOT NULL DEFAULT false"
        ))
    else:
        line_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(budget_lines)"))]
        if "source" not in line_cols:
            conn.execute(text(
                "ALTER TABLE budget_lines ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual'"
            ))
        if "source_key" not in line_cols:
            conn.execute(text("ALTER TABLE budget_lines ADD COLUMN source_key VARCHAR(120)"))
        val_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(budget_line_values)"))]
        if "is_overridden" not in val_cols:
            conn.execute(text(
                "ALTER TABLE budget_line_values ADD COLUMN is_overridden BOOLEAN NOT NULL DEFAULT 0"
            ))

    conn.commit()
