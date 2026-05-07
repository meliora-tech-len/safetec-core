#!/usr/bin/env python3
"""
seed_drivers.py  —  Idempotent driver seeder for safetec_core (SQLite dev)

Run from the project root:
    python seed_drivers.py

Seeds permanent and casual drivers for Safetec (SFT) and OBHI.
Banking / payroll fields are left NULL — those are managed via the payroll module.
Safe to re-run: existing (first_name + last_name + entity_id) combinations are skipped.
"""

import os, sys

_BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
os.chdir(_BACKEND)
sys.path.insert(0, _BACKEND)

from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db.database import SessionLocal, engine
from app.models.models import Base, BusinessEntity, Truck, Driver, DriverType

Base.metadata.create_all(bind=engine)


# ─────────────────────────────────────────────────────────────────────────────
# DATA
#
# Permanent driver row:
#   (first_name, last_name, truck_reg, employee_number, notes)
#
# Casual driver row:
#   (first_name, last_name, notes)
#   truck_id is always NULL for casuals.
# ─────────────────────────────────────────────────────────────────────────────

# ══════════════════════════════════════════════════════════════════════════════
# SAFETEC — Permanent
# ══════════════════════════════════════════════════════════════════════════════
SFT_PERMANENT = [
    # (first_name, last_name, truck_reg, employee_number, notes)
    ('Mathews',   '',       'JRC117EC', None, None),
    ('Simon',     '',       'JXP816EC', None, 'Known as Simon New'),
    ('Pieter',    '',       'JYC247EC', None, None),
    ('Freek',     '',       'JZG083EC', None, None),
    ('Resty',     '',       'JZS095EC', None, None),
    ('Kliffet',   '',       'KBD393EC', None, None),
    ('Gerald',    '',       'KCY733EC', None, None),
    ('Randall',   '',       'KDJ034EC', None, None),
    ('David',     '',       'KDZ484EC', None, 'Known as David New'),
    ('Phikani',   '',       'KFK772EC', None, None),
    ('Miguel',    '',       'KFT767EC', None, None),
    ('Andries',   '',       'KGJ578EC', None, None),
    ('Johnny',    '',       'KGX782EC', None, 'Also drove JXP813EC (sold)'),
    ('Mmotsi',    '',       'KKF401EC', None, None),
    ('Job',       '',       'KLC159EC', None, None),
    ('Simon',     'Ou',     'KMR411EC', None, 'Simon Ou — distinct from Simon New'),
    ('Sam',       '',       'KMT481EC', None, None),
    ('Sibusiso',  '',       'KNF472EC', None, None),
    ('Papilon',   '',       'KNP861EC', None, None),
    ('Abongile',  '',       'KNS946EC', None, None),
    ('Roy',       '',       'KPH748EC', None, None),
    ('Kambinda',  '',       'KPK198EC', None, None),
    ('Adriaan',   '',       'KPS102EC', None, None),
    ('Jackson',   '',       'KRC830EC', None, None),
    ('Petrus',    '',       'KRM473EC', None, None),
    ('Aubrey',    '',       'KRW188EC', None, "Appears as 'Aubry' in load sheets"),
    ('Samuel',    '',       'KSV060EC', None, None),
    ('Frans',     '',       'KSZ633EC', None, None),
    ('Stoffel',   '',       'KSZ397EC', None, None),
    # Second Freek — different person on the leased Mercedes
    ('Freek',     'Merc',   'JH13XVGP', None, 'Leased Mercedes JH13XVGP; distinct from Freek on JZG083EC'),
]

# ══════════════════════════════════════════════════════════════════════════════
# SAFETEC — Casual (float pool, no fixed truck)
# ══════════════════════════════════════════════════════════════════════════════
# Where a first name clashes with a permanent driver, use last_name='Casual'
# so the (first, last, entity) unique check doesn't collide.
SFT_CASUAL = [
    # (first_name, last_name, notes)
    ('Amos',    '',       None),
    ('Gerald',  'Casual', 'Casual pool — distinct from permanent Gerald on KCY733EC'),
    ('Maskito', '',       None),
    ('Simon',   'Casual', 'Casual pool — distinct from permanent Simon New and Simon Ou'),
    ('Moses',   '',       None),
    ('David',   'Casual', 'Casual pool — distinct from permanent David on KDZ484EC'),
    ('Shaun',   '',       "Appears as 'shuan' in source sheet"),
    ('Frans',   'Casual', 'Casual pool — distinct from permanent Frans on KSZ633EC'),
    ('Andrew',  '',       None),
    ('Rudy',    '',       None),
    ('Tumiso',  '',       'Active from November 2025'),
    ('Ives',    '',       'Active from January 2026'),
    ('Piet',    '',       'Active from January 2026'),
    ('Matthew', '',       "Casual context — distinct from permanent Mathews (different spelling)"),
    ('Garth',   '',       'Active from January 2026'),
    ('Jonas',   '',       'Active from February 2026'),
    ('Marvin',  '',       'Active from February 2026'),
]

# ══════════════════════════════════════════════════════════════════════════════
# OBHI — Permanent
# ══════════════════════════════════════════════════════════════════════════════
OBHI_PERMANENT = [
    # (first_name, last_name, truck_reg, employee_number, notes)

    # ── Betopess sub-fleet ────────────────────────────────────────────────────
    ('Seleka',      'Seodigeng', 'JKC468EC', 'BET003', 'Betopess'),
    ('Ephraim',     '',          'KDS053EC', None,     'Betopess'),
    ('Riaan',       'Maart',     'KGY077EC', 'BET001', 'Betopess'),
    ('Malibongwe',  '',          'KKL390EC', 'BET006', 'Betopess'),
    ('Andries',     'Mathetsa',  'KJW398EC', 'BET005', 'Betopess'),
    ('Lonwabo',     'Diamond',   'KMC765EC', 'BET008', 'Betopess'),
    ('Garth',       '',          'KXH514MP', 'BET009', 'Betopess'),
    # KPV364EC — no named driver in Jan 2026 data; left unassigned

    # ── Alex Maintenance sub-fleet ────────────────────────────────────────────
    ('Jimmy',       'Mathe',     'JTH936EC', 'AM008',  'Alex Maintenance'),
    ('Alex',        'Shuping',   'JZS468EC', 'AM0011', 'Alex Maintenance'),
    ('Dennis',      '',          'JZF207EC', None,     'Alex Maintenance'),
    ('Henry',       'de Bruin',  'KGW055EC', 'AM010',  'Alex Maintenance'),
    ('April',       'Mathetsa',  'KKP390EC', 'AM004',  'Alex Maintenance'),
    ('N',           'Sheffer',   'KKP393EC', 'AM001',  "Alex Maintenance; nickname 'Kortseun'"),

    # ── Intsimbi sub-fleet ────────────────────────────────────────────────────
    ('Julian',      '',          'JLX484EC', None,     'Intsimbi'),
    ('Henrie',      '',          None,       None,     'Intsimbi; historic driver, current truck reg not confirmed'),
    ('Morris',      '',          None,       None,     'Intsimbi; linked to EDJ314EC in historic data — not in current fleet'),
]

# ══════════════════════════════════════════════════════════════════════════════
# OBHI — Casual
# ══════════════════════════════════════════════════════════════════════════════
OBHI_CASUAL = [
    # (first_name, last_name, notes)
    ('Kabelo', '', 'Labelled KABELO CASUAL in JPL694EC load sheet; Alex Maintenance pool'),
    ('Jankie', '', 'Relief driver on JKC468EC (Seleka truck); casual substitution'),
]


# ─────────────────────────────────────────────────────────────────────────────
# SEED
# ─────────────────────────────────────────────────────────────────────────────

def seed():
    db: Session = SessionLocal()
    try:
        sft  = db.execute(select(BusinessEntity).where(BusinessEntity.code == 'SFT')).scalar_one()
        obhi = db.execute(select(BusinessEntity).where(BusinessEntity.code == 'OBHI')).scalar_one()

        def get_truck(entity_id: int, reg: str | None) -> int | None:
            if not reg:
                return None
            t = db.execute(
                select(Truck).where(Truck.entity_id == entity_id, Truck.registration == reg)
            ).scalar_one_or_none()
            if t is None:
                print(f'  WARN: truck {reg} not found for entity {entity_id} — truck_id will be NULL')
            return t.id if t else None

        def exists(entity_id: int, first: str, last: str) -> bool:
            return db.execute(
                select(Driver).where(
                    Driver.entity_id == entity_id,
                    Driver.first_name == first,
                    Driver.last_name == last,
                )
            ).scalar_one_or_none() is not None

        def insert(entity_id, first, last, dtype, truck_id, emp_no, notes):
            db.add(Driver(
                entity_id=entity_id,
                truck_id=truck_id,
                first_name=first,
                last_name=last,
                driver_type=dtype,
                employee_number=emp_no,
                is_active=True,
                notes=notes,
            ))

        counts = {}

        # ── Safetec permanent ─────────────────────────────────────────────────
        ins = skip = 0
        for first, last, truck_reg, emp_no, notes in SFT_PERMANENT:
            if exists(sft.id, first, last):
                skip += 1; continue
            t_id = get_truck(sft.id, truck_reg)
            insert(sft.id, first, last, DriverType.permanent, t_id, emp_no, notes)
            ins += 1
        db.flush()
        counts['Safetec permanent'] = (ins, skip)

        # ── Safetec casual ────────────────────────────────────────────────────
        ins = skip = 0
        for first, last, notes in SFT_CASUAL:
            if exists(sft.id, first, last):
                skip += 1; continue
            insert(sft.id, first, last, DriverType.casual, None, None, notes)
            ins += 1
        db.flush()
        counts['Safetec casual'] = (ins, skip)

        # ── OBHI permanent ────────────────────────────────────────────────────
        ins = skip = 0
        for first, last, truck_reg, emp_no, notes in OBHI_PERMANENT:
            if exists(obhi.id, first, last):
                skip += 1; continue
            t_id = get_truck(obhi.id, truck_reg) if truck_reg else None
            insert(obhi.id, first, last, DriverType.permanent, t_id, emp_no, notes)
            ins += 1
        db.flush()
        counts['OBHI permanent'] = (ins, skip)

        # ── OBHI casual ───────────────────────────────────────────────────────
        ins = skip = 0
        for first, last, notes in OBHI_CASUAL:
            if exists(obhi.id, first, last):
                skip += 1; continue
            insert(obhi.id, first, last, DriverType.casual, None, None, notes)
            ins += 1
        db.flush()
        counts['OBHI casual'] = (ins, skip)

        db.commit()

        print()
        print('=' * 52)
        print('  Driver seed complete')
        print('=' * 52)
        total = 0
        for label, (i, s) in counts.items():
            print(f'  {label:<22}  inserted: {i:>2},  skipped: {s:>2}')
            total += i
        print(f'  {"Total":<22}  {total}')
        print()

    except Exception as exc:
        db.rollback()
        print(f'\n  ERROR: {exc}')
        import traceback; traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == '__main__':
    seed()
