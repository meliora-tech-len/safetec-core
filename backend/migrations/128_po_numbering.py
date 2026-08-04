"""Migration 128 — purchase orders get their own number settings.

Until now a PO's number was not configurable at all: the prefix was hardcoded
"PO" and the counter was shared with invoices, so on BTP (invoice_counter 774)
the suggested PO number came out as PO775. The POs actually raised were typed
by hand as PO01/PO02/PO03, which also means the suggestion never matched the
real format — the same trap migration 095 fixed for invoices.

POs now get the full set, mirroring invoices/quotes but with their own padding:
BTP invoices are unpadded (BTP775) while its POs are two-digit (PO04).

  po_prefix          defaults to 'PO' (the old hardcoded value)
  po_counter         seeded from the highest existing PO per entity, so the
                     next suggestion follows on instead of colliding
  po_number_padding  NULL = fall back to invoice_number_padding
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE business_entities
        ADD COLUMN IF NOT EXISTS po_prefix VARCHAR(10) DEFAULT 'PO'
    """))
    conn.execute(text("""
        ALTER TABLE business_entities
        ADD COLUMN IF NOT EXISTS po_counter INTEGER NOT NULL DEFAULT 0
    """))
    conn.execute(text("""
        ALTER TABLE business_entities
        ADD COLUMN IF NOT EXISTS po_number_padding INTEGER
    """))
    conn.execute(text("UPDATE business_entities SET po_prefix = 'PO' WHERE po_prefix IS NULL"))

    # Seed the counter from the numeric tail of each entity's highest existing
    # PO number, so the next auto number continues the sequence the user
    # established by hand rather than restarting at 1.
    conn.execute(text("""
        UPDATE business_entities e
        SET po_counter = sub.max_n
        FROM (
            SELECT entity_id,
                   MAX(CAST(NULLIF(REGEXP_REPLACE(invoice_number, '^[^0-9]*', ''), '') AS INTEGER)) AS max_n
            FROM invoices
            WHERE document_type = 'purchase_order'
              AND REGEXP_REPLACE(invoice_number, '^[^0-9]*', '') ~ '^[0-9]+$'
            GROUP BY entity_id
        ) sub
        WHERE e.id = sub.entity_id AND sub.max_n IS NOT NULL
    """))

    # The existing POs are two-digit (PO01); keep that format for entities that
    # already have some, so the next suggestion looks like the last one.
    conn.execute(text("""
        UPDATE business_entities e
        SET po_number_padding = 2
        WHERE po_number_padding IS NULL
          AND EXISTS (
            SELECT 1 FROM invoices i
            WHERE i.entity_id = e.id AND i.document_type = 'purchase_order'
              AND i.invoice_number ~ '^[A-Za-z]*0[0-9]+$'
          )
    """))

    conn.commit()
