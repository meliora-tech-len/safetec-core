"""
Migration 013: Add Diesel Tracking Module tables.

Creates:
  - diesel_settings   (per-entity admin fee configuration)
  - diesel_rates      (versioned price-per-litre per supplier/entity)
  - diesel_fillups    (fill-up transaction records)
  - is_diesel_supplier column on suppliers

Run against Supabase/PostgreSQL before deploying.
SQLite: tables are auto-created by SQLAlchemy on startup.
"""

from sqlalchemy import text


def upgrade(conn):
    # ── 1. is_diesel_supplier flag on suppliers ───────────────────────────────
    conn.execute(text("""
        ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS is_diesel_supplier BOOLEAN NOT NULL DEFAULT FALSE;
    """))

    # ── 2. diesel_settings ────────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS diesel_settings (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            admin_fee_pct NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
            apply_admin_fee BOOLEAN NOT NULL DEFAULT TRUE,
            updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (entity_id)
        );
    """))

    # Seed diesel_settings for all existing entities
    conn.execute(text("""
        INSERT INTO diesel_settings (entity_id, admin_fee_pct, apply_admin_fee)
        SELECT id, 0.0000, TRUE FROM business_entities
        ON CONFLICT (entity_id) DO NOTHING;
    """))

    # ── 3. diesel_rates ───────────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS diesel_rates (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
            rate_per_litre NUMERIC(10,4) NOT NULL,
            effective_date DATE NOT NULL,
            notes TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_diesel_rates_supplier_entity
            ON diesel_rates (supplier_id, entity_id);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_diesel_rates_effective_date
            ON diesel_rates (effective_date DESC);
    """))

    # ── 4. diesel_fillups ─────────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS diesel_fillups (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE RESTRICT,
            truck_id INTEGER NOT NULL REFERENCES trucks(id) ON DELETE RESTRICT,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
            fillup_date DATE NOT NULL,
            litres NUMERIC(10,2) NOT NULL,
            rate_per_litre NUMERIC(10,4) NOT NULL,
            amount NUMERIC(12,2) NOT NULL,
            admin_fee_pct NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
            admin_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
            total_amount NUMERIC(12,2) NOT NULL,
            invoice_number VARCHAR(100),
            slip_number VARCHAR(100),
            truckload_id INTEGER REFERENCES truck_loads(id) ON DELETE SET NULL,
            verified BOOLEAN NOT NULL DEFAULT FALSE,
            verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            verified_at TIMESTAMPTZ,
            notes TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        );
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_diesel_fillups_entity
            ON diesel_fillups (entity_id);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_diesel_fillups_truck
            ON diesel_fillups (truck_id);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_diesel_fillups_supplier
            ON diesel_fillups (supplier_id);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_diesel_fillups_date
            ON diesel_fillups (fillup_date DESC);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_diesel_fillups_truckload
            ON diesel_fillups (truckload_id)
            WHERE truckload_id IS NOT NULL;
    """))


def downgrade(conn):
    conn.execute(text("DROP TABLE IF EXISTS diesel_fillups CASCADE;"))
    conn.execute(text("DROP TABLE IF EXISTS diesel_rates CASCADE;"))
    conn.execute(text("DROP TABLE IF EXISTS diesel_settings CASCADE;"))
    conn.execute(text("ALTER TABLE suppliers DROP COLUMN IF EXISTS is_diesel_supplier;"))
