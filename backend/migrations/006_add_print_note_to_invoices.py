"""
Migration 006: Add print_note boolean column to invoices table.
Controls whether the notes field is printed on the PDF.

Usage:
  python migrations/006_add_print_note_to_invoices.py
"""

import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./safetec_core.db")

engine = create_engine(DATABASE_URL)


def run():
    with engine.connect() as conn:
        try:
            if DATABASE_URL.startswith("sqlite"):
                conn.execute(text("ALTER TABLE invoices ADD COLUMN print_note BOOLEAN DEFAULT 0"))
            else:
                conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS print_note BOOLEAN DEFAULT FALSE"))
            conn.commit()
            print("  [ok] Added print_note column to invoices")
        except Exception as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                print("  [skip] print_note column already exists")
            else:
                conn.rollback()
                print(f"  [fail] Failed: {e}")
                raise

    print("\nMigration 006 complete")


if __name__ == "__main__":
    print("Running migration 006...")
    run()
