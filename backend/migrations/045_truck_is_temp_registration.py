from sqlalchemy import text


def upgrade(conn):
    conn.execute(text(
        "ALTER TABLE trucks ADD COLUMN is_temp_registration BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    conn.commit()
