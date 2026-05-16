"""
Migration 025: Add missing indexes on frequently filtered FK and status columns.
Safe to re-run — uses IF NOT EXISTS on all statements.

Usage:
  python migrations/025_add_missing_indexes.py
"""

import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./safetec_core.db")

engine = create_engine(DATABASE_URL)

INDEXES = [
    ("ix_suppliers_entity_id",          "suppliers(entity_id)"),
    ("ix_invoices_entity_id",           "invoices(entity_id)"),
    ("ix_invoices_supplier_id",         "invoices(supplier_id)"),
    ("ix_invoices_status",              "invoices(status)"),
    ("ix_drivers_entity_id",            "drivers(entity_id)"),
    ("ix_truck_loads_entity_id",        "truck_loads(entity_id)"),
    ("ix_truck_loads_truck_id",         "truck_loads(truck_id)"),
    ("ix_user_entity_access_user_id",   "user_entity_access(user_id)"),
    ("ix_audit_logs_resource_type",     "audit_logs(resource_type)"),
    ("ix_supplier_invoices_supplier_id","supplier_invoices(supplier_id)"),
]


def run():
    with engine.connect() as conn:
        for index_name, on_clause in INDEXES:
            sql = f"CREATE INDEX IF NOT EXISTS {index_name} ON {on_clause}"
            try:
                conn.execute(text(sql))
                conn.commit()
                print(f"  OK: {index_name}")
            except Exception as e:
                print(f"  SKIP/FAIL {index_name}: {e}")

    print("\nMigration 025 complete")


if __name__ == "__main__":
    print("Running migration 025 — adding missing indexes...")
    run()
