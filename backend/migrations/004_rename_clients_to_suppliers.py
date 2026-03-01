"""
Migration 004: Rename clients table to suppliers and client_id to supplier_id in invoices.
Run once against your database.

Usage:
  python migrations/004_rename_clients_to_suppliers.py
"""

import os
import sys
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./safetec_core.db")

engine = create_engine(DATABASE_URL)


def run():
    with engine.connect() as conn:
        if DATABASE_URL.startswith("sqlite"):
            steps = [
                ("Rename clients table to suppliers",
                 "ALTER TABLE clients RENAME TO suppliers"),
                ("Rename client_id column to supplier_id in invoices",
                 "ALTER TABLE invoices RENAME COLUMN client_id TO supplier_id"),
            ]
        else:
            steps = [
                ("Rename clients table to suppliers",
                 "ALTER TABLE clients RENAME TO suppliers"),
                ("Rename client_id column to supplier_id in invoices",
                 "ALTER TABLE invoices RENAME COLUMN client_id TO supplier_id"),
            ]

        for label, sql in steps:
            try:
                conn.execute(text(sql))
                conn.commit()
                print(f"  OK: {label}")
            except Exception as e:
                if "already exists" in str(e).lower() or "no such column" in str(e).lower():
                    print(f"  SKIP: {label} (already done)")
                else:
                    conn.rollback()
                    print(f"  FAIL: {label}: {e}")
                    raise

    print("\nMigration 004 complete")


if __name__ == "__main__":
    print("Running migration 004...")
    run()
