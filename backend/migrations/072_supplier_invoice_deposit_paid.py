def upgrade(conn):
    conn.execute("ALTER TABLE supplier_invoices ADD COLUMN deposit_paid NUMERIC(12,2)")
