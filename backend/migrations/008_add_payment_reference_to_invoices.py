"""
Migration 008: Add payment_reference column to invoices table.

Usage:
  python migrations/008_add_payment_reference_to_invoices.py
"""

import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./safetec_core.db")

engine = create_engine(DATABASE_URL)


def run():
    with engine.connect() as conn:
        try:
            if DATABASE_URL.startswith("sqlite"):
                conn.execute(text("ALTER TABLE invoices ADD COLUMN payment_reference VARCHAR(255)"))
            else:
                conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255)"))
            conn.commit()
            print("  [ok] Added payment_reference to invoices")
        except Exception as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                print("  [skip] payment_reference already exists")
            else:
                conn.rollback()
                print(f"  [fail] payment_reference: {e}")
                raise

    print("\nMigration 008 complete")


if __name__ == "__main__":
    print("Running migration 008...")
    run()
