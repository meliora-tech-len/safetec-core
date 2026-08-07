"""Subcontractor costing "Sent" flag — shared period + lock helpers.

A truck's costing for a period can be marked SENT (truck_costing_sent). Two
rules flow from that flag:

1. Roll-forward: an expense contribution whose natural costing period was
   already sent when the expense was CAPTURED (created_at after sent_at) moves
   forward into the next unsent month's costing, so the statement the
   subcontractor received never changes retroactively.
2. Lock: an invoice that sits ON a sent costing (captured before the send)
   may no longer be amended, archived or deleted.
"""
from datetime import timezone
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import (
    BusinessEntity, PaymentTermType, Subcontractor, SupplierInvoice, Truck,
    TruckCostingSent,
)

# Safety bound on the roll-forward walk (a chain this long cannot occur in
# practice — it would need every one of these consecutive months sent before
# the expense was captured).
_MAX_ROLL_MONTHS = 24


def period_add(year: int, month: int, delta: int):
    """Shift a (year, month) pair by `delta` whole months."""
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _dt_lte(a, b) -> bool:
    """Compare two datetimes that may differ in tz-awareness (SQLite stores
    naive, Postgres aware) — a naive value is read as UTC."""
    if a.tzinfo is None and b.tzinfo is not None:
        a = a.replace(tzinfo=timezone.utc)
    elif b.tzinfo is None and a.tzinfo is not None:
        b = b.replace(tzinfo=timezone.utc)
    return a <= b


def build_sent_map(db: Session, truck_ids) -> dict:
    """{(truck_id, year, month): sent_at} for every sent costing period of the
    given trucks."""
    ids = list(truck_ids)
    if not ids:
        return {}
    return {
        (s.truck_id, s.year, s.month): s.sent_at
        for s in db.query(TruckCostingSent).filter(TruckCostingSent.truck_id.in_(ids)).all()
    }


def roll_past_sent(period: tuple, truck_id: int, created_at, sent_map: dict) -> tuple:
    """Effective costing period for one truck's share of an expense: starting
    from the natural period, step forward past every period that was already
    SENT when the expense was captured. Stops at the first period that is
    unsent, or that was sent only after the capture (the expense was part of
    what went out)."""
    for _ in range(_MAX_ROLL_MONTHS):
        sent_at = sent_map.get((truck_id, period[0], period[1]))
        if sent_at is None or created_at is None or _dt_lte(created_at, sent_at):
            return period
        period = period_add(period[0], period[1], 1)
    return period


def costing_override_period(inv) -> Optional[tuple]:
    """Manual "Manage → Move" costing override, or None. When set, the invoice
    costs in exactly this (year, month) — bypassing both the cash-supplier shift
    and the sent-costing roll-forward."""
    if inv is None:
        return None
    y = getattr(inv, "costing_period_year", None)
    m = getattr(inv, "costing_period_month", None)
    if y and m:
        return (y, m)
    return None


def natural_invoice_period(inv: SupplierInvoice, is_safetec: bool) -> Optional[tuple]:
    """The costing (year, month) a supplier invoice naturally belongs to:
    a manual costing override wins outright; otherwise 30-day suppliers and
    custom (no-supplier) expenses cost in their statement period, while
    cash/current suppliers cost one month BEFORE their statement period (a June
    cash invoice belongs to May's costing). Safetec ignores the cash-vs-30-day
    timing rule entirely."""
    override = costing_override_period(inv)
    if override is not None:
        return override
    if inv.statement_year is None or inv.statement_month is None:
        return None
    stmt = (inv.statement_year, inv.statement_month)
    if is_safetec or inv.supplier_id is None:
        return stmt
    if inv.supplier and inv.supplier.payment_term == PaymentTermType.current:
        return period_add(stmt[0], stmt[1], -1)
    return stmt


def _norm_reg(reg) -> str:
    return (reg or "").replace(" ", "").strip().upper()


def truck_regs(truck: Truck) -> set:
    """Every registration this truck is known by: the real plate plus any
    temp/old plate, so invoices captured under either stay with the truck
    after a registration change."""
    return {r for r in (_norm_reg(truck.registration), _norm_reg(truck.temp_registration)) if r}


def truck_invoice_contribution(inv: SupplierInvoice, regs: set):
    """How much of a non-diesel supplier invoice is attributable to one truck,
    split into a non-VAT (excl) and a VAT (incl) bucket.

    Returns (matched, excl_nonvat, incl_vat). `matched` is True only when a
    positive amount applies to this truck. The caller sums both buckets into the
    truck's expenses; the split only drives the Excl-VAT vs Incl-VAT columns.

    - Matching is against ALL the truck's known regs (real + temp plate).
    - Multi-line / split invoices whose sub-lines carry a per-line vehicle reg
      (stored in ``unit``) are matched per sub-line, and each line is bucketed by
      its OWN VAT status (a line is zero-rated when incl == excl), so a single
      invoice can now mix VAT and non-VAT lines.
    - Single-line invoices (and legacy multi-line invoices with no per-line reg)
      fall back to the main-line ``vehicle_reg`` and the invoice-level VAT flag.

    Diesel-supplier invoices are included so that their NON-fuel lines (parking,
    maintenance — no slip in ``item_code``) still cost against the truck. Their
    fuel lines carry a slip and are already costed via the truck's DieselFillUp
    rows, so we skip any line with a slip here to avoid double-counting; a diesel
    single-line invoice is fuel by nature, so it contributes nothing on this path.
    """
    D0 = Decimal("0")
    if not regs:
        return False, D0, D0
    is_diesel = bool(inv.supplier and inv.supplier.is_diesel_supplier)

    if inv.is_multi_line and inv.line_items:
        has_line_reg = any((li.unit or "").strip() for li in inv.line_items)
        if has_line_reg:
            excl_nonvat, incl_vat = D0, D0
            matched = False
            for li in inv.line_items:
                if _norm_reg(li.unit) not in regs:
                    continue
                # A slipped line on a diesel statement is fuel — costed via its
                # DieselFillUp, not here. Non-fuel lines (no slip) fall through.
                if is_diesel and (li.item_code or "").strip():
                    continue
                e = Decimal(str(li.amount_excl_vat or 0))
                i = Decimal(str(li.amount_incl_vat or 0))
                if e == 0 and i == 0:
                    continue
                matched = True
                if i > e:          # line carries VAT
                    incl_vat += i
                else:              # zero-rated / non-VAT line (incl == excl)
                    excl_nonvat += e
            return matched, excl_nonvat, incl_vat

    if is_diesel:
        # Single-line / legacy diesel invoice: fuel, already costed via fill-ups.
        return False, D0, D0

    if _norm_reg(inv.vehicle_reg) in regs:
        amt = Decimal(str(inv.amount))
        if amt == 0:
            return False, D0, D0
        if inv.vat_applicable:
            return True, D0, amt
        return True, amt, D0
    return False, D0, D0


def invoice_costing_targets(db: Session, inv: SupplierInvoice) -> list:
    """Value-verification targets for every costing row this invoice shows on:
    one `costing:{sub}:{YYYY-MM}:truck:{id}:invoice:{id}:amount` key per truck
    the invoice contributes to, in that truck's effective costing period — the
    same key the costing UI binds its per-invoice verification tick to."""
    trucks = (
        db.query(Truck)
        .join(Subcontractor, Subcontractor.id == Truck.subcontractor_id)
        .filter(Subcontractor.entity_id == inv.entity_id)
        .all()
    )
    matched = [t for t in trucks if truck_invoice_contribution(inv, truck_regs(t))[0]]
    if not matched:
        return []

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == inv.entity_id).first()
    is_safetec = bool(entity and (entity.code or "").upper() == "SFT")
    natural = natural_invoice_period(inv, is_safetec)
    if natural is None:
        return []

    sent_map = build_sent_map(db, [t.id for t in matched])
    pinned = inv.is_fixed_expense or costing_override_period(inv) is not None
    targets = []
    for t in matched:
        eff = natural if pinned else roll_past_sent(natural, t.id, inv.created_at, sent_map)
        targets.append(
            f"costing:{t.subcontractor_id}:{eff[0]}-{eff[1]:02d}:truck:{t.id}:invoice:{inv.id}:amount"
        )
    return targets


def invoice_sent_lock_message(db: Session, inv: SupplierInvoice,
                              extra_reg: str | None = None) -> Optional[str]:
    """If this invoice contributes to a truck costing period that has been
    marked Sent, return a human-readable lock message; else None. `extra_reg`
    lets a line-item add/edit include the incoming reg before it is saved."""
    regs = set()
    if inv.is_multi_line and inv.line_items:
        for li in inv.line_items:
            r = _norm_reg(li.unit)
            if r:
                regs.add(r)
    for r in (_norm_reg(inv.vehicle_reg), _norm_reg(extra_reg)):
        if r:
            regs.add(r)
    if not regs:
        return None

    trucks = (
        db.query(Truck)
        .join(Subcontractor, Subcontractor.id == Truck.subcontractor_id)
        .filter(Subcontractor.entity_id == inv.entity_id)
        .all()
    )
    matched = [
        t for t in trucks
        if regs & {x for x in (_norm_reg(t.registration), _norm_reg(t.temp_registration)) if x}
    ]
    if not matched:
        return None

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == inv.entity_id).first()
    is_safetec = bool(entity and (entity.code or "").upper() == "SFT")
    natural = natural_invoice_period(inv, is_safetec)
    if natural is None:
        return None

    sent_map = build_sent_map(db, [t.id for t in matched])
    if not sent_map:
        return None

    pinned = inv.is_fixed_expense or costing_override_period(inv) is not None
    for t in matched:
        # Fixed general expenses are per-month clones pinned to their period, and
        # a manual costing override pins the month outright; everything else may
        # have rolled forward past sent months.
        eff = natural if pinned else roll_past_sent(natural, t.id, inv.created_at, sent_map)
        if (t.id, eff[0], eff[1]) in sent_map:
            return (
                f"This expense is part of the {eff[1]:02d}/{eff[0]} costing for {t.registration}, "
                "which has been sent to the subcontractor and is locked. "
                "It must be un-sent before this can change."
            )
    return None


def ensure_not_on_sent_costing(db: Session, inv: SupplierInvoice,
                               updates: dict | None = None,
                               allowed_fields: set | None = None,
                               extra_reg: str | None = None):
    """Raise 403 when the invoice sits on a sent (locked) costing. Pass
    `updates` + `allowed_fields` to let pure workflow-status changes (marking
    paid, notes) through on locked records — mirrors ensure_not_locked."""
    if updates is not None and allowed_fields is not None and set(updates) <= allowed_fields:
        return
    msg = invoice_sent_lock_message(db, inv, extra_reg=extra_reg)
    if msg:
        raise HTTPException(status_code=403, detail=msg)
