"""
Migration 121: profit_sheet_report_rows.is_hidden.

The Profit Sheet report builds one line per own-fleet truck from live data, so a
line the user deletes off the report would simply be rebuilt on the next load.
This flag records that decision: a hidden row is kept out of the table, the
totals and the exports, but the truck itself is untouched and the line can be
restored. Hand-added (truck_id NULL) lines are deleted outright instead — there
is nothing to recalculate them from.
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        # IF NOT EXISTS so a manual re-run (raw SQL) doesn't error on an existing column.
        conn.execute(text(
            "ALTER TABLE profit_sheet_report_rows "
            "ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE"
        ))
    else:
        # SQLite has no ADD COLUMN IF NOT EXISTS — check the table first.
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(profit_sheet_report_rows)")).fetchall()}
        if "is_hidden" not in cols:
            conn.execute(text(
                "ALTER TABLE profit_sheet_report_rows "
                "ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT 0"
            ))

    conn.commit()
    print("  profit_sheet_report_rows.is_hidden ready")
