"""One-off: make the SFT June 2026 budget structurally identical to SFT May 2026.

June was created before May and then had May replicated into it, so it kept every
line its own "Pull from System" had added (plus a seeded OTHER/constants section).
Replicate only ever merges, never prunes, so those extras stayed.

This:
  1. writes an undo script for everything it deletes,
  2. deletes June lines (and their values) that May has no counterpart for,
  3. deletes June sections that May doesn't have (only once empty),
  4. adds May lines missing from June as blank lines (duplicate names counted),
  5. copies May's section order and per-section line order onto June.

Lines match on source_key when they have one, otherwise on lower-cased name, which
is exactly how the replicate endpoint matches them.

Run with DRY_RUN=1 to see the plan without writing.
"""
import os
from collections import defaultdict
from sqlalchemy import text
from app.db.database import engine

SRC, TGT = 4, 3                     # SFT May 2026, SFT June 2026
DRY_RUN = os.environ.get("DRY_RUN") == "1"
UNDO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "june_budget_undo.sql")


def ident(name, key):
    return key or ("name:" + (name or "").strip().lower())


def sql_str(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def sql_num(v):
    return "NULL" if v is None else str(v)


with engine.begin() as conn:
    # Guard: only ever touch the two budgets this script was written for.
    for bid, m, y in ((SRC, 5, 2026), (TGT, 6, 2026)):
        row = conn.execute(text(
            "select b.period_month, b.period_year, e.code from budgets b "
            "join business_entities e on e.id = b.entity_id where b.id = :b"), {"b": bid}).one()
        assert (row.period_month, row.period_year, row.code) == (m, y, "SFT"), (bid, row)

    def sections(bid):
        return list(conn.execute(text(
            "select id, name, section_type, sort_order from budget_sections "
            "where budget_id = :b order by sort_order, id"), {"b": bid}))

    def lines(sec_id):
        return list(conn.execute(text(
            "select id, name, notes, source, source_key, sort_order, name_overridden "
            "from budget_lines where section_id = :s order by sort_order, id"), {"s": sec_id}))

    src_secs = sections(SRC)
    tgt_secs = sections(TGT)
    src_by_name = {s.name: s for s in src_secs}
    tgt_by_name = {s.name: s for s in tgt_secs}

    # ── 1. work out what goes ──────────────────────────────────────────────────
    doomed_lines = []      # line rows to delete
    doomed_secs = []       # section rows to delete
    to_add = []            # (tgt_section_id, src_line row)
    order_plan = []        # (line_id, sort_order)

    for tsec in tgt_secs:
        ssec = src_by_name.get(tsec.name)
        if ssec is None:
            doomed_secs.append(tsec)
            doomed_lines.extend(lines(tsec.id))
            continue

        tgt_lines = lines(tsec.id)
        src_lines = lines(ssec.id)

        # Multiset match: May's lines, in order, each consuming one June line with
        # the same identity. Leftover June lines are the extras; unmatched May
        # lines have to be created.
        pool = defaultdict(list)
        for l in tgt_lines:
            pool[ident(l.name, l.source_key)].append(l)

        matched = set()
        for order, sl in enumerate(src_lines):
            bucket = pool.get(ident(sl.name, sl.source_key))
            if bucket:
                tl = bucket.pop(0)
                matched.add(tl.id)
                order_plan.append((tl.id, order))
            else:
                to_add.append((tsec.id, sl, order))

        doomed_lines.extend([l for l in tgt_lines if l.id not in matched])

    # ── 2. undo script ─────────────────────────────────────────────────────────
    undo = ["-- Undo for match_june_to_may.py (SFT June 2026, budget 3).",
            "-- Restores the deleted sections, lines and values at their original ids.",
            "BEGIN;"]
    for s in doomed_secs:
        undo.append(
            "INSERT INTO budget_sections (id, budget_id, name, section_type, sort_order) VALUES "
            f"({s.id}, {TGT}, {sql_str(s.name)}, {sql_str(s.section_type)}, {sql_num(s.sort_order)});")
    for l in doomed_lines:
        sec_id = conn.execute(text("select section_id from budget_lines where id = :i"), {"i": l.id}).scalar()
        undo.append(
            "INSERT INTO budget_lines (id, section_id, name, notes, sort_order, source, source_key, name_overridden) "
            f"VALUES ({l.id}, {sec_id}, {sql_str(l.name)}, {sql_str(l.notes)}, {sql_num(l.sort_order)}, "
            f"{sql_str(l.source)}, {sql_str(l.source_key)}, {str(bool(l.name_overridden)).lower()});")
        for v in conn.execute(text(
            "select id, month, year, amount_due, amount_paid, is_overridden "
            "from budget_line_values where line_id = :l order by id"), {"l": l.id}):
            undo.append(
                "INSERT INTO budget_line_values (id, line_id, month, year, amount_due, amount_paid, is_overridden) "
                f"VALUES ({v.id}, {l.id}, {v.month}, {v.year}, {sql_num(v.amount_due)}, "
                f"{sql_num(v.amount_paid)}, {str(bool(v.is_overridden)).lower()});")
    undo.append("COMMIT;")
    with open(UNDO_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(undo) + "\n")

    print(f"undo script: {UNDO_PATH}")
    print(f"\nDELETE {len(doomed_lines)} line(s):")
    for l in doomed_lines:
        print(f"   {l.id:5} {l.name!r} [{l.source}]")
    print(f"\nDELETE {len(doomed_secs)} section(s): {[s.name for s in doomed_secs]}")
    print(f"\nADD {len(to_add)} blank line(s):")
    for sec_id, sl, _ in to_add:
        print(f"   {sl.name!r} [{sl.source}] -> section {sec_id}")

    if DRY_RUN:
        print("\nDRY RUN — nothing written.")
        raise SystemExit(0)

    # ── 3. apply ───────────────────────────────────────────────────────────────
    if doomed_lines:
        ids = [l.id for l in doomed_lines]
        conn.execute(text("delete from budget_line_values where line_id = any(:i)"), {"i": ids})
        conn.execute(text("delete from budget_lines where id = any(:i)"), {"i": ids})
    for s in doomed_secs:
        conn.execute(text("delete from budget_sections where id = :i"), {"i": s.id})

    for sec_id, sl, order in to_add:
        new_id = conn.execute(text(
            "insert into budget_lines (section_id, name, notes, sort_order, source, source_key, name_overridden) "
            "values (:s, :n, :o, :so, :src, :key, :ovr) returning id"),
            {"s": sec_id, "n": sl.name, "o": sl.notes, "so": order,
             "src": sl.source, "key": sl.source_key, "ovr": bool(sl.name_overridden)}).scalar()
        order_plan.append((new_id, order))

    for line_id, order in order_plan:
        conn.execute(text("update budget_lines set sort_order = :o where id = :i"),
                     {"o": order, "i": line_id})

    # May's section order, onto the sections June still has.
    for s in src_secs:
        t = tgt_by_name.get(s.name)
        if t is not None:
            conn.execute(text("update budget_sections set sort_order = :o where id = :i"),
                         {"o": s.sort_order, "i": t.id})

    print("\nApplied.")
