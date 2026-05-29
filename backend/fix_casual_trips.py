"""
Audit and repair casual driver trip logs.

Problems this script fixes:
1. Trip log entries that are linked to a truck load where driver_id != the trip's
   driver (spurious entries — the truck's assigned driver got credited for someone
   else's trip).
2. Truck loads with a driver_id that have NO corresponding trip log entry in that
   driver's pay cycle (missing entries — loads created before _add_trip_log existed).

Run from the backend/ directory:
    python fix_casual_trips.py [--dry-run]
"""
import sys
from datetime import datetime, timezone
from sqlalchemy import create_engine, text

DRY_RUN = "--dry-run" in sys.argv

DATABASE_URL = "postgresql://postgres.cecdxgtpmjxagsajhvtb:4hHAhY5ISQeytsEf@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"
engine = create_engine(DATABASE_URL)

print("=" * 70)
print(f"CASUAL TRIP LOG AUDIT {'(DRY RUN)' if DRY_RUN else '(LIVE — will modify DB)'}")
print("=" * 70)

with engine.connect() as conn:

    # ── 1. Find spurious trip log entries ─────────────────────────────────────
    # A trip log entry is spurious when it is linked to a truck load AND the load
    # has driver_id set AND driver_id != the driver who owns the pay cycle.
    spurious = conn.execute(text("""
        SELECT dtl.id       AS trip_id,
               dtl.mine_name,
               dtl.trip_date,
               dtl.truck_load_id,
               dpc.driver_id AS cycle_driver_id,
               tl.driver_id  AS load_driver_id,
               d_cycle.first_name || ' ' || d_cycle.last_name AS cycle_driver_name,
               d_load.first_name  || ' ' || d_load.last_name  AS load_driver_name
        FROM driver_trip_logs dtl
        JOIN driver_pay_cycles dpc ON dpc.id = dtl.pay_cycle_id
        JOIN truck_loads        tl  ON tl.id  = dtl.truck_load_id
        JOIN drivers d_cycle ON d_cycle.id = dpc.driver_id
        JOIN drivers d_load  ON d_load.id  = tl.driver_id
        WHERE tl.driver_id IS NOT NULL
          AND tl.driver_id != dpc.driver_id
        ORDER BY dtl.id
    """)).fetchall()

    print(f"\n[1] SPURIOUS trip log entries (load.driver_id != cycle owner): {len(spurious)}")
    for r in spurious:
        print(f"    trip_id={r.trip_id}  load_id={r.truck_load_id}"
              f"  date={str(r.trip_date)[:10]}  mine={r.mine_name}"
              f"  cycle_owner={r.cycle_driver_name}({r.cycle_driver_id})"
              f"  actual_driver={r.load_driver_name}({r.load_driver_id})")

    # ── 2. Find truck loads missing a trip log for their driver ───────────────
    # Loads that have driver_id set, are not archived, not split, have a pay cycle
    # for that driver, but no driver_trip_log row linked to them.
    missing = conn.execute(text("""
        SELECT tl.id         AS load_id,
               tl.load_date,
               tl.driver_id,
               tl.truck_id,
               m.name        AS mine_name,
               m.casual_group,
               d.first_name || ' ' || d.last_name AS driver_name,
               dpc.id        AS cycle_id
        FROM truck_loads tl
        JOIN drivers d ON d.id = tl.driver_id
        JOIN mines   m ON m.id = tl.mine_id
        JOIN driver_pay_cycles dpc
          ON  dpc.driver_id  = tl.driver_id
          AND dpc.pay_year   = EXTRACT(YEAR  FROM tl.load_date)
          AND dpc.pay_month  = EXTRACT(MONTH FROM tl.load_date)
        LEFT JOIN driver_trip_logs dtl
          ON  dtl.truck_load_id = tl.id
          AND dtl.pay_cycle_id  = dpc.id
        WHERE tl.driver_id  IS NOT NULL
          AND tl.is_archived != TRUE
          AND tl.is_split_load != TRUE
          AND dtl.id IS NULL
        ORDER BY tl.driver_id, tl.load_date
    """)).fetchall()

    print(f"\n[2] MISSING trip log entries (load has driver_id, cycle exists, no log): {len(missing)}")
    for r in missing:
        print(f"    load_id={r.load_id}  date={str(r.load_date)[:10]}"
              f"  driver={r.driver_name}({r.driver_id})  mine={r.mine_name}({r.casual_group})"
              f"  cycle_id={r.cycle_id}")

    if DRY_RUN:
        print("\nDRY RUN — no changes made.")
        sys.exit(0)

    # ── 3. Delete spurious entries ────────────────────────────────────────────
    if spurious:
        ids = [r.trip_id for r in spurious]
        conn.execute(text(
            "DELETE FROM driver_trip_logs WHERE id = ANY(:ids)"
        ), {"ids": ids})
        print(f"\n[FIX] Deleted {len(ids)} spurious trip log entries: {ids}")

    # ── 4. Insert missing trip log entries ────────────────────────────────────
    inserted = 0
    for r in missing:
        conn.execute(text("""
            INSERT INTO driver_trip_logs (pay_cycle_id, trip_date, mine_name, truck_load_id, notes)
            VALUES (:cycle_id, :trip_date, :mine_name, :load_id, :notes)
        """), {
            "cycle_id":  r.cycle_id,
            "trip_date": r.load_date,
            "mine_name": r.mine_name,
            "load_id":   r.load_id,
            "notes":     f"Auto: truck load #{r.load_id} (backfilled)",
        })
        inserted += 1

    if inserted:
        print(f"[FIX] Inserted {inserted} missing trip log entries")

    conn.commit()
    print("\nDone — changes committed.")
    print("=" * 70)
