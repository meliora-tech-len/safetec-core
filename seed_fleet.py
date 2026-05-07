#!/usr/bin/env python3
"""
seed_fleet.py  —  Idempotent fleet seeder for safetec_core (SQLite dev)

Run from the project root:
    python seed_fleet.py

Seeds trucks and trailers for Safetec (SFT) and OBHI.
Driver-truck links are NOT seeded here — handled separately.
Safe to re-run: existing registrations are skipped.
"""

import os, sys

_BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
os.chdir(_BACKEND)
sys.path.insert(0, _BACKEND)

from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db.database import SessionLocal, engine
from app.models.models import Base, BusinessEntity, Truck, Trailer, TruckStatus, TrailerStatus

Base.metadata.create_all(bind=engine)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _v(s):
    """Return None for missing/dash values, stripped string otherwise."""
    return None if (not s or s.strip() == '—') else s.strip()


def _reg(s):
    """Normalise registration: strip spaces, uppercase."""
    return None if not s else s.replace(' ', '').upper().strip()


def _status(s):
    return TruckStatus.inactive if s == 'inactive' else TruckStatus.active


def _tstatus(s):
    return TrailerStatus.inactive if s == 'inactive' else TrailerStatus.active


# ─────────────────────────────────────────────────────────────────────────────
# DATA
# Each truck row:
#   (entity_code, fleet_num, make, model, registration, vin, truck_status,
#    is_subcontractor, notes)
#
# Each trailer row:
#   (entity_code, truck_reg, slot, registration, vin, trailer_status)
# ─────────────────────────────────────────────────────────────────────────────

TRUCKS = [
    # ══════════════════════════════════════════════════════════════════════════
    # SAFETEC  —  Active Fleet
    # ══════════════════════════════════════════════════════════════════════════
    ('SFT', '1',  'Scania',        'G460',   'JRC117EC', '9BSG6X40003970699',  'active',   False, None),
    ('SFT', '2',  'Scania',        'G460',   'JXP816EC', '9BSG6X40004003854',  'active',   False, None),
    ('SFT', '3',  'Scania',        'P410',   'JYC247EC', '9BSP6X40003972408',  'active',   False, None),
    ('SFT', '4',  'Scania',        'G460',   'JZG083EC', '9BSG6X40004012527',  'active',   False, None),
    ('SFT', '5',  'Scania',        'G460',   'JZS095EC', 'YS2G6X40005659908',  'active',   False, None),
    ('SFT', '6',  'Scania',        'G460',   'KBD393EC', 'YS2G6X40005659911',  'active',   False, None),
    ('SFT', '7',  'Scania',        'P410',   'KCY733EC', '9BSPX40003948305',   'active',   False, None),
    ('SFT', '8',  'Scania',        'G460',   'KDJ034EC', '9BSG6X40004031764',  'active',   False, None),
    ('SFT', '9',  'Scania',        'G460',   'KDZ484EC', '9BSG6X40004036824',  'active',   False, None),
    ('SFT', '10', 'Scania',        'G460',   'KFK772EC', '9BSG6X40004037861',  'active',   False, None),
    ('SFT', '11', 'Scania',        'G460',   'KFT767EC', '9BSG6X40004038488',  'active',   False, None),
    ('SFT', '12', 'Scania',        'P410',   'KGJ578EC', '9BSP6X40004045407',  'active',   False, None),
    ('SFT', '13', 'Scania',        'G460',   'KGX782EC', '9BSG6X40004047043',  'active',   False, None),
    ('SFT', '14', 'Scania',        'P410',   'KKF401EC', '9BSP6V40004045408',  'active',   False, None),
    ('SFT', '15', 'Mercedes',      'Actros', 'KLC159EC', 'ABJ96342960767691',  'active',   False, None),
    ('SFT', '16', 'Scania',        'G460',   'KMR411EC', '9BSG6X40004082401',  'active',   False, None),
    ('SFT', '17', 'Scania',        'G460',   'KMT481EC', '9BSG6X40004082415',  'active',   False, None),
    ('SFT', '18', 'Scania',        'G460',   'KNF472EC', '9BSG6X40004082421',  'active',   False, None),
    ('SFT', '19', 'Scania',        'G460',   'KNP861EC', '9BSG6X40004082422',  'active',   False, None),
    ('SFT', '20', 'Mercedes',      'Actros', 'KNS946EC', 'ABJ96342X60778277',  'active',   False, None),
    ('SFT', '21', 'Scania',        'G460',   'KPH748EC', '9BSG6X40004085636',  'active',   False, None),
    ('SFT', '22', 'Mercedes',      'Actros', 'KPK198EC', 'ABJ96342660757653',  'active',   False, None),
    ('SFT', '23', 'Scania',        'G460',   'KPS102EC', '9BSG6X40004068114',  'active',   False, None),
    ('SFT', '24', 'Scania',        'G460',   'KRC830EC', '9BSG6X40004024126',  'active',   False, None),
    ('SFT', '25', 'Mercedes',      'Actros', 'KRM473EC', 'ABJ96342660749617',  'active',   False, None),
    ('SFT', '26', 'Scania',        'G460',   'KRW188EC', '9BSG6X40004028021',  'active',   False, None),
    ('SFT', '27', 'Scania',        'G460',   'KSV060EC', None,                 'active',   False, None),
    ('SFT', '28', 'Scania',        None,     'KSZ633EC', None,                 'active',   False, None),
    ('SFT', '29', 'Scania',        None,     'KSZ397EC', None,                 'active',   False, None),
    ('SFT', '30', 'Mercedes',      None,     'JH13XVGP', None,                 'active',   False, 'Leen trok (borrowed/leased)'),
    # ── Special status ────────────────────────────────────────────────────────
    ('SFT', None, 'Scania',        'G460',   'JXP813EC', '9BSG6X40004003855',  'inactive', False, 'Sold'),

    # ══════════════════════════════════════════════════════════════════════════
    # OBHI  —  Betopess sub-fleet  (owned)
    # ══════════════════════════════════════════════════════════════════════════
    ('OBHI', None, 'Scania',       None,     'KXH514MP', '9BSG6X40004042164',  'active', False, 'Betopess'),
    ('OBHI', None, 'Scania',       'R460',   'KMC765EC', '9BSR6X40003873849',  'active', False, 'Betopess'),
    ('OBHI', None, 'Scania',       None,     'KKY108EC', '9BSG6X40003966285',  'active', False, 'Betopess'),
    ('OBHI', None, 'Scania',       'G460',   'KPV364EC', '9BSG6X40003892604',  'active', False, 'Betopess'),
    ('OBHI', None, 'Scania',       'LPGRS',  'KJW398EC', '9BSG6X40003965755',  'active', False, 'Betopess'),
    ('OBHI', None, 'Scania',       'LPGRS',  'KKL390EC', '9BSG6X40003968300',  'active', False, 'Betopess'),
    ('OBHI', None, 'Scania',       'LPGRS',  'JKC468EC', '9BSG6X40003947667',  'active', False, 'Betopess'),
    ('OBHI', None, 'Scania',       'LPGRS',  'KDS053EC', '9BSG6X40003968998',  'active', False, 'Betopess'),
    ('OBHI', None, 'Scania',       'LPGRS',  'KGY077EC', '9BSG6X40003957441',  'active', False, 'Betopess'),

    # ── Alex Maintenance sub-fleet  (owned) ──────────────────────────────────
    ('OBHI', None, 'Scania',       'LPGRS',  'JPL694EC', '9BSG6X40003970275',  'active', False, 'Alex Maintenance'),
    ('OBHI', None, 'Scania',       'LPGRS',  'JTH936EC', '9BSG6X40003984471',  'active', False, 'Alex Maintenance'),
    ('OBHI', None, 'Scania',       'LPGRS',  'JZF207EC', '9BSG6X40004012528',  'active', False, 'Alex Maintenance'),
    ('OBHI', None, 'Scania',       'LPGRS',  'JZS468EC', 'YS2G6X40005659910',  'active', False, 'Alex Maintenance'),
    ('OBHI', None, 'Scania',       'LPGRS',  'KGW055EC', '9BSG6X40004047045',  'active', False, 'Alex Maintenance'),
    ('OBHI', None, 'Scania',       'LPGRS',  'KKP390EC', '9BSG6X40004067419',  'active', False, 'Alex Maintenance'),
    ('OBHI', None, 'Scania',       'LPGRS',  'KKP393EC', '9BSG6X40004067420',  'active', False, 'Alex Maintenance'),

    # ── Intsimbi sub-fleet  (owned) ───────────────────────────────────────────
    ('OBHI', None, 'Scania',       'LPGRS',  'JLX484EC', 'ABJ96342460362545',  'active', False, 'Intsimbi'),

    # ── Belorado sub-fleet  (subcontractor) ──────────────────────────────────
    ('OBHI', None, 'Foton Auman',  None,     'KRL688EC', 'LVBS6PEB2ST501986',  'active', True,  'Belorado'),
    ('OBHI', None, 'Foton Auman',  None,     'KRR116EC', 'LVBS6PEB2ST502006',  'active', True,  'Belorado'),
    ('OBHI', None, 'Scania',       None,     'MH84ZCGP', 'LBZ447DB4RA003240',  'active', True,  'Belorado'),

    # ── Phezulu sub-fleet  (subcontractor) ───────────────────────────────────
    ('OBHI', None, 'Foton Auman',  None,     'KRV199EC', 'LVBS6PEB7ST501921',  'active', True,  'Phezulu'),

    # ── Re Ama Setshaba sub-fleet  (subcontractor) ────────────────────────────
    ('OBHI', None, 'Scania',       None,     'DDM652NC', 'AAK2850FTPB101626',  'active', True,  'Re Ama Setshaba'),

    # ── Bandys sub-fleet  (subcontractor) ────────────────────────────────────
    ('OBHI', None, 'FAW',          None,     'KPS629EC', 'AAK2850FTSB011855',  'active', True,  'Bandys'),
    ('OBHI', None, 'Scania',       None,     'KSC007EC', '9BSR6X40004009728',  'active', True,  'Bandys'),
    ('OBHI', None, 'Scania',       None,     'KST708EC', None,                 'active', True,  'Bandys'),

    # ── CLS Partners sub-fleet  (subcontractor) ──────────────────────────────
    ('OBHI', None, 'Scania',       None,     'EGR648GP', '9BSG6X40004027181',  'active', True,  'CLS Partners'),

    # ── South Cape Floors sub-fleet  (subcontractor) ─────────────────────────
    ('OBHI', None, 'DAF',          None,     '207JGXEC', None,                 'active', True,  'South Cape Floors'),
    ('OBHI', None, 'DAF',          None,     '907JLTEC', None,                 'active', True,  'South Cape Floors'),
    ('OBHI', None, 'DAF',          None,     'JWM651EC', None,                 'active', True,  'South Cape Floors'),
    ('OBHI', None, 'DAF',          None,     'JXG657EC', None,                 'active', True,  'South Cape Floors'),
    ('OBHI', None, 'DAF',          None,     '529FHREC', None,                 'active', True,  'South Cape Floors'),
    ('OBHI', None, 'DAF',          None,     'KBB933EC', None,                 'active', True,  'South Cape Floors'),
    ('OBHI', None, 'DAF',          None,     'KFJ378EC', None,                 'active', True,  'South Cape Floors'),
    ('OBHI', None, 'Scania',       None,     'KKV898EC', None,                 'active', True,  'South Cape Floors'),
    ('OBHI', None, 'FAW',          None,     'KMP690EC', None,                 'active', True,  'South Cape Floors'),
]

# ─────────────────────────────────────────────────────────────────────────────
# TRAILER DATA
# (entity_code, truck_reg, slot, registration, vin, status)
# ─────────────────────────────────────────────────────────────────────────────

TRAILERS = [
    # ══════════════════════════════════════════════════════════════════════════
    # SAFETEC
    # ══════════════════════════════════════════════════════════════════════════
    ('SFT', 'JRC117EC', 1, 'JYC249EC', 'AA9S236KANLVB2215', 'active'),
    ('SFT', 'JRC117EC', 2, 'JYC248EC', 'AA9S236KANLVB2214', 'active'),
    ('SFT', 'JXP816EC', 1, 'KJJ224EC', 'AA9S236KASBVB2357', 'active'),
    ('SFT', 'JXP816EC', 2, 'KJJ227EC', 'AA9S236KASBVB2358', 'active'),
    ('SFT', 'JYC247EC', 1, 'JSS187EC', 'AA9S236KANBVB2103', 'active'),
    ('SFT', 'JYC247EC', 2, 'JSS184EC', 'AA9S236KANBVB2104', 'active'),
    ('SFT', 'JZG083EC', 1, 'KJY946EC', 'AA9S236KASBVB2323', 'active'),
    ('SFT', 'JZG083EC', 2, 'KJY945EC', 'AA9S236KASBVB2324', 'active'),
    ('SFT', 'JZS095EC', 1, 'KKZ310EC', 'AA9S236KASLVB1068', 'active'),
    ('SFT', 'JZS095EC', 2, 'KKZ312EC', 'AA9S236KASLVB1069', 'active'),
    ('SFT', 'KBD393EC', 1, 'KFF759EC', 'AA9S236KARBVB2680', 'active'),
    ('SFT', 'KBD393EC', 2, 'KFF757EC', 'AA9S236KARBVB2681', 'active'),
    ('SFT', 'KCY733EC', 1, 'KBX164EC', 'AA9S236KAPBVB2895', 'active'),
    ('SFT', 'KCY733EC', 2, 'KBX166EC', 'AA9S236KAPBVB2896', 'active'),
    ('SFT', 'KDJ034EC', 1, 'KFF762EC', 'AA9S236KARBVB2676', 'active'),
    ('SFT', 'KDJ034EC', 2, 'KFF761EC', 'AA9S236KARBVB2677', 'active'),
    ('SFT', 'KDZ484EC', 1, 'KDJ037EC', 'AA9S236KARBVB2125', 'active'),
    ('SFT', 'KDZ484EC', 2, 'KDJ181EC', 'AA9S236KARBVB2126', 'active'),
    ('SFT', 'KFK772EC', 1, 'KHD067EC', 'AA9S236KARLVB2358', 'active'),
    ('SFT', 'KFK772EC', 2, 'KHD060EC', 'AA9S236KARLVB2359', 'active'),
    ('SFT', 'KFT767EC', 1, 'KFY016EC', 'AA9S236KARLVB2107', 'active'),
    ('SFT', 'KFT767EC', 2, 'KFY028EC', 'AA9S236KARLVB2108', 'active'),
    ('SFT', 'KGJ578EC', 1, 'KCY734EC', 'AA9S236KANBVB2633', 'active'),
    ('SFT', 'KGJ578EC', 2, 'KCY736EC', 'AA9S236KANBVB2634', 'active'),
    ('SFT', 'KGX782EC', 1, 'KGX776EC', 'AA9S236KARLVB2393', 'active'),
    ('SFT', 'KGX782EC', 2, 'KGX778EC', 'AA9S236KARLVB2392', 'active'),
    ('SFT', 'KKF401EC', 1, 'KKF406EC', 'AA9S236KASBVB2893', 'active'),
    ('SFT', 'KKF401EC', 2, 'KKF394EC', 'AA9S236KASBVB2894', 'active'),
    ('SFT', 'KLC159EC', 1, 'KDC543EC', 'AA9S236KARBVB2123', 'active'),
    ('SFT', 'KLC159EC', 2, 'KDC544EC', 'AA9S236KARBVB2124', 'active'),
    ('SFT', 'KMR411EC', 1, 'KNF474EC', 'AJBS236KATBST0235',  'active'),
    ('SFT', 'KMR411EC', 2, 'KNF475EC', 'AJBS236KATBST0236',  'active'),
    ('SFT', 'KMT481EC', 1, 'KMT476EC', 'AJBS236KASBST1246',  'active'),
    ('SFT', 'KMT481EC', 2, 'KMT480EC', 'AJBS236KASBST1247',  'active'),
    ('SFT', 'KNF472EC', 1, 'KNF477EC', 'AJBS236KATBST0134',  'active'),
    ('SFT', 'KNF472EC', 2, 'KNF476EC', 'AJBS236KATBST0135',  'active'),
    ('SFT', 'KNP861EC', 1, 'KPH747EC', 'AJBS236KATBST0388',  'active'),
    ('SFT', 'KNP861EC', 2, 'KPH746EC', 'AJBS236KATBST0389',  'active'),
    ('SFT', 'KNS946EC', 1, 'KFK168EC', 'AA9S236KARBVB2682',  'active'),
    ('SFT', 'KNS946EC', 2, 'KFK169EC', 'AA9S236KARBVB2683',  'active'),
    ('SFT', 'KPH748EC', 1, 'KBZ568EC', 'AA9S236KAPLVB2115',  'active'),
    ('SFT', 'KPH748EC', 2, 'KBZ571EC', 'AA9S236KAPLVB2116',  'active'),
    ('SFT', 'KPK198EC', 1, 'KFF760EC', 'AA9S236KARBVB2678',  'active'),
    ('SFT', 'KPK198EC', 2, 'KFF756EC', 'AA9S236KARBVB2679',  'active'),
    ('SFT', 'KPS102EC', 1, 'KKX754EC', 'AA9S236KASLVB1066',  'active'),
    ('SFT', 'KPS102EC', 2, 'KKX758EC', 'AA9S236KASLVB1067',  'active'),
    ('SFT', 'KRC830EC', 1, 'KRC829EC', 'AJBS236KATBST0306',  'active'),
    ('SFT', 'KRC830EC', 2, 'KRC832EC', 'AJBS236KATBST0307',  'active'),
    ('SFT', 'KRM473EC', 1, 'KFY030EC', 'AA9S236KARLVB2110',  'active'),
    ('SFT', 'KRM473EC', 2, 'KFY018EC', 'AA9S236KARLVB2109',  'active'),
    ('SFT', 'KRW188EC', 1, 'KRW187EC', 'AJBS236KATBST0979',  'active'),
    ('SFT', 'KRW188EC', 2, 'KRW184EC', 'AJBS236KATBST0980',  'active'),
    ('SFT', 'KSV060EC', 1, 'KSV051EC', None,                 'active'),
    ('SFT', 'KSV060EC', 2, 'KSV056EC', None,                 'active'),
    ('SFT', 'KSZ633EC', 1, 'KSZ643EC', None,                 'active'),
    ('SFT', 'KSZ633EC', 2, 'KSZ640EC', None,                 'active'),
    ('SFT', 'KSZ397EC', 1, 'KSV048EC', None,                 'active'),
    ('SFT', 'KSZ397EC', 2, 'KSV043EC', None,                 'active'),
    ('SFT', 'JH13XVGP', 1, 'EJD573GP', None,                 'active'),
    ('SFT', 'JH13XVGP', 2, 'EJD574GP', None,                 'active'),
    # JXP813EC (inactive/sold) — trailers also inactive
    ('SFT', 'JXP813EC', 1, 'JZG085EC', 'AA9S236KAPBVB2440',  'inactive'),
    ('SFT', 'JXP813EC', 2, 'JZG082EC', 'AA9S236KAPBVB2441',  'inactive'),

    # ══════════════════════════════════════════════════════════════════════════
    # OBHI  —  Betopess
    # ══════════════════════════════════════════════════════════════════════════
    ('OBHI', 'KXH514MP', 1, 'EKK494GP', 'AJBS236KAVBST0186',  'active'),
    ('OBHI', 'KXH514MP', 2, 'EKK495GP', 'AJBS236KAVBST0187',  'active'),
    ('OBHI', 'KMC765EC', 1, 'JXR975EC', 'AA9S236KANLVB2218',  'active'),
    ('OBHI', 'KMC765EC', 2, 'JXR691EC', 'AA9S236KANLVB2219',  'active'),
    ('OBHI', 'KKY108EC', 1, 'KKN187EC', 'AA9S23KASLVB1002',   'active'),
    ('OBHI', 'KKY108EC', 2, 'KKN168EC', 'AA9S23KASLVB1003',   'active'),
    ('OBHI', 'KPV364EC', 1, 'JYL662EC', 'AA9B236KAPBVB2123',  'active'),
    ('OBHI', 'KPV364EC', 2, 'JYL660EC', 'AA9B236KAPBVB2124',  'active'),
    ('OBHI', 'KJW398EC', 1, 'KHX726EC', 'AA9S236KARLVB2854',  'active'),
    ('OBHI', 'KJW398EC', 2, 'KHX732EC', 'AA9S236KARLVB2853',  'active'),
    ('OBHI', 'KKL390EC', 1, 'KKN192EC', 'AA9S23KASLVB1001',   'active'),
    ('OBHI', 'KKL390EC', 2, 'KKN206EC', 'AA9S23KASLVB1000',   'active'),
    ('OBHI', 'JKC468EC', 1, 'JRV069EC', 'AA9S236KAMBVB2446',  'active'),  # chassis sheet authoritative
    ('OBHI', 'JKC468EC', 2, 'JRV067EC', 'AA9S236KAMBVB2445',  'active'),
    ('OBHI', 'KDS053EC', 1, 'KDS455EC', 'AA9S236KARBVB2411',  'active'),
    ('OBHI', 'KDS053EC', 2, 'KDS453EC', 'AA9S236KARBVB2421',  'active'),
    ('OBHI', 'KGY077EC', 1, 'KGY546EC', 'AA9S236KARBVB2955',  'active'),
    ('OBHI', 'KGY077EC', 2, 'KGY547EC', 'AA9S236KARBVB2954',  'active'),

    # ── Alex Maintenance ─────────────────────────────────────────────────────
    ('OBHI', 'JPL694EC', 1, 'JPT733EC', 'AA9S236KAMBVB2341',  'active'),
    ('OBHI', 'JPL694EC', 2, 'JPT737EC', 'AA9S236KAMBVB2342',  'active'),
    ('OBHI', 'JTH936EC', 1, 'JTJ436EC', 'AA9S236KANBVB2331',  'active'),
    ('OBHI', 'JTH936EC', 2, 'JTK547EC', 'AA9S236KANBVB2332',  'active'),
    ('OBHI', 'JZF207EC', 1, 'JZF209EC', 'AA9S236KAPBVB2438',  'active'),
    ('OBHI', 'JZF207EC', 2, 'JZF214EC', 'AA9S236KAPBVB2439',  'active'),
    ('OBHI', 'JZS468EC', 1, 'JZS116EC', 'AA9S236KAPBVB2443',  'active'),
    ('OBHI', 'JZS468EC', 2, 'JZS129EC', 'AA9S236KAPBVB2442',  'active'),
    ('OBHI', 'KGW055EC', 1, 'KGV923EC', 'AA9S236KARLVB2549',  'active'),
    ('OBHI', 'KGW055EC', 2, 'KGV926EC', 'AA9S236KARLVB2548',  'active'),
    ('OBHI', 'KKP390EC', 1, 'KKR153EC', 'AA9S236KASLVB1046',  'active'),
    ('OBHI', 'KKP390EC', 2, 'KKR169EC', 'AA9S236KASLVB1047',  'active'),
    ('OBHI', 'KKP393EC', 1, 'KKR179EC', 'AAPS236KASLVB1048',  'active'),
    ('OBHI', 'KKP393EC', 2, 'KKR186EC', 'AA9X236KASLVB1049',  'active'),

    # ── Intsimbi  (trailers were listed as Safetec spare — assigned here) ────
    ('OBHI', 'JLX484EC', 1, 'JXP754EC', 'AA9S236WANLVB2046',  'active'),
    ('OBHI', 'JLX484EC', 2, 'JXP757EC', 'AA9S236WANLVB2047',  'active'),

    # ── Belorado ─────────────────────────────────────────────────────────────
    ('OBHI', 'KRL688EC', 1, 'KRL790EC', None,                 'active'),
    ('OBHI', 'KRL688EC', 2, 'KRL796EC', None,                 'active'),
    ('OBHI', 'KRR116EC', 1, 'KRR108EC', None,                 'active'),
    ('OBHI', 'KRR116EC', 2, 'KRR109EC', None,                 'active'),
    # MH84ZCGP — no trailers recorded

    # ── Phezulu ──────────────────────────────────────────────────────────────
    ('OBHI', 'KRV199EC', 1, 'KRV326EC', 'AA9S236KANBVB2303',  'active'),
    ('OBHI', 'KRV199EC', 2, 'KRV322EC', 'AA9S23KANBVB2304',   'active'),

    # ── Re Ama Setshaba ───────────────────────────────────────────────────────
    ('OBHI', 'DDM652NC', 1, 'JVS439EC', 'AA9S236KANBVB2490',  'active'),
    ('OBHI', 'DDM652NC', 2, 'JVS436EC', 'AA9S236KANBVB2489',  'active'),

    # ── Bandys ───────────────────────────────────────────────────────────────
    ('OBHI', 'KPS629EC', 1, 'ML89XCGP', 'AAS9S236KANBVB2535', 'active'),
    ('OBHI', 'KPS629EC', 2, 'ML89XJGP', 'AAS9S236KANBVB2536', 'active'),
    ('OBHI', 'KSC007EC', 1, 'MR58LZGP', None,                 'active'),
    ('OBHI', 'KSC007EC', 2, 'MR58FSGP', None,                 'active'),
    ('OBHI', 'KST708EC', 1, 'EFY388GP', None,                 'active'),
    ('OBHI', 'KST708EC', 2, 'EFY389GP', None,                 'active'),
    # EGR648GP (CLS Partners) — no trailers recorded

    # ── South Cape Floors ─────────────────────────────────────────────────────
    ('OBHI', '207JGXEC', 1, 'KHM069EC', None, 'active'),
    ('OBHI', '207JGXEC', 2, 'KHM070EC', None, 'active'),
    ('OBHI', '907JLTEC', 1, 'KJD210EC', None, 'active'),
    ('OBHI', '907JLTEC', 2, 'KJD218EC', None, 'active'),
    ('OBHI', 'JWM651EC', 1, 'KJD211EC', None, 'active'),
    ('OBHI', 'JWM651EC', 2, 'KJD207EC', None, 'active'),
    ('OBHI', 'JXG657EC', 1, 'KFP723EC', None, 'active'),
    ('OBHI', 'JXG657EC', 2, 'KFP724EC', None, 'active'),
    ('OBHI', '529FHREC', 1, 'JYZ896EC', None, 'active'),
    ('OBHI', '529FHREC', 2, 'JYZ894EC', None, 'active'),
    ('OBHI', 'KBB933EC', 1, 'KJL074EC', None, 'active'),
    ('OBHI', 'KBB933EC', 2, 'KJL076EC', None, 'active'),
    ('OBHI', 'KFJ378EC', 1, 'KJL071EC', None, 'active'),
    ('OBHI', 'KFJ378EC', 2, 'KJL080EC', None, 'active'),
    ('OBHI', 'KKV898EC', 1, 'JWM640EC', None, 'active'),
    ('OBHI', 'KKV898EC', 2, 'JWM637EC', None, 'active'),
    ('OBHI', 'KMP690EC', 1, 'KBN566EC', None, 'active'),
    ('OBHI', 'KMP690EC', 2, 'KBN567EC', None, 'active'),
]


# ─────────────────────────────────────────────────────────────────────────────
# SEED
# ─────────────────────────────────────────────────────────────────────────────

def seed():
    db: Session = SessionLocal()
    try:
        # Look up entities
        sft  = db.execute(select(BusinessEntity).where(BusinessEntity.code == 'SFT')).scalar_one()
        obhi = db.execute(select(BusinessEntity).where(BusinessEntity.code == 'OBHI')).scalar_one()
        entity_map = {'SFT': sft, 'OBHI': obhi}

        # ── Trucks ────────────────────────────────────────────────────────────
        t_ins = t_skip = 0
        truck_id_cache: dict[str, int] = {}  # reg → id (both new and existing)

        for entity_code, fleet_num, make, model, reg, vin_val, status_str, is_sub, notes in TRUCKS:
            reg = _reg(reg)
            entity = entity_map[entity_code]

            existing = db.execute(select(Truck).where(
                Truck.entity_id == entity.id,
                Truck.registration == reg,
            )).scalar_one_or_none()

            if existing:
                truck_id_cache[reg] = existing.id
                t_skip += 1
                continue

            truck = Truck(
                entity_id=entity.id,
                fleet_number=fleet_num,
                make=make,
                model=model,
                registration=reg,
                vin=_v(vin_val),
                status=_status(status_str),
                is_subcontractor=is_sub,
                notes=notes,
            )
            db.add(truck)
            db.flush()
            truck_id_cache[reg] = truck.id
            t_ins += 1

        db.flush()

        # ── Trailers ──────────────────────────────────────────────────────────
        tr_ins = tr_skip = tr_notruck = 0

        for entity_code, truck_reg, slot, t_reg, t_vin, t_status_str in TRAILERS:
            t_reg = _reg(t_reg)
            truck_reg_norm = _reg(truck_reg)
            entity = entity_map[entity_code]

            truck_id = truck_id_cache.get(truck_reg_norm)
            if truck_id is None:
                # Try DB lookup (truck may have existed before this run)
                found = db.execute(select(Truck).where(
                    Truck.entity_id == entity.id,
                    Truck.registration == truck_reg_norm,
                )).scalar_one_or_none()
                if found:
                    truck_id = found.id
                    truck_id_cache[truck_reg_norm] = truck_id
                else:
                    print(f'  WARN: truck {truck_reg_norm} not found — skipping trailer {t_reg}')
                    tr_notruck += 1
                    continue

            existing = db.execute(select(Trailer).where(
                Trailer.truck_id == truck_id,
                Trailer.slot == slot,
            )).scalar_one_or_none()

            if existing:
                tr_skip += 1
                continue

            db.add(Trailer(
                truck_id=truck_id,
                entity_id=entity.id,
                slot=slot,
                registration=t_reg,
                vin=_v(t_vin),
                status=_tstatus(t_status_str),
            ))
            tr_ins += 1

        db.commit()

        print()
        print('=' * 50)
        print('  Fleet seed complete')
        print('=' * 50)
        print(f'  Trucks   — inserted: {t_ins:>3},  skipped: {t_skip:>3}')
        print(f'  Trailers — inserted: {tr_ins:>3},  skipped: {tr_skip:>3}', end='')
        print(f'  (no truck: {tr_notruck})' if tr_notruck else '')
        print()

        # Entity summary
        for code, entity in entity_map.items():
            nt = db.execute(select(Truck).where(Truck.entity_id == entity.id)).scalars().all()
            ntr = sum(len(t.trailers) for t in nt)
            print(f'  {code}: {len(nt)} trucks, {ntr} trailers')
        print()

    except Exception as exc:
        db.rollback()
        print(f'\n  ERROR: {exc}')
        import traceback; traceback.print_exc()
        import sys; sys.exit(1)
    finally:
        db.close()


if __name__ == '__main__':
    seed()
