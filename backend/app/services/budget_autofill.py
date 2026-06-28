"""Budget auto-fill — aggregate existing system data into budget lines.

Given an entity and a rolling window of (month, year) periods, produce a flat list
of "auto line" specs that the budgets route materialises into BudgetLine /
BudgetLineValue rows. Each spec is keyed by a stable `source_key` so a refresh
updates the same line instead of duplicating it.

Sources (each lands in its own section):
  - INCOME                    → customer invoices for the period
  - 30 DAY / CASH / DIESEL    → supplier invoices grouped by supplier (due vs paid),
                                sectioned by payment term / diesel flag
  - SUB CONTRACTORS           → per-subcontractor net payable
  - WAGES                     → payroll gross per period

Robustness: every source runs in its OWN throwaway read session (never the caller's
write transaction). So a slow/heavy read or a dropped pooled connection can neither
corrupt the budget being written nor take down the other sources — a failed source
just contributes nothing (the user fills that section in manually).
"""
import logging
from decimal import Decimal
from typing import List, Tuple, Dict

from sqlalchemy import func, and_, or_, extract

from app.db.database import SessionLocal
from app.models.models import (
    SupplierInvoice, Supplier, PaymentTermType,
    Invoice, DocumentType, InvoiceStatus,
    Subcontractor, PayrollEntry, TruckLoad, Truck,
)

log = logging.getLogger(__name__)

# Section names — MUST match the budgets DEFAULT_SECTIONS so auto lines land in
# the existing section rather than creating a duplicate.
SEC_INCOME = ("INCOME", "income")
SEC_30DAY = ("30 DAY SUPPLIERS", "expense")
SEC_CASH = ("CASH / CURRENT SUPPLIERS", "expense")
SEC_DIESEL = ("DIESEL", "expense")
SEC_SUBS = ("SUB CONTRACTORS", "expense")
SEC_WAGES = ("WAGES", "expense")
SEC_OTHER = ("OTHER", "expense")


def _d(v) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal("0")


def _prev_month(month: int, year: int) -> Tuple[int, int]:
    return (12, year - 1) if month == 1 else (month - 1, year)


def compute_autofill(entity_id: int, months: List[Tuple[int, int]], current_user=None,
                     shift_30day: bool = False) -> List[dict]:
    """Return a list of auto-line specs:
        { section_name, section_type, source_key, line_name,
          values: { (month, year): {"due": Decimal|None, "paid": Decimal|None} } }

    Reads run in a single throwaway session, SEPARATE from the caller's write
    transaction, so they can never corrupt the budget being saved. Each source is
    best-effort: a failure is rolled back (on this read session only) and skipped.
    All queries are lean column selects, so the whole pass is a handful of fast
    round-trips.

    shift_30day (statement-period entities, e.g. OBHI): `months` is
    [statement-1, statement]. Every source is pulled for the single STATEMENT
    period (the last month) only; 30-day supplier invoices are then placed in the
    previous month, everything else stays in the statement month.
    """
    db = SessionLocal()
    specs: List[dict] = []
    try:
        if shift_30day:
            statement = [months[-1]]   # query only the statement period
            sources = (
                (_income, statement),
                (_suppliers, statement),
                (_subcontractors, statement),
                (_wages, statement),
            )
        else:
            sources = (
                (_income, months), (_suppliers, months),
                (_subcontractors, months), (_wages, months),
            )
        for fn, mths in sources:
            try:
                specs += fn(db, entity_id, mths, shift_30day=shift_30day) if fn is _suppliers \
                    else fn(db, entity_id, mths)
            except Exception:
                db.rollback()
                log.exception("budget autofill: source %s failed", fn.__name__)
        return specs
    finally:
        db.close()


# ── Income (customer invoices) ────────────────────────────────────────────────
def _income(db, entity_id, months) -> List[dict]:
    values: Dict[Tuple[int, int], dict] = {}
    for (m, y) in months:
        total = (
            db.query(func.coalesce(func.sum(Invoice.total), 0))
            .filter(
                Invoice.entity_id == entity_id,
                extract("month", Invoice.issue_date) == m,
                extract("year", Invoice.issue_date) == y,
                Invoice.document_type == DocumentType.invoice,
                Invoice.status != InvoiceStatus.cancelled,
            )
            .scalar()
        )
        if total:
            values[(m, y)] = {"due": _d(total), "paid": None}
    if not values:
        return []
    return [{
        "section_name": SEC_INCOME[0], "section_type": SEC_INCOME[1],
        "source_key": "income:invoices", "line_name": "Customer Invoices (income)",
        "values": values,
    }]


# ── Suppliers (grouped by supplier, due vs paid, sectioned by term) ───────────
def _suppliers(db, entity_id, months, shift_30day: bool = False) -> List[dict]:
    period_filter = or_(*[
        and_(SupplierInvoice.statement_year == y, SupplierInvoice.statement_month == m)
        for (m, y) in months
    ])
    rows = (
        db.query(
            SupplierInvoice.supplier_id, SupplierInvoice.supplier_name_text,
            SupplierInvoice.amount, SupplierInvoice.is_paid,
            SupplierInvoice.statement_month, SupplierInvoice.statement_year,
            Supplier.id, Supplier.name, Supplier.is_diesel_supplier, Supplier.payment_term,
        )
        .outerjoin(Supplier, SupplierInvoice.supplier_id == Supplier.id)
        .filter(
            SupplierInvoice.entity_id == entity_id,
            SupplierInvoice.is_archived == False,  # noqa: E712
            period_filter,
        )
        .all()
    )
    grouped: Dict[str, dict] = {}
    for (sup_id, text_name, amount, is_paid, m, y, s_id, s_name, s_diesel, s_term) in rows:
        if (m, y) not in months:
            continue
        if s_id is not None:
            key = f"supplier:{s_id}"
            name = s_name
            if s_diesel:
                section = SEC_DIESEL
            elif s_term == PaymentTermType.days_30:
                section = SEC_30DAY
            else:
                section = SEC_CASH
        else:
            name = (text_name or "Other").strip() or "Other"
            key = f"supplier_text:{name.lower()}"
            section = SEC_OTHER
        spec = grouped.get(key)
        if spec is None:
            spec = {
                "section_name": section[0], "section_type": section[1],
                "source_key": key, "line_name": name, "values": {},
            }
            grouped[key] = spec
        # Statement-period entities: 30-day invoices are budgeted in the month
        # BEFORE their statement month; cash/diesel stay in the statement month.
        tm, ty = (_prev_month(m, y) if shift_30day and section is SEC_30DAY else (m, y))
        cell = spec["values"].setdefault((tm, ty), {"due": Decimal("0"), "paid": Decimal("0")})
        if is_paid:
            cell["paid"] += _d(amount)
        else:
            cell["due"] += _d(amount)
    return list(grouped.values())


# ── Sub-contractors (gross payout from loads) ────────────────────────────────
def _subcontractors(db, entity_id, months) -> List[dict]:
    """Per-subcontractor gross payout = sum of TruckLoad.subcontractor_amount_incl_vat
    for that subcontractor's trucks in the period. This is the GROSS payable from the
    loads, before the operator's own diesel/expense deductions — one lean query, so
    the refresh stays fast and reliable (the full net-payable costing is far too heavy
    to run synchronously). The user can adjust to net on the (editable) line.
    """
    rows = (
        db.query(
            Truck.subcontractor_id,
            Subcontractor.name,
            TruckLoad.statement_year, TruckLoad.statement_month,
            TruckLoad.load_date, TruckLoad.subcontractor_amount_incl_vat,
        )
        .join(Truck, TruckLoad.truck_id == Truck.id)
        .join(Subcontractor, Truck.subcontractor_id == Subcontractor.id)
        .filter(
            Subcontractor.entity_id == entity_id,
            Subcontractor.is_active == True,            # noqa: E712
            TruckLoad.is_archived == False,             # noqa: E712
            TruckLoad.subcontractor_amount_incl_vat.isnot(None),
        )
        .all()
    )
    grouped: Dict[str, dict] = {}
    for sub_id, sub_name, st_year, st_month, load_date, amount in rows:
        # Costing files a load under its statement period, falling back to load_date.
        m = st_month or (load_date.month if load_date else None)
        y = st_year or (load_date.year if load_date else None)
        if (m, y) not in months:
            continue
        key = f"subcontractor:{sub_id}"
        spec = grouped.get(key)
        if spec is None:
            spec = {
                "section_name": SEC_SUBS[0], "section_type": SEC_SUBS[1],
                "source_key": key, "line_name": sub_name, "values": {},
            }
            grouped[key] = spec
        cell = spec["values"].setdefault((m, y), {"due": Decimal("0"), "paid": None})
        cell["due"] += _d(amount)
    return list(grouped.values())


# ── Wages (payroll gross per period) ─────────────────────────────────────────
def _wages(db, entity_id, months) -> List[dict]:
    """Total payroll gross per period from PayrollEntry (one fast SUM per month).
    Entries exist from auto-draft onward, so they cover the figure without the heavy
    per-driver recalculation. A driver with only an un-started cycle (no entry) is
    left for the user to add."""
    values: Dict[Tuple[int, int], dict] = {}
    for (m, y) in months:
        gross = (
            db.query(func.coalesce(func.sum(PayrollEntry.gross), 0))
            .filter(
                PayrollEntry.entity_id == entity_id,
                PayrollEntry.pay_month == m,
                PayrollEntry.pay_year == y,
            )
            .scalar()
        ) or 0
        if gross:
            values[(m, y)] = {"due": _d(gross), "paid": None}
    if not values:
        return []
    return [{
        "section_name": SEC_WAGES[0], "section_type": SEC_WAGES[1],
        "source_key": "wages:payroll", "line_name": "Payroll (gross)",
        "values": values,
    }]
