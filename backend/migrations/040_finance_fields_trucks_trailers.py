"""
Migration 040: Add finance account number and contract end date to trucks;
add full finance fields (institution, account number, contract end) to trailers.

SQLite: applied by upgrade() — safe to re-run.

PostgreSQL / Supabase — run manually in the SQL editor:

    ALTER TABLE trucks
        ADD COLUMN IF NOT EXISTS finance_account_number VARCHAR(100),
        ADD COLUMN IF NOT EXISTS finance_contract_end    DATE;

    ALTER TABLE trailers
        ADD COLUMN IF NOT EXISTS finance_institution     VARCHAR(200),
        ADD COLUMN IF NOT EXISTS finance_account_number  VARCHAR(100),
        ADD COLUMN IF NOT EXISTS finance_contract_end    DATE;
"""

from sqlalchemy import text


def upgrade(conn):
    for col, typ in [
        ("finance_account_number", "VARCHAR(100)"),
        ("finance_contract_end",   "DATE"),
    ]:
        try:
            conn.execute(text(f"ALTER TABLE trucks ADD COLUMN {col} {typ}"))
        except Exception:
            pass

    for col, typ in [
        ("finance_institution",    "VARCHAR(200)"),
        ("finance_account_number", "VARCHAR(100)"),
        ("finance_contract_end",   "DATE"),
    ]:
        try:
            conn.execute(text(f"ALTER TABLE trailers ADD COLUMN {col} {typ}"))
        except Exception:
            pass

    conn.commit()
