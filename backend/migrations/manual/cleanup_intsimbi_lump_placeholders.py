"""One-off cleanup for the pre-fix Intsimbi lump-placeholder duplicates.

Before the "replace by TransID" import fix, an Intsimbi statement import matched a
printed slip against a SINGLE existing fill-up. When the user had captured the slip
as one lump (litres = the printed-slip total) before the statement arrived, the
import created its own per-TransID fill-ups alongside the lump instead of replacing
it — so the slip's litres were counted roughly twice in costing.

This archives the leftover lump fill-up (and its single-line placeholder invoice)
for every Intsimbi printed slip that ALSO has at least one genuine per-TransID
fill-up to stand in its place. Slips with only lumps (never imported) or only real
transactions (nothing to clean) are left untouched.

DRY RUN by default — prints exactly what would change and writes nothing.
Pass --commit to apply. Safe to run repeatedly.

    python scripts/cleanup_intsimbi_lump_placeholders.py            # dry run
    python scripts/cleanup_intsimbi_lump_placeholders.py --commit   # apply

NOTE: backend/.env points at the LIVE prod Supabase — --commit writes to production.
"""
import sys
from collections import defaultdict

sys.path.insert(0, '.')

from app.db.database import SessionLocal
from app.models.models import DieselFillUp, Supplier
from app.api.routes.supplier_invoices import _norm_slip, _archive_orphaned_placeholder

SYSTEM_USER_ID = 1  # audit actor for the archive log entries


def main(commit: bool) -> None:
    db = SessionLocal()
    try:
        intsimbi_ids = [
            s.id for s in db.query(Supplier).filter(Supplier.name.ilike('%intsimbi%')).all()
        ]
        if not intsimbi_ids:
            print("No Intsimbi suppliers found.")
            return

        fillups = db.query(DieselFillUp).filter(
            DieselFillUp.supplier_id.in_(intsimbi_ids),
            DieselFillUp.is_archived != True,  # noqa: E712
            DieselFillUp.depot_slip_number.isnot(None),
            DieselFillUp.depot_slip_number != '',
        ).all()

        # Group by (entity, supplier, printed slip)
        groups = defaultdict(list)
        for f in fillups:
            groups[(f.entity_id, f.supplier_id, _norm_slip(f.depot_slip_number))].append(f)

        archived_fillups = 0
        archived_invoices = 0
        touched_groups = 0

        for (ent, sup, slip), fus in sorted(groups.items()):
            lumps = [f for f in fus if not _norm_slip(f.slip_number) or _norm_slip(f.slip_number) == slip]
            reals = [f for f in fus if _norm_slip(f.slip_number) and _norm_slip(f.slip_number) != slip]
            if not lumps or not reals:
                continue  # nothing to replace the lump with, or no lump at all

            touched_groups += 1
            lump_l = sum(float(f.litres or 0) for f in lumps)
            real_l = sum(float(f.litres or 0) for f in reals)
            print(f"ent {ent} slip {slip}: archive {len(lumps)} lump ({lump_l:.2f}L), "
                  f"keep {len(reals)} txn ({real_l:.2f}L)")

            for lump in lumps:
                old_inv_id = lump.supplier_invoice_id
                lump.is_archived = True
                archived_fillups += 1
                # Keep it linked to a real transaction's invoice so the placeholder
                # (if single-line) can be archived; reals share the same statement.
                new_inv_id = reals[0].supplier_invoice_id
                if _archive_orphaned_placeholder(db, old_inv_id, new_inv_id, SYSTEM_USER_ID, slip=slip):
                    archived_invoices += 1

        print(f"\nGroups cleaned: {touched_groups}")
        print(f"Lump fill-ups archived: {archived_fillups}")
        print(f"Placeholder invoices archived: {archived_invoices}")

        if commit:
            db.commit()
            print("\nCOMMITTED.")
        else:
            db.rollback()
            print("\nDRY RUN — nothing written. Re-run with --commit to apply.")
    finally:
        db.close()


if __name__ == '__main__':
    main(commit='--commit' in sys.argv)
