"""
safetec_core – Diesel seed script
==================================
1. Marks known diesel suppliers as `is_diesel_supplier = True`
2. Creates DieselSettings rows for all active entities (0% admin fee, enabled)

Usage (run from the backend/ directory):
    python scripts/seed_diesel.py

The script is fully IDEMPOTENT – re-running it will not create duplicates.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.database import SessionLocal
from app.models.models import Supplier, BusinessEntity, DieselSettings

# ── Known diesel supplier names (partial, case-insensitive match) ─────────────
# Add or adjust these to match your actual supplier names in the database.
DIESEL_SUPPLIER_KEYWORDS = [
    "oukop",
    "diesel",
    "fuel",
    "petro",
    "sasol",
    "total",
    "bp",
    "shell",
    "engen",
    "astron",
    "caltex",
]


def seed_diesel():
    db = SessionLocal()
    try:
        # ── 1. Mark diesel suppliers ─────────────────────────────────────────────
        all_suppliers = db.query(Supplier).all()
        updated = 0
        for s in all_suppliers:
            name_lower = (s.name or "").lower()
            if any(kw in name_lower for kw in DIESEL_SUPPLIER_KEYWORDS):
                if not s.is_diesel_supplier:
                    s.is_diesel_supplier = True
                    updated += 1
                    print(f"  Marked as diesel supplier: {s.name}")
                else:
                    print(f"  Already diesel supplier: {s.name}")

        if updated == 0 and not any(
            any(kw in (s.name or "").lower() for kw in DIESEL_SUPPLIER_KEYWORDS)
            for s in all_suppliers
        ):
            print("  No matching suppliers found — set is_diesel_supplier manually in admin UI.")

        # ── 2. Seed DieselSettings for all active entities ───────────────────────
        entities = db.query(BusinessEntity).filter(BusinessEntity.is_active.is_(True)).all()
        for entity in entities:
            existing = db.query(DieselSettings).filter(
                DieselSettings.entity_id == entity.id
            ).first()
            if existing:
                print(f"  DieselSettings already exist for {entity.code} — skipping")
            else:
                ds = DieselSettings(
                    entity_id=entity.id,
                    admin_fee_pct=0,
                    apply_admin_fee=True,
                )
                db.add(ds)
                print(f"  Created DieselSettings for {entity.code} (0% admin fee)")

        db.commit()
        print("\nDiesel seed complete.")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_diesel()
