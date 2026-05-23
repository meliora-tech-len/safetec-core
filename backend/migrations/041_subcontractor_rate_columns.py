"""
Migration 041: Add subcontractor rate columns to truck_loads.

Four nullable columns support the subcontractor costing module:
  - subcontractor_admin_fee_per_ton: snapshot of DieselSettings.additional_charge_per_ton at
                                     entry time; never overwritten on edits (historical safety)
  - subcontractor_rate:              rate_per_ton minus the snapshotted admin fee
  - subcontractor_amount_excl_vat:   tonnes × subcontractor_rate
  - subcontractor_amount_incl_vat:   subcontractor_amount_excl_vat × 1.15

All four are NULL for non-subcontractor trucks.

SQLite: applied by upgrade() — safe to re-run.

PostgreSQL / Supabase — run manually in the SQL editor:

    ALTER TABLE truck_loads
        ADD COLUMN IF NOT EXISTS subcontractor_admin_fee_per_ton NUMERIC(10, 2),
        ADD COLUMN IF NOT EXISTS subcontractor_rate              NUMERIC(10, 2),
        ADD COLUMN IF NOT EXISTS subcontractor_amount_excl_vat   NUMERIC(12, 2),
        ADD COLUMN IF NOT EXISTS subcontractor_amount_incl_vat   NUMERIC(12, 2);
"""

from sqlalchemy import text


def upgrade(conn):
    for col, type_ in [
        ("subcontractor_admin_fee_per_ton", "NUMERIC(10, 2)"),
        ("subcontractor_rate",              "NUMERIC(10, 2)"),
        ("subcontractor_amount_excl_vat",   "NUMERIC(12, 2)"),
        ("subcontractor_amount_incl_vat",   "NUMERIC(12, 2)"),
    ]:
        try:
            conn.execute(text(f"ALTER TABLE truck_loads ADD COLUMN {col} {type_}"))
        except Exception:
            pass
    conn.commit()
