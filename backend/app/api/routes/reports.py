from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, TruckLoad, DieselFillUp, SupplierInvoice, SupplierInvoiceLineItem,
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

    # ── Truck load income grouped by statement period ─────────────────────────
    # Use statement_month/statement_year (user-set) not load_date so that a load
    # physically done in April but assigned to May's statement period appears in May.
    truck_rows = (
        db.query(
            TruckLoad.statement_month.label('m'),
            func.coalesce(func.sum(TruckLoad.amount_incl_vat), 0).label('incl'),
            func.coalesce(func.sum(TruckLoad.amount_excl_vat), 0).label('excl'),
        )
        .filter(
            TruckLoad.entity_id == entity_id,
            TruckLoad.statement_year == year,
            TruckLoad.statement_month.isnot(None),
            TruckLoad.is_archived != True,
        )
        .group_by(TruckLoad.statement_month)
        .all()
    )
    truck_income_incl = {int(r.m): float(r.incl) for r in truck_rows}
    truck_income_excl = {int(r.m): float(r.excl) for r in truck_rows}

    # ── Diesel expenses grouped by calendar month ──────────────────────────────
    diesel_rows = (
        db.query(
            func.extract('month', DieselFillUp.fillup_date).label('m'),
            func.coalesce(func.sum(DieselFillUp.total_amount), 0).label('amount'),
            func.coalesce(func.sum(DieselFillUp.admin_fee_vat), 0).label('vat'),
        )
        .filter(
            DieselFillUp.entity_id == entity_id,
            func.extract('year', DieselFillUp.fillup_date) == year,
            DieselFillUp.is_archived != True,
        )
        .group_by(func.extract('month', DieselFillUp.fillup_date))
        .all()
    )
    diesel_expense   = {int(float(r.m)): float(r.amount) for r in diesel_rows}
    diesel_input_vat = {int(float(r.m)): float(r.vat)    for r in diesel_rows}

    # ── Supplier invoice expenses grouped by statement month ───────────────────
    all_supplier_invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.entity_id == entity_id,
            SupplierInvoice.statement_year == year,
            SupplierInvoice.is_archived != True,
        )
        .all()
    )

    # Batch-fetch line-item excl-VAT sums to avoid N+1 queries
    inv_ids = [inv.id for inv in all_supplier_invoices]
    line_excl_by_inv: dict[int, float] = {}
    if inv_ids:
        li_rows = (
            db.query(
                SupplierInvoiceLineItem.invoice_id,
                func.coalesce(func.sum(SupplierInvoiceLineItem.amount_excl_vat), 0).label('excl'),
            )
            .filter(SupplierInvoiceLineItem.invoice_id.in_(inv_ids))
            .group_by(SupplierInvoiceLineItem.invoice_id)
            .all()
        )
        line_excl_by_inv = {r.invoice_id: float(r.excl) for r in li_rows}

    supplier_incl_by_month: dict[int, float] = {}
    supplier_excl_by_month: dict[int, float] = {}
    for inv in all_supplier_invoices:
        m = inv.statement_month
        if m is None:
            continue
        m = int(m)
        incl = float(inv.amount)
        if inv.id in line_excl_by_inv:
            excl = line_excl_by_inv[inv.id]
        elif inv.vat_applicable:
            excl = incl / 1.15
        else:
            excl = incl
        supplier_incl_by_month[m] = supplier_incl_by_month.get(m, 0.0) + incl
        supplier_excl_by_month[m] = supplier_excl_by_month.get(m, 0.0) + excl

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
        # VAT fields
        'income_incl_vat': 0, 'income_excl_vat': 0, 'output_vat': 0,
        'supplier_incl_vat': 0, 'supplier_excl_vat': 0,
        'diesel_input_vat': 0, 'input_vat': 0, 'vat_payable': 0,
    }

    for m in range(1, 13):
        income_incl = truck_income_incl.get(m, 0.0)
        income_excl = truck_income_excl.get(m, 0.0)
        output_vat  = income_incl - income_excl

        sup_incl    = supplier_incl_by_month.get(m, 0.0)
        sup_excl    = supplier_excl_by_month.get(m, 0.0)
        dsl_vat     = diesel_input_vat.get(m, 0.0)
        input_vat   = (sup_incl - sup_excl) + dsl_vat
        vat_payable = output_vat - input_vat

        diesel      = diesel_expense.get(m, 0.0)
        payroll     = payroll_expense.get(m, 0.0)

        total_income   = income_incl
        total_expenses = diesel + sup_incl + payroll
        net            = total_income - total_expenses

        months_data.append({
            'month':             m,
            'month_name':        MONTH_NAMES[m - 1],
            # legacy fields (unchanged)
            'truck_income':      round(income_incl, 2),
            'total_income':      round(total_income, 2),
            'diesel':            round(diesel, 2),
            'suppliers':         round(sup_incl, 2),
            'payroll':           round(payroll, 2),
            'total_expenses':    round(total_expenses, 2),
            'net':               round(net, 2),
            # VAT fields
            'income_incl_vat':   round(income_incl, 2),
            'income_excl_vat':   round(income_excl, 2),
            'output_vat':        round(output_vat, 2),
            'supplier_incl_vat': round(sup_incl, 2),
            'supplier_excl_vat': round(sup_excl, 2),
            'diesel_input_vat':  round(dsl_vat, 2),
            'input_vat':         round(input_vat, 2),
            'vat_payable':       round(vat_payable, 2),
        })

        for k, v in [
            ('truck_income', income_incl), ('total_income', total_income),
            ('diesel', diesel), ('suppliers', sup_incl), ('payroll', payroll),
            ('total_expenses', total_expenses), ('net', net),
            ('income_incl_vat', income_incl), ('income_excl_vat', income_excl),
            ('output_vat', output_vat),
            ('supplier_incl_vat', sup_incl), ('supplier_excl_vat', sup_excl),
            ('diesel_input_vat', dsl_vat), ('input_vat', input_vat),
            ('vat_payable', vat_payable),
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


def _build_month_detail(db, entity_id: int, year: int, month: int) -> dict:
    """Build per-invoice detail dict for one month (shared by single and annual endpoints)."""
    from collections import defaultdict

    loads = (
        db.query(TruckLoad)
        .filter(
            TruckLoad.entity_id == entity_id,
            TruckLoad.statement_year == year,
            TruckLoad.statement_month == month,
            TruckLoad.is_archived != True,
            TruckLoad.is_projection != True,
        )
        .order_by(TruckLoad.load_date)
        .all()
    )

    mine_groups: dict = defaultdict(lambda: {'mine_name': '', 'date': None, 'incl': 0.0, 'excl': 0.0})
    for load in loads:
        g = mine_groups[load.mine_id]
        g['mine_name'] = load.mine.name if load.mine else str(load.mine_id)
        d = load.load_date
        if g['date'] is None or d > g['date']:
            g['date'] = d
        g['incl'] += float(load.amount_incl_vat or 0)
        g['excl'] += float(load.amount_excl_vat or 0)

    output_invoices = sorted([
        {
            'date':        g['date'].strftime('%Y-%m-%d') if g['date'] else None,
            'description': g['mine_name'],
            'amount_incl': round(g['incl'], 2),
            'amount_excl': round(g['excl'], 2),
            'vat':         round(g['incl'] - g['excl'], 2),
        }
        for g in mine_groups.values()
    ], key=lambda x: x['date'] or '')

    sup_invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.entity_id == entity_id,
            SupplierInvoice.statement_year == year,
            SupplierInvoice.statement_month == month,
            SupplierInvoice.is_archived != True,
        )
        .order_by(SupplierInvoice.invoice_date)
        .all()
    )

    inv_ids = [inv.id for inv in sup_invoices]
    line_excl_by_inv: dict[int, float] = {}
    if inv_ids:
        li_rows = (
            db.query(
                SupplierInvoiceLineItem.invoice_id,
                func.coalesce(func.sum(SupplierInvoiceLineItem.amount_excl_vat), 0).label('excl'),
            )
            .filter(SupplierInvoiceLineItem.invoice_id.in_(inv_ids))
            .group_by(SupplierInvoiceLineItem.invoice_id)
            .all()
        )
        line_excl_by_inv = {r.invoice_id: float(r.excl) for r in li_rows}

    input_invoices = []
    for inv in sup_invoices:
        incl = float(inv.amount)
        if inv.id in line_excl_by_inv:
            excl = line_excl_by_inv[inv.id]
        elif inv.vat_applicable:
            excl = incl / 1.15
        else:
            excl = incl
        name = ''
        if inv.supplier_id and inv.supplier:
            name = inv.supplier.name
        elif inv.subcontractor_id and inv.subcontractor:
            name = inv.subcontractor.name
        input_invoices.append({
            'date':           inv.invoice_date.strftime('%Y-%m-%d') if inv.invoice_date else None,
            'invoice_number': inv.invoice_number or '',
            'supplier_name':  name,
            'description':    inv.description or name,
            'amount_incl':    round(incl, 2),
            'amount_excl':    round(excl, 2),
            'vat':            round(incl - excl, 2),
            'vat_applicable': inv.vat_applicable,
        })

    out_incl = sum(x['amount_incl'] for x in output_invoices)
    out_excl = sum(x['amount_excl'] for x in output_invoices)
    out_vat  = round(out_incl - out_excl, 2)
    in_incl  = sum(x['amount_incl'] for x in input_invoices)
    in_excl  = sum(x['amount_excl'] for x in input_invoices)
    in_vat   = round(in_incl - in_excl, 2)

    return {
        'month':           month,
        'month_name':      MONTH_NAMES[month - 1],
        'output_invoices': output_invoices,
        'input_invoices':  input_invoices,
        'output_totals':   {'amount_incl': round(out_incl, 2), 'amount_excl': round(out_excl, 2), 'vat': out_vat},
        'input_totals':    {'amount_incl': round(in_incl, 2),  'amount_excl': round(in_excl, 2),  'vat': in_vat},
        'vat_payable':     round(out_vat - in_vat, 2),
    }


@router.get("/sars-vat-detail")
def sars_vat_detail(
    entity_id: int = Query(...),
    year: int = Query(...),
    month: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(entity_id, current_user)
    detail = _build_month_detail(db, entity_id, year, month)
    return {'year': year, 'entity_id': entity_id, **detail}


@router.get("/sars-vat-detail-annual")
def sars_vat_detail_annual(
    entity_id: int = Query(...),
    year: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Full per-invoice breakdown for all 12 months — used for annual export."""
    _check_entity_access(entity_id, current_user)
    months = [_build_month_detail(db, entity_id, year, m) for m in range(1, 13)]
    return {'year': year, 'entity_id': entity_id, 'months': months}
