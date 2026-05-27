def upgrade(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS casual_truck_assignments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            driver_id   INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
            truck_id    INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
            driver_slot INTEGER NOT NULL,
            entity_id   INTEGER NOT NULL REFERENCES business_entities(id),
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_casual_truck_slot UNIQUE (truck_id, driver_slot)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_casual_truck_assignments_driver_id ON casual_truck_assignments (driver_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_casual_truck_assignments_truck_id ON casual_truck_assignments (truck_id)"
    )
