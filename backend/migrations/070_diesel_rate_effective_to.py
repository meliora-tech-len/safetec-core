def upgrade(conn):
    conn.execute("ALTER TABLE diesel_rates ADD COLUMN effective_to DATE")
