from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.models.models import DieselRate, DieselFillUp, DieselSettings, Supplier, Truck


TWO_DP = Decimal("0.01")
FOUR_DP = Decimal("0.0001")


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
                DieselRate.is_active == True,
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
    ) -> dict:
        """
        Compute amount, admin_fee_amount, and total_amount.
        All values are rounded to 2 decimal places.
        """
        litres = Decimal(str(litres))
        rate_per_litre = Decimal(str(rate_per_litre))
        admin_fee_pct = Decimal(str(admin_fee_pct))

        amount = (litres * rate_per_litre).quantize(TWO_DP, rounding=ROUND_HALF_UP)

        if apply_admin_fee and admin_fee_pct > 0:
            admin_fee_amount = (amount * (admin_fee_pct / Decimal("100"))).quantize(TWO_DP, rounding=ROUND_HALF_UP)
        else:
            admin_fee_amount = Decimal("0.00")

        total_amount = (amount + admin_fee_amount).quantize(TWO_DP, rounding=ROUND_HALF_UP)

        return {
            "amount": amount,
            "admin_fee_amount": admin_fee_amount,
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
        """Per-truck monthly diesel summary."""
        rows = (
            db.query(
                Truck.registration.label("truck_reg"),
                func.count(DieselFillUp.id).label("fillup_count"),
                func.coalesce(func.sum(DieselFillUp.litres), 0).label("total_litres"),
                func.coalesce(func.sum(DieselFillUp.amount), 0).label("total_amount"),
                func.coalesce(func.sum(DieselFillUp.admin_fee_amount), 0).label("total_admin_fee"),
                func.coalesce(func.sum(DieselFillUp.total_amount), 0).label("grand_total"),
            )
            .join(Truck, DieselFillUp.truck_id == Truck.id)
            .filter(
                DieselFillUp.entity_id == entity_id,
                func.extract("year", DieselFillUp.fillup_date) == year,
                func.extract("month", DieselFillUp.fillup_date) == month,
            )
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
        """Supplier reconciliation totals for a given month."""
        rows = (
            db.query(
                Supplier.name.label("supplier_name"),
                func.count(DieselFillUp.id).label("fillup_count"),
                func.coalesce(func.sum(DieselFillUp.litres), 0).label("total_litres"),
                func.coalesce(func.sum(DieselFillUp.total_amount), 0).label("total_amount"),
                func.coalesce(
                    func.sum(DieselFillUp.total_amount).filter(DieselFillUp.verified == True), 0
                ).label("verified_amount"),
                func.coalesce(
                    func.sum(DieselFillUp.total_amount).filter(DieselFillUp.verified == False), 0
                ).label("unverified_amount"),
            )
            .join(Supplier, DieselFillUp.supplier_id == Supplier.id)
            .filter(
                DieselFillUp.entity_id == entity_id,
                func.extract("year", DieselFillUp.fillup_date) == year,
                func.extract("month", DieselFillUp.fillup_date) == month,
            )
            .group_by(Supplier.id, Supplier.name)
            .order_by(Supplier.name)
            .all()
        )
        return [
            {
                "supplier_name": r.supplier_name,
                "fillup_count": r.fillup_count,
                "total_litres": Decimal(str(r.total_litres)).quantize(TWO_DP),
                "total_amount": Decimal(str(r.total_amount)).quantize(TWO_DP),
                "verified_amount": Decimal(str(r.verified_amount)).quantize(TWO_DP),
                "unverified_amount": Decimal(str(r.unverified_amount)).quantize(TWO_DP),
            }
            for r in rows
        ]

    @staticmethod
    def get_annual_summary(db: Session, entity_id: int, year: int) -> list:
        """Monthly totals for an entire year."""
        rows = (
            db.query(
                func.extract("month", DieselFillUp.fillup_date).label("month"),
                func.count(DieselFillUp.id).label("fillup_count"),
                func.coalesce(func.sum(DieselFillUp.litres), 0).label("total_litres"),
                func.coalesce(func.sum(DieselFillUp.amount), 0).label("total_amount"),
                func.coalesce(func.sum(DieselFillUp.admin_fee_amount), 0).label("total_admin_fee"),
                func.coalesce(func.sum(DieselFillUp.total_amount), 0).label("grand_total"),
            )
            .filter(
                DieselFillUp.entity_id == entity_id,
                func.extract("year", DieselFillUp.fillup_date) == year,
            )
            .group_by(func.extract("month", DieselFillUp.fillup_date))
            .order_by(func.extract("month", DieselFillUp.fillup_date))
            .all()
        )
        return [
            {
                "month": int(r.month),
                "fillup_count": r.fillup_count,
                "total_litres": Decimal(str(r.total_litres)).quantize(TWO_DP),
                "total_amount": Decimal(str(r.total_amount)).quantize(TWO_DP),
                "total_admin_fee": Decimal(str(r.total_admin_fee)).quantize(TWO_DP),
                "grand_total": Decimal(str(r.grand_total)).quantize(TWO_DP),
            }
            for r in rows
        ]
