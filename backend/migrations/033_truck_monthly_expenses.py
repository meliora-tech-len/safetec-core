"""
Migration 033: Create truck_monthly_expenses table (Profit Sheet per truck per month).

SQLite: applied by upgrade() — safe to re-run.
PostgreSQL/Supabase: run the SQL block manually via the SQL editor.
"""

from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS truck_monthly_expenses (
            id                   SERIAL PRIMARY KEY,
            truck_id             INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
            year                 INTEGER NOT NULL,
            month                INTEGER NOT NULL,
            income_excl_vat      NUMERIC(12, 2),
            income_incl_vat      NUMERIC(12, 2),
            drivers_salary       NUMERIC(12, 2),
            insurance_trailer    NUMERIC(12, 2),
            liability_3rd_party  NUMERIC(12, 2),
            goods_in_transit     NUMERIC(12, 2),
            loss_of_use          NUMERIC(12, 2),
            personal_accident    NUMERIC(12, 2),
            communication_device NUMERIC(12, 2),
            sauma                NUMERIC(12, 2),
            diesel               NUMERIC(12, 2),
            tyre_maintenance     NUMERIC(12, 2),
            other_suppliers      NUMERIC(12, 2),
            notes                TEXT,
            created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (truck_id, year, month)
        )
    """))
