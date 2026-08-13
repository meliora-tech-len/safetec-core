"""One-off data fix (2026-08-13, requested by the user in Afrikaans):

Supplier invoice INV1468541 (id 3388, OBHI / Wbg Diesel, dated 2026-07-31) has a
single line — 300 L on KTS596EC, R7 740.00 excl — captured on 2026-08-05 WITHOUT
a slip number. Slip-less line fill-up creation only shipped on 2026-08-06
(commit 2d7f03c), so the line never created its DieselFillUp and the diesel
never showed on the truck's Diesel tab. Nothing re-runs creation after the fact.

This inserts the exact fill-up _maybe_create_line_fillup would have created,
using the app's own helpers for the math, and logs the same
diesel_fillup.auto_created audit action.

Writes obhi_inv1468541_missing_fillup_undo.sql BEFORE committing.
Run from backend/:  venv/Scripts/python.exe migrations/manual/obhi_inv1468541_missing_fillup.py
"""
import sys
from decimal import Decimal
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv
load_dotenv(BACKEND / ".env")

from app.db.database import SessionLocal
from app.models.models import DieselFillUp, Supplier, SupplierInvoice, SupplierInvoiceLineItem, Truck
from app.services.audit import log_action
from app.services.diesel_service import DieselCalculationService, diesel_type_for_supplier

INVOICE_ID = 3388
LINE_ID = 7652
CREATED_BY = 4  # user who captured the invoice line (audit log 33184)
UNDO_PATH = Path(__file__).with_name("obhi_inv1468541_missing_fillup_undo.sql")


def main():
    db = SessionLocal()
    try:
        inv = db.query(SupplierInvoice).filter(SupplierInvoice.id == INVOICE_ID).first()
        li = db.query(SupplierInvoiceLineItem).filter(SupplierInvoiceLineItem.id == LINE_ID).first()
        assert inv and inv.invoice_number == "INV1468541" and inv.entity_id == 2, "invoice mismatch"
        assert li and li.invoice_id == INVOICE_ID, "line mismatch"
        assert (li.item_code or "").strip() == "", "line unexpectedly has a slip — use the normal path"

        existing = db.query(DieselFillUp).filter(
            DieselFillUp.supplier_invoice_id == INVOICE_ID,
            DieselFillUp.is_archived != True,  # noqa: E712 — SQL boolean
        ).count()
        if existing:
            print(f"Invoice {INVOICE_ID} already has {existing} fill-up(s) — nothing to do.")
            return

        supplier = db.query(Supplier).filter(Supplier.id == inv.supplier_id).first()
        truck = db.query(Truck).filter(Truck.entity_id == inv.entity_id,
                                       Truck.registration == (li.unit or "").strip()).first()
        assert supplier and supplier.is_diesel_supplier, "not a diesel supplier"
        assert truck, "truck not found"

        inv_date = inv.invoice_date.date() if hasattr(inv.invoice_date, "date") else inv.invoice_date
        fillup_date = li.line_date or inv_date
        litres_d = Decimal(str(li.quantity))
        excl_d = Decimal(str(li.amount_excl_vat))
        rate_d = (excl_d / litres_d).quantize(Decimal("0.0001"))

        settings = DieselCalculationService.get_diesel_settings(db, inv.entity_id)
        admin_fee_pct = Decimal(str(settings.admin_fee_pct)) if settings else Decimal("0")
        apply_admin_fee = settings.apply_admin_fee if settings else False
        amounts = DieselCalculationService.calculate_fillup_amounts(
            litres=litres_d,
            rate_per_litre=rate_d,
            admin_fee_pct=admin_fee_pct,
            apply_admin_fee=apply_admin_fee,
        )

        fillup = DieselFillUp(
            entity_id=inv.entity_id,
            truck_id=truck.id,
            supplier_id=supplier.id,
            fillup_date=fillup_date,
            litres=litres_d,
            rate_per_litre=rate_d,
            invoice_number=inv.invoice_number,
            slip_number=None,
            depot_slip_number=None,
            supplier_invoice_id=inv.id,
            admin_fee_pct=admin_fee_pct,
            diesel_type=diesel_type_for_supplier(supplier),
            created_by=CREATED_BY,
            **amounts,
        )
        db.add(fillup)
        db.flush()
        log_action(
            db, "diesel_fillup.auto_created", user_id=CREATED_BY,
            entity_id=inv.entity_id, resource_type="diesel_fillup",
            description=(
                f"Auto-created diesel fill-up from invoice {inv.invoice_number} line "
                f"for {truck.registration} ({litres_d}L, no slip) "
                f"[backfilled 2026-08-13: line predates slip-less creation]"
            ),
        )
        UNDO_PATH.write_text(
            "-- UNDO for obhi_inv1468541_missing_fillup.py (run 2026-08-13)\n"
            f"DELETE FROM diesel_fillups WHERE id = {fillup.id};\n",
            encoding="utf-8",
        )
        db.commit()
        print(f"Created fill-up #{fillup.id}: {litres_d}L @ R{rate_d} on {fillup_date} "
              f"for {truck.registration}, total R{amounts['total_amount']} "
              f"(fuel R{amounts['amount']} + fee R{amounts['admin_fee_amount']} + fee VAT R{amounts['admin_fee_vat']})")
        print(f"Undo written to {UNDO_PATH.name}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
