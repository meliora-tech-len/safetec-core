"""
safetec_core – Mine seed script
================================
Creates the standard mine sites and sets their hauling rates for all
existing business entities.

Usage (run from the backend/ directory):
    python scripts/seed_mines.py

The script is fully IDEMPOTENT – re-running it will not create duplicates.
"""

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.database import SessionLocal
from app.models.models import Mine, MineRate, BusinessEntity

# ── Mine definitions ──────────────────────────────────────────────────────────
# rate_per_ton = None means no rate is seeded (set per entity via UI)
MINES = [
    {"name": "ASSMANG",  "code": "ASS",  "rate_per_ton": None},
    {"name": "TAWANA",   "code": "TAW",  "rate_per_ton": 760},
    {"name": "SEBILO",   "code": "SEB",  "rate_per_ton": 760},
    {"name": "MOKALA",   "code": "MOK",  "rate_per_ton": 790},
    {"name": "GLOSAM",   "code": "GLO",  "rate_per_ton": None},
    {"name": "BOSKOP",   "code": "BOS",  "rate_per_ton": None},
    {"name": "TSHIPI",   "code": "TSH",  "rate_per_ton": None},
]

# Only seed rates for these entity codes
RATE_ENTITY_CODES = {"SFT", "OBHI"}

EFFECTIVE_FROM = datetime(2025, 1, 1, tzinfo=timezone.utc)


def seed_mines():
    db = SessionLocal()
    try:
        all_entities = db.query(BusinessEntity).filter(BusinessEntity.is_active.is_(True)).all()
        entities = [e for e in all_entities if e.code in RATE_ENTITY_CODES]
        if not entities:
            print(f"No matching entities found for codes {RATE_ENTITY_CODES}.")
            return

        print(f"Seeding rates for: {[e.code for e in entities]}")

        for mine_def in MINES:
            name = mine_def["name"]
            code = mine_def["code"]
            rate = mine_def["rate_per_ton"]

            # Get or create mine
            mine = db.query(Mine).filter(Mine.name == name).first()
            if not mine:
                mine = Mine(name=name, code=code, is_active=True)
                db.add(mine)
                db.flush()
                print(f"  Created mine: {name} ({code})")
            else:
                print(f"  Mine already exists: {name} ({code})")

            # Set rate for each entity if a rate is defined
            if rate is not None:
                for entity in entities:
                    existing = db.query(MineRate).filter(
                        MineRate.mine_id == mine.id,
                        MineRate.entity_id == entity.id,
                        MineRate.effective_to.is_(None),
                    ).first()

                    if existing:
                        if float(existing.rate_per_ton) == float(rate):
                            print(f"    Rate already set for {entity.code}: R{rate}/t — skipping")
                            continue
                        # Close old rate
                        existing.effective_to = EFFECTIVE_FROM

                    new_rate = MineRate(
                        mine_id=mine.id,
                        entity_id=entity.id,
                        rate_per_ton=rate,
                        effective_from=EFFECTIVE_FROM,
                        effective_to=None,
                        notes="Seeded",
                    )
                    db.add(new_rate)
                    print(f"    Set rate for {entity.code}: R{rate}/t")

        db.commit()
        print("\nMine seed complete.")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_mines()
