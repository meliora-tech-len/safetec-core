from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.models.models import (
    DieselRate, DieselFillUp, DieselSettings, Supplier, SupplierInvoice, Truck,
)


TWO_DP = Decimal("0.01")
FOUR_DP = Decimal("0.0001")


def diesel_type_for_supplier(supplier: Optional[Supplier]) -> str:
    """Fixed per-supplier diesel tag: Merino & Oukop fills are always 'topup';
    everything else (e.g. WBG Diesel) is 'fillup'. Single source of truth so all
    fill-up creation paths tag consistently."""
    if not supplier:
        return "fillup"
    name = f"{supplier.name or ''} {supplier.short_name or ''}".lower()
    if "merino" in name or "oukop" in name:
        return "topup"
    return "fillup"


def supplier_bills_own_admin_fee(name) -> bool:
    """Intsimbi bills its admin fee on its own statement, so that fee's VAT is
    genuine supplier input VAT — unlike the internal 1% markup every other diesel
    supplier's fill-ups carry, whose VAT is ours and must not be claimed.
    Single source of truth for the Intsimbi name match."""
    return "intsimbi" in (name or "").lower()


def fillup_effective_period():
    """(year, month) expressions for the period a fill-up counts under.

    A fill-up belongs to the STATEMENT period of its linked supplier invoice —
    the statement it was captured on — and only falls back to its own slip date
    when it has no linked invoice. That way a June statement line typed as 15/03
    still counts in June, which is how the Diesel module, costing and the
    subcontractor report all read it.

    The query must be outer-joined to SupplierInvoice on
    ``DieselFillUp.supplier_invoice_id`` for these to resolve.
    """
    eff_year = func.coalesce(
        SupplierInvoice.statement_year, func.extract("year", DieselFillUp.fillup_date)
    )
    eff_month = func.coalesce(
        SupplierInvoice.statement_month, func.extract("month", DieselFillUp.fillup_date)
    )
    return eff_year, eff_month


def apply_fillup_period(q, year: Optional[int] = None, month: Optional[int] = None,
                        include_archived: bool = False):
    """Scope a DieselFillUp query to a period and drop archived fill-ups.

    Single source of truth for "which fill-ups make up this month" — archived
    rows are superseded placeholders and re-linked duplicates, so counting them
    double-books their value.
    """
    if not include_archived:
        q = q.filter(DieselFillUp.is_archived != True)  # noqa: E712 — SQL boolean
    if not (year or month):
        return q
    q = q.outerjoin(SupplierInvoice, SupplierInvoice.id == DieselFillUp.supplier_invoice_id)
    eff_year, eff_month = fillup_effective_period()
    if year:
        q = q.filter(eff_year == year)
    if month:
        q = q.filter(eff_month == month)
    return q


class DieselCalculationService:

    @staticmethod
    def get_active_rate(
        db: Session,
        supplier_id: int,
        entity_id: int,
        on_date: date,
    ) -> Optional[DieselRate]:
        """Return the most recent active DieselRate for supplier/entity on or before on_date."""
        return (
            db.query(DieselRate)
            .filter(
                DieselRate.supplier_id == supplier_id,
                DieselRate.entity_id == entity_id,
                DieselRate.effective_date <= on_date,
                and_(
                    DieselRate.is_active == True,
                    (DieselRate.effective_to == None) | (DieselRate.effective_to >= on_date),
                ),
            )
            .order_by(DieselRate.effective_date.desc(), DieselRate.id.desc())
            .first()
        )

    @staticmethod
    def calculate_fillup_amounts(
        litres: Decimal,
        rate_per_litre: Decimal,
        admin_fee_pct: Decimal,
        apply_admin_fee: bool,
        vat_rate: Decimal = Decimal("0.15"),
        amount: Optional[Decimal] = None,
    ) -> dict:
        """
        Compute amount, admin_fee_amount (excl VAT), admin_fee_vat, and total_amount.
        All values are rounded to 2 decimal places.

        Pass `amount` to use a hand-entered fuel amount instead of litres × rate.
        The statement is the authority on the rand value, and litres × rate can
        only land within a cent of it once the rate is rounded to 4dp — so when the
        user types the amount off the invoice, that exact figure is kept and the
        fee/VAT/total are built on it.
        """
        litres = Decimal(str(litres))
        rate_per_litre = Decimal(str(rate_per_litre))
        admin_fee_pct = Decimal(str(admin_fee_pct))
        vat_rate = Decimal(str(vat_rate))

        amount = (
            Decimal(str(amount)) if amount is not None else litres * rate_per_litre
        ).quantize(TWO_DP, rounding=ROUND_HALF_UP)

        if apply_admin_fee and admin_fee_pct > 0:
            admin_fee_amount = (amount * admin_fee_pct).quantize(TWO_DP, rounding=ROUND_HALF_UP)
            admin_fee_vat = (admin_fee_amount * vat_rate).quantize(TWO_DP, rounding=ROUND_HALF_UP)
        else:
            admin_fee_amount = Decimal("0.00")
            admin_fee_vat = Decimal("0.00")

        total_amount = (amount + admin_fee_amount + admin_fee_vat).quantize(TWO_DP, rounding=ROUND_HALF_UP)

        return {
            "amount": amount,
            "admin_fee_amount": admin_fee_amount,
            "admin_fee_vat": admin_fee_vat,
            "total_amount": total_amount,
        }

    @staticmethod
    def get_diesel_settings(db: Session, entity_id: int) -> Optional[DieselSettings]:
        """Return diesel settings for an entity (or None if not configured)."""
        return db.query(DieselSettings).filter(DieselSettings.entity_id == entity_id).first()

    @staticmethod
    def get_diesel_cost_per_load(db: Session, truckload_id: int) -> Decimal:
        """Sum total_amount of all fill-ups linked to a specific truckload_id."""
        result = (
            db.query(func.coalesce(func.sum(DieselFillUp.total_amount), 0))
            .filter(DieselFillUp.truckload_id == truckload_id)
            .scalar()
        )
        return Decimal(str(result)).quantize(TWO_DP)

    @staticmethod
    def get_monthly_summary_by_truck(
        db: Session,
        entity_id: int,
        year: int,
        month: int,
    ) -> list:
        """Per-truck monthly diesel summary, scoped by statement period."""
        q = (
            db.query(
                Truck.registration.label("truck_reg"),
                func.count(DieselFillUp.id).label("fillup_count"),
                func.coalesce(func.sum(DieselFillUp.litres), 0).label("total_litres"),
                func.coalesce(func.sum(DieselFillUp.amount), 0).label("total_amount"),
                func.coalesce(func.sum(DieselFillUp.admin_fee_amount), 0).label("total_admin_fee"),
                func.coalesce(func.sum(DieselFillUp.admin_fee_vat), 0).label("total_admin_fee_vat"),
                func.coalesce(func.sum(DieselFillUp.total_amount), 0).label("grand_total"),
            )
            .join(Truck, DieselFillUp.truck_id == Truck.id)
            .filter(DieselFillUp.entity_id == entity_id)
        )
        rows = (
            apply_fillup_period(q, year, month)
            .group_by(Truck.id, Truck.registration)
            .order_by(Truck.registration)
            .all()
        )
        return [
            {
                "truck_reg": r.truck_reg,
                "fillup_count": r.fillup_count,
                "total_litres": Decimal(str(r.total_litres)).quantize(TWO_DP),
                "total_amount": Decimal(str(r.total_amount)).quantize(TWO_DP),
                "total_admin_fee": Decimal(str(r.total_admin_fee)).quantize(TWO_DP),
                "total_admin_fee_vat": Decimal(str(r.total_admin_fee_vat)).quantize(TWO_DP),
                "grand_total": Decimal(str(r.grand_total)).quantize(TWO_DP),
            }
            for r in rows
        ]

    @staticmethod
    def get_supplier_reconciliation(
        db: Session,
        entity_id: int,
        year: int,
        month: int,
    ) -> list:
        """Per-supplier diesel totals for a month, with the fill-ups behind them.

        Same period rule and archived exclusion as `apply_fillup_period`, spelt
        out here because the query already outer-joins SupplierInvoice for the
        statement columns. Every line making up each total is returned so the
        report can be drilled into and reconciled against the statement.
        """
        eff_year, eff_month = fillup_effective_period()
        rows = (
            db.query(
                DieselFillUp,
                Supplier.id.label("supplier_id"),
                Supplier.name.label("supplier_name"),
                Truck.registration.label("truck_registration"),
                SupplierInvoice.invoice_number.label("statement_invoice_number"),
                SupplierInvoice.statement_month.label("statement_month"),
                SupplierInvoice.statement_year.label("statement_year"),
            )
            .join(Supplier, DieselFillUp.supplier_id == Supplier.id)
            .outerjoin(Truck, DieselFillUp.truck_id == Truck.id)
            .outerjoin(SupplierInvoice, SupplierInvoice.id == DieselFillUp.supplier_invoice_id)
            .filter(
                DieselFillUp.entity_id == entity_id,
                DieselFillUp.is_archived != True,
                eff_year == year,
                eff_month == month,
            )
            .order_by(Supplier.name, DieselFillUp.fillup_date, DieselFillUp.id)
            .all()
        )

        groups: dict = {}
        for f, supplier_id, supplier_name, truck_reg, stmt_inv_no, stmt_m, stmt_y in rows:
            g = groups.get(supplier_id)
            if g is None:
                g = groups[supplier_id] = {
                    "supplier_id": supplier_id,
                    "supplier_name": supplier_name,
                    "fillup_count": 0,
                    "total_litres": Decimal("0"),
                    "total_amount": Decimal("0"),
                    "total_admin_fee": Decimal("0"),
                    "total_admin_fee_vat": Decimal("0"),
                    "grand_total": Decimal("0"),
                    "verified_amount": Decimal("0"),
                    "unverified_amount": Decimal("0"),
                    "fillups": [],
                }

            litres = Decimal(str(f.litres or 0))
            amount = Decimal(str(f.amount or 0))
            fee = Decimal(str(f.admin_fee_amount or 0))
            fee_vat = Decimal(str(f.admin_fee_vat or 0))
            total = Decimal(str(f.total_amount or 0))

            g["fillup_count"] += 1
            g["total_litres"] += litres
            g["total_amount"] += amount
            g["total_admin_fee"] += fee
            g["total_admin_fee_vat"] += fee_vat
            g["grand_total"] += total
            if f.verified:
                g["verified_amount"] += total
            else:
                g["unverified_amount"] += total

            g["fillups"].append({
                "id": f.id,
                "fillup_date": f.fillup_date,
                "truck_registration": truck_reg,
                "slip_number": f.depot_slip_number or f.slip_number,
                "trans_id": f.slip_number,
                "invoice_number": stmt_inv_no or f.invoice_number,
                "supplier_invoice_id": f.supplier_invoice_id,
                "statement_month": stmt_m,
                "statement_year": stmt_y,
                "diesel_type": f.diesel_type,
                "litres": litres.quantize(TWO_DP),
                "rate_per_litre": Decimal(str(f.rate_per_litre or 0)).quantize(FOUR_DP),
                "amount": amount.quantize(TWO_DP),
                "admin_fee_amount": fee.quantize(TWO_DP),
                "admin_fee_vat": fee_vat.quantize(TWO_DP),
                "total_amount": total.quantize(TWO_DP),
                "verified": bool(f.verified),
                "rate_pending": bool(f.rate_pending),
            })

        result = []
        for g in sorted(groups.values(), key=lambda x: (x["supplier_name"] or "").lower()):
            for k in (
                "total_litres", "total_amount", "total_admin_fee", "total_admin_fee_vat",
                "grand_total", "verified_amount", "unverified_amount",
            ):
                g[k] = g[k].quantize(TWO_DP)
            result.append(g)
        return result

    @staticmethod
    def get_annual_summary(db: Session, entity_id: int, year: int) -> list:
        """Monthly totals for an entire year.

        Each month is the sum of that month's Diesel by Truck / by Supplier
        report, so the three tabs reconcile: same statement-period rule, same
        exclusion of archived fill-ups.
        """
        _, eff_month = fillup_effective_period()
        q = (
            db.query(
                eff_month.label("month"),
                func.count(DieselFillUp.id).label("fillup_count"),
                func.coalesce(func.sum(DieselFillUp.litres), 0).label("total_litres"),
                func.coalesce(func.sum(DieselFillUp.amount), 0).label("total_amount"),
                func.coalesce(func.sum(DieselFillUp.admin_fee_amount), 0).label("total_admin_fee"),
                func.coalesce(func.sum(DieselFillUp.admin_fee_vat), 0).label("total_admin_fee_vat"),
                func.coalesce(func.sum(DieselFillUp.total_amount), 0).label("grand_total"),
            )
            .filter(DieselFillUp.entity_id == entity_id)
        )
        rows = (
            apply_fillup_period(q, year)
            .group_by(eff_month)
            .order_by(eff_month)
            .all()
        )
        return [
            {
                "month": int(r.month),
                "fillup_count": r.fillup_count,
                "total_litres": Decimal(str(r.total_litres)).quantize(TWO_DP),
                "total_amount": Decimal(str(r.total_amount)).quantize(TWO_DP),
                "total_admin_fee": Decimal(str(r.total_admin_fee)).quantize(TWO_DP),
                "total_admin_fee_vat": Decimal(str(r.total_admin_fee_vat)).quantize(TWO_DP),
                "grand_total": Decimal(str(r.grand_total)).quantize(TWO_DP),
            }
            for r in rows
        ]
