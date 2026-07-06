"""
Migration 110: subcontractors.end_date.

Lets a subcontractor be given a final engagement date (e.g. Julian's last
month as an OBHI subcontractor). Once end_date has passed, the subcontractor
and their truck(s) drop out of the "active" pickers used to capture new
loads/diesel/invoices, while all historical records and costing remain fully
intact and viewable.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text(
        "ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS end_date DATE"
    ))
    conn.commit()
