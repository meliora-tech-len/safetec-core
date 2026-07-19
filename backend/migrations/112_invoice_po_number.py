"""Migration 112 — persist the PO ("POH") number on customer invoices.

The PO number an invoice was generated from only ever existed inside free text:
"PO Ref: POH10126050000191" in invoices.notes, and echoed in the header line
item's description. Every consumer re-derived it by regex in the browser, which
meant PO-grouped income couldn't be computed in SQL at all.

This adds invoices.po_number and backfills it from the existing free text using
the same rule as services/po_number.py (POH followed by digits, tolerating a
space, notes taking precedence over the header line item). Invoices with no POH
anywhere — anything hand-keyed rather than PO-imported — stay NULL, which is a
normal state (the budget's income modal lists those as their own per-invoice rows).
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        conn.execute(text(
            "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_number VARCHAR(60)"
        ))
    else:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(invoices)"))]
        if "po_number" not in cols:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN po_number VARCHAR(60)"))

    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_invoices_po_number ON invoices (po_number)"
    ))

    # Backfill. Done in Python rather than SQL regex so the rule stays identical
    # across Postgres and SQLite and matches services/po_number.py exactly —
    # a divergence here would silently split one PO into two budget lines.
    from app.services.po_number import extract_po_number

    rows = conn.execute(text("""
        SELECT i.id, i.notes, (
            SELECT li.description FROM invoice_line_items li
            WHERE li.invoice_id = i.id AND li.line_type = 'header'
            ORDER BY li.sort_order LIMIT 1
        ) AS header_desc
        FROM invoices i
        WHERE i.po_number IS NULL
    """)).fetchall()

    updated = 0
    for inv_id, notes, header_desc in rows:
        po = extract_po_number(notes, header_desc)
        if not po:
            continue
        conn.execute(
            text("UPDATE invoices SET po_number = :po WHERE id = :id"),
            {"po": po, "id": inv_id},
        )
        updated += 1

    conn.commit()
    print(f"  backfilled po_number on {updated} of {len(rows)} invoice(s)")
