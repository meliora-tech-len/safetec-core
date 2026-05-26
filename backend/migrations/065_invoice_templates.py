"""
Migration 065: Invoice Templates
Creates invoice_templates and invoice_template_line_items tables.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS invoice_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id),
            supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
            customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
            name VARCHAR(200) NOT NULL,
            document_type VARCHAR(20) NOT NULL DEFAULT 'invoice',
            is_vat_exempt BOOLEAN NOT NULL DEFAULT 0,
            vat_rate NUMERIC(5,4) DEFAULT 0.15,
            notes TEXT,
            print_note BOOLEAN NOT NULL DEFAULT 0,
            terms TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        )
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS invoice_template_line_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL REFERENCES invoice_templates(id) ON DELETE CASCADE,
            description TEXT,
            is_vat_exempt BOOLEAN NOT NULL DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            line_type VARCHAR(20) DEFAULT 'item',
            quantity NUMERIC(12,4),
            unit_price NUMERIC(12,2),
            amount NUMERIC(12,2)
        )
    """))

    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoice_templates_entity_id ON invoice_templates(entity_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoice_template_line_items_template_id ON invoice_template_line_items(template_id)"))
