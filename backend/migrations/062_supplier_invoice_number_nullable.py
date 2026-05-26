from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text("ALTER TABLE supplier_invoices ALTER COLUMN invoice_number DROP NOT NULL"))
    except Exception:
        pass
    conn.commit()
