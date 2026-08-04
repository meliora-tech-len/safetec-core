"""One-off: duplicate the June 2026 SFT Profit Sheet lines into July 2026.

The carry-forward only fires when a month has NO sheet row yet, and it used to
copy just 13 whitelisted insurance/finance lines. She opened and saved all the
July sheets on 2026-08-03 under the old rule, so those rows now exist with
June's other recurring lines (Sasfin, Beyonda, Ngqura loads, maintenance,
driver/casual wages, diesel) missing. Changing the rule alone can't reach them.

This rebuilds each SFT truck's July 2026 custom_lines as:
    June's lines, in June's order, then any July-only lines appended.

  * a line already in July keeps ITS amount and id — nothing she typed in July
    is overwritten or reordered away,
  * a line only in June is added with June's amount, EXCEPT diesel/wages/salary
    lines, which come across with a blank amount (see PROFIT_SHEET_BLANK_ON_CARRY
    in app/api/routes/fleet.py — same rule the endpoint now applies),
  * a July line with NO amount that June doesn't have is dropped: those 33 rows
    are leftovers of the old 13-line template (Theft Truck, Theft Trailer, Truck/
    Trailers Monthly Payment, 5% of Sum Insured), which June already carries under
    her own wording (THEFT HIJACK TRUCK & TRAILER, Trailers Monthly Payment - vat
    back). Nothing with a figure on it is ever dropped,
  * lines match on case/space-insensitive description, one-for-one, so a month
    holding the same description twice keeps both.

ALIASES exists because June spells Sasfin "SAFIN" on 3 trucks (JZG083EC,
KKF401EC, KMR411EC) where July says "SASFIN". Without it both spellings would
land in July and double-count ~R1 471 per truck. It is a backfill-only fix for
those rows; the endpoint copies a month forward wholesale and never merges, so
it needs no alias table.

Income, notes and the named legacy columns are not touched.

Writes sft_july_profit_sheet_carry_june_undo.sql before changing anything.
Run with DRY_RUN=1 to see the plan without writing.

    cd backend
    python -c "import runpy; runpy.run_path('migrations/manual/sft_july_profit_sheet_carry_june.py')"
"""
import json
import os
from sqlalchemy import text
from app.db.database import engine
from app.api.routes.fleet import _profit_sheet_carry_amount

ENTITY_CODE = "SFT"
SRC_YEAR, SRC_MONTH = 2026, 6
TGT_YEAR, TGT_MONTH = 2026, 7

DRY_RUN = os.environ.get("DRY_RUN") == "1"
UNDO_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "sft_july_profit_sheet_carry_june_undo.sql",
)


ALIASES = {"safin": "sasfin"}


def norm(desc):
    key = " ".join((desc or "").split()).lower()
    return ALIASES.get(key, key)


def has_amount(line):
    try:
        float(line.get("amount"))
    except (TypeError, ValueError):
        return False
    return True


def as_lines(raw):
    if isinstance(raw, str):
        raw = json.loads(raw)
    return list(raw or [])


def sql_json(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::json"


with engine.begin() as conn:
    rows = list(conn.execute(text("""
        SELECT t.id AS truck_id, t.registration,
               s.id AS src_id, s.custom_lines AS src_lines,
               g.id AS tgt_id, g.custom_lines AS tgt_lines
        FROM trucks t
        JOIN business_entities e ON e.id = t.entity_id
        JOIN truck_monthly_expenses s
             ON s.truck_id = t.id AND s.year = :sy AND s.month = :sm
        JOIN truck_monthly_expenses g
             ON g.truck_id = t.id AND g.year = :ty AND g.month = :tm
        WHERE e.code = :code
        ORDER BY t.registration
    """), {"sy": SRC_YEAR, "sm": SRC_MONTH, "ty": TGT_YEAR, "tm": TGT_MONTH,
           "code": ENTITY_CODE}))

    undo = [
        f"-- Undo: restore SFT {TGT_MONTH}/{TGT_YEAR} profit-sheet custom_lines",
        "BEGIN;",
    ]
    planned = []

    for r in rows:
        src = as_lines(r.src_lines)
        tgt = as_lines(r.tgt_lines)

        # Index July's lines by description so each is claimed at most once.
        remaining = {}
        for line in tgt:
            remaining.setdefault(norm(line.get("description")), []).append(line)

        merged, added, dropped = [], [], []
        for line in src:
            key = norm(line.get("description"))
            bucket = remaining.get(key)
            if bucket:
                merged.append(bucket.pop(0))          # July's own line wins
                continue
            keep = _profit_sheet_carry_amount(line.get("description"))
            new = {
                "id": os.urandom(16).hex(),
                "description": line.get("description") or "",
                "amount": line.get("amount") if keep else None,
            }
            merged.append(new)
            added.append(new)

        # Anything captured in July that June never had: keep it if she typed a
        # figure on it, drop it if it's an empty old-template row.
        leftover_ids = {id(l) for bucket in remaining.values() for l in bucket}
        for line in tgt:
            if id(line) not in leftover_ids:
                continue
            (merged if has_amount(line) else dropped).append(line)

        if merged == tgt:
            continue

        planned.append((r.registration, added, dropped, len(tgt), len(merged)))
        undo.append(
            f"UPDATE truck_monthly_expenses SET custom_lines = {sql_json(tgt)} "
            f"WHERE id = {r.tgt_id};  -- {r.registration}"
        )
        if not DRY_RUN:
            conn.execute(
                text("UPDATE truck_monthly_expenses SET custom_lines = :cl WHERE id = :id"),
                {"cl": json.dumps(merged), "id": r.tgt_id},
            )

    undo.append("COMMIT;")

    for reg, added, dropped, before, after in planned:
        print(f"{reg:12} {before:2} -> {after:2} lines")
        for line in added:
            amount = "(blank)" if line["amount"] is None else line["amount"]
            print(f"               + {line['description']:38} {amount}")
        for line in dropped:
            print(f"               - {line.get('description'):38} (was empty)")

    print(f"\n{len(rows)} SFT trucks with both months captured; "
          f"{len(planned)} July sheets {'would be' if DRY_RUN else ''} updated.")

    if DRY_RUN:
        raise SystemExit("DRY_RUN=1 — rolled back, nothing written.")

    with open(UNDO_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(undo) + "\n")
    print(f"Undo written to {UNDO_PATH}")
