"""
Migration 034: Add casual mine-group rate columns to payroll_settings,
               add casual_group_a/b_loads to driver_pay_cycles,
               add casual_group to mines.

PostgreSQL/Supabase: run the SQL block manually via the SQL editor.
"""

from sqlalchemy import text


def _add(conn, sql):
    try:
        conn.execute(text(sql))
    except Exception:
        pass  # column already exists


def upgrade(conn):
    # PayrollSettings — two new rate columns
    _add(conn, "ALTER TABLE payroll_settings ADD COLUMN casual_rate_group_a NUMERIC(12,2) NOT NULL DEFAULT 2200.00")
    _add(conn, "ALTER TABLE payroll_settings ADD COLUMN casual_rate_group_b NUMERIC(12,2) NOT NULL DEFAULT 1900.00")

    # DriverPayCycle — per-group load counts
    _add(conn, "ALTER TABLE driver_pay_cycles ADD COLUMN casual_group_a_loads INTEGER NOT NULL DEFAULT 0")
    _add(conn, "ALTER TABLE driver_pay_cycles ADD COLUMN casual_group_b_loads INTEGER NOT NULL DEFAULT 0")

    # Mines — group classification
    _add(conn, "ALTER TABLE mines ADD COLUMN casual_group VARCHAR(1)")

    # Seed the group assignments for the nine named mines
    conn.execute(text("""
        UPDATE mines SET casual_group = 'A'
        WHERE LOWER(name) IN ('mokala','assmang','sebilo','tawana')
    """))
    conn.execute(text("""
        UPDATE mines SET casual_group = 'B'
        WHERE LOWER(name) IN ('glosam','driehoek','future','afrimat','boskop')
    """))
