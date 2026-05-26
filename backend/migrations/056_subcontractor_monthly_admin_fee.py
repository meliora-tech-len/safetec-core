from sqlalchemy import text


def upgrade(conn):
    try:
        conn.execute(text(
            "ALTER TABLE diesel_settings ADD COLUMN subcontractor_monthly_admin_fee NUMERIC(10,2) NOT NULL DEFAULT 0"
        ))
    except Exception:
        pass
    conn.commit()
