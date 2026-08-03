"""One-off: release the stuck pins on the SFT 30 DAY SUPPLIERS June 2026 cells.

Every June cell in that section is `is_overridden = true` at 0.00, so
_apply_autofill skips it and the June figures never land — the pull finds them
(Truck Mech R281 890.49, Erp R38 352.50, Scania R53 407.54 + R181 330.40 paid, …)
and then refuses to write. Both SFT budgets show it: the June budget inherited the
pins from May, because Replicate carries `is_overridden` forward.

The pins came from a hand-edit — until the accompanying fix to upsert_line_value,
ANY edit of an auto cell (including typing 0, or blanking it) set the pin and there
was no way to clear it.

This:
  1. writes an undo script restoring the exact flags it clears,
  2. clears is_overridden on the pinned June 2026 cells in 30 DAY SUPPLIERS
     on every SFT budget — but ONLY where the cell is blank/zero, so a real
     hand-typed June figure is never silently released,
  3. re-pulls the 30 DAY SUPPLIERS section on each affected budget (exactly what
     the section's "Pull from System" button does).

Scoped deliberately to 30 DAY SUPPLIERS. The same stuck pins exist on the June
CASH / DIESEL / INCOME cells and are left alone.

  DRY_RUN=1   plan only, nothing written
  NO_PULL=1   clear the pins but don't re-pull (click Pull from System yourself)
"""
import os
import sys

from sqlalchemy import text

from app.db.database import SessionLocal, engine
from app.models.models import Budget

SECTION = "30 DAY SUPPLIERS"
TARGET_MONTH, TARGET_YEAR = 6, 2026
ENTITY_CODE = "SFT"

DRY_RUN = os.environ.get("DRY_RUN") == "1"
NO_PULL = os.environ.get("NO_PULL") == "1"
UNDO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sft_unpin_june_30day_undo.sql")


with engine.begin() as conn:
    rows = list(conn.execute(text("""
        select v.id, v.line_id, l.name as line_name, v.amount_due, v.amount_paid,
               b.id as budget_id, b.period_month, b.period_year
        from budget_line_values v
        join budget_lines l      on l.id = v.line_id
        join budget_sections sec on sec.id = l.section_id
        join budgets b           on b.id = sec.budget_id
        join business_entities e on e.id = b.entity_id
        where e.code = :code
          and sec.name = :section
          and l.source = 'auto'
          and v.month = :m and v.year = :y
          and v.is_overridden = true
        order by b.id, l.sort_order, l.id
    """), {"code": ENTITY_CODE, "section": SECTION, "m": TARGET_MONTH, "y": TARGET_YEAR}))

    def is_blank(r):
        return ((r.amount_due is None or r.amount_due == 0)
                and (r.amount_paid is None or r.amount_paid == 0))

    doomed = [r for r in rows if is_blank(r)]
    kept = [r for r in rows if not is_blank(r)]

    print(f"{len(rows)} pinned {TARGET_YEAR}-{TARGET_MONTH:02d} cell(s) in {SECTION} across {ENTITY_CODE} budgets\n")
    print(f"UNPIN {len(doomed)}:")
    for r in doomed:
        print(f"   budget {r.budget_id} ({r.period_month}/{r.period_year})  {r.line_name!r}  "
              f"due={r.amount_due} paid={r.amount_paid}")
    if kept:
        print(f"\nLEFT PINNED {len(kept)} (hand-typed figure, not a zero — releasing it would lose the number):")
        for r in kept:
            print(f"   budget {r.budget_id} ({r.period_month}/{r.period_year})  {r.line_name!r}  "
                  f"due={r.amount_due} paid={r.amount_paid}")

    if not doomed:
        print("\nNothing to do.")
        sys.exit(0)

    undo = [f"-- Undo for sft_unpin_june_30day.py ({ENTITY_CODE} {SECTION}, {TARGET_MONTH}/{TARGET_YEAR}).",
            "-- Re-pins the cells and restores the amounts they held when the pin was cleared.",
            "-- NOTE: run this BEFORE any further pull, or a pull will already have",
            "-- overwritten the amounts (the pin is what was stopping it).",
            "BEGIN;"]
    for r in doomed:
        due = "NULL" if r.amount_due is None else str(r.amount_due)
        paid = "NULL" if r.amount_paid is None else str(r.amount_paid)
        undo.append(f"UPDATE budget_line_values SET is_overridden = true, "
                    f"amount_due = {due}, amount_paid = {paid} WHERE id = {r.id};")
    undo.append("COMMIT;")
    with open(UNDO_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(undo) + "\n")
    print(f"\nundo script: {UNDO_PATH}")

    if DRY_RUN:
        print("\nDRY RUN — nothing written.")
        sys.exit(0)

    conn.execute(text("update budget_line_values set is_overridden = false where id = any(:ids)"),
                 {"ids": [r.id for r in doomed]})
    print(f"\nCleared {len(doomed)} pin(s).")

budget_ids = sorted({r.budget_id for r in doomed})

if NO_PULL:
    print(f"NO_PULL set — click 'Pull from System' on {SECTION} for budget(s) {budget_ids}.")
    sys.exit(0)

# Re-pull, same call path as the section's "Pull from System" button. current_user
# is only used by the subcontractor source, which this section never runs.
from app.api.routes.budgets import _apply_autofill   # noqa: E402  (after the write above)

db = SessionLocal()
try:
    for bid in budget_ids:
        budget = db.query(Budget).filter(Budget.id == bid).first()
        count = _apply_autofill(budget, db, None, section_names={SECTION})
        print(f"budget {bid}: pulled {count} line(s) into {SECTION}")
finally:
    db.close()

print("\nApplied.")
