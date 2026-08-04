"""One-off: carry SFT May 2026's Bank Info Summary into SFT June 2026.

June was replicated from May before replicate knew about the bank block (it walks
sections -> lines -> values, and budget_bank_rows hangs off the budget itself), so
June came out with no Bank Info Summary at all. The code fix means the NEXT
replicate carries it; this backfills the month that already went through.

Same merge rule as the endpoint's _replicate_bank_rows, so running this and then
pressing Replicate again changes nothing the second time:
  * a row June hasn't got is created with May's label, note and amount,
  * a row June already has keeps what is on it — only blanks are filled,
  * rows match on kind + lower-cased label, duplicates matched by count.

What is deliberately NOT copied: vat_back_trailer, bank_profit_override and
profit_excl_vat_back_override. Those are per-month figures the block computes for
itself (June's VAT back is its own, not May's R133 582.50).

Run with DRY_RUN=1 to see the plan without writing.
"""
import os
from collections import defaultdict
from sqlalchemy import text
from app.db.database import engine

ENTITY = "SFT"
SRC_PERIOD = (5, 2026)
TGT_PERIOD = (6, 2026)
DRY_RUN = os.environ.get("DRY_RUN") == "1"
UNDO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "sft_june_bank_info_from_may_UNDO.sql")


def ident(row):
    return f"{row.kind}:{(row.label or '').strip().lower()}"


def sql_str(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def sql_num(v):
    return "NULL" if v is None else str(v)


with engine.begin() as conn:
    def budget_id(month, year):
        row = conn.execute(text(
            "select b.id from budgets b join business_entities e on e.id = b.entity_id "
            "where upper(e.code) = :c and b.period_month = :m and b.period_year = :y"),
            {"c": ENTITY, "m": month, "y": year}).one()
        return row.id

    SRC = budget_id(*SRC_PERIOD)
    TGT = budget_id(*TGT_PERIOD)
    print(f"{ENTITY}: May budget {SRC} -> June budget {TGT}")

    def rows(bid):
        return list(conn.execute(text(
            "select id, kind, label, note, amount, sort_order from budget_bank_rows "
            "where budget_id = :b order by sort_order, id"), {"b": bid}))

    src_rows = rows(SRC)
    tgt_rows = rows(TGT)
    assert src_rows, "May has no Bank Info Summary to copy — nothing to do."

    # ── 1. plan ────────────────────────────────────────────────────────────────
    pool = defaultdict(list)
    for r in tgt_rows:
        pool[ident(r)].append(r)
    next_order = {}
    for kind in {r.kind for r in src_rows} | {r.kind for r in tgt_rows}:
        next_order[kind] = max([r.sort_order or 0 for r in tgt_rows if r.kind == kind],
                               default=-1) + 1

    to_add = []      # (kind, label, note, amount, sort_order)
    to_fill = []     # (target row, field, new value)
    for s in src_rows:
        bucket = pool.get(ident(s))
        t = bucket.pop(0) if bucket else None
        if t is None:
            order = next_order.get(s.kind, 0)
            next_order[s.kind] = order + 1
            to_add.append((s.kind, s.label, s.note, s.amount, order))
            continue
        if t.amount is None and s.amount is not None:
            to_fill.append((t, "amount", s.amount))
        if not (t.note or "").strip() and s.note:
            to_fill.append((t, "note", s.note))

    print(f"\nADD {len(to_add)} row(s) to June:")
    for kind, label, note, amount, order in to_add:
        print(f"   [{kind:10}] {label!r}  note={note!r}  amount={amount}  order={order}")
    print(f"\nFILL {len(to_fill)} blank field(s) on rows June already has:")
    for t, field, value in to_fill:
        print(f"   row {t.id} [{t.kind}] {t.label!r}  {field} := {value}")

    if DRY_RUN:
        print("\nDRY RUN — nothing written.")
        raise SystemExit(0)

    # ── 2. apply, writing the undo as we go (inserted ids are only known now) ──
    undo = [f"-- Undo for sft_june_bank_info_from_may.py ({ENTITY} June {TGT_PERIOD[1]}, budget {TGT}).",
            "-- Removes the copied Bank Info Summary rows and re-blanks the filled fields.",
            "BEGIN;"]

    for kind, label, note, amount, order in to_add:
        new_id = conn.execute(text(
            "insert into budget_bank_rows (budget_id, kind, label, note, amount, sort_order) "
            "values (:b, :k, :l, :n, :a, :o) returning id"),
            {"b": TGT, "k": kind, "l": label, "n": note, "a": amount, "o": order}).scalar()
        undo.append(f"DELETE FROM budget_bank_rows WHERE id = {new_id};")

    for t, field, value in to_fill:
        conn.execute(text(f"update budget_bank_rows set {field} = :v where id = :i"),
                     {"v": value, "i": t.id})
        old = sql_num(getattr(t, field)) if field == "amount" else sql_str(getattr(t, field))
        undo.append(f"UPDATE budget_bank_rows SET {field} = {old} WHERE id = {t.id};")

    undo.append("COMMIT;")
    with open(UNDO_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(undo) + "\n")

    print(f"\nundo script: {UNDO_PATH}")
    print("Applied.")
