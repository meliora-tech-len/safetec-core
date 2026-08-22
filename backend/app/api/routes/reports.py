import re
from datetime import date as date_cls
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, and_
from typing import Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, TruckLoad, DieselFillUp, SupplierInvoice, SupplierInvoiceLineItem,
    DriverPayCycle, Driver, PayrollSettings, PayrollEntry, Supplier, PaymentTermType,
    Invoice, InvoiceLineItem, Customer, DocumentType, InvoiceStatus, BusinessEntity,
    Truck, Subcontractor, ReportExclusion, TruckMonthlyExpenses, ProfitSheetReportRow,
    ProfitSheetLock,
)
from app.services.audit import log_action
from app.services.diesel_service import apply_fillup_period, supplier_bills_own_admin_fee
from app.services.vat import entity_vat_rate
from app.services.profit_sheet_lock import (
    get_profit_sheet_lock, profit_sheet_lock_detail,
)
from app.schemas.schemas import (
    ReportExclusionCreate, ProfitSheetReportSave, ProfitSheetReportOut,
    ProfitSheetReportRowOut, ProfitSheetReportAuto, ProfitSheetReportOverrides,
    ProfitSheetLockOut, ProfitSheetLockSet,
)
from app.services.payroll_calculator import calculate_pay_cycle

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _intercompany_tokens(db: Session, entity_id: int) -> set:
    """Upper-case tokens identifying OTHER group entities (codes + name words ≥4),
    used to auto-detect intercompany customers/suppliers by name on the VAT report."""
    tokens: set = set()
    for e in db.query(BusinessEntity).filter(BusinessEntity.id != entity_id).all():
        if e.code and len(e.code) >= 4:
            tokens.add(e.code.upper())
        for w in (e.name or '').upper().replace('(', ' ').replace(')', ' ').split():
            if len(w) >= 4 and w not in ('PTY', 'LTD'):
                tokens.add(w)
    return tokens


def _name_is_intercompany(name: str, tokens: set) -> bool:
    up = (name or '').upper()
    return any(t in up for t in tokens)


# ── Report-only supplier-invoice adjustments ───────────────────────────────────
# These reclassify a few specific suppliers for the Income vs Expenses / SARS VAT
# report ONLY. They do not change stored data or any other module.
def _supplier_name(inv) -> str:
    return (inv.supplier.name if (inv.supplier_id and inv.supplier) else '') or ''


def _is_sasfin_supplier(inv) -> bool:
    """Sasfin supplier invoices are excluded from the report entirely."""
    return 'sasfin' in _supplier_name(inv).lower()


def _is_crack_logic_insurance(inv) -> bool:
    """Crack Logic 'Insurance Claim' invoices are counted as income, not expense."""
    return ('crack logic' in _supplier_name(inv).lower()
            and 'insurance claim' in (inv.description or '').lower())


def _is_general_expense(inv) -> bool:
    """Free-text 'general' expenses added in the costing module: no registered
    supplier and no invoice number (the invoiced capture mode always requires an
    invoice number). These are internal costing allocations, not SARS-deductible
    supplier invoices, so the Income vs Expenses / SARS report excludes them for
    OBHI (see _exclude_general_expenses)."""
    return inv.supplier_id is None and not (inv.invoice_number or '').strip()


def _exclude_general_expenses(db: Session, entity_id: int) -> bool:
    """General costing expenses are dropped from the report for OBHI only;
    every other entity keeps counting them as before."""
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    return bool(entity and (entity.code or '').upper() == 'OBHI')


def _is_trailer_maintenance_supplier(inv) -> bool:
    """OBHI's 'TRAILER MAINTENANCE' supplier is an internal costing allocation,
    not a SARS-deductible supplier expense, so it's excluded from the report."""
    return 'trailer maintenance' in _supplier_name(inv).lower()


def _excluded_ids(db: Session, entity_id: int, record_type: str) -> set:
    """Record ids the user has dropped from this report (see ReportExclusion).

    Report-only: the records still exist and every other module still counts them.
    """
    return {
        r[0] for r in db.query(ReportExclusion.record_id).filter(
            ReportExclusion.entity_id == entity_id,
            ReportExclusion.record_type == record_type,
        ).all()
    }


def _is_intsimbi_diesel(inv) -> bool:
    """Whether this supplier invoice's admin-fee VAT is claimable input VAT
    (see the input_vat note in income_expenses_report)."""
    return supplier_bills_own_admin_fee(_supplier_name(inv))


def _line_excl_by_invoice(db: Session, inv_ids: list) -> dict:
    """Batch-fetch each supplier invoice's summed line-item excl-VAT amount
    (single grouped query to avoid N+1)."""
    if not inv_ids:
        return {}
    li_rows = (
        db.query(
            SupplierInvoiceLineItem.invoice_id,
            func.coalesce(func.sum(SupplierInvoiceLineItem.amount_excl_vat), 0).label('excl'),
        )
        .filter(SupplierInvoiceLineItem.invoice_id.in_(inv_ids))
        .group_by(SupplierInvoiceLineItem.invoice_id)
        .all()
    )
    return {r.invoice_id: float(r.excl) for r in li_rows}


def _fee_vat_by_invoice(db: Session, inv_ids: list) -> dict:
    """Admin-fee VAT per supplier invoice, summed from its diesel fill-ups.

    Intsimbi's diesel is zero-rated and its admin fee is the only VAT-bearing part,
    but the invoice stores a single incl-VAT header amount, so the report's usual
    `incl − Σ line excl` would book fee + fee VAT as VAT (≈7× over-claim). The
    fill-ups hold the fee and its VAT split out, which is what costing reports off —
    so read the VAT from there and let excl fall out as incl − VAT."""
    if not inv_ids:
        return {}
    rows = (
        db.query(
            DieselFillUp.supplier_invoice_id.label('inv_id'),
            func.coalesce(func.sum(DieselFillUp.admin_fee_vat), 0).label('vat'),
        )
        .filter(
            DieselFillUp.supplier_invoice_id.in_(inv_ids),
            DieselFillUp.is_archived != True,
        )
        .group_by(DieselFillUp.supplier_invoice_id)
        .all()
    )
    return {r.inv_id: float(r.vat) for r in rows}


def _diesel_fillup_lines(db: Session, inv_ids: list) -> dict:
    """Per-invoice diesel fill-up breakdown, mirroring costing's Diesel Summary
    columns so the SARS drill-down and costing read the same way.

    Each line carries the zero-rated diesel amount and the admin fee split into
    excl / VAT / incl — the fee being the only VAT-bearing part of the invoice."""
    if not inv_ids:
        return {}
    fillups = (
        db.query(DieselFillUp)
        .options(joinedload(DieselFillUp.truck))
        .filter(
            DieselFillUp.supplier_invoice_id.in_(inv_ids),
            DieselFillUp.is_archived != True,
        )
        .order_by(DieselFillUp.fillup_date, DieselFillUp.id)
        .all()
    )
    lines: dict[int, list] = {}
    for f in fillups:
        amt      = float(f.amount or 0)
        fee_excl = float(f.admin_fee_amount or 0)
        fee_vat  = float(f.admin_fee_vat or 0)
        lines.setdefault(f.supplier_invoice_id, []).append({
            'fillup_id':          f.id,
            'date':               f.fillup_date.strftime('%Y-%m-%d') if f.fillup_date else None,
            'slip_number':        f.depot_slip_number or f.slip_number or None,
            'truck_registration': f.truck.registration if f.truck else None,
            'litres':             round(float(f.litres or 0), 2),
            'rate_per_litre':     round(float(f.rate_per_litre or 0), 4),
            'amount_excl':        round(amt, 2),
            'admin_fee_excl':     round(fee_excl, 2),
            'admin_fee_vat':      round(fee_vat, 2),
            'admin_fee_incl':     round(fee_excl + fee_vat, 2),
            'total':              round(float(f.total_amount or 0), 2),
        })
    return lines


from app.core.constants import MONTH_NAMES_0 as MONTH_NAMES  # noqa: E402


from app.core.security import check_entity_access as _check_entity_access


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
    exclude_general = _exclude_general_expenses(db, entity_id)
    excluded_income   = _excluded_ids(db, entity_id, 'invoice')
    excluded_expenses = _excluded_ids(db, entity_id, 'supplier_invoice')

    # ── Income source: customer invoices (output VAT basis) ────────────────────
    # Income is every customer invoice issued in the period — the actual tax
    # invoices that create output VAT — grouped by issue_date month, for all
    # entities. (Truck loads are operational records, not the VAT/sales figure.)
    # total = incl-VAT, subtotal = excl-VAT; credit notes (negative) net out.
    # Count every status except cancelled (real invoices are often left 'draft');
    # only document_type=invoice, never quotes/POs.
    income_source = 'invoices'
    inv_rows = (
        db.query(
            func.extract('month', Invoice.issue_date).label('m'),
            func.coalesce(func.sum(Invoice.total), 0).label('incl'),
            func.coalesce(func.sum(Invoice.subtotal), 0).label('excl'),
        )
        .filter(
            Invoice.entity_id == entity_id,
            func.extract('year', Invoice.issue_date) == year,
            Invoice.document_type == DocumentType.invoice,
            Invoice.status != InvoiceStatus.cancelled,
            *([Invoice.id.notin_(excluded_income)] if excluded_income else []),
        )
        .group_by(func.extract('month', Invoice.issue_date))
        .all()
    )
    truck_income_incl = {int(r.m): float(r.incl) for r in inv_rows}
    truck_income_excl = {int(r.m): float(r.excl) for r in inv_rows}

    # ── Diesel expenses grouped by costing period (payment-term aware) ─────────
    # Diesel has no statement period, so the fill-up date stands in for it and the
    # supplier's payment term shifts it, mirroring supplier-invoice costing:
    #   30-day  → costing month = fill-up month
    #   current → costing month = fill-up month − 1 (cash belongs to the prior period,
    #             e.g. a June cash fill-up costs in May; a Jan one rolls to prior Dec)
    # Fetch this year's fill-ups plus next Jan (a Jan cash fill-up maps back to Dec).
    diesel_fillups = (
        db.query(
            DieselFillUp.fillup_date,
            DieselFillUp.total_amount,
            DieselFillUp.admin_fee_vat,
            Supplier.payment_term,
            Supplier.name,
        )
        .join(Supplier, Supplier.id == DieselFillUp.supplier_id)
        .filter(
            DieselFillUp.entity_id == entity_id,
            func.extract('year', DieselFillUp.fillup_date).in_([year, year + 1]),
            DieselFillUp.is_archived != True,
        )
        .all()
    )
    diesel_expense: dict[int, float] = {}
    diesel_input_vat: dict[int, float] = {}
    for fd, amount, vat, term, sup_name in diesel_fillups:
        is_cash = getattr(term, 'value', term) == PaymentTermType.current.value
        if is_cash:
            cm = fd.month - 1 if fd.month > 1 else 12
            cy = fd.year if fd.month > 1 else fd.year - 1
        else:
            cm, cy = fd.month, fd.year
        if cy != year:
            continue
        diesel_expense[cm] = diesel_expense.get(cm, 0.0) + float(amount or 0)
        # diesel_input_vat reports the fee VAT that is NOT in input_vat — i.e. our
        # own 1% markup. Intsimbi's fee is supplier-billed, so its VAT is already
        # claimed through the supplier-invoice block below; counting it here too
        # would report the same rand twice with opposite meanings.
        if not supplier_bills_own_admin_fee(sup_name):
            diesel_input_vat[cm] = diesel_input_vat.get(cm, 0.0) + float(vat or 0)

    # ── Supplier invoice expenses grouped by report period ──────────────────────
    # Unlike costing (which uses statement_month/statement_year so a late-arriving
    # invoice costs in the statement it was captured against), this report reflects
    # the real SARS-deductible period, so it groups by the invoice's own date —
    # unless a manual "Manage → Move" report override (report_period_*) pins it to
    # a different month (coalesced below).
    all_supplier_invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.entity_id == entity_id,
            func.coalesce(
                SupplierInvoice.report_period_year,
                func.extract('year', SupplierInvoice.invoice_date),
            ) == year,
            SupplierInvoice.is_archived != True,
        )
        .all()
    )

    line_excl_by_inv = _line_excl_by_invoice(db, [inv.id for inv in all_supplier_invoices])

    fee_vat_by_inv = _fee_vat_by_invoice(
        db, [inv.id for inv in all_supplier_invoices if _is_intsimbi_diesel(inv)])

    vat_divisor = 1.0 + float(entity_vat_rate(db, entity_id))
    supplier_incl_by_month: dict[int, float] = {}
    supplier_excl_by_month: dict[int, float] = {}
    for inv in all_supplier_invoices:
        # Report month: manual override wins, else the invoice's own date.
        m = inv.report_period_month or (inv.invoice_date.month if inv.invoice_date else None)
        if m is None:
            continue
        incl = float(inv.amount)
        if _is_intsimbi_diesel(inv):
            excl = round(incl, 2) - round(fee_vat_by_inv.get(inv.id, 0.0), 2)
        elif inv.id in line_excl_by_inv:
            excl = line_excl_by_inv[inv.id]
        elif inv.vat_applicable:
            excl = incl / vat_divisor
        else:
            excl = incl
        # Report-only reclassification (source data untouched):
        #   Sasfin → excluded entirely; general costing expenses and Trailer
        #   Maintenance supplier invoices → excluded (OBHI only); Crack Logic
        #   'Insurance Claim' → income.
        if inv.id in excluded_expenses:
            continue   # user dropped this row from the report (ReportExclusion)
        if _is_sasfin_supplier(inv):
            continue
        if exclude_general and _is_general_expense(inv):
            continue
        if exclude_general and _is_trailer_maintenance_supplier(inv):
            continue
        if _is_crack_logic_insurance(inv):
            truck_income_incl[m] = truck_income_incl.get(m, 0.0) + round(incl, 2)
            truck_income_excl[m] = truck_income_excl.get(m, 0.0) + round(excl, 2)
            continue
        # Round per-invoice (matching the SARS VAT detail) so the month-line totals
        # tie exactly to the drill-down rather than drifting a few cents on incl/(1+rate).
        supplier_incl_by_month[m] = supplier_incl_by_month.get(m, 0.0) + round(incl, 2)
        supplier_excl_by_month[m] = supplier_excl_by_month.get(m, 0.0) + round(excl, 2)

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
            calc = calculate_pay_cycle(cycle, effective, driver_type,
                                       exclude_mine_bonus=bool(getattr(driver, 'exclude_mine_bonus', False)))
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
        # Input VAT is the supplier-invoice VAT only — matching the SARS VAT detail
        # drill-down (_build_month_detail). diesel_input_vat is the VAT on the internal
        # 1% diesel admin-fee markup, NOT supplier input VAT, so it must not be added
        # here (doing so over-claimed input VAT and understated VAT payable, most
        # visibly for OBHI where diesel volume is high). Reported separately for info.
        # (Intsimbi's fee IS supplier-billed, so its VAT reaches input_vat via
        # sup_incl − sup_excl and is kept out of diesel_input_vat — see the fill-up
        # loop above.)
        input_vat   = (sup_incl - sup_excl)
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
        'income_source':      income_source,
        'has_payroll_entries': bool(payroll_from_entries),
    }


def _build_month_detail(db, entity_id: int, year: int, month: int) -> dict:
    """Build per-invoice detail dict for one month (shared by single and annual endpoints).

    User-excluded rows (ReportExclusion) are still listed, flagged `excluded`, so they
    can be seen and restored — but they're left out of every group and total, exactly
    as they are in the annual figures.
    """
    exclude_general   = _exclude_general_expenses(db, entity_id)
    excluded_income   = _excluded_ids(db, entity_id, 'invoice')
    excluded_expenses = _excluded_ids(db, entity_id, 'supplier_invoice')
    vat_divisor       = 1.0 + float(entity_vat_rate(db, entity_id))
    # Income side: every customer invoice issued in the month (output VAT basis),
    # for all entities — the actual tax invoices, not operational truck loads.
    income_invoices = (
        db.query(Invoice)
        .filter(
            Invoice.entity_id == entity_id,
            func.extract('year', Invoice.issue_date) == year,
            func.extract('month', Invoice.issue_date) == month,
            Invoice.document_type == DocumentType.invoice,
            Invoice.status != InvoiceStatus.cancelled,
        )
        .order_by(Invoice.issue_date)
        .all()
    )
    income_tokens = _intercompany_tokens(db, entity_id)
    output_invoices = []
    for inv in income_invoices:
        incl = float(inv.total or 0)
        excl = float(inv.subtotal or 0)
        cust = inv.customer.name if inv.customer else ''
        desc = f"{inv.invoice_number} — {cust}" if cust else (inv.invoice_number or '')
        # Group: Tradekor → Intercompany (customer name matches another entity) → Other
        if 'TRADEKOR' in cust.upper():
            ocat = 'tradekor'
        elif _name_is_intercompany(cust, income_tokens):
            ocat = 'intercompany'
        else:
            ocat = 'other'
        output_invoices.append({
            'record_type': 'invoice',
            'record_id':   inv.id,
            'excluded':    inv.id in excluded_income,
            'date':        inv.issue_date.strftime('%Y-%m-%d') if inv.issue_date else None,
            'description': desc,
            'amount_incl': round(incl, 2),
            'amount_excl': round(excl, 2),
            'vat':         round(incl - excl, 2),
            'category':    ocat,
        })

    # (Output grouping is built below, after supplier invoices are processed —
    #  Crack Logic 'Insurance Claim' invoices get reclassified onto the income side.)

    # Grouped by the invoice's actual date, not statement_month/statement_year —
    # costing uses the statement period, but SARS deductibility follows the real
    # invoice date regardless of which statement it was captured against. A manual
    # "Manage → Move" report override (report_period_*) pins the row to a chosen
    # month when set (coalesced here so it stays in sync with Income vs Expenses).
    sup_invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.entity_id == entity_id,
            func.coalesce(
                SupplierInvoice.report_period_year,
                func.extract('year', SupplierInvoice.invoice_date),
            ) == year,
            func.coalesce(
                SupplierInvoice.report_period_month,
                func.extract('month', SupplierInvoice.invoice_date),
            ) == month,
            SupplierInvoice.is_archived != True,
        )
        .order_by(SupplierInvoice.invoice_date)
        .all()
    )

    line_excl_by_inv = _line_excl_by_invoice(db, [inv.id for inv in sup_invoices])

    fillup_lines_by_inv = _diesel_fillup_lines(
        db, [inv.id for inv in sup_invoices if _is_intsimbi_diesel(inv)])

    input_invoices = []
    for inv in sup_invoices:
        incl = float(inv.amount)
        # Intsimbi's stored vat_applicable=False makes the row render "Non-VAT",
        # but its admin fee does carry VAT — surface it as a VAT-bearing row, and
        # derive the VAT from the same fill-up lines the row expands to show, so
        # the header and the breakdown can never disagree.
        is_intsimbi = _is_intsimbi_diesel(inv)
        fillup_lines = fillup_lines_by_inv.get(inv.id, []) if is_intsimbi else []
        vat_applicable = True if is_intsimbi else inv.vat_applicable
        if is_intsimbi:
            excl = round(incl, 2) - round(sum(l['admin_fee_vat'] for l in fillup_lines), 2)
        elif inv.id in line_excl_by_inv:
            excl = line_excl_by_inv[inv.id]
        elif inv.vat_applicable:
            excl = incl / vat_divisor
        else:
            excl = incl
        name = ''
        if inv.supplier_id and inv.supplier:
            name = inv.supplier.name
        elif inv.subcontractor_id and inv.subcontractor:
            name = inv.subcontractor.name
        # Report-only reclassification (source data untouched):
        #   Sasfin → excluded from the report; general costing expenses and
        #   Trailer Maintenance supplier invoices → excluded (OBHI only);
        #   Crack Logic 'Insurance Claim' → moved onto the income/output side
        #   as an insurance-claim reimbursement.
        if _is_sasfin_supplier(inv):
            continue
        if exclude_general and _is_general_expense(inv):
            continue
        if exclude_general and _is_trailer_maintenance_supplier(inv):
            continue
        if _is_crack_logic_insurance(inv):
            output_invoices.append({
                'record_type': 'supplier_invoice',
                'record_id':   inv.id,
                'excluded':    inv.id in excluded_expenses,
                'date':        inv.invoice_date.strftime('%Y-%m-%d') if inv.invoice_date else None,
                'description': f"{name} — {inv.description}".strip(' —') or (inv.invoice_number or ''),
                'amount_incl': round(incl, 2),
                'amount_excl': round(excl, 2),
                'vat':         round(incl - excl, 2),
                'category':    'other',
            })
            continue
        # Categorise for the grouped expense breakdown:
        #   subcontractor → diesel → intercompany → other (first match wins)
        if inv.subcontractor_id:
            category = 'subcontractor'
        elif inv.supplier and inv.supplier.is_diesel_supplier:
            category = 'diesel'
        elif inv.supplier and getattr(inv.supplier, 'is_intercompany', False):
            category = 'intercompany'
        else:
            category = 'other'
        input_invoices.append({
            'invoice_id':     inv.id,
            'record_type':    'supplier_invoice',
            'record_id':      inv.id,
            'supplier_id':    inv.supplier_id,
            # Manage→Move pin: the row sits in this month's bucket regardless of
            # its invoice date (day-precision export filters must not drop it).
            'pinned':         inv.report_period_year is not None or inv.report_period_month is not None,
            'excluded':       inv.id in excluded_expenses,
            'date':           inv.invoice_date.strftime('%Y-%m-%d') if inv.invoice_date else None,
            'invoice_number': inv.invoice_number or '',
            'supplier_name':  name,
            'vehicle_reg':    inv.vehicle_reg or '',
            'description':    inv.description or name,
            'amount_incl':    round(incl, 2),
            'amount_excl':    round(excl, 2),
            'vat':            round(incl - excl, 2),
            'vat_applicable': vat_applicable,
            'category':       category,
            # Diesel fill-up breakdown for rows that expand (Intsimbi only, where
            # the admin fee is supplier-billed and carries the invoice's only VAT).
            'fillup_lines':   fillup_lines,
        })

    # Order by category (diesel, subcontractor, intercompany, other) then date,
    # and compute per-group subtotals for the SARS expense breakdown.
    _CAT_ORDER = {'diesel': 0, 'subcontractor': 1, 'intercompany': 2, 'other': 3}
    _CAT_LABEL = {'diesel': 'Diesel', 'subcontractor': 'Subcontractors',
                  'intercompany': 'Intercompany', 'other': 'Other Suppliers'}
    input_invoices.sort(key=lambda x: (_CAT_ORDER.get(x['category'], 9), x['date'] or ''))
    input_groups = []
    for key in ('diesel', 'subcontractor', 'intercompany', 'other'):
        rows = [x for x in input_invoices if x['category'] == key]
        if not rows:
            continue
        # Excluded rows stay listed (so they can be restored) but must not count.
        counted = [x for x in rows if not x['excluded']]
        input_groups.append({
            'key':         key,
            'label':       _CAT_LABEL[key],
            'count':       len(counted),
            'amount_incl': round(sum(x['amount_incl'] for x in counted), 2),
            'amount_excl': round(sum(x['amount_excl'] for x in counted), 2),
            'vat':         round(sum(x['vat'] for x in counted), 2),
        })

    # Order Tradekor → Intercompany → Other (then date) and build per-group subtotals.
    # Built here (not right after the income loop) so Crack Logic 'Insurance Claim'
    # invoices reclassified from the supplier side are included.
    _OCAT_ORDER = {'tradekor': 0, 'intercompany': 1, 'other': 2}
    _OCAT_LABEL = {'tradekor': 'Tradekor', 'intercompany': 'Intercompany', 'other': 'Other'}
    output_invoices.sort(key=lambda x: (_OCAT_ORDER.get(x['category'], 9), x['date'] or ''))
    output_groups = []
    for key in ('tradekor', 'intercompany', 'other'):
        rows = [x for x in output_invoices if x['category'] == key]
        if not rows:
            continue
        counted = [x for x in rows if not x['excluded']]
        output_groups.append({
            'key':         key,
            'label':       _OCAT_LABEL[key],
            'count':       len(counted),
            'amount_incl': round(sum(x['amount_incl'] for x in counted), 2),
            'amount_excl': round(sum(x['amount_excl'] for x in counted), 2),
            'vat':         round(sum(x['vat'] for x in counted), 2),
        })

    # Totals count only what isn't excluded, so this month's VAT payable matches the
    # annual row (which drops excluded records at query time).
    out_counted = [x for x in output_invoices if not x['excluded']]
    in_counted  = [x for x in input_invoices  if not x['excluded']]
    out_incl = sum(x['amount_incl'] for x in out_counted)
    out_excl = sum(x['amount_excl'] for x in out_counted)
    out_vat  = round(out_incl - out_excl, 2)
    in_incl  = sum(x['amount_incl'] for x in in_counted)
    in_excl  = sum(x['amount_excl'] for x in in_counted)
    in_vat   = round(in_incl - in_excl, 2)

    return {
        'month':           month,
        'month_name':      MONTH_NAMES[month - 1],
        'output_invoices': output_invoices,
        'output_groups':   output_groups,
        'input_invoices':  input_invoices,
        'input_groups':    input_groups,
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


@router.get("/supplier-summary")
def supplier_summary_report(
    entity_id: int = Query(...),
    year: int = Query(..., ge=2020),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Supplier invoices for the month grouped per supplier, with each supplier's
    individual invoices behind its totals row.

    Built on the same per-invoice computation as the SARS VAT detail
    (_build_month_detail) — invoice-date basis with Manage→Move pins, plus the
    report-only reclassifications and user exclusions — so the grand total here
    always equals the month's supplier-expense figure on Income vs Expenses.
    """
    _check_entity_access(entity_id, current_user)
    detail = _build_month_detail(db, entity_id, year, month)

    suppliers: dict[str, dict] = {}
    for row in detail['input_invoices']:
        if row['excluded']:
            continue
        name = row['supplier_name'] or 'General Expenses'
        sup = suppliers.get(name.upper())
        if sup is None:
            sup = suppliers[name.upper()] = {
                'supplier_name': name,
                'category':      row['category'],
                'count':         0,
                'amount_excl':   0.0,
                'vat':           0.0,
                'amount_incl':   0.0,
                'invoices':      [],
            }
        sup['count'] += 1
        sup['amount_excl'] += row['amount_excl']
        sup['vat']         += row['vat']
        sup['amount_incl'] += row['amount_incl']
        sup['invoices'].append({
            'record_id':      row['record_id'],
            'date':           row['date'],
            'invoice_number': row['invoice_number'],
            'description':    row['description'],
            'amount_excl':    row['amount_excl'],
            'vat':            row['vat'],
            'amount_incl':    row['amount_incl'],
            'vat_applicable': row['vat_applicable'],
        })

    rows = sorted(suppliers.values(), key=lambda s: -s['amount_incl'])
    for s in rows:
        for k in ('amount_excl', 'vat', 'amount_incl'):
            s[k] = round(s[k], 2)

    return {
        'entity_id':  entity_id,
        'year':       year,
        'month':      month,
        'month_name': MONTH_NAMES[month - 1],
        'suppliers':  rows,
        'totals': {
            'count':       sum(s['count'] for s in rows),
            'amount_excl': round(sum(s['amount_excl'] for s in rows), 2),
            'vat':         round(sum(s['vat'] for s in rows), 2),
            'amount_incl': round(sum(s['amount_incl'] for s in rows), 2),
        },
    }


@router.get("/supplier-summary/export/excel")
def supplier_summary_export_excel(
    entity_id: int = Query(...),
    year: Optional[int] = Query(None, ge=2020),
    month: Optional[int] = Query(None, ge=1, le=12),
    start: Optional[date_cls] = Query(None),
    end: Optional[date_cls] = Query(None),
    supplier_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Excel workbook of supplier invoices, one tab per supplier (plus a
    Summary grid) — the shape of the manual supplier workbook.

    Period: either `year` (whole year, or one month with `month`) — the Reports
    page — or a `start`/`end` date range (may span years) — the Supplier
    Profile export. Pass `supplier_id` for just that supplier's workbook.

    Reuses _build_month_detail per month, so the rows and totals are exactly
    the ones the Supplier Summary report shows. Day-precision: an unpinned row
    is kept only if its invoice date falls inside [start, end]; a Manage→Move
    pinned row belongs to its pinned month bucket, so it's kept whenever that
    month is inside the range (full-month ranges therefore tie to the report
    exactly).
    """
    import io
    import calendar
    from fastapi.responses import StreamingResponse
    from app.services.supplier_summary_export import generate_supplier_summary_excel

    _check_entity_access(entity_id, current_user)
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    supplier = None
    if supplier_id is not None:
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier or supplier.entity_id != entity_id:
            raise HTTPException(status_code=404, detail="Supplier not found")

    if start and end:
        if start > end:
            raise HTTPException(status_code=400, detail="Start date must be on or before end date")
        n_months = (end.year - start.year) * 12 + (end.month - start.month) + 1
        if n_months > 60:
            raise HTTPException(status_code=400, detail="Date range too large (maximum 5 years)")
        month_keys = [((start.year * 12 + start.month - 1 + i) // 12,
                       (start.year * 12 + start.month - 1 + i) % 12 + 1)
                      for i in range(n_months)]
        s_iso, e_iso = start.isoformat(), end.isoformat()
        aligned = start.day == 1 and end.day == calendar.monthrange(end.year, end.month)[1]
        if aligned and (start.year, start.month) == (end.year, end.month):
            period_label = f"{MONTH_NAMES[start.month - 1]} {start.year}"
        elif aligned and (start.month, end.month) == (1, 12) and start.year == end.year:
            period_label = str(start.year)
        elif aligned:
            period_label = (f"{MONTH_NAMES[start.month - 1][:3]} {start.year} – "
                            f"{MONTH_NAMES[end.month - 1][:3]} {end.year}")
        else:
            period_label = f"{start.strftime('%d %b %Y')} – {end.strftime('%d %b %Y')}"
    elif year:
        month_keys = [(year, month)] if month else [(year, m) for m in range(1, 13)]
        s_iso = e_iso = None
        period_label = f"{MONTH_NAMES[month - 1]} {year}" if month else str(year)
    else:
        raise HTTPException(status_code=400, detail="Provide either year or a start/end date range")

    month_rows = {}
    for (yy, mm) in month_keys:
        rows = [r for r in _build_month_detail(db, entity_id, yy, mm)['input_invoices']
                if not r['excluded']
                and (supplier_id is None or r.get('supplier_id') == supplier_id)
                and (s_iso is None or r.get('pinned') or not r['date']
                     or s_iso <= r['date'] <= e_iso)]
        if rows:
            month_rows[(yy, mm)] = rows

    xl_bytes = generate_supplier_summary_excel(entity, period_label, month_rows)
    code = (entity.code or 'entity').lower()
    sup_slug = (re.sub(r'[^A-Za-z0-9]+', '-', supplier.name).strip('-').lower() or 'supplier') \
        if supplier else None
    base = "supplier-summary-" + (f"{sup_slug}-" if sup_slug else "") + code
    if start and end:
        filename = f"{base}-{start.isoformat()}-to-{end.isoformat()}.xlsx"
    else:
        filename = f"{base}-{year}" + (f"-{month:02d}" if month else "") + ".xlsx"
    return StreamingResponse(
        io.BytesIO(xl_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Report exclusions ─────────────────────────────────────────────────────────
# Dropping a row is report-only: the invoice itself is never touched, so costing,
# diesel and payouts are unaffected and it's always reversible. That's why these
# deliberately carry no verification/sent-costing lock check and no admin gate —
# any user with access to the entity may exclude and restore. Entity access is
# still enforced: it scopes who sees the data at all, it isn't a record lock.

_EXCLUDABLE = {
    'invoice':          (Invoice, 'invoice_number'),
    'supplier_invoice': (SupplierInvoice, 'invoice_number'),
}


@router.post("/exclusions")
def create_report_exclusion(
    payload: ReportExclusionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Drop one record from the Income vs Expenses / SARS report."""
    if payload.record_type not in _EXCLUDABLE:
        raise HTTPException(status_code=400, detail="Unknown record type")
    model, label_field = _EXCLUDABLE[payload.record_type]

    record = db.query(model).filter(model.id == payload.record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    _check_entity_access(record.entity_id, current_user)

    existing = db.query(ReportExclusion).filter(
        ReportExclusion.record_type == payload.record_type,
        ReportExclusion.record_id == payload.record_id,
    ).first()
    if existing:
        return {'status': 'already_excluded', 'id': existing.id}

    excl = ReportExclusion(
        entity_id=record.entity_id,
        record_type=payload.record_type,
        record_id=payload.record_id,
        reason=(payload.reason or '').strip() or None,
        excluded_by_id=current_user.id,
    )
    db.add(excl)
    label = getattr(record, label_field, None) or f"#{payload.record_id}"
    log_action(
        db, "report.excluded", user_id=current_user.id,
        entity_id=record.entity_id, resource_type=payload.record_type,
        resource_id=payload.record_id,
        description=(f"Removed {label} from the Income vs Expenses report"
                     + (f" — {excl.reason}" if excl.reason else "")),
    )
    db.commit()
    db.refresh(excl)
    return {'status': 'excluded', 'id': excl.id}


@router.delete("/exclusions/{record_type}/{record_id}")
def delete_report_exclusion(
    record_type: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Restore a previously excluded record to the report."""
    excl = db.query(ReportExclusion).filter(
        ReportExclusion.record_type == record_type,
        ReportExclusion.record_id == record_id,
    ).first()
    if not excl:
        raise HTTPException(status_code=404, detail="Exclusion not found")
    _check_entity_access(excl.entity_id, current_user)

    log_action(
        db, "report.restored", user_id=current_user.id,
        entity_id=excl.entity_id, resource_type=record_type, resource_id=record_id,
        description="Restored record to the Income vs Expenses report",
    )
    db.delete(excl)
    db.commit()
    return {'status': 'restored'}


# ── Subcontractor truck loads ─────────────────────────────────────────────────

def _zero_load_totals() -> dict:
    return {
        'loads': 0, 'tonnes': 0.0,
        'invoiced_excl': 0.0, 'invoiced_incl': 0.0,
        'payout_excl': 0.0, 'payout_incl': 0.0,
        'admin_fee': 0.0,
    }


def _add_load_totals(dst: dict, src: dict):
    for k in dst:
        dst[k] += src[k]


def _round_load_totals(t: dict) -> dict:
    return {
        'loads': t['loads'],
        'tonnes': round(t['tonnes'], 3),
        **{k: round(t[k], 2) for k in
           ('invoiced_excl', 'invoiced_incl', 'payout_excl', 'payout_incl', 'admin_fee')},
    }


@router.get("/subcontractor-loads")
def subcontractor_loads_report(
    entity_id: int = Query(...),
    year: int = Query(..., ge=2020),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Truck loads for the period, grouped subcontractor → truck → individual loads,
    with the invoiced amount and the subcontractor payout side by side.

    Only trucks linked to a subcontractor are included; own-fleet trucks are out of
    scope for this report.

    Scoping deliberately mirrors the subcontractor costing module so the two
    reconcile: subcontractors are selected by their own entity_id (not the load's),
    and a load belongs to its STATEMENT period when one is set, falling back to the
    load date.
    """
    _check_entity_access(entity_id, current_user)

    loads = (
        db.query(TruckLoad)
        .join(Truck, Truck.id == TruckLoad.truck_id)
        .join(Subcontractor, Subcontractor.id == Truck.subcontractor_id)
        .options(joinedload(TruckLoad.mine))
        .filter(
            Subcontractor.entity_id == entity_id,
            TruckLoad.is_archived == False,
            func.coalesce(TruckLoad.statement_month, func.extract('month', TruckLoad.load_date)) == month,
            func.coalesce(TruckLoad.statement_year, func.extract('year', TruckLoad.load_date)) == year,
        )
        .add_columns(
            Subcontractor.id.label('sub_id'),
            Subcontractor.name.label('sub_name'),
            Truck.id.label('t_id'),
            Truck.registration.label('t_reg'),
            Truck.fleet_number.label('t_fleet'),
        )
        .order_by(
            Subcontractor.name, Truck.fleet_number, Truck.registration,
            TruckLoad.load_date, TruckLoad.id,
        )
        .all()
    )

    subs: dict[int, dict] = {}
    trucks: dict[tuple, dict] = {}

    for load, sub_id, sub_name, t_id, t_reg, t_fleet in loads:
        sub = subs.get(sub_id)
        if sub is None:
            sub = subs[sub_id] = {
                'subcontractor_id': sub_id,
                'subcontractor_name': sub_name,
                'trucks': [],
                'totals': _zero_load_totals(),
            }
        truck = trucks.get((sub_id, t_id))
        if truck is None:
            truck = trucks[(sub_id, t_id)] = {
                'truck_id': t_id,
                'truck_registration': t_reg,
                'fleet_number': t_fleet,
                'loads': [],
                'totals': _zero_load_totals(),
            }
            sub['trucks'].append(truck)

        tonnes        = float(load.tonnes or 0)
        invoiced_excl = float(load.amount_excl_vat or 0)
        invoiced_incl = float(load.amount_incl_vat or 0)
        payout_excl   = float(load.subcontractor_amount_excl_vat or 0)
        payout_incl   = float(load.subcontractor_amount_incl_vat or 0)
        # Taken as the difference rather than tonnes × fee so the invoiced, payout
        # and admin-fee columns always reconcile against the stored, separately
        # rounded amounts.
        admin_fee     = invoiced_excl - payout_excl

        truck['loads'].append({
            'load_id': load.id,
            'load_date': load.load_date,
            'mine_name': load.mine.name if load.mine else None,
            'slip_number': load.slip_number,
            'po_number': load.po_number,
            'driver_name': load.driver_name,
            'tonnes': round(tonnes, 3),
            'rate_per_ton': float(load.rate_per_ton or 0),
            'invoiced_excl': round(invoiced_excl, 2),
            'invoiced_incl': round(invoiced_incl, 2),
            'subcontractor_rate': float(load.subcontractor_rate or 0),
            'payout_excl': round(payout_excl, 2),
            'payout_incl': round(payout_incl, 2),
            'admin_fee_per_ton': float(load.subcontractor_admin_fee_per_ton or 0),
            'admin_fee': round(admin_fee, 2),
            'is_split_load': bool(load.is_split_load),
            'is_projection': bool(load.is_projection),
        })

        row_totals = {
            'loads': 1, 'tonnes': tonnes,
            'invoiced_excl': invoiced_excl, 'invoiced_incl': invoiced_incl,
            'payout_excl': payout_excl, 'payout_incl': payout_incl,
            'admin_fee': admin_fee,
        }
        _add_load_totals(truck['totals'], row_totals)
        _add_load_totals(sub['totals'], row_totals)

    grand = _zero_load_totals()
    for sub in subs.values():
        _add_load_totals(grand, sub['totals'])
        for truck in sub['trucks']:
            truck['totals'] = _round_load_totals(truck['totals'])
        sub['totals'] = _round_load_totals(sub['totals'])

    return {
        'entity_id': entity_id,
        'year': year,
        'month': month,
        'month_name': MONTH_NAMES[month - 1],
        'subcontractors': list(subs.values()),
        'totals': _round_load_totals(grand),
    }


# ── Invoiced PO vs Truck Loads reconciliation ─────────────────────────────────
#
# Checks that what was billed on a PO invoice matches what the Truck Loads module
# actually recorded, per truck.
#
# The join key is the weighbridge SLIP number, not the PO number: TruckLoad.po_number
# is empty on every load in production, whereas TruckLoad.slip_number lines up with
# the waybill captured on the invoice line. Which of the two invoice waybill columns
# holds it depends on the mine's PO layout (the import maps them by column heading),
# so both are tried — loading_number first, since it carries the slip on the large
# majority of invoices.

# "EGN693EC - Futureshine to PE" / bare "KRM473EC" → the registration.
_LINE_REG_RE = re.compile(r'^\s*([A-Z0-9]{5,10})\s*(?:-|$)')

# Tolerances: tonnes are captured to 3dp and amounts to 2dp on both sides, so
# anything above these is a real capture difference, not rounding.
_TONNES_TOL = 0.01
_AMOUNT_TOL = 0.05


def _line_reg(description: Optional[str]) -> Optional[str]:
    m = _LINE_REG_RE.match((description or '').upper())
    return m.group(1) if m else None


def _line_tonnes(quantity) -> float:
    """Invoiced tonnes for a line, normalising the kg convention.

    Some PO layouts bill the quantity in kilograms (38360) while pricing per tonne,
    so the line amount is already correct and only the displayed quantity differs.
    No single load approaches 1000 tonnes, so a quantity above that is unambiguously
    kg and is scaled down rather than reported as a difference.
    """
    q = float(quantity or 0)
    return q / 1000 if q >= 1000 else q


def _zero_recon_totals() -> dict:
    return {
        'invoiced_loads': 0, 'invoiced_tonnes': 0.0, 'invoiced_amount': 0.0,
        'invoiced_amount_incl': 0.0,
        'load_loads': 0, 'load_tonnes': 0.0, 'load_amount': 0.0,
    }


def _recon_with_diff(t: dict) -> dict:
    out = {
        'invoiced_loads': t['invoiced_loads'], 'load_loads': t['load_loads'],
        'invoiced_tonnes': round(t['invoiced_tonnes'], 3),
        'load_tonnes': round(t['load_tonnes'], 3),
        'invoiced_amount': round(t['invoiced_amount'], 2),
        'invoiced_amount_incl': round(t['invoiced_amount_incl'], 2),
        'load_amount': round(t['load_amount'], 2),
    }
    out['diff_loads'] = out['invoiced_loads'] - out['load_loads']
    out['diff_tonnes'] = round(out['invoiced_tonnes'] - out['load_tonnes'], 3)
    out['diff_amount'] = round(out['invoiced_amount'] - out['load_amount'], 2)
    return out


@router.get("/po-load-reconciliation")
def po_load_reconciliation_report(
    entity_id: int = Query(...),
    year: int = Query(..., ge=2020),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every invoiced PO for the month, checked against the Truck Loads module per truck.

    Scoped by the INVOICE's issue date — the report answers "for what we billed this
    month, do the loads agree". The loads it matches against are deliberately NOT
    restricted to that month: an invoice routinely bills a load carrying the previous
    month's statement period, and those matches would otherwise read as missing loads.
    A load whose period differs from the invoice month is flagged instead.
    """
    _check_entity_access(entity_id, current_user)

    invoices = (
        db.query(Invoice)
        .options(joinedload(Invoice.line_items), joinedload(Invoice.customer))
        .filter(
            Invoice.entity_id == entity_id,
            Invoice.po_number.isnot(None),
            Invoice.document_type == DocumentType.invoice,
            Invoice.status != InvoiceStatus.cancelled,
            func.extract('year', Invoice.issue_date) == year,
            func.extract('month', Invoice.issue_date) == month,
        )
        .order_by(Invoice.po_number, Invoice.invoice_number)
        .all()
    )

    # Every load for the entity, keyed by slip. Not period-filtered: see the docstring.
    load_rows = (
        db.query(TruckLoad, Truck.registration, Truck.fleet_number, Truck.id.label('t_id'))
        .join(Truck, Truck.id == TruckLoad.truck_id)
        .options(joinedload(TruckLoad.mine))
        .filter(TruckLoad.entity_id == entity_id, TruckLoad.is_archived == False)
        .all()
    )
    # Keyed case-insensitively: a slip captured "DN1234" on the invoice and "dn1234"
    # on the load is the same weighbridge slip and must still match.
    loads_by_slip: dict[str, list] = {}
    for row in load_rows:
        slip = (row[0].slip_number or '').strip()
        if slip:
            loads_by_slip.setdefault(slip.upper(), []).append(row)

    # Registration → canonical truck. A truck reissued with a new plate keeps the old
    # one in temp_registration, and invoices raised before the change still carry it,
    # so both resolve to the same truck rather than reading as a wrong-truck error.
    # sub_by_truck maps a truck to the subcontractor that operates it (linked row name
    # first, then the free-text subcontractor_name); own-fleet trucks are absent.
    truck_by_reg: dict[str, tuple] = {}
    sub_by_truck: dict[int, str] = {}
    for t_id, reg, temp, fleet, sub_name_col, sub_name in (
        db.query(
            Truck.id, Truck.registration, Truck.temp_registration, Truck.fleet_number,
            Truck.subcontractor_name, Subcontractor.name,
        )
        .outerjoin(Subcontractor, Subcontractor.id == Truck.subcontractor_id)
        .filter(Truck.entity_id == entity_id)
        .all()
    ):
        canon = (t_id, (reg or '').upper(), fleet)
        if reg:
            truck_by_reg[reg.upper()] = canon
        if temp and temp.upper() not in truck_by_reg:
            truck_by_reg[temp.upper()] = canon
        label = (sub_name or sub_name_col or '').strip()
        if label:
            sub_by_truck[t_id] = label

    pos: dict[str, dict] = {}
    trucks: dict[tuple, dict] = {}
    matched_load_ids: set = set()

    for inv in invoices:
        po = inv.po_number
        entry = pos.get(po)
        if entry is None:
            entry = pos[po] = {
                'po_number': po,
                'invoices': [],
                'customer_name': inv.customer.name if inv.customer else None,
                'trucks': [],
                'totals': _zero_recon_totals(),
                'issue_count': 0,
            }
        entry['invoices'].append({
            'invoice_id': inv.id,
            'invoice_number': inv.invoice_number,
            'issue_date': inv.issue_date,
            'status': inv.status.value if inv.status else None,
        })

        # Line amounts are excl-VAT; the incl total uses this invoice's own rate.
        vat_factor = 1.0 if inv.is_vat_exempt else 1.0 + float(
            inv.vat_rate if inv.vat_rate is not None else 0.15
        )

        for li in sorted(inv.line_items, key=lambda x: (x.sort_order or 0, x.id)):
            if li.line_type != 'item':
                continue

            inv_reg = _line_reg(li.description)
            canon = truck_by_reg.get(inv_reg) if inv_reg else None
            group_reg = canon[1] if canon else (inv_reg or '—')

            slip_a = (li.loading_number or '').strip()
            slip_b = (li.offloading_number or '').strip()
            cands = loads_by_slip.get(slip_a.upper()) or loads_by_slip.get(slip_b.upper()) or []
            # A slip captured twice yields more than one load; take the first not already
            # claimed by an earlier line so two invoice lines can't both point at one load.
            match = next((c for c in cands if c[0].id not in matched_load_ids), None)
            if match is None and cands:
                match = cands[0]

            issues = []
            inv_tonnes = _line_tonnes(li.quantity)
            inv_amount = float(li.amount or 0)

            if match is None:
                issues.append('no_load')
                load_tonnes = load_amount = 0.0
                load_data = None
            else:
                load, load_reg, load_fleet, load_t_id = match
                matched_load_ids.add(load.id)
                load_tonnes = float(load.tonnes or 0)
                load_amount = float(load.amount_excl_vat or 0)
                if inv_reg and load_reg and (canon[0] if canon else None) != load_t_id:
                    issues.append('reg')
                if abs(inv_tonnes - load_tonnes) > _TONNES_TOL:
                    issues.append('tonnes')
                if abs(inv_amount - load_amount) > _AMOUNT_TOL:
                    issues.append('amount')
                lm = load.statement_month or (load.load_date.month if load.load_date else None)
                ly = load.statement_year or (load.load_date.year if load.load_date else None)
                if (lm, ly) != (month, year):
                    issues.append('period')
                load_data = {
                    'load_id': load.id,
                    'load_date': load.load_date,
                    'load_registration': load_reg,
                    'load_tonnes': round(load_tonnes, 3),
                    'load_rate': float(load.rate_per_ton or 0),
                    'load_amount': round(load_amount, 2),
                    'load_period': f"{MONTH_NAMES[lm - 1]} {ly}" if lm and ly else None,
                }

            truck = trucks.get((po, group_reg))
            if truck is None:
                truck = trucks[(po, group_reg)] = {
                    'registration': group_reg,
                    'truck_id': canon[0] if canon else None,
                    'fleet_number': canon[2] if canon else None,
                    'known_truck': canon is not None,
                    'lines': [],
                    'totals': _zero_recon_totals(),
                }
                entry['trucks'].append(truck)

            truck['lines'].append({
                'invoice_number': inv.invoice_number,
                'description': li.description,
                'slip_number': slip_a or slip_b or None,
                'invoiced_registration': inv_reg,
                'invoiced_tonnes': round(inv_tonnes, 3),
                'invoiced_rate': float(li.unit_price or 0),
                'invoiced_amount': round(inv_amount, 2),
                'issues': issues,
                **(load_data or {
                    'load_id': None, 'load_date': None, 'load_registration': None,
                    'load_tonnes': 0.0, 'load_rate': 0.0, 'load_amount': 0.0, 'load_period': None,
                }),
            })

            row_totals = {
                'invoiced_loads': 1, 'invoiced_tonnes': inv_tonnes, 'invoiced_amount': inv_amount,
                'invoiced_amount_incl': inv_amount * vat_factor,
                'load_loads': 1 if match is not None else 0,
                'load_tonnes': load_tonnes, 'load_amount': load_amount,
            }
            for k, v in row_totals.items():
                truck['totals'][k] += v
                entry['totals'][k] += v

    # ── Loads never billed on any invoice ──────────────────────────────────────
    # "Not invoiced" is judged against every PO invoice line for the entity, not just
    # this month's: a load in this period may legitimately be billed by next month's
    # invoice, and checking only this month would report it as unbilled.
    all_invoiced_slips: set = set()
    for a, b in db.query(InvoiceLineItem.loading_number, InvoiceLineItem.offloading_number).join(
        Invoice, Invoice.id == InvoiceLineItem.invoice_id
    ).filter(
        Invoice.entity_id == entity_id,
        Invoice.document_type == DocumentType.invoice,
        Invoice.status != InvoiceStatus.cancelled,
        InvoiceLineItem.line_type == 'item',
    ).all():
        if a and a.strip():
            all_invoiced_slips.add(a.strip().upper())
        if b and b.strip():
            all_invoiced_slips.add(b.strip().upper())

    uninvoiced: dict[int, dict] = {}
    uninvoiced_totals = _zero_recon_totals()
    for load, reg, fleet, t_id in load_rows:
        lm = load.statement_month or (load.load_date.month if load.load_date else None)
        ly = load.statement_year or (load.load_date.year if load.load_date else None)
        if (lm, ly) != (month, year):
            continue
        slip = (load.slip_number or '').strip()
        if slip and slip.upper() in all_invoiced_slips:
            continue
        if load.id in matched_load_ids:
            continue
        grp = uninvoiced.get(t_id)
        if grp is None:
            grp = uninvoiced[t_id] = {
                'registration': reg, 'truck_id': t_id, 'fleet_number': fleet,
                'loads': [], 'totals': _zero_recon_totals(),
            }
        amount = float(load.amount_excl_vat or 0)
        tonnes = float(load.tonnes or 0)
        grp['loads'].append({
            'load_id': load.id,
            'load_date': load.load_date,
            'slip_number': load.slip_number,
            'mine_name': load.mine.name if load.mine else None,
            'driver_name': load.driver_name,
            'load_tonnes': round(tonnes, 3),
            'load_rate': float(load.rate_per_ton or 0),
            'load_amount': round(amount, 2),
            'is_projection': bool(load.is_projection),
        })
        for t in (grp['totals'], uninvoiced_totals):
            t['load_loads'] += 1
            t['load_tonnes'] += tonnes
            t['load_amount'] += amount

    # ── By-registration view ───────────────────────────────────────────────────
    # The same matched lines, regrouped registration → PO instead of PO → truck,
    # so a single truck can be reconciled across every PO it appears on. Built from
    # the raw per-(po, reg) truck totals before the grand loop below diffs them.
    by_reg: dict[str, dict] = {}
    for entry in pos.values():
        for truck in entry['trucks']:
            reg = truck['registration']
            rg = by_reg.get(reg)
            if rg is None:
                rg = by_reg[reg] = {
                    'registration': reg,
                    'truck_id': truck['truck_id'],
                    'fleet_number': truck['fleet_number'],
                    'known_truck': truck['known_truck'],
                    'subcontractor': sub_by_truck.get(truck['truck_id']) if truck['truck_id'] else None,
                    'pos': [],
                    'totals': _zero_recon_totals(),
                }
            for k in rg['totals']:
                rg['totals'][k] += truck['totals'][k]
            inv_nums = list(dict.fromkeys(l['invoice_number'] for l in truck['lines']))
            rg['pos'].append({
                'po_number': entry['po_number'],
                'customer_name': entry['customer_name'],
                'invoice_numbers': inv_nums,
                'lines': truck['lines'],
                'issue_count': sum(1 for l in truck['lines'] if l['issues']),
                'totals': _recon_with_diff(truck['totals']),
            })
    for rg in by_reg.values():
        rg['issue_count'] = sum(p['issue_count'] for p in rg['pos'])
        rg['totals'] = _recon_with_diff(rg['totals'])

    grand = _zero_recon_totals()
    for entry in pos.values():
        for k in grand:
            grand[k] += entry['totals'][k]
        for truck in entry['trucks']:
            truck['issue_count'] = sum(1 for l in truck['lines'] if l['issues'])
            truck['totals'] = _recon_with_diff(truck['totals'])
        entry['issue_count'] = sum(t['issue_count'] for t in entry['trucks'])
        entry['totals'] = _recon_with_diff(entry['totals'])

    for grp in uninvoiced.values():
        grp['totals'] = _recon_with_diff(grp['totals'])

    return {
        'entity_id': entity_id,
        'year': year,
        'month': month,
        'month_name': MONTH_NAMES[month - 1],
        'pos': list(pos.values()),
        # Own-fleet trucks (no subcontractor) sort last, then by reg within each group.
        'by_reg': sorted(
            by_reg.values(),
            key=lambda r: ((r['subcontractor'] or '').upper() or '￿', r['registration']),
        ),
        'uninvoiced': list(uninvoiced.values()),
        'uninvoiced_totals': _recon_with_diff(uninvoiced_totals),
        'totals': _recon_with_diff(grand),
        'issue_count': sum(e['issue_count'] for e in pos.values()),
    }


@router.get("/po-load-slip-lookup")
def po_load_slip_lookup(
    entity_id: int = Query(...),
    slip: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Find a weighbridge slip anywhere in the entity's invoices and truck loads.

    Answers "is this slip on any PO?" across every month, not just the report's,
    matching the slip case-insensitively (a load slip 'dn123' and an invoice
    waybill 'DN123' are the same slip). Both invoice waybill columns are searched.
    """
    _check_entity_access(entity_id, current_user)
    q = slip.strip().upper()

    invoiced = []
    for li, inv in (
        db.query(InvoiceLineItem, Invoice)
        .join(Invoice, Invoice.id == InvoiceLineItem.invoice_id)
        .filter(
            Invoice.entity_id == entity_id,
            Invoice.document_type == DocumentType.invoice,
            Invoice.status != InvoiceStatus.cancelled,
            InvoiceLineItem.line_type == 'item',
            or_(
                func.upper(func.trim(InvoiceLineItem.loading_number)) == q,
                func.upper(func.trim(InvoiceLineItem.offloading_number)) == q,
            ),
        )
        .order_by(Invoice.issue_date, Invoice.invoice_number)
        .all()
    ):
        invoiced.append({
            'invoice_number': inv.invoice_number,
            'po_number': inv.po_number,
            'issue_date': inv.issue_date,
            'status': inv.status.value if inv.status else None,
            'registration': _line_reg(li.description),
            'description': li.description,
            'loading_number': li.loading_number,
            'offloading_number': li.offloading_number,
            'tonnes': round(_line_tonnes(li.quantity), 3),
            'amount': round(float(li.amount or 0), 2),
        })

    loads = []
    for load, reg, fleet in (
        db.query(TruckLoad, Truck.registration, Truck.fleet_number)
        .outerjoin(Truck, Truck.id == TruckLoad.truck_id)
        .filter(
            TruckLoad.entity_id == entity_id,
            func.upper(func.trim(TruckLoad.slip_number)) == q,
        )
        .order_by(TruckLoad.load_date)
        .all()
    ):
        lm = load.statement_month or (load.load_date.month if load.load_date else None)
        ly = load.statement_year or (load.load_date.year if load.load_date else None)
        loads.append({
            'load_id': load.id,
            'registration': reg,
            'fleet_number': fleet,
            'slip_number': load.slip_number,
            'load_date': load.load_date,
            'tonnes': round(float(load.tonnes or 0), 3),
            'period': f"{MONTH_NAMES[lm - 1]} {ly}" if lm and ly else None,
            'is_archived': bool(load.is_archived),
            'is_projection': bool(load.is_projection),
        })

    return {'slip': slip.strip(), 'invoiced': invoiced, 'loads': loads}


# ── Profit Sheet report ───────────────────────────────────────────────────────

# Legacy named expense columns on truck_monthly_expenses. New profit sheets keep
# everything in custom_lines with these left NULL, but older rows still carry
# amounts here, so both are summed — skipping any column whose label a custom
# line already repeats, which is exactly what the profit sheet UI does.
_PROFIT_SHEET_EXPENSE_COLUMNS = [
    ('drivers_salary',       "Driver's Salary"),
    ('insurance_trailer',    'Insurance Trailer'),
    ('liability_3rd_party',  '3rd Party Liability'),
    ('goods_in_transit',     'Goods in Transit'),
    ('loss_of_use',          'Loss of Use'),
    ('personal_accident',    'Personal Accident'),
    ('communication_device', 'Communication Device'),
    ('sauma',                'SASRIA'),
    ('diesel',               'Diesel'),
    ('tyre_maintenance',     'Tyre Maintenance'),
    ('other_suppliers',      'Other Suppliers'),
]


def _profit_sheet_net_profit(sheet, loads_incl: float, sub_incl: float,
                             supplier_total: float) -> float:
    """Net profit for one truck-month, exactly as the truck's Profit Sheet tab
    shows it: income incl VAT − (captured expense lines + supplier invoices).

    Income falls back the same way the sheet does — the manual override first,
    then the subcontractor payout, then the truck's own invoiced income — so the
    report and the sheet can never disagree.
    """
    auto_income = sub_incl if sub_incl > 0 else loads_incl
    income = float(sheet.income_incl_vat) if (sheet and sheet.income_incl_vat is not None) else auto_income

    expenses = supplier_total
    if sheet:
        custom = sheet.custom_lines or []
        used = {(l.get('description') or '').strip().lower() for l in custom}
        expenses += sum(float(l.get('amount') or 0) for l in custom)
        for col, label in _PROFIT_SHEET_EXPENSE_COLUMNS:
            val = getattr(sheet, col, None)
            if val is not None and label.lower() not in used:
                expenses += float(val)

    return round(income - expenses, 2)


@router.get("/profit-sheet", response_model=ProfitSheetReportOut)
def profit_sheet_report(
    entity_id: int = Query(...),
    year: int = Query(..., ge=2020),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One line per own-fleet truck for the month — reg, driver, diesel, diesel
    per load, loads, profit, sand loads and profit excluding sand.

    Everything is calculated from the modules that already own the data, then any
    value the user typed over (stored in profit_sheet_report_rows) is returned
    alongside it. The client shows the override when there is one and the
    calculated figure otherwise, so a late correction upstream still lands here.

    Loads use the statement period, falling back to the load date — the same rule
    costing and the subcontractor report use, so the load counts reconcile.
    """
    _check_entity_access(entity_id, current_user)

    trucks = (
        db.query(Truck)
        .filter(
            Truck.entity_id == entity_id,
            Truck.is_subcontractor == False,      # noqa: E712 — SQL boolean, not Python
            Truck.subcontractor_id.is_(None),
        )
        .order_by(Truck.fleet_number, Truck.registration)
        .all()
    )
    truck_ids = [t.id for t in trucks]

    in_period = and_(
        func.coalesce(TruckLoad.statement_month, func.extract('month', TruckLoad.load_date)) == month,
        func.coalesce(TruckLoad.statement_year, func.extract('year', TruckLoad.load_date)) == year,
    ) if truck_ids else None

    load_rows = (
        db.query(
            TruckLoad.truck_id,
            func.count(TruckLoad.id).label('loads'),
            func.coalesce(func.sum(TruckLoad.amount_incl_vat), 0).label('incl'),
            func.coalesce(func.sum(TruckLoad.subcontractor_amount_incl_vat), 0).label('sub_incl'),
        )
        .filter(TruckLoad.truck_id.in_(truck_ids), TruckLoad.is_archived == False, in_period)  # noqa: E712
        .group_by(TruckLoad.truck_id)
        .all()
    ) if truck_ids else []
    loads_by_truck = {r.truck_id: r for r in load_rows}

    # Diesel is the grand total (fuel + admin fee) — the cost actually carried.
    # Scoped by statement period like the loads above (and like the Diesel
    # module), with archived fill-ups excluded so re-linked placeholders don't
    # double-book against the truck.
    diesel_rows = (
        apply_fillup_period(
            db.query(
                DieselFillUp.truck_id,
                func.coalesce(func.sum(DieselFillUp.total_amount), 0).label('total'),
            ).filter(DieselFillUp.truck_id.in_(truck_ids)),
            year, month,
        )
        .group_by(DieselFillUp.truck_id)
        .all()
    ) if truck_ids else []
    diesel_by_truck = {r.truck_id: float(r.total or 0) for r in diesel_rows}

    sheets = {
        s.truck_id: s
        for s in db.query(TruckMonthlyExpenses).filter(
            TruckMonthlyExpenses.truck_id.in_(truck_ids),
            TruckMonthlyExpenses.year == year,
            TruckMonthlyExpenses.month == month,
        ).all()
    } if truck_ids else {}

    # Driver 1 is the truck's driver; the slot-less/second driver is ignored so
    # the column matches the one name the source sheet carries per reg.
    driver_rows = db.query(Driver).filter(
        Driver.truck_id.in_(truck_ids), Driver.is_active == True,  # noqa: E712
    ).all() if truck_ids else []
    # Sorted in Python: NULLS LAST isn't portable across SQLite and PostgreSQL,
    # and an unassigned slot must fall behind Driver 1 either way.
    driver_rows.sort(key=lambda d: (d.driver_slot is None, d.driver_slot or 0, d.id))
    drivers = {}
    for d in driver_rows:
        drivers.setdefault(d.truck_id, f"{d.first_name} {d.last_name}".strip())

    # Supplier-invoice expenses for the whole fleet in one query — the per-reg
    # endpoint the Profit Sheet tab calls is far too slow run 25+ times over.
    from app.api.routes.supplier_invoices import invoices_by_vehicle_regs
    inv_by_reg = invoices_by_vehicle_regs(
        db, [t.registration for t in trucks if t.registration], month, year,
    )

    saved = {
        r.truck_id: r
        for r in db.query(ProfitSheetReportRow).filter(
            ProfitSheetReportRow.entity_id == entity_id,
            ProfitSheetReportRow.year == year,
            ProfitSheetReportRow.month == month,
        ).all()
    }

    def _overrides(rec) -> ProfitSheetReportOverrides:
        if rec is None:
            return ProfitSheetReportOverrides()
        return ProfitSheetReportOverrides(
            reg_no=rec.reg_no_override,
            driver=rec.driver_override,
            diesel=rec.diesel_override,
            diesel_avg_per_load=rec.diesel_avg_override,
            loads=rec.loads_override,
            profit=rec.profit_override,
            sand_loads_incl_vat=rec.sand_loads_incl_vat,
            profit_excl_sand=rec.profit_excl_sand_override,
        )

    rows: list[ProfitSheetReportRowOut] = []
    for i, t in enumerate(trucks):
        lr    = loads_by_truck.get(t.id)
        sheet = sheets.get(t.id)
        rec   = saved.get(t.id)
        loads = int(lr.loads) if lr else 0
        diesel = diesel_by_truck.get(t.id, 0.0)
        supplier_invs = inv_by_reg.get((t.registration or '').strip().upper()) or []
        supplier_total = sum(float(i.get('amount') or 0) for i in supplier_invs)

        # A truck with nothing captured and nothing typed is not on the sheet —
        # but a zero-amount invoice (a no-charge record) still counts as captured.
        if not lr and not diesel and not sheet and not supplier_invs and rec is None:
            continue

        profit = _profit_sheet_net_profit(
            sheet,
            float(lr.incl or 0) if lr else 0.0,
            float(lr.sub_incl or 0) if lr else 0.0,
            supplier_total,
        )
        rows.append(ProfitSheetReportRowOut(
            truck_id=t.id,
            sort_order=rec.sort_order if rec and rec.sort_order is not None else i,
            is_custom=False,
            # Deleted lines are still sent so the client can list and restore
            # them; it is the client that keeps them off the table and totals.
            is_hidden=bool(rec.is_hidden) if rec else False,
            notes=rec.notes if rec else None,
            auto=ProfitSheetReportAuto(
                reg_no=t.registration,
                driver=drivers.get(t.id) or t.driver_name,
                diesel=round(diesel, 2),
                loads=loads,
                profit=profit,
            ),
            overrides=_overrides(rec),
        ))

    # Hand-added lines (truck_id NULL) — nothing to calculate, all typed.
    for rec in db.query(ProfitSheetReportRow).filter(
        ProfitSheetReportRow.entity_id == entity_id,
        ProfitSheetReportRow.year == year,
        ProfitSheetReportRow.month == month,
        ProfitSheetReportRow.truck_id.is_(None),
    ).order_by(ProfitSheetReportRow.sort_order, ProfitSheetReportRow.id).all():
        rows.append(ProfitSheetReportRowOut(
            truck_id=None,
            sort_order=rec.sort_order if rec.sort_order is not None else 9999,
            is_custom=True,
            notes=rec.notes,
            auto=ProfitSheetReportAuto(),
            overrides=_overrides(rec),
        ))

    rows.sort(key=lambda r: (r.sort_order, r.auto.reg_no or ''))
    lock = get_profit_sheet_lock(db, entity_id, year, month)
    return ProfitSheetReportOut(
        entity_id=entity_id, year=year, month=month, rows=rows,
        lock=ProfitSheetLockOut(
            locked=lock is not None,
            locked_at=lock.locked_at if lock else None,
            locked_by_name=(lock.locked_by.full_name if lock and lock.locked_by else None),
        ),
    )


@router.put("/profit-sheet", response_model=ProfitSheetReportOut)
def save_profit_sheet_report(
    payload: ProfitSheetReportSave,
    entity_id: int = Query(...),
    year: int = Query(..., ge=2020),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace the period's saved edits. Only overrides are stored — a row where
    the user typed nothing is dropped rather than written as a wall of NULLs, so
    the report keeps tracking live data until she actually changes something."""
    _check_entity_access(entity_id, current_user)

    lock = get_profit_sheet_lock(db, entity_id, year, month)
    if lock is not None:
        raise HTTPException(
            status_code=423,
            detail=profit_sheet_lock_detail(db, lock, None, year, month),
        )

    db.query(ProfitSheetReportRow).filter(
        ProfitSheetReportRow.entity_id == entity_id,
        ProfitSheetReportRow.year == year,
        ProfitSheetReportRow.month == month,
    ).delete(synchronize_session=False)

    seen_trucks: set[int] = set()
    kept = 0
    for row in payload.rows:
        o = row.overrides
        has_value = any(v is not None and v != '' for v in (
            o.reg_no, o.driver, o.diesel, o.diesel_avg_per_load, o.loads,
            o.profit, o.sand_loads_incl_vat, o.profit_excl_sand, row.notes,
        ))
        # A deleted truck line carries no typed value but must still be stored —
        # it is the only record that she took the line off the report.
        if not has_value and not row.is_hidden:
            continue
        if row.truck_id is not None:
            # The unique index is per truck per period; a duplicate would be a
            # client bug, and keeping the first is the safe reading.
            if row.truck_id in seen_trucks:
                continue
            seen_trucks.add(row.truck_id)
        db.add(ProfitSheetReportRow(
            entity_id=entity_id, year=year, month=month,
            truck_id=row.truck_id, sort_order=row.sort_order,
            reg_no_override=(o.reg_no or None),
            driver_override=(o.driver or None),
            diesel_override=o.diesel,
            diesel_avg_override=o.diesel_avg_per_load,
            loads_override=o.loads,
            profit_override=o.profit,
            sand_loads_incl_vat=o.sand_loads_incl_vat,
            profit_excl_sand_override=o.profit_excl_sand,
            notes=(row.notes or None),
            # Only a truck line can be hidden; a hand-added one is simply gone
            # from the payload, so there is nothing left to flag.
            is_hidden=bool(row.is_hidden and row.truck_id is not None),
        ))
        kept += 1

    log_action(
        db, "report.profit_sheet_saved", user_id=current_user.id, entity_id=entity_id,
        resource_type="profit_sheet_report",
        description=f"Saved {kept} edited line(s) on the Profit Sheet report for {MONTH_NAMES[month - 1]} {year}",
    )
    db.commit()
    return profit_sheet_report(entity_id=entity_id, year=year, month=month,
                               db=db, current_user=current_user)


@router.put("/profit-sheet/lock", response_model=ProfitSheetLockOut)
def set_profit_sheet_lock(
    payload: ProfitSheetLockSet,
    entity_id: int = Query(...),
    year: int = Query(..., ge=2020),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Final-lock (or unlock) the Profit Sheet for one entity-month. Admin only.

    While locked, every reg on the sheet is closed for that month — truck
    loads, food allowance, diesel and truck-linked supplier-invoice expenses
    all refuse new or changed records, and the sheet's own overrides can no
    longer be saved.
    """
    if current_user.role != "admin":
        raise HTTPException(status_code=403,
                            detail="Only administrators can final lock the Profit Sheet.")
    _check_entity_access(entity_id, current_user)

    lock = get_profit_sheet_lock(db, entity_id, year, month)
    period = f"{MONTH_NAMES[month - 1]} {year}"

    if payload.locked and lock is None:
        lock = ProfitSheetLock(entity_id=entity_id, year=year, month=month,
                               locked_by_id=current_user.id)
        db.add(lock)
        log_action(
            db, "report.profit_sheet_locked", user_id=current_user.id, entity_id=entity_id,
            resource_type="profit_sheet_report",
            description=f"Final locked the Profit Sheet for {period}",
        )
        db.commit()
        db.refresh(lock)
    elif not payload.locked and lock is not None:
        db.delete(lock)
        log_action(
            db, "report.profit_sheet_unlocked", user_id=current_user.id, entity_id=entity_id,
            resource_type="profit_sheet_report",
            description=f"Removed the Profit Sheet final lock for {period}",
        )
        db.commit()
        lock = None

    return ProfitSheetLockOut(
        locked=lock is not None,
        locked_at=lock.locked_at if lock else None,
        locked_by_name=(lock.locked_by.full_name if lock and lock.locked_by else None),
    )
