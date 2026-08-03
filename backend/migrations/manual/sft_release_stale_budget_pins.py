"""One-off: release stale pins across the SFT budgets' AUTO sections, then re-pull.

Companion to sft_unpin_june_30day.py, which did the same for 30 DAY SUPPLIERS.
Same cause: until the fix to upsert_line_value, ANY edit of an auto cell set
`is_overridden` — including typing 0 or blanking a box — and nothing could clear
it, so those cells ignored every later pull.

CONSERVATIVE BY DESIGN. A pin is released only when releasing it cannot lose a
figure: for BOTH boxes (To Pay / Paid) the stored amount must be blank, zero, or
already equal to what the system says. Anything else is a real hand-entry — the
SFT "Cash" line's June R619 631.22 against the system's R10 646.96, say — and is
left pinned and listed, because only the user can say which number is right.

INCOME is untouched. It is not pulled at all (it's chosen through the income
modal, one row per PO), so there is nothing to refresh it from.

  DRY_RUN=1   plan only, nothing written
  NO_PULL=1   release the pins but don't re-pull
"""
import os
import sys
from decimal import Decimal

from sqlalchemy import text

from app.db.database import SessionLocal, engine
from app.models.models import Budget
from app.services.budget_autofill import compute_autofill, SECTION_SOURCES, SEC_INCOME

ENTITY_ID, ENTITY_CODE = 3, "SFT"
BUDGET_IDS = [4, 20]                       # SFT May 2026, SFT June 2026

DRY_RUN = os.environ.get("DRY_RUN") == "1"
NO_PULL = os.environ.get("NO_PULL") == "1"
UNDO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "sft_release_stale_budget_pins_undo.sql")

PULLABLE = {n for n in SECTION_SOURCES if n != SEC_INCOME[0]}


def window(month, year, n=3):
    out, y, m = [], year, month
    for _ in range(n):
        out.append((m, y))
        idx = y * 12 + (m - 1) + 1
        y, m = idx // 12, idx % 12 + 1
    return out


def num(v):
    return Decimal("0") if v is None else Decimal(str(v))


def loses_nothing(stored, system):
    """True if overwriting `stored` with `system` cannot lose a hand-typed figure."""
    return num(stored) == 0 or num(stored) == num(system)


release, keep = [], []

db = SessionLocal()
try:
    for bid in BUDGET_IDS:
        budget = db.query(Budget).filter(Budget.id == bid).first()
        assert budget and budget.entity_id == ENTITY_ID, bid
        months = window(budget.period_month, budget.period_year)

        # What the system says for every pullable section of this budget's window.
        specs = compute_autofill(ENTITY_ID, months, None, section_names=PULLABLE)
        by_key = {s["source_key"]: s for s in specs}

        rows = db.execute(text("""
            select v.id, v.month, v.year, v.amount_due, v.amount_paid,
                   l.name as line_name, l.source_key, sec.name as section
            from budget_line_values v
            join budget_lines l      on l.id = v.line_id
            join budget_sections sec on sec.id = l.section_id
            where sec.budget_id = :b and l.source = 'auto' and v.is_overridden = true
            order by sec.sort_order, l.sort_order, v.year, v.month
        """), {"b": bid}).fetchall()

        for r in rows:
            if r.section not in PULLABLE:
                continue          # INCOME and hand-built sections have no source
            sysvals = by_key.get(r.source_key, {}).get("values", {}).get((r.month, r.year), {})
            sys_due, sys_paid = sysvals.get("due"), sysvals.get("paid")
            item = (bid, r, sys_due, sys_paid)
            if loses_nothing(r.amount_due, sys_due) and loses_nothing(r.amount_paid, sys_paid):
                release.append(item)
            else:
                keep.append(item)
finally:
    db.close()


def show(items, heading):
    print(f"\n{heading} ({len(items)}):")
    for bid, r, sd, sp in items:
        print(f"   b{bid} {r.section:<26} {r.line_name.strip():<24} {r.year}-{r.month:02d}  "
              f"stored due={r.amount_due} paid={r.amount_paid}   "
              f"system due={sd} paid={sp}")


show(release, "RELEASE — stored is blank/zero or already matches the system")
show(keep, "KEEP PINNED — a hand-typed figure the system disagrees with")

if not release:
    print("\nNothing to release.")
    sys.exit(0)

undo = [f"-- Undo for sft_release_stale_budget_pins.py ({ENTITY_CODE} budgets {BUDGET_IDS}).",
        "-- Re-pins the cells and restores the amounts they held beforehand.",
        "-- Run BEFORE any further pull, which would already have rewritten the amounts.",
        "BEGIN;"]
for bid, r, sd, sp in release:
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

with engine.begin() as conn:
    conn.execute(text("update budget_line_values set is_overridden = false where id = any(:ids)"),
                 {"ids": [r.id for _, r, _, _ in release]})
print(f"\nReleased {len(release)} pin(s).")

if NO_PULL:
    print("NO_PULL set — click 'Pull from System' on each section yourself.")
    sys.exit(0)

from app.api.routes.budgets import _apply_autofill   # noqa: E402  (after the write above)

db = SessionLocal()
try:
    touched = {(bid, r.section) for bid, r, _, _ in release}
    for bid in BUDGET_IDS:
        sections = sorted({s for b, s in touched if b == bid})
        if not sections:
            continue
        budget = db.query(Budget).filter(Budget.id == bid).first()
        count = _apply_autofill(budget, db, None, section_names=set(sections))
        print(f"budget {bid}: pulled {count} line(s) into {', '.join(sections)}")
finally:
    db.close()

print("\nApplied.")
