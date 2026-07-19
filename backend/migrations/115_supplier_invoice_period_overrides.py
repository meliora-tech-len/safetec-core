"""Migration 115 — supplier-invoice manual period overrides ("Manage → Move").

A Safetec cash supplier invoice captured in July normally costs under June (the
cash-supplier "previous month" rule). If June's costing was already sent and the
invoice arrived too late, the user needs to pull it forward into July costing —
and the automatic cash-shift must NOT re-apply. They also want to move the SARS /
Income-vs-Expenses month independently of costing and of the statement listing.

Add two nullable override month/year pairs to supplier_invoices:
  costing_period_month / costing_period_year — pins the costing month (bypasses
    the cash −1 shift and the sent-costing roll-forward).
  report_period_month / report_period_year   — pins the SARS VAT / Income-vs-
    Expenses month (those reports otherwise group by invoice_date).

All four are nullable; NULL = "Auto" (the existing computed default), so there is
nothing to backfill and no behaviour change for any existing invoice. Fully
reversible — dropping the columns restores the old behaviour.
"""
from sqlalchemy import text

_COLS = [
    "costing_period_month",
    "costing_period_year",
    "report_period_month",
    "report_period_year",
]


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        for col in _COLS:
            conn.execute(text(
                f"ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS {col} INTEGER"
            ))
    else:
        # SQLite can't guard ADD COLUMN with IF NOT EXISTS — check the catalog.
        existing = {
            row[1] for row in conn.execute(text("PRAGMA table_info(supplier_invoices)"))
        }
        for col in _COLS:
            if col not in existing:
                conn.execute(text(
                    f"ALTER TABLE supplier_invoices ADD COLUMN {col} INTEGER"
                ))

    conn.commit()
    print("  added supplier_invoices period-override columns")
