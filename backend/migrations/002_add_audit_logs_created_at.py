"""
Migration 002: Add missing created_at column to audit_logs table.
Run once against your Supabase PostgreSQL database.

Usage:
  python migrations/002_add_audit_logs_created_at.py
"""

import os
import sys
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable not set")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

MIGRATIONS = [
    """
    ALTER TABLE audit_logs
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();
    """,
]


def run():
    with engine.connect() as conn:
        for i, sql in enumerate(MIGRATIONS, 1):
            try:
                conn.execute(text(sql.strip()))
                conn.commit()
                print(f"  ✓ Step {i} complete")
            except Exception as e:
                conn.rollback()
                print(f"  ✗ Step {i} failed: {e}")
                raise

    print("\n✅ Migration 002 complete")


if __name__ == "__main__":
    print("Running migration 002...")
    run()
