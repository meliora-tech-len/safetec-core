"""
Migration 029: Populate fleet licence expiry dates and insert personal vehicles.

Updates trucks.model + trucks.licence_expiry for the Safetec fleet,
sets trailers.licence_expiry for all known trailers,
and inserts personal vehicles (all under entity_id=3 = Safetec).

SQLite: safe to re-run (skips existing data).
PostgreSQL: run equivalent SQL via Supabase SQL editor.
"""

from sqlalchemy import text

TRUCK_DATA = [
    ("JRC117EC",  "G460 XT", "2026-12-31"),
    ("JXP816EC",  "G460",    "2026-12-31"),
    ("JYC247EC",  "P410",    "2026-02-28"),
    ("JZG083EC",  "G460",    "2026-05-31"),
    ("JZS095EC",  "G460",    "2026-07-31"),
    ("KBD393EC",  "G460",    "2026-08-31"),
    ("KCY733EC",  "P410",    "2027-01-31"),
    ("KDJ034EC",  "G460",    "2026-02-28"),
    ("KDZ484EC",  "G460",    "2026-04-30"),
    ("KFK772EC",  "G460",    "2026-06-30"),
    ("KFT767EC",  "G460",    "2026-07-31"),
    ("KGJ578EC",  "P410",    "2026-09-30"),
    ("KGX782EC",  "G460",    "2026-10-31"),
    ("KKF401EC",  "P410",    "2026-06-30"),
    ("KLC159EC",  "Actros",  "2026-12-31"),
    ("KMR411EC",  "G460",    "2027-01-31"),
    ("KMT481EC",  "G460",    "2027-01-31"),
    ("KNF472EC",  "G460",    "2026-02-28"),
    ("KNP861EC",  "G460",    "2026-04-30"),
    ("KNS946EC",  "Actros",  "2026-04-30"),
    ("KPH748EC",  "G460",    "2026-06-30"),
    ("KPK198EC",  "Actros",  "2026-06-30"),
    ("KPS102EC",  "G460",    "2026-07-31"),
    ("KRC830EC",  "G460",    "2026-08-31"),
    ("KRM473EC",  "Actros",  "2026-09-30"),
    ("KRW188EC",  "G460",    "2026-10-31"),
    ("KSV060EC",  "G460",    "2026-12-31"),
    ("JXP813EC",  "G460",    "2026-12-31"),
]

TRAILER_DATA = [
    ("JYC248EC", "2026-02-28"), ("JYC249EC", "2026-02-28"),
    ("KJJ224EC", "2026-03-31"), ("KJJ227EC", "2026-03-31"),
    ("JSS187EC", "2026-02-28"), ("JSS184EC", "2026-02-28"),
    ("KJY946EC", "2026-05-31"), ("KJY945EC", "2026-05-31"),
    ("KKZ310EC", "2026-08-31"), ("KKZ312EC", "2026-08-31"),
    ("KFF759EC", "2026-05-31"), ("KFF757EC", "2026-05-31"),
    ("KBX164EC", "2026-10-31"), ("KBX166EC", "2026-10-31"),
    ("KFF762EC", "2026-05-31"), ("KFF761EC", "2026-05-31"),
    ("KDJ037EC", "2026-02-28"), ("KDJ181EC", "2026-02-28"),
    ("KHD067EC", "2026-11-30"), ("KHD060EC", "2026-11-30"),
    ("KFY016EC", "2026-07-31"), ("KFY028EC", "2026-07-31"),
    ("KCY734EC", "2027-01-31"), ("KCY736EC", "2027-01-31"),
    ("KGX776EC", "2026-10-31"), ("KGX778EC", "2026-10-31"),
    ("KKF406EC", "2026-06-30"), ("KKF394EC", "2026-06-30"),
    ("KDC543EC", "2026-02-28"), ("KDC544EC", "2026-02-28"),
    ("KNF474EC", "2026-02-28"), ("KNF475EC", "2026-03-28"),
    ("KMT476EC", "2027-01-31"), ("KMT480EC", "2027-01-31"),
    ("KNF477EC", "2026-02-28"), ("KNF476EC", "2026-02-28"),
    ("KPH747EC", "2026-06-30"), ("KPH746EC", "2026-06-30"),
    ("KFK168EC", "2026-06-30"), ("KFK169EC", "2026-06-30"),
    ("KBZ568EC", "2026-10-31"), ("KBZ571EC", "2026-10-31"),
    ("KFF760EC", "2026-05-31"), ("KFF756EC", "2026-05-31"),
    ("KKX754EC", "2026-08-31"), ("KKX758EC", "2026-08-31"),
    ("KRC829EC", "2026-08-31"), ("KRC832EC", "2026-08-31"),
    ("KFY030EC", "2026-07-31"), ("KFY018EC", "2026-07-31"),
    ("KRW187EC", "2026-10-31"), ("KRW184EC", "2026-10-31"),
    ("KSV051EC", "2026-12-31"), ("KSV056EC", "2026-12-31"),
    ("KSV048EC", "2026-12-31"), ("KSV043EC", "2026-12-31"),
    ("JZG085EC", "2026-05-31"), ("JZG082EC", "2026-05-31"),
    ("JXP754EC", "2026-12-31"), ("JXP757EC", "2026-12-31"),
    ("JVS439EC", "2026-07-31"), ("JVS436EC", "2026-07-31"),
]

# (owner, vehicle_type, year, registration, licence_expiry, status, notes)
PERSONAL_VEHICLES = [
    ("THEMBIS", "Thembi's Trailer",                          2020, "JRP244EC", "2026-12-31", "active", ""),
    ("THEMBIS", "Toyota Land Cruiser Pick Up D/C Diesel V8", None, None,       None,          "active", "KYK OP NATIS - check Dec 2026"),
    ("THEMBIS", "Isuzu Bakkie",                              2023, "KDR321EC", "2026-04-30", "active", "Jonty"),
    ("THEMBIS", "Isuzu Bakkie",                              2023, "KDR315EC", "2026-04-30", "active", "Desire"),
    ("THEMBIS", "Toyota Land Cruiser Single Cab Bakkie",     2025, "KMN678EC", "2026-05-30", "active", ""),
    ("THEMBIS", "Toyota Fortuner",                           2023, "KGM491EC", "2026-09-30", "active", ""),
    ("THEMBIS", "Toyota Quantum",                            2024, "KHG337EC", "2026-07-31", "active", ""),
    ("THEMBIS", "Ford Ranger 2L Wildtrack 4x2",              None, "KNL252EC", "2026-03-31", "active", "Thembi"),
    ("THEMBIS", "VW Amarok DC Panamericana",                  None, None,       None,          "active", "Johan - KYK OP NATIS - check Feb 2027"),
    ("SAFETEC", "Toyota Land Cruiser Pickup",                2024, "KJK880EC", "2026-03-31", "active", ""),
    ("SAFETEC", "Flat Deck Trailer - Johan Trailer",          None, "KJN837EC", "2026-03-31", "active", ""),
    ("SAFETEC", "Big Boy Adventure RS 150 Bike",             2023, "KDP694EC", "2026-03-31", "active", ""),
    ("SAFETEC", "Big Boy Adventure RS 150 Bike",             2023, "KFL754EC", "2026-06-30", "active", ""),
    ("THEMBIS", "Ford Ranger 2L Bi Wildtrack 4x4",           None, "KNL256EC", "2026-03-31", "active", "Johan"),
    ("SAFETEC", "Porsche Cayenne GTS",                       2023, "KLR134EC", "2026-10-31", "active", ""),
    ("THEMBIS", "BYD Shark 6 D/Cab",                         None, "KR6751EC", None,          "active", "Johan"),
    ("THEMBIS", "Ford Ranger Raptor",                        2023, "KDK967EC", "2024-03-31", "sold",   "Verkoop"),
    ("THEMBIS", "Toyota Hilux",                              2022, "KBY774EC", "2023-10-31", "sold",   "Sold"),
    ("THEMBIS", "Nissan Navara",                             2021, "JVR246EC", "2023-07-31", "sold",   "Sold"),
    ("THEMBIS", "Porsche Macan GTS",                         2022, "JYY478EC", "2024-04-30", "sold",   "Verkoop"),
    ("THEMBIS", "Toyota Hilux",                              2021, "JXS933EC", "2023-12-31", "sold",   "Ingeruil vir Thembi Fortuner"),
    ("THEMBIS", "Toyota Verso",                              2011, "FVV898EC", "2023-12-31", "sold",   "Sold"),
    ("OBHI",    "Mercedes AMG",                              2023, "KGF630EC", "2024-08-31", "sold",   "Verkoop"),
    ("THEMBIS", "Toyota Land Cruiser",                       2024, "KHG491EC", "2024-12-31", "sold",   "Verkoop"),
    ("SAFETEC", "Land Rover Defender",                       2023, "KKH144EC", "2025-06-30", "sold",   ""),
    ("THEMBIS", "Toyota Hilux 2.8 GD-6 GR-S 4x4",          2024, "KKM440EC", "2025-06-30", "sold",   "Johan nuwe bakkie"),
    ("THEMBIS", "Toyota Hilux Legend",                       2023, "KFZ417EC", "2025-07-31", "sold",   "Multi Projects - Francois"),
    ("THEMBIS", "Toyota Hilux SC 2.4 GD6 4x4 RAI MT",      2022, "KLV137EC", "2025-10-31", "sold",   ""),
    ("THEMBIS", "Isuzu D-Max Bakkie",                        2023, "KFC287EC", "2025-05-31", "sold",   "Thembi"),
    ("OBHI",    "Ford Mustang 5.0 GT Fastback",              2024, "KLS087EC", "2025-10-31", "sold",   ""),
]


def upgrade(conn):
    for reg, model, expiry in TRUCK_DATA:
        conn.execute(text(
            "UPDATE trucks SET model = :model WHERE registration = :reg"
        ), {"model": model, "reg": reg})
        conn.execute(text(
            "UPDATE trucks SET licence_expiry = :expiry WHERE registration = :reg AND licence_expiry IS NULL"
        ), {"expiry": expiry, "reg": reg})

    for reg, expiry in TRAILER_DATA:
        conn.execute(text(
            "UPDATE trailers SET licence_expiry = :expiry WHERE registration = :reg AND licence_expiry IS NULL"
        ), {"expiry": expiry, "reg": reg})

    for owner, vtype, year, reg, expiry, status, notes in PERSONAL_VEHICLES:
        if reg:
            exists = conn.execute(
                text("SELECT id FROM personal_vehicles WHERE registration = :reg"),
                {"reg": reg}
            ).fetchone()
            if exists:
                continue
        conn.execute(text("""
            INSERT INTO personal_vehicles
                (entity_id, owner, vehicle_type, year, registration, licence_expiry, status, notes)
            VALUES (3, :owner, :vtype, :year, :reg, :expiry, :status, :notes)
        """), {
            "owner": owner, "vtype": vtype, "year": year,
            "reg": reg, "expiry": expiry, "status": status,
            "notes": notes or None,
        })

    conn.commit()
