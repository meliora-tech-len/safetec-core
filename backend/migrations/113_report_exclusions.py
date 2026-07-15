"""Migration 113 — report_exclusions: let users drop a row from the SARS report.

The Income vs Expenses / SARS report already carried a handful of hardcoded
report-only adjustments (Sasfin, Trailer Maintenance, general costing expenses),
each of which needed a code change. This table is the user-controlled version of
the same idea: mark one record as "not needed on this report".

Report-only and reversible by construction — nothing here modifies the invoice, so
costing, diesel and payouts are unaffected, and restoring just deletes the row.
Polymorphic over the report's two sides: 'invoice' (customer invoices / output VAT)
and 'supplier_invoice' (expenses / input VAT).
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS report_exclusions (
                id             SERIAL PRIMARY KEY,
                entity_id      INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
                record_type    VARCHAR(30) NOT NULL,
                record_id      INTEGER NOT NULL,
                reason         TEXT,
                excluded_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                excluded_at    TIMESTAMPTZ DEFAULT NOW()
            )
        """))
    else:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS report_exclusions (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id      INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
                record_type    VARCHAR(30) NOT NULL,
                record_id      INTEGER NOT NULL,
                reason         TEXT,
                excluded_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                excluded_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

    # One exclusion per record — the report asks "is this record excluded?", so a
    # duplicate would be meaningless and makes restore ambiguous.
    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_report_exclusion_record
        ON report_exclusions (record_type, record_id)
    """))
    # The report filters by entity for a whole year, so it looks these up by entity.
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_report_exclusions_entity
        ON report_exclusions (entity_id)
    """))

    conn.commit()
    print("  created report_exclusions")
