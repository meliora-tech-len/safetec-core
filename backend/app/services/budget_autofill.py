"""Budget auto-fill — aggregate existing system data into budget lines.

Given an entity and a rolling window of (month, year) periods, produce a flat list
of "auto line" specs that the budgets route materialises into BudgetLine /
BudgetLineValue rows. Each spec is keyed by a stable `source_key` so a refresh
updates the same line instead of duplicating it.

Sources (each lands in its own section):
  - 30 DAY / CASH / DIESEL /
    INTERCOMPANY              → supplier invoices grouped by supplier (due vs paid),
                                sectioned by payment term / diesel / is_intercompany flag
                                (intercompany takes priority over the other flags)
  - SUB CONTRACTORS           → per-subcontractor net payable
  - WAGES                     → payroll gross per period

INCOME is deliberately NOT one of them. Income is chosen, not pulled: the user
opens a modal, sees one candidate row per PO plus one row per invoice that has no
PO (each labelled by its invoice number), and assigns what belongs in the budget
to one of the two generic income lines (TRADEKOR INCOME ONLY / OTHER INCOME).
See income_candidates() — the budgets route sums the assigned candidates into
those two lines (INCOME_BUCKETS in routes/budgets.py).

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
    Invoice, DocumentType, InvoiceStatus, Customer,
    Subcontractor, PayrollEntry,
    BusinessEntity,
)

log = logging.getLogger(__name__)

# Section names — MUST match the budgets DEFAULT_SECTIONS so auto lines land in
# the existing section rather than creating a duplicate.
SEC_INCOME = ("INCOME", "income")
SEC_30DAY = ("30 DAY SUPPLIERS", "expense")
SEC_CASH = ("CASH / CURRENT SUPPLIERS", "expense")
SEC_DIESEL = ("DIESEL", "expense")
SEC_INTERCOMPANY = ("INTERCOMPANY INVOICES", "expense")
SEC_SUBS = ("SUB CONTRACTORS", "expense")
SEC_WAGES = ("WAGES", "expense")
SEC_OTHER = ("OTHER", "expense")

# Entities whose invoicing lags into the following month (Tradekor pays out PO
# invoices in arrears) — their INCOME line counts everything issued from the 1st
# of the budgeted month through the 15th of the NEXT month, not just the
# calendar month. Every other entity keeps plain calendar-month bucketing.
INCOME_EXTENDED_WINDOW_ENTITIES = {"OBHI", "SFT"}


def _d(v) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal("0")


def _prev_month(month: int, year: int) -> Tuple[int, int]:
    return (12, year - 1) if month == 1 else (month - 1, year)


def _next_month(month: int, year: int) -> Tuple[int, int]:
    return (1, year + 1) if month == 12 else (month + 1, year)


def compute_autofill(entity_id: int, months: List[Tuple[int, int]], current_user=None,
                     shift_30day: bool = False, section_names: set = None) -> List[dict]:
    """Return a list of auto-line specs:
        { section_name, section_type, source_key, line_name,
          values: { (month, year): {"due": Decimal|None, "paid": Decimal|None} } }

    Reads run in a single throwaway session, SEPARATE from the caller's write
    transaction, so they can never corrupt the budget being saved. Each source is
    best-effort: a failure is rolled back (on this read session only) and skipped.
    All queries are lean column selects, so the whole pass is a handful of fast
    round-trips.

    section_names limits the pull to those sections — it runs only the sources
    that can feed them and drops any spec landing elsewhere, so the per-section
    "Pull from System" button touches nothing but its own section. None = every
    section (except INCOME, which is never pulled — see income_candidates).

    shift_30day (statement-period entities, e.g. OBHI): `months` is
    [statement-1, statement]. Every source is pulled for the single STATEMENT
    period (the last month) only; 30-day supplier invoices are then placed in the
    previous month, everything else stays in the statement month.
    """
    db = SessionLocal()
    specs: List[dict] = []
    try:
        # Statement-period entities: query the statement period only; _suppliers
        # then back-dates its 30-day rows into the previous month itself.
        mths = [months[-1]] if shift_30day else months

        if section_names is None:
            fns = _ALL_SOURCES
        else:
            fns = {SECTION_SOURCES[n] for n in section_names if n in SECTION_SOURCES}

        for fn in fns:
            try:
                if fn is _suppliers:
                    specs += fn(db, entity_id, mths, shift_30day=shift_30day)
                elif fn is _subcontractors:
                    # Needs the user to run the per-subcontractor costing (access
                    # check + fixed-expense carry-forward).
                    specs += fn(db, entity_id, mths, current_user)
                else:
                    specs += fn(db, entity_id, mths)
            except Exception:
                db.rollback()
                log.exception("budget autofill: source %s failed", fn.__name__)

        if section_names is not None:
            specs = [s for s in specs if s["section_name"] in section_names]
        return specs
    finally:
        db.close()


# ── Income (customer invoices, grouped by PO) ─────────────────────────────────


def _income_window(m: int, y: int, extended: bool):
    """The issue-date filter for a month's income.

    Extended entities (OBHI/SFT) count everything issued from the 1st of (m, y)
    through the 15th of the NEXT month — Tradekor pays PO invoices in arrears, so
    they land weeks late. Note the windows deliberately overlap: an invoice
    issued on the 10th of July counts toward both June's window and July's own
    month. That is the long-standing behaviour of this budget — each column is
    the income attributable to that month's cycle, not a partition of invoices.
    """
    if not extended:
        return and_(
            extract("month", Invoice.issue_date) == m,
            extract("year", Invoice.issue_date) == y,
        )
    nm, ny = _next_month(m, y)
    return or_(
        and_(extract("year", Invoice.issue_date) == y, extract("month", Invoice.issue_date) == m),
        and_(extract("year", Invoice.issue_date) == ny, extract("month", Invoice.issue_date) == nm,
             extract("day", Invoice.issue_date) <= 15),
    )


def income_candidates(entity_id: int, months: List[Tuple[int, int]]) -> List[dict]:
    """Selectable income rows for the budget's Income modal.

    One spec per PO number (source_key "income:po:<POH…>"), plus one spec per
    invoice that has NO PO (source_key "income:inv:<invoice_id>", labelled by its
    invoice number). Same spec shape as the autofill sources, so the route can
    materialise a ticked candidate through exactly the same path.

    Every spec carries an "invoice_number" for the modal to flag: the single
    number on a per-invoice row, and the comma-joined list of the underlying
    invoice numbers on a PO row (a PO may bundle several invoices). The label
    leads with that invoice number, then the PO, then the customer — the invoice
    number is what the user reconciles against, so it comes first.

    Rows sort by invoice number.
    """
    db = SessionLocal()
    try:
        code = (db.query(BusinessEntity.code).filter(BusinessEntity.id == entity_id).scalar() or "").upper()
        extended = code in INCOME_EXTENDED_WINDOW_ENTITIES

        grouped: Dict[str, dict] = {}
        for (m, y) in months:
            rows = (
                db.query(Invoice.id, Invoice.invoice_number, Invoice.po_number, Customer.name, Invoice.total)
                .outerjoin(Customer, Invoice.customer_id == Customer.id)
                .filter(
                    Invoice.entity_id == entity_id,
                    Invoice.document_type == DocumentType.invoice,
                    Invoice.status != InvoiceStatus.cancelled,
                    _income_window(m, y, extended),
                )
                .all()
            )
            for inv_id, inv_number, po, customer_name, total in rows:
                if po:
                    # A PO groups all its invoices into one row — labelled by the
                    # invoice number(s) that fall under it, then the PO.
                    key = f"income:po:{po}"
                else:
                    # No PO (hand-keyed invoices never carry a POH) — one row per
                    # invoice, labelled by its number so the user knows which it is.
                    key = f"income:inv:{inv_id}"
                spec = grouped.get(key)
                if spec is None:
                    spec = {
                        "section_name": SEC_INCOME[0], "section_type": SEC_INCOME[1],
                        "source_key": key, "line_name": "",
                        "po_number": po or None, "customer_name": customer_name,
                        "_inv_numbers": set(), "values": {},
                    }
                    grouped[key] = spec
                if customer_name and not spec["customer_name"]:
                    spec["customer_name"] = customer_name
                if inv_number:
                    # Windows overlap (an invoice can land in two months) — the set
                    # dedupes so a number is never listed twice.
                    spec["_inv_numbers"].add(inv_number)
                cell = spec["values"].setdefault((m, y), {"due": Decimal("0"), "paid": None})
                cell["due"] += _d(total)

        for spec in grouped.values():
            nums = spec.pop("_inv_numbers")
            spec["invoice_number"] = ", ".join(sorted(nums)) if nums else None
            # Invoice number first, then the PO, then the customer — whichever
            # of those the row actually has.
            parts = [p for p in (spec["invoice_number"], spec["po_number"], spec["customer_name"]) if p]
            spec["line_name"] = " — ".join(parts) or spec["source_key"]

        return sorted(
            grouped.values(),
            key=lambda s: (s["invoice_number"] or "", s["line_name"]),
        )
    finally:
        db.close()


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
            Supplier.is_intercompany, Supplier.exclude_from_budget,
            SupplierInvoice.invoice_number,
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
    for (sup_id, text_name, amount, is_paid, m, y, s_id, s_name, s_diesel, s_term, s_intercompany, s_excluded, inv_number) in rows:
        if (m, y) not in months:
            continue
        if s_id is not None:
            if s_excluded:
                continue   # user explicitly excluded this supplier from budget pulls
            key = f"supplier:{s_id}"
            name = s_name
            # Intercompany takes priority over diesel/term — a supplier that's another
            # entity in the Safetec system belongs in its own section, not cash/current.
            if s_intercompany:
                section = SEC_INTERCOMPANY
            elif s_diesel:
                section = SEC_DIESEL
            elif s_term == PaymentTermType.days_30:
                section = SEC_30DAY
            else:
                section = SEC_CASH
        else:
            # No linked supplier AND no invoice number = a free-text "general" expense
            # added in the costing module (e.g. trailer/truck insurance allocations).
            # Those are internal costing allocations already reflected in the
            # Subcontractors section's payout figures — pulling them again here would
            # double-count them, so they're excluded from the budget entirely.
            if not (inv_number or "").strip():
                continue
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


# ── Sub-contractors (net "to be paid" from the costing) ──────────────────────
def _subcontractors(db, entity_id, months, current_user=None) -> List[dict]:
    """Per-subcontractor net payable = the monthly-summary "To Be Paid Out" figure
    from that subcontractor's costing for the period — income less the operator's own
    diesel/invoice/admin expenses, honouring any manual net-payable override. This is
    exactly the total the Subcontractor Costing screen shows (e.g. Alex Maintenance's
    July summary), so the budget line matches the costing to the rand.

    One line per active subcontractor, valued per month from that month's costing
    summary. Running the full costing per subcontractor/month is heavier than a single
    load SUM, but the SUB CONTRACTORS pull is a manual, per-section action, so the
    accuracy is worth the round-trips. Each build reads/writes on the throwaway
    autofill session; a per-subcontractor failure is caught by compute_autofill and
    that subcontractor simply contributes no line (the user can add it by hand).
    """
    # Lazy import avoids a route↔service import cycle at module load.
    from app.api.routes.subcontractors import _build_subcontractor_costing

    subs = (
        db.query(Subcontractor)
        .filter(
            Subcontractor.entity_id == entity_id,
            Subcontractor.is_active == True,            # noqa: E712
        )
        .order_by(Subcontractor.name)
        .all()
    )

    specs: List[dict] = []
    for sub in subs:
        values: Dict[Tuple[int, int], dict] = {}
        for (m, y) in months:
            costing = _build_subcontractor_costing(sub.id, m, y, db, current_user)
            net = costing.summary.net_payable
            if net:
                values[(m, y)] = {"due": _d(net), "paid": None}
        if values:
            specs.append({
                "section_name": SEC_SUBS[0], "section_type": SEC_SUBS[1],
                "source_key": f"subcontractor:{sub.id}", "line_name": sub.name,
                "values": values,
            })
    return specs


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


# ── Section → source wiring ──────────────────────────────────────────────────
# Which source feeds a given section. Drives the per-section "Pull from System"
# button: pulling 30 DAY SUPPLIERS runs only _suppliers, and only its 30-day
# specs are kept. A section absent from this map has no system source at all
# (DEBIT ORDERS is hand-entered; INCOME is modal-driven via income_candidates),
# so it gets no pull button.
SECTION_SOURCES = {
    SEC_30DAY[0]: _suppliers,
    SEC_CASH[0]: _suppliers,
    SEC_DIESEL[0]: _suppliers,
    SEC_INTERCOMPANY[0]: _suppliers,
    SEC_OTHER[0]: _suppliers,
    SEC_SUBS[0]: _subcontractors,
    SEC_WAGES[0]: _wages,
}

_ALL_SOURCES = (_suppliers, _subcontractors, _wages)
