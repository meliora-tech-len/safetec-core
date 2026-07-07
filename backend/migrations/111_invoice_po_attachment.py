"""Migration 111 — customer invoice PO-attachment columns.

Each customer invoice (typically one generated via PO Import from a split
Tradekor PO) can hold one attached PDF — the source purchase order — so it can
be merged into the invoice PDF on download. Mirrors migration 093's
supplier-invoice attachment columns; files are stored privately (local disk in
dev, a private Supabase bucket in prod) and streamed back via an authenticated
endpoint.
"""
from sqlalchemy import text


_COLUMNS = [
    ("attachment_key", "VARCHAR(500)"),
    ("attachment_filename", "VARCHAR(300)"),
    ("attachment_content_type", "VARCHAR(100)"),
    ("attachment_size", "INTEGER"),
    ("attachment_uploaded_at", "TIMESTAMP WITH TIME ZONE"),
    ("attachment_uploaded_by_id", "INTEGER"),
]


def upgrade(conn):
    if conn.dialect.name == "postgresql":
        for name, ddl_type in _COLUMNS:
            conn.execute(text(
                f"ALTER TABLE invoices ADD COLUMN IF NOT EXISTS {name} {ddl_type}"
            ))
    else:
        # SQLite has no ADD COLUMN IF NOT EXISTS — probe the table first.
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(invoices)"))]
        for name, ddl_type in _COLUMNS:
            if name not in cols:
                conn.execute(text(
                    f"ALTER TABLE invoices ADD COLUMN {name} {ddl_type}"
                ))

    conn.commit()
