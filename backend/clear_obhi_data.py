"""
Clear transactional data for OBHI (entity_id=2) from the SQLite dev database.

Clears:  invoices, supplier invoices, truck loads, diesel fill-ups,
         payroll entries, driver pay cycles and sub-tables,
         driver loads/payments, truck monthly expenses, audit logs.

Keeps:   trucks, trailers, drivers, customers, suppliers, subcontractors,
         fleet/licence info, diesel rates/settings, mine rates,
         user access, driver salary configs, the business_entities row.

Usage:
    python clear_obhi_data.py            # dry-run: prints row counts only
    python clear_obhi_data.py --execute  # actually deletes the data
"""

import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent / "safetec_core.db"
ENTITY_ID = 2  # OBHI


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = OFF")  # we handle order manually
    return conn


def get_obhi_ids(conn):
    truck_ids = [r[0] for r in conn.execute(
        "SELECT id FROM trucks WHERE entity_id = ?", (ENTITY_ID,)
    ).fetchall()]
    driver_ids = [r[0] for r in conn.execute(
        "SELECT id FROM drivers WHERE entity_id = ?", (ENTITY_ID,)
    ).fetchall()]
    pay_cycle_ids = []
    if driver_ids:
        placeholders = ",".join("?" * len(driver_ids))
        pay_cycle_ids = [r[0] for r in conn.execute(
            f"SELECT id FROM driver_pay_cycles WHERE driver_id IN ({placeholders})",
            driver_ids,
        ).fetchall()]
    invoice_ids = [r[0] for r in conn.execute(
        "SELECT id FROM invoices WHERE entity_id = ?", (ENTITY_ID,)
    ).fetchall()]
    supplier_invoice_ids = [r[0] for r in conn.execute(
        "SELECT id FROM supplier_invoices WHERE entity_id = ?", (ENTITY_ID,)
    ).fetchall()]
    return {
        "truck_ids": truck_ids,
        "driver_ids": driver_ids,
        "pay_cycle_ids": pay_cycle_ids,
        "invoice_ids": invoice_ids,
        "supplier_invoice_ids": supplier_invoice_ids,
    }


def count_rows(conn, table, where_sql, params):
    return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where_sql}", params).fetchone()[0]


def in_where(col, id_list):
    if not id_list:
        return "1=0", []
    return f"{col} IN ({','.join('?' * len(id_list))})", id_list


def entity_where():
    return "entity_id = ?", [ENTITY_ID]


def build_deletions(ids):
    """Returns list of (table, where_sql, params, label) in safe deletion order."""
    truck_ids = ids["truck_ids"]
    driver_ids = ids["driver_ids"]
    pay_cycle_ids = ids["pay_cycle_ids"]
    invoice_ids = ids["invoice_ids"]
    supplier_invoice_ids = ids["supplier_invoice_ids"]

    steps = []

    # ── Driver pay cycle sub-tables ──────────────────────────────────────────
    if pay_cycle_ids:
        steps.append(("driver_trip_logs",       *in_where("pay_cycle_id", pay_cycle_ids), "Driver trip logs"))
        steps.append(("driver_additional_loads", *in_where("pay_cycle_id", pay_cycle_ids), "Driver additional loads"))
        steps.append(("driver_food_payments",    *in_where("pay_cycle_id", pay_cycle_ids), "Driver food payments"))

    if driver_ids:
        steps.append(("driver_pay_cycles", *in_where("driver_id", driver_ids), "Driver pay cycles"))
        steps.append(("driver_loads",      *in_where("driver_id", driver_ids), "Driver loads"))
        steps.append(("driver_payments",   *in_where("driver_id", driver_ids), "Driver payments"))

    steps.append(("payroll_entries", *entity_where(), "Payroll entries"))

    # ── Diesel fill-ups (transactional; keep rates/settings) ─────────────────
    steps.append(("diesel_fillups", *entity_where(), "Diesel fill-ups"))

    # ── Truck monthly expenses ────────────────────────────────────────────────
    if truck_ids:
        steps.append(("truck_monthly_expenses", *in_where("truck_id", truck_ids), "Truck monthly expenses"))

    # ── Truck loads ───────────────────────────────────────────────────────────
    steps.append(("truck_loads", *entity_where(), "Truck loads"))

    # ── Invoices ─────────────────────────────────────────────────────────────
    if invoice_ids:
        steps.append(("invoice_line_items", *in_where("invoice_id", invoice_ids), "Invoice line items"))
    steps.append(("invoices", *entity_where(), "Invoices"))

    # ── Supplier invoices ─────────────────────────────────────────────────────
    if supplier_invoice_ids:
        steps.append(("supplier_invoice_line_items", *in_where("invoice_id", supplier_invoice_ids), "Supplier invoice line items"))
    steps.append(("supplier_invoices", *entity_where(), "Supplier invoices"))

    # ── Audit logs ────────────────────────────────────────────────────────────
    steps.append(("audit_logs", *entity_where(), "Audit logs"))

    return steps


def run(execute: bool):
    if not DB_PATH.exists():
        print(f"ERROR: database not found at {DB_PATH}")
        sys.exit(1)

    conn = connect()

    print(f"\n{'=== DRY RUN ===' if not execute else '=== EXECUTING DELETIONS ==='}")
    print(f"Entity: OBHI (entity_id={ENTITY_ID})")
    print(f"Database: {DB_PATH}")
    print("Scope: transactional data only (trucks/drivers/customers/fleet kept)\n")

    ids = get_obhi_ids(conn)
    print(f"Found {len(ids['truck_ids'])} trucks, {len(ids['driver_ids'])} drivers, "
          f"{len(ids['pay_cycle_ids'])} pay cycles, "
          f"{len(ids['invoice_ids'])} invoices, {len(ids['supplier_invoice_ids'])} supplier invoices\n")

    steps = build_deletions(ids)

    total_rows = 0
    for table, where_sql, params, label in steps:
        n = count_rows(conn, table, where_sql, params)
        if n:
            print(f"  {'DELETE' if execute else 'WOULD DELETE':14s}  {n:>5d}  {label}  ({table})")
            total_rows += n
        if execute and n:
            conn.execute(f"DELETE FROM {table} WHERE {where_sql}", params)

    print(f"\n  {'Total rows deleted' if execute else 'Total rows that would be deleted':38s}  {total_rows}")

    if execute:
        conn.commit()
        print("\nDone. OBHI transactional data cleared. Master data (fleet, drivers, customers, suppliers) kept.")
    else:
        print("\nDry run complete. Re-run with --execute to delete.")

    conn.close()


if __name__ == "__main__":
    execute = "--execute" in sys.argv
    run(execute)
