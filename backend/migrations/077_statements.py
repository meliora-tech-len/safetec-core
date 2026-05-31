"""Migration 077 — Create statements and statement_lines tables."""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS statements (
            id            BIGSERIAL PRIMARY KEY,
            entity_id     INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE RESTRICT,
            customer_id   INTEGER          REFERENCES customers(id)          ON DELETE RESTRICT,
            statement_type VARCHAR(50) NOT NULL DEFAULT 'invoice',
            statement_date DATE NOT NULL,
            title          VARCHAR(200),
            notes          TEXT,
            created_by_id  INTEGER          REFERENCES users(id)             ON DELETE SET NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ
        )
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS statement_lines (
            id             BIGSERIAL PRIMARY KEY,
            statement_id   BIGINT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
            line_date      DATE,
            description    TEXT,
            invoice_number VARCHAR(100),
            amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
            sort_order     INTEGER NOT NULL DEFAULT 0
        )
    """))

    conn.commit()
