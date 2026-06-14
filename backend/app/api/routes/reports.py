from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, TruckLoad, DieselFillUp, SupplierInvoice, SupplierInvoiceLineItem,
    DriverPayCycle, Driver, PayrollSettings, PayrollEntry, Supplier, PaymentTermType,
    Invoice, Customer, DocumentType, InvoiceStatus, BusinessEntity,
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
    for fd, amount, vat, term in diesel_fillups:
        is_cash = getattr(term, 'value', term) == PaymentTermType.current.value
        if is_cash:
            cm = fd.month - 1 if fd.month > 1 else 12
            cy = fd.year if fd.month > 1 else fd.year - 1
        else:
            cm, cy = fd.month, fd.year
        if cy != year:
            continue
        diesel_expense[cm]   = diesel_expense.get(cm, 0.0) + float(amount or 0)
        diesel_input_vat[cm] = diesel_input_vat.get(cm, 0.0) + float(vat or 0)

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
        # Report-only reclassification (source data untouched):
        #   Sasfin → excluded entirely; Crack Logic 'Insurance Claim' → income.
        if _is_sasfin_supplier(inv):
            continue
        if _is_crack_logic_insurance(inv):
            truck_income_incl[m] = truck_income_incl.get(m, 0.0) + round(incl, 2)
            truck_income_excl[m] = truck_income_excl.get(m, 0.0) + round(excl, 2)
            continue
        # Round per-invoice (matching the SARS VAT detail) so the month-line totals
        # tie exactly to the drill-down rather than drifting a few cents on incl/1.15.
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
        # Input VAT is the supplier-invoice VAT only — matching the SARS VAT detail
        # drill-down (_build_month_detail). diesel_input_vat is the VAT on the internal
        # 1% diesel admin-fee markup, NOT supplier input VAT, so it must not be added
        # here (doing so over-claimed input VAT and understated VAT payable, most
        # visibly for OBHI where diesel volume is high). Reported separately for info.
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
    """Build per-invoice detail dict for one month (shared by single and annual endpoints)."""
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
            'date':        inv.issue_date.strftime('%Y-%m-%d') if inv.issue_date else None,
            'description': desc,
            'amount_incl': round(incl, 2),
            'amount_excl': round(excl, 2),
            'vat':         round(incl - excl, 2),
            'category':    ocat,
        })

    # (Output grouping is built below, after supplier invoices are processed —
    #  Crack Logic 'Insurance Claim' invoices get reclassified onto the income side.)

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
        # Report-only reclassification (source data untouched):
        #   Sasfin → excluded from the report; Crack Logic 'Insurance Claim' →
        #   moved onto the income/output side as an insurance-claim reimbursement.
        if _is_sasfin_supplier(inv):
            continue
        if _is_crack_logic_insurance(inv):
            output_invoices.append({
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
            'date':           inv.invoice_date.strftime('%Y-%m-%d') if inv.invoice_date else None,
            'invoice_number': inv.invoice_number or '',
            'supplier_name':  name,
            'description':    inv.description or name,
            'amount_incl':    round(incl, 2),
            'amount_excl':    round(excl, 2),
            'vat':            round(incl - excl, 2),
            'vat_applicable': inv.vat_applicable,
            'category':       category,
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
        input_groups.append({
            'key':         key,
            'label':       _CAT_LABEL[key],
            'count':       len(rows),
            'amount_incl': round(sum(x['amount_incl'] for x in rows), 2),
            'amount_excl': round(sum(x['amount_excl'] for x in rows), 2),
            'vat':         round(sum(x['vat'] for x in rows), 2),
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
        output_groups.append({
            'key':         key,
            'label':       _OCAT_LABEL[key],
            'count':       len(rows),
            'amount_incl': round(sum(x['amount_incl'] for x in rows), 2),
            'amount_excl': round(sum(x['amount_excl'] for x in rows), 2),
            'vat':         round(sum(x['vat'] for x in rows), 2),
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
