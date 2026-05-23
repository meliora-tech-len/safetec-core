from sqlalchemy import text


def upgrade(conn):
    conn.execute(text(
        "ALTER TABLE invoices ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT"
    ))
    conn.commit()

    try:
        conn.execute(text("ALTER TABLE invoices ALTER COLUMN supplier_id DROP NOT NULL"))
        conn.commit()
    except Exception:
        pass  # SQLite does not support ALTER COLUMN
