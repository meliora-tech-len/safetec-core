"""One-off: move costing verification ticks along with the expenses that
stopped rolling forward past a sent costing.

From the Aug 2026 costing onward an expense captured after its month was marked
Sent stays in that month (flagged "AFTER SEND") instead of rolling into the
next one — see app/services/costing_sent.py, ROLL_FORWARD_LAST_PERIOD. The
per-invoice verification tick on the costing card is keyed by period
(costing:{sub}:{YYYY-MM}:truck:{id}:invoice:{id}:amount), so the ticks the office
already put on those invoices still point at the month they used to roll into
(Sep 2026) and would show as unverified on the month they now sit in (Aug 2026).

This re-keys every such tick to the invoice's current costing period. Scope is
deliberately narrow: only ticks whose OLD period is after ROLL_FORWARD_LAST_PERIOD
(i.e. moved by this rule change) and whose new key is free. Ticks that were
already stale for other reasons (manual period moves, reg changes) are reported
but left alone.

Run from backend/ AFTER deploying the matching code (the new key is computed
by that code). Writes an undo SQL file next to this script before changing
anything.

  DRY_RUN=1   plan only, nothing written
"""
import os
import re
import sys
from datetime import datetime

from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.db.database import SessionLocal  # noqa: E402
from app.models.models import SupplierInvoice, ValueVerification  # noqa: E402
from app.services.costing_sent import ROLL_FORWARD_LAST_PERIOD, invoice_costing_targets  # noqa: E402

DRY_RUN = os.environ.get("DRY_RUN") == "1"
PATTERN = re.compile(r"^costing:(\d+):(\d{4})-(\d{2}):truck:(\d+):invoice:(\d+):amount$")


def main():
    db = SessionLocal()
    rows = (
        db.query(ValueVerification)
        .filter(ValueVerification.target.like("costing:%:invoice:%:amount"))
        .all()
    )
    existing = {r.target for r in rows}
    targets_by_inv: dict = {}
    plan, skipped = [], []
    for r in rows:
        m = PATTERN.match(r.target)
        if not m:
            continue
        _sub, y, mth, truck_id, inv_id = m.groups()
        inv = db.get(SupplierInvoice, int(inv_id))
        if inv is None or inv.is_archived:
            continue
        if inv_id not in targets_by_inv:
            targets_by_inv[inv_id] = invoice_costing_targets(db, inv)
        current = targets_by_inv[inv_id]
        if r.target in current:
            continue
        new = [t for t in current if f":truck:{truck_id}:" in t]
        reason = None
        if (int(y), int(mth)) <= ROLL_FORWARD_LAST_PERIOD:
            reason = "old period is before the rule change"
        elif not new:
            reason = "invoice no longer on this truck's costing"
        elif new[0] in existing:
            reason = f"new key already exists: {new[0]}"
        if reason:
            skipped.append((r.id, r.target, reason))
        else:
            plan.append((r.id, r.target, new[0]))

    print(f"costing invoice ticks: {len(rows)}   to re-key: {len(plan)}   left alone: {len(skipped)}")
    for rid, old, new in plan:
        print(f"  {rid:6d}  {old}  ->  {new}")
    for rid, old, why in skipped:
        print(f"  skip {rid:6d}  {old}  ({why})")
    if DRY_RUN or not plan:
        print("DRY RUN — nothing written." if DRY_RUN else "Nothing to do.")
        return

    undo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "rekey_after_send_verification_ticks_undo.sql")
    with open(undo_path, "w", encoding="utf-8") as f:
        f.write(f"-- Undo for rekey_after_send_verification_ticks.py, generated {datetime.now():%Y-%m-%d %H:%M}\n")
        f.write("BEGIN;\n")
        for rid, old, _new in plan:
            f.write(f"UPDATE value_verifications SET target = '{old}' WHERE id = {rid};\n")
        f.write("COMMIT;\n")
    print("undo written:", undo_path)

    for rid, _old, new in plan:
        db.execute(text("UPDATE value_verifications SET target = :t WHERE id = :id"), {"t": new, "id": rid})
    db.commit()
    print(f"re-keyed {len(plan)} tick(s).")


if __name__ == "__main__":
    main()
