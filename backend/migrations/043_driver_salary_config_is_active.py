from sqlalchemy import text


def upgrade(conn):
    conn.execute(text(
        "ALTER TABLE driver_salary_configs ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE"
    ))
    conn.execute(text(
        "ALTER TABLE driver_salary_configs ADD COLUMN updated_at TIMESTAMPTZ"
    ))
    # Mark all existing rows as active (they are, by default)
    conn.execute(text("UPDATE driver_salary_configs SET is_active = TRUE WHERE is_active IS NULL"))
    conn.commit()
