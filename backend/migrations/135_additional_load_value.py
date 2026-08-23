"""Migration 135: customer load value on additional loads.

Safetec's additional (sand/Concor) loads were captured with only the driver's
payment (`amount`); the value the CUSTOMER is charged for the load lived in a
side spreadsheet only. `load_value` stores that charge EXCL VAT per load so the
Profit Sheet — the truck tab's income and the report's "Sand Loads (Incl VAT)"
column — can pull it through automatically (grossed up with the entity's saved
vat_rate) instead of the figure being typed over by hand.

Idempotent (ADD COLUMN IF NOT EXISTS); PostgreSQL (prod) — SQLite dev gets the
column from main.py's Base.metadata.create_all on a fresh database.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE driver_additional_loads
        ADD COLUMN IF NOT EXISTS load_value NUMERIC(12, 2)
    """))
