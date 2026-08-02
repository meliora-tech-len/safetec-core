"""Migration 124 — budget_lines.name_overridden.

Budget line names are now editable in place. Auto lines get their name rewritten
on every "Pull from System" (so a renamed supplier shows through), which would
silently undo a hand-typed name. This flag records that the user typed the name
themselves; the pull then refreshes the amounts but leaves the name alone.

Manual/constant lines are never renamed by a pull, so the flag is a no-op there.
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"
    col = "BOOLEAN NOT NULL DEFAULT FALSE" if is_pg else "BOOLEAN NOT NULL DEFAULT 0"
    conn.execute(text(f"ALTER TABLE budget_lines ADD COLUMN name_overridden {col}"))


def downgrade(conn):
    conn.execute(text("ALTER TABLE budget_lines DROP COLUMN name_overridden"))
