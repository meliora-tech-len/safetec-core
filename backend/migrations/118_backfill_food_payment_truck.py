"""
Migration 118 — Backfill DriverFoodPayment.truck_id where it is unambiguous.

Truck-less food payments (captured from the driver payslip page before the truck
picker existed) fall back to the driver-link display rule in
fleet.list_truck_food_payments, so one payment shows under EVERY truck the driver
is linked to — the duplicate-entry bug.

This pins each truck-less payment to its truck where the driver has exactly one
linked truck (assigned truck, casual assignment, or a truck they are named on a
load for). That is a no-op for what the user sees — the row already displays only
under that truck — it just makes the attribution explicit so the fallback stops
applying. Payments whose driver is linked to several trucks are left NULL on
purpose: only a human knows which truck paid, and they now show as "Unassigned"
in the driver's Food Allowance table with a truck picker to fix them.
"""
from sqlalchemy import text


LINKED_TRUCKS = """
    SELECT DISTINCT t.truck_id FROM (
        SELECT d.truck_id            FROM drivers d                  WHERE d.id = :driver_id AND d.truck_id IS NOT NULL
        UNION SELECT a.truck_id      FROM casual_truck_assignments a WHERE a.driver_id = :driver_id
        UNION SELECT l.truck_id      FROM truck_loads l              WHERE l.driver_id = :driver_id AND l.truck_id IS NOT NULL
        UNION SELECT l2.truck_id     FROM truck_load_driver_splits s
                                     JOIN truck_loads l2 ON l2.id = s.truck_load_id
                                     WHERE s.driver_id = :driver_id AND l2.truck_id IS NOT NULL
    ) t
"""


def upgrade(conn):
    rows = conn.execute(text("""
        SELECT f.id, c.driver_id
        FROM driver_food_payments f
        JOIN driver_pay_cycles c ON c.id = f.pay_cycle_id
        WHERE f.truck_id IS NULL
    """)).fetchall()

    pinned = skipped = 0
    for payment_id, driver_id in rows:
        trucks = [r[0] for r in conn.execute(text(LINKED_TRUCKS), {"driver_id": driver_id})]
        if len(trucks) != 1:
            skipped += 1
            continue
        conn.execute(
            text("UPDATE driver_food_payments SET truck_id = :truck_id WHERE id = :id"),
            {"truck_id": trucks[0], "id": payment_id},
        )
        pinned += 1

    conn.commit()
    print(f"Migration 118: pinned {pinned} food payments to a truck, "
          f"left {skipped} ambiguous rows for manual assignment")
