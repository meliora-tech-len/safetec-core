"""
Migration 116: diesel_fillups.rate_pending.

A "rate pending" flag for BKMO (Bokamosho) diesel slips captured before the
rate-per-litre is known. The user receives slips and wants to log them
immediately (litres known, R/L unknown); the Tradekor diesel import later
matches the slip and fills the rate in. Such a placeholder is stored with
rate_per_litre = 0 and rate_pending = TRUE so the importer can tell it apart
from a finalised fill-up and update it in place instead of skipping it as a
duplicate.
"""
from sqlalchemy import text


def upgrade(conn):
    # IF NOT EXISTS so a manual re-run (raw SQL) doesn't error on an existing column.
    conn.execute(text(
        "ALTER TABLE diesel_fillups "
        "ADD COLUMN IF NOT EXISTS rate_pending BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    conn.commit()
