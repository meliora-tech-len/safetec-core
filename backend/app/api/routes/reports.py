from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, TruckLoad, DieselFillUp, SupplierInvoice,
    DriverPayCycle, Driver, PayrollSettings, PayrollEntry,
)
from app.services.payroll_calculator import calculate_pay_cycle

router = APIRouter(prefix="/api/reports", tags=["reports"])

MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


@router.get("/income-expenses")
def income_expenses_report(
    entity_id: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Annual income vs expenses breakdown by month for a given entity and year.

    Income  : Truck load revenue (incl. VAT)
    Expenses: Diesel fill-ups + Supplier invoices + Driver payroll (gross)

    Payroll source priority:
      1. PayrollEntry rows (finalized payroll) — used when available.
      2. DriverPayCycle rows (in-progress) — used for months without finalized entries,
         calculated via the payroll calculator so results are always up-to-date.
    """
    _check_entity_access(entity_id, current_user)

    # ── Truck load income grouped by calendar month ────────────────────────────
    truck_rows = (
        db.query(
            func.extract('month', TruckLoad.load_date).label('m'),
            func.coalesce(func.sum(TruckLoad.amount_incl_vat), 0).label('amount'),
        )
        .filter(
            TruckLoad.entity_id == entity_id,
            func.extract('year', TruckLoad.load_date) == year,
        )
        .group_by(func.extract('month', TruckLoad.load_date))
        .all()
    )
    truck_income = {int(float(r.m)): float(r.amount) for r in truck_rows}

    # ── Diesel expenses grouped by calendar month ──────────────────────────────
    diesel_rows = (
        db.query(
            func.extract('month', DieselFillUp.fillup_date).label('m'),
            func.coalesce(func.sum(DieselFillUp.total_amount), 0).label('amount'),
        )
        .filter(
            DieselFillUp.entity_id == entity_id,
            func.extract('year', DieselFillUp.fillup_date) == year,
        )
        .group_by(func.extract('month', DieselFillUp.fillup_date))
        .all()
    )
    diesel_expense = {int(float(r.m)): float(r.amount) for r in diesel_rows}

    # ── Supplier invoice expenses grouped by statement month ───────────────────
    # statement_month/year already reflect payment-term costing allocation
    # (set at invoice creation: days_30 → invoice month, cash → previous month)
    supplier_rows = (
        db.query(
            SupplierInvoice.statement_month.label('m'),
            func.coalesce(func.sum(SupplierInvoice.amount), 0).label('amount'),
        )
        .filter(
            SupplierInvoice.entity_id == entity_id,
            SupplierInvoice.statement_year == year,
            SupplierInvoice.is_archived != True,
        )
        .group_by(SupplierInvoice.statement_month)
        .all()
    )
    supplier_expense = {int(r.m): float(r.amount) for r in supplier_rows if r.m is not None}

    # ── Payroll: prefer finalized PayrollEntry, fall back to DriverPayCycle ────

    # Source 1: finalized PayrollEntry rows
    entry_rows = (
        db.query(
            PayrollEntry.pay_month,
            func.coalesce(func.sum(PayrollEntry.gross), 0).label('amount'),
        )
        .filter(
            PayrollEntry.entity_id == entity_id,
            PayrollEntry.pay_year == year,
        )
        .group_by(PayrollEntry.pay_month)
        .all()
    )
    payroll_from_entries = {int(r.pay_month): float(r.amount) for r in entry_rows}

    # Source 2: DriverPayCycle (in-progress) for months not covered by PayrollEntry
    cycle_rows = (
        db.query(DriverPayCycle, Driver, PayrollSettings)
        .join(Driver, DriverPayCycle.driver_id == Driver.id)
        .outerjoin(PayrollSettings, DriverPayCycle.payroll_settings_id == PayrollSettings.id)
        .filter(
            Driver.entity_id == entity_id,
            DriverPayCycle.pay_year == year,
        )
        .all()
    )
    default_settings = db.query(PayrollSettings).order_by(PayrollSettings.id.desc()).first()

    payroll_from_cycles: dict[int, float] = {}
    for cycle, driver, settings in cycle_rows:
        m = int(cycle.pay_month)
        if m in payroll_from_entries:
            continue  # already covered by finalized entry
        effective = settings or default_settings
        if not effective:
            continue
        driver_type = driver.driver_type.value if driver.driver_type else 'permanent'
        try:
            calc = calculate_pay_cycle(cycle, effective, driver_type)
            payroll_from_cycles[m] = payroll_from_cycles.get(m, 0.0) + float(calc['gross'])
        except Exception:
            pass

    payroll_expense = {**payroll_from_cycles, **payroll_from_entries}

    # ── Build monthly rows ─────────────────────────────────────────────────────
    months_data = []
    totals: dict[str, float] = {
        'truck_income': 0, 'total_income': 0,
        'diesel': 0, 'suppliers': 0, 'payroll': 0, 'total_expenses': 0,
        'net': 0,
    }

    for m in range(1, 13):
        truck    = truck_income.get(m, 0.0)
        diesel   = diesel_expense.get(m, 0.0)
        suppliers = supplier_expense.get(m, 0.0)
        payroll  = payroll_expense.get(m, 0.0)

        total_income   = truck
        total_expenses = diesel + suppliers + payroll
        net            = total_income - total_expenses

        months_data.append({
            'month':          m,
            'month_name':     MONTH_NAMES[m - 1],
            'truck_income':   round(truck, 2),
            'total_income':   round(total_income, 2),
            'diesel':         round(diesel, 2),
            'suppliers':      round(suppliers, 2),
            'payroll':        round(payroll, 2),
            'total_expenses': round(total_expenses, 2),
            'net':            round(net, 2),
        })

        for k, v in [
            ('truck_income', truck), ('total_income', total_income),
            ('diesel', diesel), ('suppliers', suppliers), ('payroll', payroll),
            ('total_expenses', total_expenses), ('net', net),
        ]:
            totals[k] += v

    for k in totals:
        totals[k] = round(totals[k], 2)

    return {
        'year':               year,
        'entity_id':          entity_id,
        'months':             months_data,
        'totals':             totals,
        'has_payroll_entries': bool(payroll_from_entries),
    }
