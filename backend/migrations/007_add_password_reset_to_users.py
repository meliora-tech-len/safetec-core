"""
Migration 007: Add password_reset_token and password_reset_expires columns to users table.

Usage:
  python migrations/007_add_password_reset_to_users.py
"""

import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./safetec_core.db")

engine = create_engine(DATABASE_URL)


def run():
    with engine.connect() as conn:
        for col, definition in [
            ("password_reset_token", "VARCHAR(100)"),
            ("password_reset_expires", "DATETIME"),
        ]:
            try:
                if DATABASE_URL.startswith("sqlite"):
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {definition}"))
                else:
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {definition}"))
                conn.commit()
                print(f"  [ok] Added {col} to users")
            except Exception as e:
                if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                    print(f"  [skip] {col} already exists")
                else:
                    conn.rollback()
                    print(f"  [fail] {col}: {e}")
                    raise

    print("\nMigration 007 complete")


if __name__ == "__main__":
    print("Running migration 007...")
    run()
