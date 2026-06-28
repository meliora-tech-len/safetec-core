"""Migration 100 — manual costing income lines.

Adds `truck_costing_incomes`: a manual income line entered directly in the
costing module for a truck + costing period. It mirrors the "general expense"
but on the income side, and is deliberately isolated to the costing view — it
is neither a TruckLoad nor a SupplierInvoice, so it never flows into the Income
vs Expenses report or the Supplier Invoice Profile.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS truck_costing_incomes (
            id             SERIAL PRIMARY KEY,
            truck_id       INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
            month          INTEGER NOT NULL,
            year           INTEGER NOT NULL,
            description    TEXT NOT NULL,
            amount         NUMERIC(12, 2) NOT NULL,
            vat_applicable BOOLEAN NOT NULL DEFAULT TRUE,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_by_id  INTEGER REFERENCES users(id) ON DELETE SET NULL
        )
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_truck_costing_incomes_period
        ON truck_costing_incomes (truck_id, month, year)
    """))

    conn.commit()
