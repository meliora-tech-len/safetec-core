"""Migration 094 — manual net-payable override on truck costing notes.

The costing module computes each truck's "To Be Paid Out" from income minus
expenses. Users can now override that figure manually (e.g. to fold in an
out-of-band adjustment). The override lives on the existing per-truck/period
overlay row (`truck_costing_notes`); null means use the calculated value.
"""
from sqlalchemy import text


def upgrade(conn):
    if conn.dialect.name == "postgresql":
        conn.execute(text(
            "ALTER TABLE truck_costing_notes "
            "ADD COLUMN IF NOT EXISTS net_payable_override NUMERIC(12, 2)"
        ))
    else:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(truck_costing_notes)"))]
        if "net_payable_override" not in cols:
            conn.execute(text(
                "ALTER TABLE truck_costing_notes ADD COLUMN net_payable_override NUMERIC(12, 2)"
            ))

    conn.commit()
