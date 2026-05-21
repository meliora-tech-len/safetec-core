"""
Migration 039: Normalise fleet_number — strip leading '#' prefix.

Some trucks were entered as '#1', '#2' etc. This strips the hash so all
fleet numbers are stored as plain digits ('1', '2', ...).

SQLite: applied by upgrade() — safe to re-run.

PostgreSQL / Supabase — run manually in the SQL editor:

    UPDATE trucks
    SET fleet_number = LTRIM(fleet_number, '#')
    WHERE fleet_number LIKE '#%';
"""

from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        UPDATE trucks
        SET fleet_number = LTRIM(fleet_number, '#')
        WHERE fleet_number LIKE '#%'
    """))
    conn.commit()
