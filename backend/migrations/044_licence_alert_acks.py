from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS licence_alert_acks (
            id         SERIAL PRIMARY KEY,
            resource_type VARCHAR(30) NOT NULL,
            resource_id   INTEGER     NOT NULL,
            acknowledged_expiry TIMESTAMPTZ NOT NULL,
            acknowledged_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
            acknowledged_at     TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (resource_type, resource_id, acknowledged_expiry)
        )
    """))
    conn.commit()
