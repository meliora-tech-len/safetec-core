"""Migration 091 — archive orphaned diesel placeholder invoices.

A diesel log saved with a slip number auto-creates a placeholder supplier invoice
that uses the slip as a stand-in invoice number. When the real supplier invoice is
later imported, the import re-links the fill-up to the imported invoice but (before
the accompanying code fix) left the placeholder behind, so it lingered as a
duplicate "pending" row on the Supplier Profile.

This one-off archives those already-orphaned placeholders. It is deliberately
conservative — it only touches a placeholder that:
  • is not already archived,
  • is single-line (not an imported multi-line invoice) and has NO line items,
  • belongs to a diesel supplier,
  • has NO non-archived fill-up still pointing at it (its fill-up moved away), and
  • whose invoice_number (the slip) is now carried by a fill-up linked to a
    DIFFERENT invoice — i.e. the slip was provably absorbed elsewhere.

Idempotent: re-running archives nothing new.
"""
from sqlalchemy import text


def upgrade(conn):
    result = conn.execute(text("""
        UPDATE supplier_invoices
        SET is_archived = TRUE
        WHERE COALESCE(supplier_invoices.is_archived, FALSE) = FALSE
          AND COALESCE(supplier_invoices.is_multi_line, FALSE) = FALSE
          AND supplier_invoices.invoice_number IS NOT NULL
          AND supplier_invoices.invoice_number <> ''
          AND NOT EXISTS (
              SELECT 1 FROM supplier_invoice_line_items li
              WHERE li.invoice_id = supplier_invoices.id
          )
          AND EXISTS (
              SELECT 1 FROM suppliers s
              WHERE s.id = supplier_invoices.supplier_id
                AND s.is_diesel_supplier = TRUE
          )
          AND NOT EXISTS (
              SELECT 1 FROM diesel_fillups df
              WHERE df.supplier_invoice_id = supplier_invoices.id
                AND COALESCE(df.is_archived, FALSE) = FALSE
          )
          AND EXISTS (
              SELECT 1 FROM diesel_fillups df2
              WHERE df2.slip_number = supplier_invoices.invoice_number
                AND df2.entity_id = supplier_invoices.entity_id
                AND df2.supplier_invoice_id IS NOT NULL
                AND df2.supplier_invoice_id <> supplier_invoices.id
                AND COALESCE(df2.is_archived, FALSE) = FALSE
          )
    """))

    conn.commit()
    try:
        print(f"Archived {result.rowcount} orphaned diesel placeholder invoice(s)")
    except Exception:
        pass
