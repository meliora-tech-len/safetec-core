"""
Migration 022: Add operator, contract_context, temp_registration to trucks.

operator         – who operates the truck (None = entity-owned).
                   e.g. "Betopess", "Alex Maintenance", "Julian"
contract_context – which work programme the truck belongs to.
                   e.g. "OBHI", "Safetec", "Intsimbi"
temp_registration – old or temporary plate (e.g. GP reg before EC transfer).

These three fields drive the sub-fleet grouping in the Truck Loads UI.

PostgreSQL: run via Supabase SQL editor.
SQLite: handled below with duplicate-column guard.
"""

from sqlalchemy import text


def upgrade(conn):
    for ddl in [
        "ALTER TABLE trucks ADD COLUMN operator          VARCHAR(100);",
        "ALTER TABLE trucks ADD COLUMN contract_context  VARCHAR(100);",
        "ALTER TABLE trucks ADD COLUMN temp_registration VARCHAR(50);",
    ]:
        try:
            conn.execute(text(ddl))
        except Exception:
            pass  # column already present
