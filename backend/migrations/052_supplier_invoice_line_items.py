"""Add is_multi_line to supplier_invoices and create supplier_invoice_line_items table."""
from sqlalchemy import text

def upgrade(conn):
    # Add is_multi_line column to supplier_invoices
    try:
        conn.execute(text("ALTER TABLE supplier_invoices ADD COLUMN is_multi_line BOOLEAN NOT NULL DEFAULT FALSE"))
    except Exception:
        pass

    # Create line items table (PostgreSQL)
    try:
        conn.execute(text("""
            CREATE TABLE supplier_invoice_line_items (
                id               SERIAL PRIMARY KEY,
                invoice_id       INTEGER NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
                sort_order       INTEGER NOT NULL DEFAULT 0,
                item_code        VARCHAR(100),
                item_description TEXT,
                quantity         NUMERIC(12,3),
                unit             VARCHAR(50),
                amount_excl_vat  NUMERIC(12,2) NOT NULL DEFAULT 0,
                amount_incl_vat  NUMERIC(12,2) NOT NULL DEFAULT 0,
                created_at       TIMESTAMPTZ DEFAULT NOW()
            )
        """))
    except Exception:
        # SQLite fallback
        try:
            conn.execute(text("""
                CREATE TABLE supplier_invoice_line_items (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_id       INTEGER NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
                    sort_order       INTEGER NOT NULL DEFAULT 0,
                    item_code        TEXT,
                    item_description TEXT,
                    quantity         REAL,
                    unit             TEXT,
                    amount_excl_vat  REAL NOT NULL DEFAULT 0,
                    amount_incl_vat  REAL NOT NULL DEFAULT 0,
                    created_at       TEXT DEFAULT (datetime('now'))
                )
            """))
        except Exception:
            pass

    try:
        conn.execute(text("""
            CREATE INDEX ix_supplier_invoice_line_items_invoice_id
            ON supplier_invoice_line_items(invoice_id)
        """))
    except Exception:
        pass

    conn.commit()
