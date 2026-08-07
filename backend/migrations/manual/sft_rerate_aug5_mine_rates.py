"""One-off: re-rate SFT slips dated on/after 2026-08-05 to the mine rates the
user entered in Settings on 2026-08-07 (effective from the 5th).

The settings change only closed/opened MineRate rows — loads captured between
the 5th and the 7th kept their snapshotted old rate (OBHI was fixed by hand;
this does the same for SFT). Only loads still carrying the exact superseded
rate are touched, mirroring the new retro-apply logic in add_mine_rate:
hand-typed rates, paid, archived and projection loads are left alone.

Recomputes amount_excl/incl_vat (entity VAT) and, where a subcontractor admin
fee snapshot exists, the subcontractor_* payout fields (truck-owner VAT).

Writes sft_rerate_aug5_mine_rates_UNDO.sql before changing anything.
Run with DRY_RUN=1 to see the plan without writing.
"""
import os
from decimal import Decimal
from sqlalchemy import text
from app.db.database import engine

DRY_RUN = os.environ.get("DRY_RUN") == "1"
UNDO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "sft_rerate_aug5_mine_rates_UNDO.sql")
VAT = Decimal("1.15")

# (new open MineRate id, expected mine name, old rate, new rate)
CHANGES = [
    (68, "ASSMANG", Decimal("855.00"), Decimal("860.00")),
    (69, "MOKALA",  Decimal("858.00"), Decimal("865.00")),
]

undo_lines = ["-- UNDO for sft_rerate_aug5_mine_rates.py", "BEGIN;"]

with engine.begin() as conn:
    sft = conn.execute(text(
        "select id, vat_registered from business_entities where code = 'SFT'")).one()

    total = 0
    for rate_id, mine_name, old_rate, new_rate in CHANGES:
        nr = conn.execute(text("""
            select mr.mine_id, mr.entity_id, mr.rate_per_ton, mr.effective_from, m.name
            from mine_rates mr join mines m on m.id = mr.mine_id
            where mr.id = :i and mr.effective_to is null"""), {"i": rate_id}).one()
        assert nr.name == mine_name and nr.entity_id == sft.id, (rate_id, nr)
        assert Decimal(str(nr.rate_per_ton)) == new_rate, (rate_id, nr.rate_per_ton)

        loads = list(conn.execute(text("""
            select tl.id, tl.tonnes, tl.rate_per_ton, tl.amount_excl_vat, tl.amount_incl_vat,
                   tl.subcontractor_admin_fee_per_ton, tl.subcontractor_rate,
                   tl.subcontractor_amount_excl_vat, tl.subcontractor_amount_incl_vat,
                   tl.truck_id, t.entity_id as truck_entity_id
            from truck_loads tl join trucks t on t.id = tl.truck_id
            where tl.mine_id = :m and tl.entity_id = :e
              and tl.load_date >= :ef
              and tl.rate_per_ton = :old
              and tl.is_archived is not true
              and tl.is_projection is not true
              and tl.is_paid is not true
            order by tl.id
        """), {"m": nr.mine_id, "e": nr.entity_id, "ef": nr.effective_from, "old": old_rate}))

        for l in loads:
            undo_lines.append(
                "update truck_loads set "
                f"rate_per_ton = {l.rate_per_ton}, "
                f"amount_excl_vat = {l.amount_excl_vat if l.amount_excl_vat is not None else 'NULL'}, "
                f"amount_incl_vat = {l.amount_incl_vat if l.amount_incl_vat is not None else 'NULL'}, "
                f"subcontractor_rate = {l.subcontractor_rate if l.subcontractor_rate is not None else 'NULL'}, "
                f"subcontractor_amount_excl_vat = {l.subcontractor_amount_excl_vat if l.subcontractor_amount_excl_vat is not None else 'NULL'}, "
                f"subcontractor_amount_incl_vat = {l.subcontractor_amount_incl_vat if l.subcontractor_amount_incl_vat is not None else 'NULL'} "
                f"where id = {l.id};"
            )

            tonnes = Decimal(str(l.tonnes))
            excl = (tonnes * new_rate).quantize(Decimal("0.01"))
            incl = (excl * VAT).quantize(Decimal("0.01")) if sft.vat_registered else excl

            params = {"i": l.id, "r": new_rate, "ex": excl, "inc": incl}
            set_sub = ""
            if l.subcontractor_admin_fee_per_ton is not None:
                fee = Decimal(str(l.subcontractor_admin_fee_per_ton))
                sub_rate = (new_rate - fee).quantize(Decimal("0.01"))
                sub_excl = (tonnes * (new_rate - fee)).quantize(Decimal("0.01"))
                sub_vat_reg = True
                if l.truck_entity_id:
                    te = conn.execute(text(
                        "select vat_registered from business_entities where id = :i"),
                        {"i": l.truck_entity_id}).first()
                    sub_vat_reg = te.vat_registered if te else True
                sub_incl = (sub_excl * VAT).quantize(Decimal("0.01")) if sub_vat_reg else sub_excl
                set_sub = (", subcontractor_rate = :sr, subcontractor_amount_excl_vat = :sex, "
                           "subcontractor_amount_incl_vat = :sinc")
                params.update({"sr": sub_rate, "sex": sub_excl, "sinc": sub_incl})

            print(f"  load#{l.id} {mine_name}: R{l.rate_per_ton} -> R{new_rate}, "
                  f"excl {l.amount_excl_vat} -> {excl}"
                  + (f", sub_excl -> {params.get('sex')}" if set_sub else ""))
            if not DRY_RUN:
                conn.execute(text(
                    "update truck_loads set rate_per_ton = :r, amount_excl_vat = :ex, "
                    "amount_incl_vat = :inc" + set_sub + " where id = :i"), params)
            total += 1

    undo_lines.append("COMMIT;")
    if DRY_RUN:
        print(f"\nDRY RUN — {total} load(s) would be updated, nothing written.")
        raise SystemExit(0)

    # Write the undo BEFORE the transaction commits — a failed write rolls back.
    with open(UNDO_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(undo_lines) + "\n")

print(f"\nUpdated {total} load(s). UNDO written to {UNDO_PATH}")
