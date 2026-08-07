"""One-off: two SFT loads were captured with statement year 2024 instead of 2026
(scroll-wheel/typo on the Load Entry period field) and show as "July/August 2024"
period issues on the Invoiced PO vs Loads report.

  load#2079 JYC247EC slip 118125 load_date 2026-07-16: 7/2024 -> 7/2026
  load#2562 KRM473EC slip 119161 load_date 2026-08-02: 8/2024 -> 8/2026

Amounts/tonnes/rates on both loads match their invoices — only the period is wrong.
Run with DRY_RUN=1 to check without writing.
"""
import os
from sqlalchemy import text
from app.db.database import engine

DRY_RUN = os.environ.get("DRY_RUN") == "1"
UNDO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "sft_fix_2024_statement_years_UNDO.sql")

# (load id, expected slip, expected month, wrong year)
FIXES = [(2079, "118125", 7, 2024), (2562, "119161", 8, 2024)]

undo = ["-- UNDO for sft_fix_2024_statement_years.py", "BEGIN;"]

with engine.begin() as conn:
    for lid, slip, mo, bad_year in FIXES:
        row = conn.execute(text("""
            select tl.slip_number, tl.statement_month, tl.statement_year, e.code
            from truck_loads tl join business_entities e on e.id = tl.entity_id
            where tl.id = :i"""), {"i": lid}).one()
        assert (row.slip_number, row.statement_month, row.statement_year, row.code) == \
               (slip, mo, bad_year, "SFT"), (lid, tuple(row))
        undo.append(f"update truck_loads set statement_year = {bad_year} where id = {lid};")
        print(f"load#{lid} slip {slip}: {mo}/{bad_year} -> {mo}/2026")
        if not DRY_RUN:
            conn.execute(text(
                "update truck_loads set statement_year = 2026 where id = :i"), {"i": lid})

    undo.append("COMMIT;")
    if DRY_RUN:
        print("DRY RUN — nothing written.")
        raise SystemExit(0)
    with open(UNDO_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(undo) + "\n")

print(f"Done. UNDO written to {UNDO_PATH}")
