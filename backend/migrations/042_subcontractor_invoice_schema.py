"""
Migration 042: Add subcontractor_id to supplier_invoices, make supplier_id nullable.

Allows SupplierInvoice records to be created directly for a subcontractor (the
subcontractor acts as the billing entity, so no third-party supplier is needed).

SQLite (dev): recreates the supplier_invoices table with the new schema.
PostgreSQL / Supabase — run manually in the SQL editor:

    ALTER TABLE supplier_invoices ALTER COLUMN supplier_id DROP NOT NULL;
    ALTER TABLE supplier_invoices
        ADD COLUMN IF NOT EXISTS subcontractor_id INTEGER
        REFERENCES subcontractors(id) ON DELETE CASCADE;
"""

from sqlalchemy import text


def upgrade(conn):
    # Try PostgreSQL first (supports ALTER COLUMN syntax)
    try:
        conn.execute(text(
            "ALTER TABLE supplier_invoices ALTER COLUMN supplier_id DROP NOT NULL"
        ))
        conn.execute(text(
            "ALTER TABLE supplier_invoices "
            "ADD COLUMN IF NOT EXISTS subcontractor_id INTEGER "
            "REFERENCES subcontractors(id) ON DELETE CASCADE"
        ))
        conn.commit()
        return
    except Exception:
        conn.rollback()

    # SQLite: check if migration was already applied
    try:
        conn.execute(text("SELECT subcontractor_id FROM supplier_invoices LIMIT 0"))
        return  # column already exists, done
    except Exception:
        conn.rollback()

    # SQLite: recreate table to drop the NOT NULL constraint on supplier_id
    conn.execute(text("""
        CREATE TABLE supplier_invoices_new (
            id                INTEGER NOT NULL PRIMARY KEY,
            supplier_id       INTEGER,
            subcontractor_id  INTEGER,
            entity_id         INTEGER NOT NULL,
            invoice_date      DATETIME NOT NULL,
            invoice_number    VARCHAR(100) NOT NULL,
            amount            NUMERIC(12,2) NOT NULL,
            litres            NUMERIC(10,3),
            vat_applicable    BOOLEAN DEFAULT 1,
            is_archived       BOOLEAN NOT NULL DEFAULT 0,
            vehicle_reg       VARCHAR(50),
            description       TEXT,
            statement_month   INTEGER,
            statement_year    INTEGER,
            is_verified       BOOLEAN DEFAULT 0,
            verified_by       INTEGER,
            verified_at       DATETIME,
            verified2_by      INTEGER,
            verified2_at      DATETIME,
            payment_due_date  DATETIME,
            is_paid           BOOLEAN DEFAULT 0,
            paid_date         DATETIME,
            payment_reference VARCHAR(200),
            notes             TEXT,
            created_by_id     INTEGER,
            created_at        DATETIME,
            updated_at        DATETIME
        )
    """))
    conn.execute(text("""
        INSERT INTO supplier_invoices_new (
            id, supplier_id, subcontractor_id, entity_id,
            invoice_date, invoice_number, amount, litres,
            vat_applicable, is_archived, vehicle_reg, description,
            statement_month, statement_year,
            is_verified, verified_by, verified_at,
            verified2_by, verified2_at,
            payment_due_date, is_paid, paid_date, payment_reference,
            notes, created_by_id, created_at, updated_at
        )
        SELECT
            id, supplier_id, NULL, entity_id,
            invoice_date, invoice_number, amount, litres,
            vat_applicable, is_archived, vehicle_reg, description,
            statement_month, statement_year,
            is_verified, verified_by, verified_at,
            verified2_by, verified2_at,
            payment_due_date, is_paid, paid_date, payment_reference,
            notes, created_by_id, created_at, updated_at
        FROM supplier_invoices
    """))
    conn.execute(text("DROP TABLE supplier_invoices"))
    conn.execute(text("ALTER TABLE supplier_invoices_new RENAME TO supplier_invoices"))
    try:
        conn.execute(text(
            "CREATE INDEX ix_supplier_invoices_id ON supplier_invoices (id)"
        ))
    except Exception:
        pass
    conn.commit()
