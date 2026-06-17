"""Migration 093 — supplier invoice physical-document attachment columns.

Each captured supplier invoice can hold one attached file (the physical invoice
received from the supplier — a scanned PDF or a phone photo). Files are stored
privately (local disk in dev, a private Supabase bucket in prod); these columns
hold the metadata. `attachment_key` is the storage path/key; the bytes are
streamed back via an authenticated endpoint.
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
                f"ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS {name} {ddl_type}"
            ))
    else:
        # SQLite has no ADD COLUMN IF NOT EXISTS — probe the table first.
        # SQLite stores TIMESTAMP WITH TIME ZONE as TEXT; the type affinity is fine.
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(supplier_invoices)"))]
        for name, ddl_type in _COLUMNS:
            if name not in cols:
                conn.execute(text(
                    f"ALTER TABLE supplier_invoices ADD COLUMN {name} {ddl_type}"
                ))

    conn.commit()
