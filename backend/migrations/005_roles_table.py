"""
Migration 005: Add roles table and convert users.role from enum to varchar

Usage:
  python migrations/005_roles_table.py
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
    # ── Create roles table ────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS roles (
        id           SERIAL PRIMARY KEY,
        key          VARCHAR(100) UNIQUE NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        is_protected BOOLEAN DEFAULT FALSE,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT now()
    );
    """,

    # ── Seed default roles ────────────────────────────────────────────────────
    """
    INSERT INTO roles (key, display_name, is_protected) VALUES
        ('admin',    'System Administrator', TRUE),
        ('standard', 'Admin Assistant',      TRUE)
    ON CONFLICT (key) DO NOTHING;
    """,

    # ── Convert users.role from PostgreSQL enum to varchar ────────────────────
    # SQLAlchemy named the enum type 'userrole' (lowercase class name)
    """
    ALTER TABLE users
        ALTER COLUMN role TYPE VARCHAR(100) USING role::text;
    """,

    # ── Drop the old enum type (no longer needed) ─────────────────────────────
    """
    DROP TYPE IF EXISTS userrole;
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

    print("\n✅ Migration 005 complete")


if __name__ == "__main__":
    print("Running migration 005: roles table...")
    run()
