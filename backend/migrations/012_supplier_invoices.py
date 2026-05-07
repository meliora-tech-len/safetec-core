"""
Migration 012: Add supplier_invoices table and payment_term to suppliers.

supplier_invoices stores incoming supplier invoices (payables) with payment
term tracking, statement grouping, and verification workflow.

Run against Supabase/PostgreSQL before deploying.
SQLite: table is auto-created by SQLAlchemy on startup.
"""

from sqlalchemy import text


def upgrade(conn):
    # Add payment_term to suppliers table
    conn.execute(text("""
        ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS payment_term VARCHAR(20) NOT NULL DEFAULT 'current';
    """))

    # Create supplier_invoices table
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS supplier_invoices (
            id SERIAL PRIMARY KEY,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE RESTRICT,

            invoice_date TIMESTAMPTZ NOT NULL,
            invoice_number VARCHAR(100) NOT NULL,
            amount NUMERIC(12, 2) NOT NULL,
            vat_applicable BOOLEAN NOT NULL DEFAULT TRUE,
            vehicle_reg VARCHAR(50),
            description TEXT,

            statement_month INTEGER,
            statement_year INTEGER,

            is_verified BOOLEAN NOT NULL DEFAULT FALSE,
            verified_at TIMESTAMPTZ,
            payment_due_date TIMESTAMPTZ,
            is_paid BOOLEAN NOT NULL DEFAULT FALSE,
            paid_date TIMESTAMPTZ,
            payment_reference VARCHAR(200),

            notes TEXT,
            created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        );
    """))

    # Indexes for common query patterns
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_supplier_invoices_supplier_id
            ON supplier_invoices (supplier_id);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_supplier_invoices_entity_id
            ON supplier_invoices (entity_id);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_supplier_invoices_statement
            ON supplier_invoices (supplier_id, statement_year, statement_month);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_supplier_invoices_unpaid
            ON supplier_invoices (entity_id, is_paid, payment_due_date)
            WHERE is_paid = FALSE;
    """))


def downgrade(conn):
    conn.execute(text("DROP TABLE IF EXISTS supplier_invoices CASCADE;"))
    conn.execute(text("ALTER TABLE suppliers DROP COLUMN IF EXISTS payment_term;"))
