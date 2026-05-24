from sqlalchemy import text


def upgrade(conn):
    conn.execute(text(
        "ALTER TABLE diesel_settings "
        "ADD COLUMN IF NOT EXISTS subcontractor_monthly_admin_fee NUMERIC(10,2) NOT NULL DEFAULT 0"
    ))
    conn.commit()
