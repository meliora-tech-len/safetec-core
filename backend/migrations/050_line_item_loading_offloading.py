"""Add loading_number and offloading_number to invoice_line_items."""
from sqlalchemy import text

def upgrade(conn):
    for col in ("loading_number VARCHAR(100)", "offloading_number VARCHAR(100)"):
        try:
            conn.execute(text(f"ALTER TABLE invoice_line_items ADD COLUMN {col}"))
        except Exception:
            pass
    conn.commit()
