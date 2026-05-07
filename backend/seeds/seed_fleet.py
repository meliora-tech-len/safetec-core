"""
backend/seeds/seed_fleet.py
============================
Seeds OBHI fleet data and back-fills operator / contract_context / temp_registration
on existing trucks.

Run from the backend/ directory:
    python seeds/seed_fleet.py

Idempotent:
  - Trucks are matched by registration.  If the truck already exists, its
    operator / contract_context / temp_registration are updated in-place.
  - Trailers are matched by registration; skipped if already present.

Field mapping vs. spec:
  spec field          → existing model column
  -----------------     ----------------------
  chassis_number      → vin
  trailer_number      → slot
  primary_truck_id    → truck_id
  is_active (bool)    → status enum  (active trucks default to TruckStatus.active)
  operator            → operator     (NEW — migration 022)
  contract_context    → contract_context (NEW — migration 022)
  temp_registration   → temp_registration (NEW — migration 022)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import SessionLocal
from app.models.models import Truck, Trailer, TruckStatus, TrailerStatus, BusinessEntity

# ─────────────────────────────────────────────────────────────────────────────
# OBHI FLEET DATA
# (registration, temp_registration, make, chassis_number, operator, contract_context)
# ─────────────────────────────────────────────────────────────────────────────

OBHI_TRUCKS = [
    # ── Betopess — OBHI owned ─────────────────────────────────────────────────
    ("JKC468EC", None, "Scania", None, "Betopess",         "OBHI"),
    ("KDS053EC", None, "Scania", None, "Betopess",         "OBHI"),
    ("KGY077EC", None, "Scania", None, "Betopess",         "OBHI"),
    ("KKL390EC", None, "Scania", None, "Betopess",         "OBHI"),
    ("KJW398EC", None, "Scania", None, "Betopess",         "OBHI"),
    ("KKY108EC", None, "Scania", None, "Betopess",         "OBHI"),
    ("KMC765EC", None, "Scania", None, "Betopess",         "OBHI"),
    ("KXH514MP", None, "Scania", None, "Betopess",         "OBHI"),

    # ── Alex Maintenance (OBHI work) ─────────────────────────────────────────
    ("JZF207EC", None, "Scania", None, "Alex Maintenance", "OBHI"),
    ("JTH936EC", None, "Scania", None, "Alex Maintenance", "OBHI"),
    ("JZS468EC", None, "Scania", None, "Alex Maintenance", "OBHI"),
    ("KGW055EC", None, "Scania", None, "Alex Maintenance", "OBHI"),
    ("KKP390EC", None, "Scania", None, "Alex Maintenance", "OBHI"),
    ("KKP393EC", None, "Scania", None, "Alex Maintenance", "OBHI"),

    # ── Alex Maintenance (Intsimbi work) ─────────────────────────────────────
    # No trailers confirmed in source data — trucks only
    ("JPL694EC", None, "Scania", None, "Alex Maintenance", "Intsimbi"),
    ("EDJ314EC", None, "Scania", None, "Alex Maintenance", "Intsimbi"),  # historic; may be inactive

    # ── Julian / Intsimbi ─────────────────────────────────────────────────────
    # Trailers not confirmed in source data
    ("JLX484EC", None, "Scania", None, "Julian",           "Intsimbi"),

    # ── Belorado ─────────────────────────────────────────────────────────────
    ("KRR116EC", None,       "Foton Auman", None, "Belorado", "OBHI"),
    ("KRL688EC", None,       "Foton Auman", None, "Belorado", "OBHI"),
    ("MH84ZCGP", None,       None,          None, "Belorado", "OBHI"),  # make not confirmed

    # ── Phezulu ───────────────────────────────────────────────────────────────
    ("KRV199EC", None, "Foton Auman", None, "Phezulu", "OBHI"),
    # TODO: confirm EFK328EC — unclear if truck or trailer; not seeded
    ("KRC196EC", None, None,          None, "Phezulu", "OBHI"),  # make not confirmed

    # ── Bandeys ───────────────────────────────────────────────────────────────
    # ECF698GP and EKV375GP are old GP regs stored in temp_registration
    ("KPS629EC", None,       None,    None, "Bandeys", "OBHI"),   # trailers unknown
    ("KSC007EC", "ECF698GP", "Scania", None, "Bandeys", "OBHI"),
    ("KST708EC", "EKV375GP", "Scania", None, "Bandeys", "OBHI"),

    # ── CLS Partners ──────────────────────────────────────────────────────────
    ("EGR648GP", None, None, None, "CLS Partners", "OBHI"),  # make not confirmed

    # ── South Cape ────────────────────────────────────────────────────────────
    ("207JGXEC", None, "DAF", None, "South Cape", "OBHI"),
    ("529FHREC", None, "DAF", None, "South Cape", "OBHI"),
    ("907JLTEC", None, "DAF", None, "South Cape", "OBHI"),
    ("JWM651EC", None, "DAF", None, "South Cape", "OBHI"),
    ("JXG657EC", None, "DAF", None, "South Cape", "OBHI"),
    ("KBB933EC", None, "DAF", None, "South Cape", "OBHI"),
    ("KFJ378EC", None, "DAF", None, "South Cape", "OBHI"),
    ("KKV898EC", None, "Scania", None, "South Cape", "OBHI"),
    ("KMP690EC", None, None,    None, "South Cape", "OBHI"),  # make not confirmed

    # ── Re Ama ────────────────────────────────────────────────────────────────
    ("DDM652NC", None, "Scania", None, "Re Ama", "OBHI"),
]

# (truck_reg, slot, trailer_reg)
OBHI_TRAILERS = [
    # Betopess
    ("JKC468EC", 1, "JYL662EC"), ("JKC468EC", 2, "JYL660EC"),
    ("KDS053EC", 1, "KDS455EC"), ("KDS053EC", 2, "KDS453EC"),
    ("KGY077EC", 1, "KGY546EC"), ("KGY077EC", 2, "KGY547EC"),
    ("KKL390EC", 1, "KKN192EC"), ("KKL390EC", 2, "KKN206EC"),
    ("KJW398EC", 1, "KHX726EC"), ("KJW398EC", 2, "KHX732EC"),
    ("KKY108EC", 1, "KKN187EC"), ("KKY108EC", 2, "KKN168EC"),
    ("KMC765EC", 1, "JXR975EC"), ("KMC765EC", 2, "JXR691EC"),
    ("KXH514MP", 1, "EKK494GP"), ("KXH514MP", 2, "EKK495GP"),
    # Alex Maintenance (OBHI work)
    ("JZF207EC", 1, "JZF214EC"), ("JZF207EC", 2, "JZF209EC"),
    ("JTH936EC", 1, "JTJ436EC"), ("JTH936EC", 2, "JTK547EC"),
    ("JZS468EC", 1, "JZS116EC"), ("JZS468EC", 2, "JZS129EC"),
    ("KGW055EC", 1, "KGV923EC"), ("KGW055EC", 2, "KGV926EC"),
    ("KKP390EC", 1, "KKR153EC"), ("KKP390EC", 2, "KKR169EC"),
    ("KKP393EC", 1, "KKR179EC"), ("KKP393EC", 2, "KKR186EC"),
    # Belorado
    ("KRR116EC", 1, "KRR108EC"), ("KRR116EC", 2, "KRR109EC"),
    ("KRL688EC", 1, "KRL790EC"), ("KRL688EC", 2, "KRL796EC"),
    # Phezulu
    ("KRV199EC", 1, "KRV326EC"), ("KRV199EC", 2, "KRV322EC"),
    # South Cape
    ("207JGXEC", 1, "KHM069EC"), ("207JGXEC", 2, "KHM070EC"),
    ("529FHREC", 1, "JYZ896EC"), ("529FHREC", 2, "JYZ894EC"),
    ("907JLTEC", 1, "KJD210EC"), ("907JLTEC", 2, "KJD218EC"),
    ("JWM651EC", 1, "KJD211EC"), ("JWM651EC", 2, "KJD207EC"),
    ("JXG657EC", 1, "KFP723EC"), ("JXG657EC", 2, "KFP724EC"),
    ("KBB933EC", 1, "KJL074EC"), ("KBB933EC", 2, "KJL076EC"),
    ("KFJ378EC", 1, "KJL071EC"), ("KFJ378EC", 2, "KJL080EC"),
    ("KKV898EC", 1, "JWM640EC"), ("KKV898EC", 2, "JWM637EC"),
    # Re Ama
    ("DDM652NC", 1, "JVS439EC"), ("DDM652NC", 2, "JVS436EC"),
]


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def upsert_truck(db, entity_id, registration, temp_registration, make,
                 chassis_number, operator, contract_context):
    truck = db.query(Truck).filter_by(registration=registration).first()
    if truck:
        # Back-fill the new fields even if the truck already exists
        changed = False
        if truck.operator != operator:
            truck.operator = operator; changed = True
        if truck.contract_context != contract_context:
            truck.contract_context = contract_context; changed = True
        if temp_registration and truck.temp_registration != temp_registration:
            truck.temp_registration = temp_registration; changed = True
        if make and not truck.make:
            truck.make = make; changed = True
        if chassis_number and not truck.vin:
            truck.vin = chassis_number; changed = True
        action = "UPDATE" if changed else "SKIP  "
        print(f"  {action} truck {registration} ({operator or 'entity-owned'})")
        return truck

    truck = Truck(
        entity_id=entity_id,
        registration=registration,
        temp_registration=temp_registration,
        make=make or "Unknown",
        vin=chassis_number,
        operator=operator,
        contract_context=contract_context,
        is_subcontractor=True,   # all OBHI trucks are subbies
        status=TruckStatus.active,
    )
    db.add(truck)
    db.flush()
    print(f"  ADD    truck {registration} ({operator or 'entity-owned'})")
    return truck


def upsert_trailer(db, entity_id, truck_id, registration, slot):
    if db.query(Trailer).filter_by(registration=registration).first():
        print(f"    SKIP  trailer {registration}")
        return
    db.add(Trailer(
        entity_id=entity_id,
        truck_id=truck_id,
        registration=registration,
        slot=slot,
        status=TrailerStatus.active,
    ))
    print(f"    ADD   trailer {registration} (slot {slot})")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    db = SessionLocal()
    try:
        obhi = db.query(BusinessEntity).filter_by(code="OBHI").first()
        sft  = db.query(BusinessEntity).filter_by(code="SFT").first()

        if not obhi or not sft:
            print("ERROR: SFT or OBHI entity not found. Ensure entities are seeded first.")
            return

        # ── Back-fill SFT trucks with operator/contract_context ──────────────
        print("\n[SFT] Back-filling operator / contract_context for own fleet…")
        sft_trucks = db.query(Truck).filter_by(entity_id=sft.id).all()
        sft_updated = 0
        for t in sft_trucks:
            if t.operator is None and t.contract_context is None:
                t.operator = None
                t.contract_context = "Safetec"
                sft_updated += 1
        print(f"  Updated {sft_updated} SFT trucks (contract_context = 'Safetec')")

        # ── OBHI trucks ───────────────────────────────────────────────────────
        print("\n[OBHI] Upserting fleet…")
        truck_map = {}   # registration → Truck.id (for trailer linking)

        for reg, temp_reg, make, chassis, operator, ctx in OBHI_TRUCKS:
            truck = upsert_truck(
                db, obhi.id, reg, temp_reg, make, chassis, operator, ctx
            )
            truck_map[reg] = truck.id

        db.flush()

        # ── OBHI trailers ─────────────────────────────────────────────────────
        print("\n[OBHI] Upserting trailers…")
        for truck_reg, slot, trailer_reg in OBHI_TRAILERS:
            truck_id = truck_map.get(truck_reg)
            if truck_id is None:
                # truck existed before this run — look it up
                t = db.query(Truck).filter_by(registration=truck_reg).first()
                truck_id = t.id if t else None
            if truck_id is None:
                print(f"    WARN: truck {truck_reg} not found for trailer {trailer_reg}")
                continue
            upsert_trailer(db, obhi.id, truck_id, trailer_reg, slot)

        db.commit()

        # ── Summary ───────────────────────────────────────────────────────────
        total_obhi = db.query(Truck).filter_by(entity_id=obhi.id).count()
        total_sft  = db.query(Truck).filter_by(entity_id=sft.id).count()
        print(f"\n{'-' * 50}")
        print(f"  SFT trucks : {total_sft}")
        print(f"  OBHI trucks: {total_obhi}")
        print(f"  Done.")
        print(f"{'-' * 50}\n")

    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback; traceback.print_exc()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
