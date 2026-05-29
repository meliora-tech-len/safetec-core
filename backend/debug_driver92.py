"""
Read-only diagnostic: shows driver 92, their truck_loads for the current month,
and their pay cycle record. Run from the backend/ directory:
    python debug_driver92.py
"""
import os, sys
from datetime import datetime, timezone
from sqlalchemy import create_engine, text

DATABASE_URL = "postgresql://postgres.cecdxgtpmjxagsajhvtb:4hHAhY5ISQeytsEf@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"

engine = create_engine(DATABASE_URL)

DRIVER_ID = 92
YEAR  = datetime.now().year
MONTH = datetime.now().month

with engine.connect() as conn:

    # ── 1. Driver record ──────────────────────────────────────────────────────
    row = conn.execute(text("""
        SELECT id, first_name, last_name, driver_type, truck_id, entity_id, is_active
        FROM drivers WHERE id = :id
    """), {"id": DRIVER_ID}).fetchone()

    if not row:
        print(f"No driver found with id={DRIVER_ID}")
        sys.exit(1)

    print("=" * 60)
    print("DRIVER")
    print(f"  id          : {row.id}")
    print(f"  name        : {row.first_name} {row.last_name}")
    print(f"  driver_type : {row.driver_type}")
    print(f"  truck_id    : {row.truck_id}")
    print(f"  entity_id   : {row.entity_id}")
    print(f"  is_active   : {row.is_active}")

    # ── 2. Truck (if any) ─────────────────────────────────────────────────────
    if row.truck_id:
        truck = conn.execute(text("""
            SELECT id, registration FROM trucks WHERE id = :id
        """), {"id": row.truck_id}).fetchone()
        print(f"\nTRUCK  id={truck.id}  reg={truck.registration}" if truck else "\nTRUCK  not found")

    # ── 3. TruckLoads this month by driver_id ─────────────────────────────────
    loads_by_driver = conn.execute(text("""
        SELECT tl.id, tl.load_date, tl.truck_id, tl.driver_id, tl.driver_name,
               tl.is_split_load, tl.is_archived, tl.driver_already_paid,
               tl.is_projection, m.name AS mine_name, m.casual_group
        FROM truck_loads tl
        LEFT JOIN mines m ON m.id = tl.mine_id
        WHERE tl.driver_id = :driver_id
          AND EXTRACT(YEAR  FROM tl.load_date) = :year
          AND EXTRACT(MONTH FROM tl.load_date) = :month
        ORDER BY tl.load_date
    """), {"driver_id": DRIVER_ID, "year": YEAR, "month": MONTH}).fetchall()

    print(f"\nTRUCK LOADS where driver_id={DRIVER_ID}  ({YEAR}-{MONTH:02d})  → {len(loads_by_driver)} rows")
    for l in loads_by_driver:
        print(f"  load_id={l.id}  date={str(l.load_date)[:10]}  truck_id={l.truck_id}"
              f"  mine={l.mine_name}({l.casual_group})  split={l.is_split_load}"
              f"  archived={l.is_archived}  proj={l.is_projection}  already_paid={l.driver_already_paid}")

    # ── 4. TruckLoads this month by truck_id (if driver has one) ─────────────
    if row.truck_id:
        loads_by_truck = conn.execute(text("""
            SELECT tl.id, tl.load_date, tl.driver_id, tl.driver_name,
                   tl.is_split_load, tl.is_archived, tl.driver_already_paid,
                   tl.is_projection, m.name AS mine_name, m.casual_group
            FROM truck_loads tl
            LEFT JOIN mines m ON m.id = tl.mine_id
            WHERE tl.truck_id = :truck_id
              AND EXTRACT(YEAR  FROM tl.load_date) = :year
              AND EXTRACT(MONTH FROM tl.load_date) = :month
            ORDER BY tl.load_date
        """), {"truck_id": row.truck_id, "year": YEAR, "month": MONTH}).fetchall()

        print(f"\nTRUCK LOADS where truck_id={row.truck_id}  ({YEAR}-{MONTH:02d})  → {len(loads_by_truck)} rows")
        for l in loads_by_truck:
            print(f"  load_id={l.id}  date={str(l.load_date)[:10]}  driver_id={l.driver_id}"
                  f"  driver_name={l.driver_name}  mine={l.mine_name}({l.casual_group})"
                  f"  split={l.is_split_load}  archived={l.is_archived}  proj={l.is_projection}")

    # ── 5. Pay cycle record ───────────────────────────────────────────────────
    cycle = conn.execute(text("""
        SELECT id, pay_year, pay_month,
               casual_group_a_loads, casual_group_b_loads,
               lohatla_base_loads, lohatla_extra_loads,
               casual_split_group_a_loads, casual_split_group_b_loads
        FROM driver_pay_cycles
        WHERE driver_id = :id AND pay_year = :year AND pay_month = :month
    """), {"id": DRIVER_ID, "year": YEAR, "month": MONTH}).fetchone()

    print(f"\nPAY CYCLE  {YEAR}-{MONTH:02d}")
    if cycle:
        print(f"  cycle_id            : {cycle.id}")
        print(f"  casual_group_a_loads: {cycle.casual_group_a_loads}")
        print(f"  casual_group_b_loads: {cycle.casual_group_b_loads}")
        print(f"  lohatla_base_loads  : {cycle.lohatla_base_loads}")
        print(f"  lohatla_extra_loads : {cycle.lohatla_extra_loads}")
        print(f"  split_a / split_b   : {cycle.casual_split_group_a_loads} / {cycle.casual_split_group_b_loads}")
    else:
        print("  NO CYCLE EXISTS for this month")

    # ── 6. Trip log entries ───────────────────────────────────────────────────
    trips = conn.execute(text("""
        SELECT dtl.id, dtl.trip_date, dtl.mine_name, dtl.truck_load_id, dtl.notes
        FROM driver_trip_logs dtl
        JOIN driver_pay_cycles dpc ON dpc.id = dtl.pay_cycle_id
        WHERE dpc.driver_id = :id
          AND dpc.pay_year  = :year
          AND dpc.pay_month = :month
        ORDER BY dtl.trip_date
    """), {"id": DRIVER_ID, "year": YEAR, "month": MONTH}).fetchall()

    print(f"\nTRIP LOG entries for driver {DRIVER_ID}  ({YEAR}-{MONTH:02d})  → {len(trips)} rows")
    for t in trips:
        print(f"  trip_id={t.id}  date={str(t.trip_date)[:10]}  mine={t.mine_name}"
              f"  truck_load_id={t.truck_load_id}  notes={t.notes}")

    # ── 7. Check for loads missing a trip log ─────────────────────────────────
    if loads_by_driver:
        linked_load_ids = {t.truck_load_id for t in trips if t.truck_load_id}
        missing = [l for l in loads_by_driver if l.id not in linked_load_ids]
        print(f"\nLOADS MISSING a trip log entry ({len(missing)}):")
        for l in missing:
            print(f"  load_id={l.id}  date={str(l.load_date)[:10]}  mine={l.mine_name}"
                  f"  proj={l.is_projection}  archived={l.is_archived}")

    print("=" * 60)
