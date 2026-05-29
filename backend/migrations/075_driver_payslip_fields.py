"""
Migration 075 — Add payslip-related fields to drivers table.
Adds: date_engaged, address, branch_code, job_title
"""
from sqlalchemy import text


def upgrade(conn):
    stmts = [
        "ALTER TABLE drivers ADD COLUMN date_engaged DATE",
        "ALTER TABLE drivers ADD COLUMN address TEXT",
        "ALTER TABLE drivers ADD COLUMN branch_code VARCHAR(20)",
        "ALTER TABLE drivers ADD COLUMN job_title VARCHAR(200)",
    ]
    for stmt in stmts:
        try:
            conn.execute(text(stmt))
        except Exception:
            pass
    conn.commit()
