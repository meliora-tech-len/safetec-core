"""
Migration 010: Add mines, mine_rates, truck_loads, driver_salary_configs tables.

Run against Supabase/PostgreSQL before deploying.
SQLite: tables are auto-created by SQLAlchemy on startup — run this only for PostgreSQL.
"""

from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS mines (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            code VARCHAR(30) NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS mine_rates (
            id SERIAL PRIMARY KEY,
            mine_id INTEGER NOT NULL REFERENCES mines(id) ON DELETE CASCADE,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            rate_per_ton NUMERIC(10,2) NOT NULL,
            effective_from TIMESTAMPTZ NOT NULL,
            effective_to TIMESTAMPTZ,
            notes VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_mine_rates_mine_entity
        ON mine_rates(mine_id, entity_id);
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS truck_loads (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE RESTRICT,
            truck_id INTEGER NOT NULL REFERENCES trucks(id) ON DELETE RESTRICT,
            mine_id INTEGER NOT NULL REFERENCES mines(id) ON DELETE RESTRICT,
            load_date TIMESTAMPTZ NOT NULL,
            slip_number VARCHAR(50),
            po_number VARCHAR(50),
            driver_name VARCHAR(100),
            tonnes NUMERIC(8,3) NOT NULL,
            rate_per_ton NUMERIC(10,2) NOT NULL,
            amount_excl_vat NUMERIC(12,2),
            amount_incl_vat NUMERIC(12,2),
            diesel_litres NUMERIC(10,3),
            diesel_invoice VARCHAR(50),
            diesel_rate NUMERIC(10,4),
            date_paid TIMESTAMPTZ,
            is_paid BOOLEAN NOT NULL DEFAULT FALSE,
            notes TEXT,
            checked_by VARCHAR(50),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        );
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_truck_loads_entity_date
        ON truck_loads(entity_id, load_date DESC);
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_truck_loads_truck
        ON truck_loads(truck_id);
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS driver_salary_configs (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            truck_id INTEGER REFERENCES trucks(id) ON DELETE CASCADE,
            driver_name VARCHAR(100) NOT NULL,
            base_salary_near_route NUMERIC(10,2),
            base_salary_far_route NUMERIC(10,2),
            extra_per_load_far NUMERIC(10,2),
            deduction_near NUMERIC(10,2),
            effective_from TIMESTAMPTZ,
            effective_to TIMESTAMPTZ,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_driver_salary_configs_entity
        ON driver_salary_configs(entity_id);
    """))


def downgrade(conn):
    conn.execute(text("DROP TABLE IF EXISTS driver_salary_configs CASCADE;"))
    conn.execute(text("DROP TABLE IF EXISTS truck_loads CASCADE;"))
    conn.execute(text("DROP TABLE IF EXISTS mine_rates CASCADE;"))
    conn.execute(text("DROP TABLE IF EXISTS mines CASCADE;"))
