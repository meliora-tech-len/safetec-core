def upgrade(conn):
    conn.execute(
        "ALTER TABLE diesel_fillups ADD COLUMN driver_name VARCHAR(200)"
    )
