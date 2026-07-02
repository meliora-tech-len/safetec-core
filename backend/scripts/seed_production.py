"""
seed_production.py
==================
Creates all tables on Supabase and seeds master/reference data.

Run from the backend/ directory with your Supabase DATABASE_URL:

    DATABASE_URL=postgresql://... python scripts/seed_production.py

Or temporarily edit DATABASE_URL in your .env file to point at Supabase,
then run:

    python scripts/seed_production.py

Tables seeded (in dependency order):
  roles, business_entities, users, mines, trucks, trailers,
  personal_vehicles, drivers, payroll_settings, app_settings

Transactional tables (invoices, loads, diesel, etc.) are NOT seeded —
they will be populated through normal app use.
"""

import os
import sys
import json
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Load .env from backend/ so DATABASE_URL is available without exporting it
_env_file = Path(__file__).resolve().parents[1] / ".env"
if _env_file.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_file, override=False)

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from app.db.database import Base
from app.models.models import (
    Role, BusinessEntity, User, UserEntityAccess,
    Mine, Truck, TruckStatus, Trailer, TrailerStatus,
    PersonalVehicle, PersonalVehicleStatus,
    Driver, DriverType,
    PayrollSettings, AppSetting,
)

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL or DATABASE_URL.startswith("sqlite"):
    print("\nERROR: Set DATABASE_URL to your Supabase PostgreSQL URL before running.\n"
          "  Example:\n"
          "  DATABASE_URL=postgresql://postgres.xxx:password@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"
          " python scripts/seed_production.py\n")
    sys.exit(1)

engine = create_engine(DATABASE_URL, echo=False)


# ── 1. Create all tables ──────────────────────────────────────────────────────

def create_tables():
    print("Creating tables...")
    Base.metadata.create_all(bind=engine)
    print("  OK")


# ── 2. Seed helpers ───────────────────────────────────────────────────────────

def reset_sequence(conn, table, col="id"):
    """Advance the PostgreSQL sequence to MAX(id) so next insert doesn't clash."""
    conn.execute(text(
        f"SELECT setval(pg_get_serial_sequence('{table}', '{col}'), "
        f"COALESCE(MAX({col}), 0) + 1, false) FROM {table}"
    ))


# ── 3. Roles ──────────────────────────────────────────────────────────────────

ROLES = [
    {"key": "admin",    "display_name": "System Administrator", "is_protected": True},
    {"key": "standard", "display_name": "Admin Assistant",      "is_protected": True},
]


def seed_roles(db: Session):
    print("Seeding roles...")
    for r in ROLES:
        if not db.query(Role).filter(Role.key == r["key"]).first():
            db.add(Role(**r))
    db.commit()
    print(f"  {len(ROLES)} roles")


# ── 4. Business entities ──────────────────────────────────────────────────────

ENTITIES = [
    {"id": 1, "code": "BTP",  "name": "Border Tradepost (Pty) Ltd",  "trading_name": "Border Tradepost",
     "registration_number": "2020/123456/07", "vat_number": "4123456789",
     "address": "16 Lower Valley Road \nSouth End \nGqeberha\nEastern Cape \n6001",
     "phone": "041 008 5009", "email": "admin@btpo.co.za",
     "bank_name": "Standard Bank", "bank_branch": "Walmer",
     "bank_account_number": "", "bank_branch_code": "", "bank_reference": "",
     "primary_color": "#468b5f", "invoice_prefix": "BTP", "invoice_counter": 1,
     "quote_prefix": "QT", "quote_counter": 0, "vat_rate": 0.15, "is_active": True},

    {"id": 2, "code": "OBHI", "name": "OBHI (Pty) Ltd", "trading_name": "OBHI",
     "registration_number": "2019/234567/07", "vat_number": "4234567890",
     "address": "16 LOWER VALLEY ROAD\nSOUTH END\nGQEBERHA\nEASTERN CAPE\n6001",
     "phone": "041 008 5009", "email": "admin@obhi.co.za",
     "bank_name": "Standard Bank", "bank_branch": "051001",
     "bank_account_number": "33 335 32 69", "bank_branch_code": "051001",
     "bank_reference": "INVOICE NO",
     "primary_color": "#dc2626", "invoice_prefix": "OBHI", "invoice_counter": 2,
     "quote_prefix": "QT", "quote_counter": 3, "vat_rate": 0.15, "is_active": True},

    {"id": 3, "code": "SFT",  "name": "Safetec (Pty) Ltd", "trading_name": "Safetec",
     "registration_number": "2018/345678/07", "vat_number": "4345678901",
     "address": "16 Lower Valley Road \nSouth End \nGqeberha\nEastern Cape \n6001",
     "phone": "0410085009", "email": "admin@safetec.co.za",
     "bank_name": "Standard Bank", "bank_branch": "Walmer",
     "bank_account_number": "080096832", "bank_branch_code": "", "bank_reference": "",
     "primary_color": "#f4a64e", "invoice_prefix": "SFT", "invoice_counter": 1,
     "quote_prefix": "QT", "quote_counter": 0, "vat_rate": 0.15, "is_active": True},

    {"id": 4, "code": "TP",   "name": "Thembis People (Pty) Ltd", "trading_name": "Thembis People",
     "registration_number": "2017/456789/07", "vat_number": "4456789012",
     "address": "16 Lower Valley Road \nSouth End \nGqeberha\nEastern Cape \n6001",
     "phone": "041 008 5009", "email": "admin@thembis.co.za",
     "bank_name": "Standard Bank", "bank_branch": "Walmer",
     "bank_account_number": "061446211", "bank_branch_code": "", "bank_reference": "",
     "primary_color": "#24a8eb", "invoice_prefix": "TP", "invoice_counter": 0,
     "quote_prefix": "QT", "quote_counter": 0, "vat_rate": 0.15, "is_active": True},

    {"id": 5, "code": "BKMO", "name": "Bokamosho (Pty) Ltd", "trading_name": "Bokamosho",
     "registration_number": "2021/567890/07", "vat_number": "4567890123",
     "address": "2400 Industrial Road\nOlifantshoek\nNorthen Cape\n8450",
     "phone": "068 884 7098", "email": "admin@bokamosho.co.za",
     "bank_name": "Standard Bank", "bank_branch": "", "bank_account_number": "",
     "bank_branch_code": "", "bank_reference": "",
     "primary_color": "#1a1a2e", "invoice_prefix": "BKMO", "invoice_counter": 3,
     "quote_prefix": "QT", "quote_counter": 0, "vat_rate": 0.15, "is_active": True},

    {"id": 6, "code": "SP",   "name": "SUMMERPALACE (PTY) LTD", "trading_name": "Summerpalace",
     "registration_number": "2023/536007/07", "vat_number": "",
     "address": "16 LOWER VALLEY ROAD\nSOUTH END\nGQEBERHA\nEASTERN CAPE\n6001",
     "phone": "0410085009", "email": "info@safetec.co.za",
     "bank_name": "", "bank_branch": "", "bank_account_number": "",
     "bank_branch_code": "", "bank_reference": "",
     "primary_color": "#eeb677", "invoice_prefix": "", "invoice_counter": 0,
     "quote_prefix": "QT", "quote_counter": 0, "vat_rate": 0.15, "is_active": True},
]


def seed_entities(db: Session):
    print("Seeding business entities...")
    for e in ENTITIES:
        if not db.query(BusinessEntity).filter(BusinessEntity.id == e["id"]).first():
            db.add(BusinessEntity(**e))
    db.commit()
    with engine.connect() as conn:
        reset_sequence(conn, "business_entities")
        conn.commit()
    print(f"  {len(ENTITIES)} entities")


# ── 5. Admin user ─────────────────────────────────────────────────────────────
# Password hash = bcrypt of the dev admin password.
# Change via the app's "Forgot Password" flow after first login.

ADMIN_USER = {
    "id": 1,
    "email": "admin@safetec.co.za",
    "full_name": "System Administrator",
    "hashed_password": "$2b$12$r8FwqfDgyH5pdKSUguBFkOedo.pFGIHEcQEbjgQYdmr17ePWnnpBO",
    "role": "admin",
    "is_active": True,
}


def seed_users(db: Session):
    print("Seeding admin user...")
    if not db.query(User).filter(User.id == ADMIN_USER["id"]).first():
        db.add(User(**ADMIN_USER))
        db.commit()

        # Give admin full access to all entities
        for entity_id in range(1, 7):
            db.add(UserEntityAccess(
                user_id=1,
                entity_id=entity_id,
                can_create=True,
                can_edit=True,
                can_delete=True,
                allowed_modules=["clients", "invoices", "suppliers", "fleet", "diesel"],
            ))
        db.commit()

    with engine.connect() as conn:
        reset_sequence(conn, "users")
        reset_sequence(conn, "user_entity_access")
        conn.commit()
    print("  1 admin user + entity access")


# ── 6. Mines ──────────────────────────────────────────────────────────────────

MINES = [
    {"id": 1, "name": "ASSMANG", "code": "ASS", "is_active": True},
    {"id": 2, "name": "TAWANA",  "code": "TAW", "is_active": True},
    {"id": 3, "name": "SEBILO",  "code": "SEB", "is_active": True},
    {"id": 4, "name": "MOKALA",  "code": "MOK", "is_active": True},
    {"id": 5, "name": "GLOSAM",  "code": "GLO", "is_active": True},
    {"id": 6, "name": "BOSKOP",  "code": "BOS", "is_active": False},
    {"id": 7, "name": "TSHIPI",  "code": "TSH", "is_active": True},
]


def seed_mines(db: Session):
    print("Seeding mines...")
    for m in MINES:
        if not db.query(Mine).filter(Mine.id == m["id"]).first():
            db.add(Mine(**m))
    db.commit()
    with engine.connect() as conn:
        reset_sequence(conn, "mines")
        conn.commit()
    print(f"  {len(MINES)} mines")


# ── 7. Trucks ─────────────────────────────────────────────────────────────────

# (id, entity_id, fleet_number, make, model, registration, vin, is_subcontractor, operator, contract_context, temp_registration, status, notes)
TRUCKS = [
    (1,  3, "1",  "Scania",     "G460 XT", "JRC117EC", "9BSG6X40003970699", False, None,             "Safetec",  None,         "active", None),
    (2,  3, "2",  "Scania",     "G460",    "JXP816EC", "9BSG6X40004003854", False, None,             "Safetec",  None,         "active", None),
    (3,  3, "3",  "Scania",     "P410",    "JYC247EC", "9BSP6X40003972408", False, "Safetec",        "Intsimbi", None,         "active", None),
    (4,  3, "4",  "Scania",     "G460",    "JZG083EC", "9BSG6X40004012527", False, None,             "Safetec",  None,         "active", None),
    (5,  3, "5",  "Scania",     "G460",    "JZS095EC", "YS2G6X40005659908", False, None,             "Safetec",  None,         "active", None),
    (6,  3, "6",  "Scania",     "G460",    "KBD393EC", "YS2G6X40005659911", False, None,             "Safetec",  None,         "active", None),
    (7,  3, "7",  "Scania",     "P410",    "KCY733EC", "9BSPX40003948305",  False, None,             "Safetec",  None,         "active", None),
    (8,  3, "8",  "Scania",     "G460",    "KDJ034EC", "9BSG6X40004031764", False, None,             "Safetec",  None,         "active", None),
    (9,  3, "9",  "Scania",     "G460",    "KDZ484EC", "9BSG6X40004036824", False, None,             "Safetec",  None,         "active", None),
    (10, 3, "10", "Scania",     "G460",    "KFK772EC", "9BSG6X40004037861", False, None,             "Safetec",  None,         "active", None),
    (11, 3, "11", "Scania",     "G460",    "KFT767EC", "9BSG6X40004038488", False, None,             "Safetec",  None,         "active", None),
    (12, 3, "12", "Scania",     "P410",    "KGJ578EC", "9BSP6X40004045407", False, None,             "Safetec",  None,         "active", None),
    (13, 3, "13", "Scania",     "G460",    "KGX782EC", "9BSG6X40004047043", False, None,             "Safetec",  None,         "active", None),
    (14, 3, "14", "Scania",     "P410",    "KKF401EC", "9BSP6V40004045408", False, None,             "Safetec",  None,         "active", None),
    (15, 3, "15", "Mercedes",   "Actros",  "KLC159EC", "ABJ96342960767691", False, None,             "Safetec",  None,         "active", None),
    (16, 3, "16", "Scania",     "G460",    "KMR411EC", "9BSG6X40004082401", False, None,             "Safetec",  None,         "active", None),
    (17, 3, "17", "Scania",     "G460",    "KMT481EC", "9BSG6X40004082415", False, None,             "Safetec",  None,         "active", None),
    (18, 3, "18", "Scania",     "G460",    "KNF472EC", "9BSG6X40004082421", False, None,             "Safetec",  None,         "active", None),
    (19, 3, "19", "Scania",     "G460",    "KNP861EC", "9BSG6X40004082422", False, None,             "Safetec",  None,         "active", None),
    (20, 3, "20", "Mercedes",   "Actros",  "KNS946EC", "ABJ96342X60778277", False, None,             "Safetec",  None,         "active", None),
    (21, 3, "21", "Scania",     "G460",    "KPH748EC", "9BSG6X40004085636", False, None,             "Safetec",  None,         "active", None),
    (22, 3, "22", "Mercedes",   "Actros",  "KPK198EC", "ABJ96342660757653", False, None,             "Safetec",  None,         "active", None),
    (23, 3, "23", "Scania",     "G460",    "KPS102EC", "9BSG6X40004068114", False, None,             "Safetec",  None,         "active", None),
    (24, 3, "24", "Scania",     "G460",    "KRC830EC", "9BSG6X40004024126", False, None,             "Safetec",  None,         "active", None),
    (25, 3, "25", "Mercedes",   "Actros",  "KRM473EC", "ABJ96342660749617", False, None,             "Safetec",  None,         "active", None),
    (26, 3, "26", "Scania",     "G460",    "KRW188EC", "9BSG6X40004028021", False, None,             "Safetec",  None,         "active", None),
    (27, 3, "27", "Scania",     "G460",    "KSV060EC", None,                False, None,             "Safetec",  None,         "active", None),
    (28, 3, "28", "Scania",     None,      "KSZ633EC", None,                False, None,             "Safetec",  None,         "active", None),
    (29, 3, "29", "Scania",     None,      "KSZ397EC", None,                False, None,             "Safetec",  None,         "active", None),
    (30, 3, "30", "Mercedes",   None,      "JH13XVGP", None,                False, None,             "Safetec",  None,         "active", "Leen trok (borrowed/leased)"),
    (31, 3, None, "Scania",     "G460",    "JXP813EC", "9BSG6X40004003855", False, None,             "Safetec",  None,         "inactive","Sold"),
    # OBHI subcontractors
    (32, 2, None, "Scania",     None,      "KXH514MP", "9BSG6X40004042164", True,  "Betopess",       "OBHI",     None,         "active", "Betopess"),
    (33, 2, None, "Scania",     "R460",    "KMC765EC", "9BSR6X40003873849", True,  "Betopess",       "OBHI",     None,         "active", "Betopess"),
    (34, 2, None, "Scania",     None,      "KKY108EC", "9BSG6X40003966285", True,  "Betopess",       "OBHI",     None,         "active", "Betopess"),
    (36, 2, None, "Scania",     "LPGRS",   "KJW398EC", "9BSG6X40003965755", True,  "Betopess",       "OBHI",     None,         "active", "Betopess"),
    (37, 2, None, "Scania",     "LPGRS",   "KKL390EC", "9BSG6X40003968300", True,  "Betopess",       "OBHI",     None,         "active", "Betopess"),
    (38, 2, None, "Scania",     "LPGRS",   "JKC468EC", "9BSG6X40003947667", True,  "Betopess",       "OBHI",     None,         "active", "Betopess"),
    (39, 2, None, "Scania",     "LPGRS",   "KDS053EC", "9BSG6X40003968998", True,  "Betopess",       "OBHI",     None,         "active", "Betopess"),
    (40, 2, None, "Scania",     "LPGRS",   "KGY077EC", "9BSG6X40003957441", True,  "Betopess",       "OBHI",     None,         "active", "Betopess"),
    (41, 2, None, "Scania",     "LPGRS",   "JPL694EC", "9BSG6X40003970275", True,  "Alex Maintenance","Intsimbi", None,         "active", "Alex Maintenance"),
    (42, 2, None, "Scania",     "LPGRS",   "JTH936EC", "9BSG6X40003984471", True,  "Alex Maintenance","OBHI",     None,         "active", "Alex Maintenance"),
    (43, 2, None, "Scania",     "LPGRS",   "JZF207EC", "9BSG6X40004012528", True,  "Alex Maintenance","OBHI",     None,         "active", "Alex Maintenance"),
    (44, 2, None, "Scania",     "LPGRS",   "JZS468EC", "YS2G6X40005659910", True,  "Alex Maintenance","OBHI",     None,         "active", "Alex Maintenance"),
    (45, 2, None, "Scania",     "LPGRS",   "KGW055EC", "9BSG6X40004047045", True,  "Alex Maintenance","OBHI",     None,         "active", "Alex Maintenance"),
    (46, 2, None, "Scania",     "LPGRS",   "KKP390EC", "9BSG6X40004067419", True,  "Alex Maintenance","OBHI",     None,         "active", "Alex Maintenance"),
    (47, 2, None, "Scania",     "LPGRS",   "KKP393EC", "9BSG6X40004067420", True,  "Alex Maintenance","OBHI",     None,         "active", "Alex Maintenance"),
    (48, 2, None, "Scania",     "LPGRS",   "JLX484EC", "ABJ96342460362545", True,  "Julian",         "Intsimbi", None,         "active", "Intsimbi"),
    (49, 2, None, "Foton Auman",None,      "KRL688EC", "LVBS6PEB2ST501986", True,  "Belorado",       "OBHI",     None,         "active", "Belorado"),
    (50, 2, None, "Foton Auman",None,      "KRR116EC", "LVBS6PEB2ST502006", True,  "Belorado",       "OBHI",     None,         "active", "Belorado"),
    (51, 2, None, "Scania",     None,      "MH84ZCGP", "LBZ447DB4RA003240", True,  "Belorado",       "OBHI",     None,         "active", "Belorado"),
    (52, 2, None, "Foton Auman",None,      "KRV199EC", "LVBS6PEB7ST501921", True,  "Phezulu",        "OBHI",     None,         "active", "Phezulu"),
    (53, 2, None, "Scania",     None,      "DDM652NC", "AAK2850FTPB101626", True,  "Re Ama",         "OBHI",     None,         "active", "Re Ama Setshaba"),
    (54, 2, None, "FAW",        None,      "KPS629EC", "AAK2850FTSB011855", True,  "Bandeys",        "OBHI",     None,         "active", "Bandys"),
    (55, 2, None, "Scania",     None,      "KSC007EC", "9BSR6X40004009728", True,  "Bandeys",        "OBHI",     "ECF698GP",   "active", "Bandys"),
    (56, 2, None, "Scania",     None,      "KST708EC", None,                True,  "Bandeys",        "OBHI",     "EKV375GP",   "active", "Bandys"),
    (57, 2, None, "Scania",     None,      "EGR648GP", "9BSG6X40004027181", True,  "CLS Partners",   "OBHI",     None,         "active", "CLS Partners"),
    (58, 2, None, "DAF",        None,      "207JGXEC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (59, 2, None, "DAF",        None,      "907JLTEC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (60, 2, None, "DAF",        None,      "JWM651EC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (61, 2, None, "DAF",        None,      "JXG657EC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (62, 2, None, "DAF",        None,      "529FHREC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (63, 2, None, "DAF",        None,      "KBB933EC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (64, 2, None, "DAF",        None,      "KFJ378EC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (65, 2, None, "Scania",     None,      "KKV898EC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (66, 2, None, "FAW",        None,      "KMP690EC", None,                True,  "South Cape",     "OBHI",     None,         "active", "South Cape Floors"),
    (67, 2, None, "Scania",     None,      "EDJ314EC", None,                True,  "Alex Maintenance","Intsimbi", None,         "active", None),
    (68, 2, None, "Unknown",    None,      "KRC196EC", None,                True,  "Phezulu",        "OBHI",     None,         "active", None),
]


def seed_trucks(db: Session):
    print("Seeding trucks...")
    count = 0
    for (tid, eid, fleet_num, make, model, reg, vin, is_sub, operator, ctx, temp_reg, status, notes) in TRUCKS:
        if db.query(Truck).filter(Truck.id == tid).first():
            continue
        db.add(Truck(
            id=tid, entity_id=eid, fleet_number=fleet_num,
            make=make, model=model, registration=reg, vin=vin,
            is_subcontractor=is_sub, operator=operator,
            contract_context=ctx, temp_registration=temp_reg,
            status=TruckStatus(status), notes=notes,
        ))
        count += 1
    db.commit()
    with engine.connect() as conn:
        reset_sequence(conn, "trucks")
        conn.commit()
    print(f"  {count} trucks")


# ── 8. Trailers ───────────────────────────────────────────────────────────────

# (id, truck_id, entity_id, slot, registration, vin, status, licence_expiry)
TRAILERS = [
    (1,  1,  3, 1, "JYC249EC","AA9S236KANLVB2215","active","2026-02-28"),
    (2,  1,  3, 2, "JYC248EC","AA9S236KANLVB2214","active","2026-02-28"),
    (3,  2,  3, 1, "KJJ224EC","AA9S236KASBVB2357","active","2026-03-31"),
    (4,  2,  3, 2, "KJJ227EC","AA9S236KASBVB2358","active","2026-03-31"),
    (5,  3,  3, 1, "JSS187EC","AA9S236KANBVB2103","active","2026-02-28"),
    (6,  3,  3, 2, "JSS184EC","AA9S236KANBVB2104","active","2026-02-28"),
    (7,  4,  3, 1, "KJY946EC","AA9S236KASBVB2323","active","2026-05-31"),
    (8,  4,  3, 2, "KJY945EC","AA9S236KASBVB2324","active","2026-05-31"),
    (9,  5,  3, 1, "KKZ310EC","AA9S236KASLVB1068","active","2026-08-31"),
    (10, 5,  3, 2, "KKZ312EC","AA9S236KASLVB1069","active","2026-08-31"),
    (11, 6,  3, 1, "KFF759EC","AA9S236KARBVB2680","active","2026-05-31"),
    (12, 6,  3, 2, "KFF757EC","AA9S236KARBVB2681","active","2026-05-31"),
    (13, 7,  3, 1, "KBX164EC","AA9S236KAPBVB2895","active","2026-10-31"),
    (14, 7,  3, 2, "KBX166EC","AA9S236KAPBVB2896","active","2026-10-31"),
    (15, 8,  3, 1, "KFF762EC","AA9S236KARBVB2676","active","2026-05-31"),
    (16, 8,  3, 2, "KFF761EC","AA9S236KARBVB2677","active","2026-05-31"),
    (17, 9,  3, 1, "KDJ037EC","AA9S236KARBVB2125","active","2026-02-28"),
    (18, 9,  3, 2, "KDJ181EC","AA9S236KARBVB2126","active","2026-02-28"),
    (19, 10, 3, 1, "KHD067EC","AA9S236KARLVB2358","active","2026-11-30"),
    (20, 10, 3, 2, "KHD060EC","AA9S236KARLVB2359","active","2026-11-30"),
    (21, 11, 3, 1, "KFY016EC","AA9S236KARLVB2107","active","2026-07-31"),
    (22, 11, 3, 2, "KFY028EC","AA9S236KARLVB2108","active","2026-07-31"),
    (23, 12, 3, 1, "KCY734EC","AA9S236KANBVB2633","active","2027-01-31"),
    (24, 12, 3, 2, "KCY736EC","AA9S236KANBVB2634","active","2027-01-31"),
    (25, 13, 3, 1, "KGX776EC","AA9S236KARLVB2393","active","2026-10-31"),
    (26, 13, 3, 2, "KGX778EC","AA9S236KARLVB2392","active","2026-10-31"),
    (27, 14, 3, 1, "KKF406EC","AA9S236KASBVB2893","active","2026-06-30"),
    (28, 14, 3, 2, "KKF394EC","AA9S236KASBVB2894","active","2026-06-30"),
    (29, 15, 3, 1, "KDC543EC","AA9S236KARBVB2123","active","2026-02-28"),
    (30, 15, 3, 2, "KDC544EC","AA9S236KARBVB2124","active","2026-02-28"),
    (31, 16, 3, 1, "KNF474EC","AJBS236KATBST0235","active","2026-02-28"),
    (32, 16, 3, 2, "KNF475EC","AJBS236KATBST0236","active","2026-03-28"),
    (33, 17, 3, 1, "KMT476EC","AJBS236KASBST1246","active","2027-01-31"),
    (34, 17, 3, 2, "KMT480EC","AJBS236KASBST1247","active","2027-01-31"),
    (35, 18, 3, 1, "KNF477EC","AJBS236KATBST0134","active","2026-02-28"),
    (36, 18, 3, 2, "KNF476EC","AJBS236KATBST0135","active","2026-02-28"),
    (37, 19, 3, 1, "KPH747EC","AJBS236KATBST0388","active","2026-06-30"),
    (38, 19, 3, 2, "KPH746EC","AJBS236KATBST0389","active","2026-06-30"),
    (39, 20, 3, 1, "KFK168EC","AA9S236KARBVB2682","active","2026-06-30"),
    (40, 20, 3, 2, "KFK169EC","AA9S236KARBVB2683","active","2026-06-30"),
    (41, 21, 3, 1, "KBZ568EC","AA9S236KAPLVB2115","active","2026-10-31"),
    (42, 21, 3, 2, "KBZ571EC","AA9S236KAPLVB2116","active","2026-10-31"),
    (43, 22, 3, 1, "KFF760EC","AA9S236KARBVB2678","active","2026-05-31"),
    (44, 22, 3, 2, "KFF756EC","AA9S236KARBVB2679","active","2026-05-31"),
    (45, 23, 3, 1, "KKX754EC","AA9S236KASLVB1066","active","2026-08-31"),
    (46, 23, 3, 2, "KKX758EC","AA9S236KASLVB1067","active","2026-08-31"),
    (47, 24, 3, 1, "KRC829EC","AJBS236KATBST0306","active","2026-08-31"),
    (48, 24, 3, 2, "KRC832EC","AJBS236KATBST0307","active","2026-08-31"),
    (49, 25, 3, 1, "KFY030EC","AA9S236KARLVB2110","active","2026-07-31"),
    (50, 25, 3, 2, "KFY018EC","AA9S236KARLVB2109","active","2026-07-31"),
    (51, 26, 3, 1, "KRW187EC","AJBS236KATBST0979","active","2026-10-31"),
    (52, 26, 3, 2, "KRW184EC","AJBS236KATBST0980","active","2026-10-31"),
    (53, 27, 3, 1, "KSV051EC",None,               "active","2026-12-31"),
    (54, 27, 3, 2, "KSV056EC",None,               "active","2026-12-31"),
    (55, 28, 3, 1, "KSZ643EC",None,               "active",None),
    (56, 28, 3, 2, "KSZ640EC",None,               "active",None),
    (57, 29, 3, 1, "KSV048EC",None,               "active","2026-12-31"),
    (58, 29, 3, 2, "KSV043EC",None,               "active","2026-12-31"),
    (59, 30, 3, 1, "EJD573GP",None,               "active",None),
    (60, 30, 3, 2, "EJD574GP",None,               "active",None),
    (61, 31, 3, 1, "JZG085EC","AA9S236KAPBVB2440","inactive","2026-05-31"),
    (62, 31, 3, 2, "JZG082EC","AA9S236KAPBVB2441","inactive","2026-05-31"),
    # OBHI trailers
    (63, 32, 2, 1, "EKK494GP","AJBS236KAVBST0186","active",None),
    (64, 32, 2, 2, "EKK495GP","AJBS236KAVBST0187","active",None),
    (65, 33, 2, 1, "JXR975EC","AA9S236KANLVB2218","active",None),
    (66, 33, 2, 2, "JXR691EC","AA9S236KANLVB2219","active",None),
    (67, 34, 2, 1, "KKN187EC","AA9S23KASLVB1002", "active",None),
    (68, 34, 2, 2, "KKN168EC","AA9S23KASLVB1003", "active",None),
    (69, 38, 2, 1, "JYL662EC","AA9B236KAPBVB2123","active",None),
    (70, 38, 2, 2, "JYL660EC","AA9B236KAPBVB2124","active",None),
    (71, 36, 2, 1, "KHX726EC","AA9S236KARLVB2854","active",None),
    (72, 36, 2, 2, "KHX732EC","AA9S236KARLVB2853","active",None),
    (73, 37, 2, 1, "KKN192EC","AA9S23KASLVB1001", "active",None),
    (74, 37, 2, 2, "KKN206EC","AA9S23KASLVB1000", "active",None),
    (77, 39, 2, 1, "KDS455EC","AA9S236KARBVB2411","active",None),
    (78, 39, 2, 2, "KDS453EC","AA9S236KARBVB2421","active",None),
    (79, 40, 2, 1, "KGY546EC","AA9S236KARBVB2955","active",None),
    (80, 40, 2, 2, "KGY547EC","AA9S236KARBVB2954","active",None),
    (81, 41, 2, 1, "JPT733EC","AA9S236KAMBVB2341","active",None),
    (82, 41, 2, 2, "JPT737EC","AA9S236KAMBVB2342","active",None),
    (83, 42, 2, 1, "JTJ436EC","AA9S236KANBVB2331","active",None),
    (84, 42, 2, 2, "JTK547EC","AA9S236KANBVB2332","active",None),
    (85, 43, 2, 2, "JZF209EC","AA9S236KAPBVB2438","active",None),
    (86, 43, 2, 1, "JZF214EC","AA9S236KAPBVB2439","active",None),
    (87, 44, 2, 1, "JZS116EC","AA9S236KAPBVB2443","active",None),
    (88, 44, 2, 2, "JZS129EC","AA9S236KAPBVB2442","active",None),
    (89, 45, 2, 1, "KGV923EC","AA9S236KARLVB2549","active",None),
    (90, 45, 2, 2, "KGV926EC","AA9S236KARLVB2548","active",None),
    (91, 46, 2, 1, "KKR153EC","AA9S236KASLVB1046","active",None),
    (92, 46, 2, 2, "KKR169EC","AA9S236KASLVB1047","active",None),
    (93, 47, 2, 1, "KKR179EC","AAPS236KASLVB1048","active",None),
    (94, 47, 2, 2, "KKR186EC","AA9X236KASLVB1049","active",None),
    (95, 48, 2, 1, "JXP754EC","AA9S236WANLVB2046","active","2026-12-31"),
    (96, 48, 2, 2, "JXP757EC","AA9S236WANLVB2047","active","2026-12-31"),
    (97, 49, 2, 1, "KRL790EC",None,               "active",None),
    (98, 49, 2, 2, "KRL796EC",None,               "active",None),
    (99, 50, 2, 1, "KRR108EC",None,               "active",None),
    (100,50, 2, 2, "KRR109EC",None,               "active",None),
    (101,52, 2, 1, "KRV326EC","AA9S236KANBVB2303","active",None),
    (102,52, 2, 2, "KRV322EC","AA9S23KANBVB2304", "active",None),
    (103,53, 2, 1, "JVS439EC","AA9S236KANBVB2490","active","2026-07-31"),
    (104,53, 2, 2, "JVS436EC","AA9S236KANBVB2489","active","2026-07-31"),
    (105,54, 2, 1, "ML89XCGP","AAS9S236KANBVB2535","active",None),
    (106,54, 2, 2, "ML89XJGP","AAS9S236KANBVB2536","active",None),
    (107,55, 2, 1, "MR58LZGP",None,               "active",None),
    (108,55, 2, 2, "MR58FSGP",None,               "active",None),
    (109,56, 2, 1, "EFY388GP",None,               "active",None),
    (110,56, 2, 2, "EFY389GP",None,               "active",None),
    (111,58, 2, 1, "KHM069EC",None,               "active",None),
    (112,58, 2, 2, "KHM070EC",None,               "active",None),
    (113,59, 2, 1, "KJD210EC",None,               "active",None),
    (114,59, 2, 2, "KJD218EC",None,               "active",None),
    (115,60, 2, 1, "KJD211EC",None,               "active",None),
    (116,60, 2, 2, "KJD207EC",None,               "active",None),
    (117,61, 2, 1, "KFP723EC",None,               "active",None),
    (118,61, 2, 2, "KFP724EC",None,               "active",None),
    (119,62, 2, 1, "JYZ896EC",None,               "active",None),
    (120,62, 2, 2, "JYZ894EC",None,               "active",None),
    (121,63, 2, 1, "KJL074EC",None,               "active",None),
    (122,63, 2, 2, "KJL076EC",None,               "active",None),
    (123,64, 2, 1, "KJL071EC",None,               "active",None),
    (124,64, 2, 2, "KJL080EC",None,               "active",None),
    (125,65, 2, 1, "JWM640EC",None,               "active",None),
    (126,65, 2, 2, "JWM637EC",None,               "active",None),
    (127,66, 2, 1, "KBN566EC",None,               "active",None),
    (128,66, 2, 2, "KBN567EC",None,               "active",None),
]


def seed_trailers(db: Session):
    print("Seeding trailers...")
    count = 0
    for (tid, truck_id, eid, slot, reg, vin, status, expiry) in TRAILERS:
        if db.query(Trailer).filter(Trailer.id == tid).first():
            continue
        db.add(Trailer(
            id=tid, truck_id=truck_id, entity_id=eid, slot=slot,
            registration=reg, vin=vin,
            status=TrailerStatus(status),
            licence_expiry=expiry,
        ))
        count += 1
    db.commit()
    with engine.connect() as conn:
        reset_sequence(conn, "trailers")
        conn.commit()
    print(f"  {count} trailers")


# ── 9. Personal vehicles (all under entity_id=3 / SFT) ───────────────────────

# (owner, vehicle_type, year, registration, licence_expiry, status, notes)
PERSONAL_VEHICLES = [
    ("THEMBIS", "Thembi's Trailer",                          2020, "JRP244EC", "2026-12-31", "active", None),
    ("THEMBIS", "Toyota Land Cruiser Pick Up D/C Diesel V8", None, None,       None,         "active", "KYK OP NATIS - check Dec 2026"),
    ("THEMBIS", "Isuzu Bakkie",                              2023, "KDR321EC", "2026-04-30", "active", "Jonty"),
    ("THEMBIS", "Isuzu Bakkie",                              2023, "KDR315EC", "2026-04-30", "active", "Desire"),
    ("THEMBIS", "Toyota Land Cruiser Single Cab Bakkie",     2025, "KMN678EC", "2026-05-30", "active", None),
    ("THEMBIS", "Toyota Fortuner",                           2023, "KGM491EC", "2026-09-30", "active", None),
    ("THEMBIS", "Toyota Quantum",                            2024, "KHG337EC", "2026-07-31", "active", None),
    ("THEMBIS", "Ford Ranger 2L Wildtrack 4x2",              None, "KNL252EC", "2026-03-31", "active", "Thembi"),
    ("THEMBIS", "VW Amarok DC Panamericana",                 None, None,       None,         "active", "Johan - KYK OP NATIS - check Feb 2027"),
    ("SAFETEC", "Toyota Land Cruiser Pickup",                2024, "KJK880EC", "2026-03-31", "active", None),
    ("SAFETEC", "Flat Deck Trailer - Johan Trailer",         None, "KJN837EC", "2026-03-31", "active", None),
    ("SAFETEC", "Big Boy Adventure RS 150 Bike",             2023, "KDP694EC", "2026-03-31", "active", None),
    ("SAFETEC", "Big Boy Adventure RS 150 Bike",             2023, "KFL754EC", "2026-06-30", "active", None),
    ("THEMBIS", "Ford Ranger 2L Bi Wildtrack 4x4",           None, "KNL256EC", "2026-03-31", "active", "Johan"),
    ("SAFETEC", "Porsche Cayenne GTS",                       2023, "KLR134EC", "2026-10-31", "active", None),
    ("THEMBIS", "BYD Shark 6 D/Cab",                         None, "KR6751EC", None,         "active", "Johan"),
    ("THEMBIS", "Ford Ranger Raptor",                        2023, "KDK967EC", "2024-03-31", "sold",   "Verkoop"),
    ("THEMBIS", "Toyota Hilux",                              2022, "KBY774EC", "2023-10-31", "sold",   "Sold"),
    ("THEMBIS", "Nissan Navara",                             2021, "JVR246EC", "2023-07-31", "sold",   "Sold"),
    ("THEMBIS", "Porsche Macan GTS",                         2022, "JYY478EC", "2024-04-30", "sold",   "Verkoop"),
    ("THEMBIS", "Toyota Hilux",                              2021, "JXS933EC", "2023-12-31", "sold",   "Ingeruil vir Thembi Fortuner"),
    ("THEMBIS", "Toyota Verso",                              2011, "FVV898EC", "2023-12-31", "sold",   "Sold"),
    ("OBHI",    "Mercedes AMG",                              2023, "KGF630EC", "2024-08-31", "sold",   "Verkoop"),
    ("THEMBIS", "Toyota Land Cruiser",                       2024, "KHG491EC", "2024-12-31", "sold",   "Verkoop"),
    ("SAFETEC", "Land Rover Defender",                       2023, "KKH144EC", "2025-06-30", "sold",   None),
    ("THEMBIS", "Toyota Hilux 2.8 GD-6 GR-S 4x4",           2024, "KKM440EC", "2025-06-30", "sold",   "Johan nuwe bakkie"),
    ("THEMBIS", "Toyota Hilux Legend",                       2023, "KFZ417EC", "2025-07-31", "sold",   "Multi Projects - Francois"),
    ("THEMBIS", "Toyota Hilux SC 2.4 GD6 4x4 RAI MT",       2022, "KLV137EC", "2025-10-31", "sold",   None),
    ("THEMBIS", "Isuzu D-Max Bakkie",                        2023, "KFC287EC", "2025-05-31", "sold",   "Thembi"),
    ("OBHI",    "Ford Mustang 5.0 GT Fastback",              2024, "KLS087EC", "2025-10-31", "sold",   None),
]


def seed_personal_vehicles(db: Session):
    print("Seeding personal vehicles...")
    count = 0
    for (owner, vtype, year, reg, expiry, status, notes) in PERSONAL_VEHICLES:
        exists = False
        if reg:
            exists = db.query(PersonalVehicle).filter(PersonalVehicle.registration == reg).first() is not None
        if exists:
            continue
        db.add(PersonalVehicle(
            entity_id=3, owner=owner, vehicle_type=vtype, year=year,
            registration=reg, licence_expiry=expiry,
            status=PersonalVehicleStatus(status), notes=notes,
        ))
        count += 1
    db.commit()
    with engine.connect() as conn:
        reset_sequence(conn, "personal_vehicles")
        conn.commit()
    print(f"  {count} personal vehicles")


# ── 10. Drivers ───────────────────────────────────────────────────────────────

# Permanent: (emp_no, first, last, truck_reg, id_number, tax_number, bank_name, bank_account)
PERMANENT_DRIVERS = [
    ("THEM002",  "Luizi",              "Kambinda",  None,       None,              None,         None,  None),
    ("THEM004",  "Ndondi Simon",       "Ndlala",    "KMR411EC", None,              None,         None,  None),
    ("THEM008",  "Abongile",           "Mana",      "KNS946EC", None,              None,         None,  None),
    ("THEM011",  "Kliffet",            "Williams",  "KBD393EC", None,              None,         None,  None),
    ("THEM-021", "Resty",              "Hollander", "JZS095EC", None,              None,         None,  None),
    ("THEM-026", "Kgosiema Roy",       "Setlhare",  "KPH748EC", None,              None,         None,  None),
    ("THEM-027", "Sibusiso Arnold",    "Silomo",    "KNF472EC", None,              None,         None,  None),
    ("THEM028",  "Sam",                "Mahlamba",  "KMT481EC", "8811015438080",   "2535529164", None,  None),
    ("THEM031",  "Petrus Jacobus",     "Pretorius", "KRM473EC", "6312265270085",   None,         None,  None),
    ("THEM033",  "Andries Moitsemang","Mathe",      "KGJ578EC", None,              None,         None,  None),
    ("THEM037",  "Itemogeng Job",      "Dimengu",   "KLC159EC", None,              None,         None,  None),
    ("THEM043",  "Stoffel",            "Sefadi",    "KSZ397EC", None,              None,         "FNB", "62418950045"),
    ("THEM045",  "Samuel",             "Domingo",   "KDZ484EC", None,              None,         None,  None),
    ("THEM046",  "Phikane",            "Matiwane",  "KFK772EC", None,              None,         None,  None),
    ("THEM047",  "Kgololo Joseph",     "Mocwane",   "KRC830EC", None,              None,         None,  None),
    ("THEM048",  "Randall",            "Bosch",     "KDJ034EC", None,              None,         None,  None),
    ("THEM049",  "Ruwatira",           "Tapiwa",    "KNP861EC", None,              None,         None,  None),
    ("THEM050",  "Samuel",             "Mmotsi",    "KKF401EC", None,              None,         None,  None),
    ("THEM051",  "Freek",              "Boss",      "JZG083EC", None,              None,         None,  None),
    ("THEM054",  "Letlhogonolo Aubry", "Gaebidiwe", "KRW188EC", None,              None,         None,  None),
    ("THEM056",  "Pieter",             "Hendrikcs", "JYC247EC", None,              None,         None,  None),
    ("THEM057",  "Miguel",             "Maseka",    "KFT767EC", None,              None,         None,  None),
    ("THEM058",  "Simon Tshidiso",     "Sethunya",  "JXP816EC", None,              None,         None,  None),
    ("THEM060",  "Johny",              "Jacobs",    "JXP816EC", None,              None,         None,  None),
    ("THEM061",  "David",              "Mohapeloa", "KDZ484EC", None,              None,         None,  None),
    ("THEM059",  "Aviwe",              "Hoza",      None,       None,              None,         None,  None),
    ("THEM052",  "Ayabulela",          "Mdingi",    None,       None,              None,         None,  None),
]

# Casual: (entity_code, first, last, truck_reg, bank_name, bank_account, notes)
CASUAL_DRIVERS = [
    ("SFT",  "Gerald",  "Casual",  "KCY733EC", None,      None,         "Casual driver – Safetec"),
    ("SFT",  "Maskito", "Casual",  "KRM473EC", None,      None,         "Casual driver – shares truck with Petrus"),
    ("SFT",  "Tumiso",  "Casual",  "JYC247EC", None,      None,         "Casual driver – Safetec"),
    ("SFT",  "Mathews", "Casual",  "JRC117EC", None,      None,         "Casual driver – Safetec"),
    ("SFT",  "Adriaan", "Casual",  "KPS102EC", None,      None,         "Casual driver – Safetec"),
    ("SFT",  "Garth",   "Casual",  "KDJ034EC", None,      None,         "Casual driver – Safetec"),
    ("OBHI", "Jerry",   "Bandeys", "KPS629EC", "CAPITEC", "1169321362", "Casual driver – OBHI (Bandeys)"),
    ("OBHI", "Zamani",  "Bandeys", "KSC007EC", "CAPITEC", "1267731808", "Casual driver – OBHI (Bandeys)"),
    ("OBHI", "Amos",    "Bandeys", "EKV375GP", "CAPITEC", "1323790177", "Casual driver – OBHI (Bandeys)"),
]


def _find_truck(db: Session, entity_id: int, reg: str):
    if not reg:
        return None
    t = db.query(Truck).filter(Truck.entity_id == entity_id, Truck.registration == reg).first()
    if not t:
        t = db.query(Truck).filter(Truck.registration == reg).first()
    return t


def seed_drivers(db: Session):
    from app.models.models import Driver, DriverType

    print("Seeding drivers...")
    sft_id  = db.query(BusinessEntity).filter(BusinessEntity.code == "SFT").first().id
    obhi_id = db.query(BusinessEntity).filter(BusinessEntity.code == "OBHI").first().id

    perm = 0
    for (emp, first, last, truck_reg, id_no, tax_no, bank, bank_acc) in PERMANENT_DRIVERS:
        if db.query(Driver).filter(Driver.entity_id == sft_id, Driver.employee_number == emp).first():
            continue
        t = _find_truck(db, sft_id, truck_reg)
        db.add(Driver(
            entity_id=sft_id, truck_id=t.id if t else None,
            employee_number=emp, first_name=first, last_name=last,
            driver_type=DriverType.permanent,
            id_number=id_no, tax_number=tax_no,
            bank_name=bank, bank_account_number=bank_acc,
            is_active=True,
        ))
        perm += 1

    db.flush()

    cas = 0
    entity_map = {"SFT": sft_id, "OBHI": obhi_id}
    for (ecode, first, last, truck_reg, bank, bank_acc, notes) in CASUAL_DRIVERS:
        eid = entity_map[ecode]
        if db.query(Driver).filter(Driver.entity_id == eid, Driver.first_name == first, Driver.last_name == last).first():
            continue
        t = _find_truck(db, eid, truck_reg)
        db.add(Driver(
            entity_id=eid, truck_id=t.id if t else None,
            first_name=first, last_name=last,
            driver_type=DriverType.casual,
            bank_name=bank, bank_account_number=bank_acc,
            notes=notes, is_active=True,
        ))
        cas += 1

    db.commit()
    with engine.connect() as conn:
        reset_sequence(conn, "drivers")
        conn.commit()
    print(f"  {perm} permanent + {cas} casual drivers")


# ── 11. Payroll settings ──────────────────────────────────────────────────────

def seed_payroll_settings(db: Session):
    print("Seeding payroll settings...")
    if db.query(PayrollSettings).count() == 0:
        db.add(PayrollSettings(
            effective_date="2023-03-01",
            lohatla_base_salary=16481.55,
            lohatla_incentive_per_load=2610.00,
            lohatla_subs_per_load=459.66,
            lohatla_casual_rate_per_load=2610.00,
            assmang_bonus_per_load=150.00,
            nbcrfli_rate=0.004,
            provident_rate=0.10,
            wellness_rate=0.01,
            sick_fund_rate=0.20,
            holiday_fund_rate=0.3608,
            leave_pay_rate=0.25,
            nbcrfli_amount=65.93,
            provident_amount=1648.16,
            wellness_amount=164.82,
            sick_fund_amount=760.69,
            holiday_fund_amount=1372.29,
            leave_pay_amount=950.87,
            paye_fixed=177.12,
            weekly_to_monthly_factor=4.3333,
        ))
        db.commit()
    with engine.connect() as conn:
        reset_sequence(conn, "payroll_settings")
        conn.commit()
    print("  1 payroll settings row")


# ── 12. App settings ──────────────────────────────────────────────────────────

APP_SETTINGS = [
    {"key": "vat_rate",               "value": "0.15",                                          "label": "Global VAT Rate",             "category": "billing"},
    {"key": "roles",                  "value": '["admin", "standard"]',                          "label": "User Roles",                  "category": "system"},
    {"key": "invoice_modules",        "value": '["clients","invoices","suppliers","fleet","diesel"]', "label": "Available Modules",      "category": "system"},
    {"key": "fleet_licence_warn_days","value": "30",                                              "label": "Licence Expiry Warning Window","category": "fleet"},
]


def seed_app_settings(db: Session):
    print("Seeding app settings...")
    count = 0
    for s in APP_SETTINGS:
        if not db.query(AppSetting).filter(AppSetting.key == s["key"]).first():
            db.add(AppSetting(**s))
            count += 1
    db.commit()
    with engine.connect() as conn:
        reset_sequence(conn, "app_settings")
        conn.commit()
    print(f"  {count} settings")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  safetec_core – Production Seed")
    print(f"  Target: {DATABASE_URL[:50]}...")
    print("=" * 60)

    create_tables()

    db = Session(bind=engine)
    try:
        seed_roles(db)
        seed_entities(db)
        seed_users(db)
        seed_mines(db)
        seed_trucks(db)
        seed_trailers(db)
        seed_personal_vehicles(db)
        seed_drivers(db)
        seed_payroll_settings(db)
        seed_app_settings(db)

        print()
        print("=" * 60)
        print("  Seed complete.")
        print()
        print("  IMPORTANT: Change the admin password after first login.")
        print("  Admin login: admin@safetec.co.za")
        print("=" * 60)

    except Exception as e:
        db.rollback()
        print(f"\nSeed FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
