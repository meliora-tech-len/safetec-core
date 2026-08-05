"""Migration 130 — supplier_statements: one month-end statement document + note
per supplier statement period.

Supplier Profile already attaches the physical document to each individual
invoice. Suppliers also send ONE consolidated statement for the whole month, and
that document belongs to the month header (where the totals are), not to any one
invoice — so it gets its own table rather than another column on supplier_invoices.
The same row carries a free-text note for the month.

Keyed on (supplier_id, statement_year, statement_month) — the exact grouping the
profile uses — so a supplier billing under more than one entity still has a single
statement per month. Rows are created lazily by the API: a month with neither a
document nor a note has no row.
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS supplier_statements (
                id                        SERIAL PRIMARY KEY,
                supplier_id               INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
                statement_month           INTEGER NOT NULL,
                statement_year            INTEGER NOT NULL,
                note                      TEXT,
                note_updated_at           TIMESTAMPTZ,
                note_updated_by_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
                attachment_key            VARCHAR(500),
                attachment_filename       VARCHAR(300),
                attachment_content_type   VARCHAR(100),
                attachment_size           INTEGER,
                attachment_uploaded_at    TIMESTAMPTZ,
                attachment_uploaded_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at                TIMESTAMPTZ DEFAULT NOW(),
                updated_at                TIMESTAMPTZ
            )
        """))
    else:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS supplier_statements (
                id                        INTEGER PRIMARY KEY AUTOINCREMENT,
                supplier_id               INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
                statement_month           INTEGER NOT NULL,
                statement_year            INTEGER NOT NULL,
                note                      TEXT,
                note_updated_at           TIMESTAMP,
                note_updated_by_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
                attachment_key            VARCHAR(500),
                attachment_filename       VARCHAR(300),
                attachment_content_type   VARCHAR(100),
                attachment_size           INTEGER,
                attachment_uploaded_at    TIMESTAMP,
                attachment_uploaded_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at                TIMESTAMP
            )
        """))

    # One statement per supplier per period — the upsert in the API relies on this.
    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_statement_period
        ON supplier_statements (supplier_id, statement_year, statement_month)
    """))
    # The profile loads every statement for one supplier in a single query.
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_supplier_statement_supplier
        ON supplier_statements (supplier_id)
    """))

    conn.commit()
    print("  created supplier_statements")
