"""Migration 127 — document-level quantity adjustment on invoices/POs.

Border Trade Post's POs bill a tonnage that is the weighbridge net mass plus a
fixed percentage (currently +1.53%), e.g. 32.56 t net -> 33.06 t billed. Until
now the capturer had to work that out on a calculator and type the answer into
Qty, so nothing recorded that the figure was derived or what it was derived
from.

The adjustment is captured once per document (not per line):
  invoices.qty_adjustment_pct    the percentage, e.g. 1.5300. NULL = off.
  invoices.qty_adjustment_scope  'all' = every item line, 'selected' = only
                                 lines flagged with qty_adjusted.

and each line keeps both figures:
  invoice_line_items.base_quantity  what was captured (the net mass in tons)
  invoice_line_items.qty_adjusted   whether this line takes the adjustment

`quantity` stays the billed (adjusted) figure so every existing consumer —
totals, the PDF, the PO-vs-Loads report — keeps working untouched.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS qty_adjustment_pct NUMERIC(7,4)
    """))
    conn.execute(text("""
        ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS qty_adjustment_scope VARCHAR(10) NOT NULL DEFAULT 'all'
    """))
    conn.execute(text("""
        ALTER TABLE invoice_line_items
        ADD COLUMN IF NOT EXISTS base_quantity NUMERIC(12,4)
    """))
    conn.execute(text("""
        ALTER TABLE invoice_line_items
        ADD COLUMN IF NOT EXISTS qty_adjusted BOOLEAN NOT NULL DEFAULT false
    """))

    conn.commit()
