"""
Migration 003: Add terms column to invoices table.
Run once against your database.

Usage:
  python migrations/003_add_terms_to_invoices.py
"""

import os
import sys
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./safetec_core.db")

engine = create_engine(DATABASE_URL)


def run():
    with engine.connect() as conn:
        try:
            if DATABASE_URL.startswith("sqlite"):
                conn.execute(text("ALTER TABLE invoices ADD COLUMN terms TEXT"))
            else:
                conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS terms TEXT"))
            conn.commit()
            print("  ✓ Added terms column to invoices")
        except Exception as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                print("  ℹ terms column already exists, skipping")
            else:
                conn.rollback()
                print(f"  ✗ Failed: {e}")
                raise

    print("\n✅ Migration 003 complete")


if __name__ == "__main__":
    print("Running migration 003...")
    run()
