"""Migration 095 — per-entity invoice/quote number zero-padding width.

The number generator previously hard-coded 5-digit zero padding
({counter:05d} -> BTP00739). Some entities (BTP, BKMO) actually use
un-padded numbers (BTP738, BKMO88), so the suggested next number never
matched their real sequence and the counter never advanced.

`invoice_number_padding` = minimum digit width. 0 = no padding (BTP739);
5 = legacy behaviour (OBHI03667). Applies to both invoices and quotes.
"""
from sqlalchemy import text


def upgrade(conn):
    if conn.dialect.name == "postgresql":
        conn.execute(text(
            "ALTER TABLE business_entities "
            "ADD COLUMN IF NOT EXISTS invoice_number_padding INTEGER NOT NULL DEFAULT 5"
        ))
    else:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(business_entities)"))]
        if "invoice_number_padding" not in cols:
            conn.execute(text(
                "ALTER TABLE business_entities "
                "ADD COLUMN invoice_number_padding INTEGER NOT NULL DEFAULT 5"
            ))

    # Entities that use un-padded numbering in the real world.
    conn.execute(text(
        "UPDATE business_entities SET invoice_number_padding = 0 "
        "WHERE code IN ('BTP', 'BKMO')"
    ))

    conn.commit()
