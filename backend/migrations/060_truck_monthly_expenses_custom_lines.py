from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE truck_monthly_expenses
        ADD COLUMN IF NOT EXISTS custom_lines JSONB
    """))
    conn.commit()
