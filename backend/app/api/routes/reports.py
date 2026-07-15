from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, TruckLoad, DieselFillUp, SupplierInvoice, SupplierInvoiceLineItem,
    DriverPayCycle, Driver, PayrollSettings, PayrollEntry, Supplier, PaymentTermType,
    Invoice, Customer, DocumentType, InvoiceStatus, BusinessEntity,
    Truck, Subcontractor,
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
    exclude_general = _exclude_general_expenses(db, entity_id)

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

    # ── Supplier invoice expenses grouped by actual invoice date ────────────────
    # Unlike costing (which uses statement_month/statement_year so a late-arriving
    # invoice costs in the statement it was captured against), this report reflects
    # the real SARS-deductible period, so it groups by the invoice's own date.
    all_supplier_invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.entity_id == entity_id,
            func.extract('year', SupplierInvoice.invoice_date) == year,
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
        if inv.invoice_date is None:
            continue
        m = inv.invoice_date.month
        incl = float(inv.amount)
        if inv.id in line_excl_by_inv:
            excl = line_excl_by_inv[inv.id]
        elif inv.vat_applicable:
            excl = incl / 1.15
        else:
            excl = incl
        # Report-only reclassification (source data untouched):
        #   Sasfin → excluded entirely; general costing expenses and Trailer
        #   Maintenance supplier invoices → excluded (OBHI only); Crack Logic
        #   'Insurance Claim' → income.
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
    exclude_general = _exclude_general_expenses(db, entity_id)
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

    # Grouped by the invoice's actual date, not statement_month/statement_year —
    # costing uses the statement period, but SARS deductibility follows the real
    # invoice date regardless of which statement it was captured against.
    sup_invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.entity_id == entity_id,
            func.extract('year', SupplierInvoice.invoice_date) == year,
            func.extract('month', SupplierInvoice.invoice_date) == month,
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
