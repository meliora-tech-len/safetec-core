"""
Migration 063 — Add admin_fee_vat column to diesel_fillups.
Backfills existing rows: admin_fee_vat = admin_fee_amount * 0.15
Updates total_amount to include VAT: total_amount = amount + admin_fee_amount + admin_fee_vat
"""
from sqlalchemy import text


def upgrade(conn):
    # Add column (safe to re-run — IF NOT EXISTS)
    conn.execute(text("""
        ALTER TABLE diesel_fillups
        ADD COLUMN IF NOT EXISTS admin_fee_vat NUMERIC(12, 2) NOT NULL DEFAULT 0
    """))

    # Backfill VAT on existing admin fees (15%)
    conn.execute(text("""
        UPDATE diesel_fillups
        SET admin_fee_vat = ROUND(admin_fee_amount * 0.15, 2)
        WHERE admin_fee_amount > 0
    """))

    # Recalculate total_amount to include VAT on admin fee
    conn.execute(text("""
        UPDATE diesel_fillups
        SET total_amount = amount + admin_fee_amount + admin_fee_vat
    """))

    conn.commit()
