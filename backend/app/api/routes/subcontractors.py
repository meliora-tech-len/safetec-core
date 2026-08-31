import calendar
import re
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, extract, func
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from decimal import Decimal
from app.db.database import get_db
from app.core.security import get_current_user
from app.core.updates import sent_fields
from app.models.models import User, Subcontractor, Truck, TruckLoad, SupplierInvoice, SupplierInvoiceLineItem, BusinessEntity, DieselSettings, DieselRate, Supplier, DieselFillUp, PaymentTermType, TruckCostingNote, TruckCostingIncome, TruckCostingSent
from app.schemas.schemas import (
    SubcontractorCreate, SubcontractorBulkCreate,
    SubcontractorUpdate, SubcontractorOut,
    TruckLoadOut, TruckOut, SupplierInvoiceOut,
    SubcontractorCostingOut, SubcontractorCostingSummary, SubcontractorTruckCostingOut,
    SupplierStatementGroup, SubcontractorInvoiceCreate,
    DieselFillUpCostingRow, DieselSupplierGroup, SubcontractorCostingNoteUpdate,
    SubcontractorCostingNetOverrideUpdate, SubcontractorCostingSentUpdate,
    TruckCostingIncomeOut, TruckCostingIncomeCreate,
)
from app.services.audit import log_action
from app.services.profit_sheet_lock import ensure_invoice_not_profit_locked
from app.services.costing_sent import (
    build_sent_map, natural_invoice_period, period_add, roll_past_sent, costing_override_period,
    truck_regs as _truck_regs, truck_invoice_contribution as _truck_invoice_contribution,
)
from app.services.verification import get_verification_display
from app.services.vat import entity_vat_rate, DEFAULT_VAT_RATE

router = APIRouter(prefix="/api/subcontractors", tags=["subcontractors"])


from app.core.security import check_entity_access as _check_entity_access


@router.get("/", response_model=List[SubcontractorOut])
def list_subcontractors(
    entity_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    exclude_ended: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Subcontractor)

    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(Subcontractor.entity_id.in_(access_ids))

    if entity_id:
        _check_entity_access(entity_id, current_user)
        query = query.filter(Subcontractor.entity_id == entity_id)

    if not include_inactive:
        query = query.filter(Subcontractor.is_active == True)

    # Only pickers for capturing NEW work (e.g. the diesel "Subbie Name" dropdown)
    # ask for this — ended subcontractors still need to show up in management
    # views so their historical records and costing stay reachable.
    if exclude_ended:
        query = query.filter(or_(
            Subcontractor.end_date.is_(None),
            Subcontractor.end_date >= datetime.now(timezone.utc).date(),
        ))

    if search:
        term = f"%{search}%"
        # Also match a subcontractor by any of its trucks' registration (real or
        # temp plate) — users often know the reg but not the subbie's name.
        truck_match = (
            db.query(Truck.subcontractor_id)
            .filter(
                Truck.subcontractor_id.isnot(None),
                or_(
                    Truck.registration.ilike(term),
                    Truck.temp_registration.ilike(term),
                ),
            )
        )
        query = query.filter(or_(
            Subcontractor.name.ilike(term),
            Subcontractor.trading_name.ilike(term),
            Subcontractor.contact_person.ilike(term),
            Subcontractor.email.ilike(term),
            Subcontractor.id.in_(truck_match),
        ))

    return query.order_by(Subcontractor.name).offset(skip).limit(limit).all()


# NOTE: must be registered before /{subcontractor_id} or "summary" is parsed as an id.
@router.get("/summary")
def subcontractors_financial_summary(
    entity_id: Optional[int] = Query(None),
    period: str = Query("month", pattern="^(month|year|lifetime)$"),
    year: Optional[int] = Query(None, ge=2020),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-subcontractor Income / Outgoing / Profit (excl VAT) for the overview
    table.

    Mirrors the Subcontractor Loads report: income is what we invoice for the
    sub's loads, outgoing is the payout to the sub, and a load belongs to its
    STATEMENT period when one is set, falling back to the load date — so the
    monthly figures reconcile with that report.
    """
    if period == "month" and not (year and month):
        raise HTTPException(status_code=400, detail="year and month are required for a monthly period")
    if period == "year" and not year:
        raise HTTPException(status_code=400, detail="year is required for a yearly period")

    query = (
        db.query(
            Subcontractor.id.label("subcontractor_id"),
            func.coalesce(func.sum(TruckLoad.amount_excl_vat), 0).label("income"),
            func.coalesce(func.sum(TruckLoad.subcontractor_amount_excl_vat), 0).label("outgoing"),
        )
        .join(Truck, Truck.subcontractor_id == Subcontractor.id)
        .join(TruckLoad, TruckLoad.truck_id == Truck.id)
        .filter(TruckLoad.is_archived == False)
    )

    if current_user.role != "admin":
        access_ids = [a.entity_id for a in current_user.entity_access]
        query = query.filter(Subcontractor.entity_id.in_(access_ids))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        query = query.filter(Subcontractor.entity_id == entity_id)

    if period == "month":
        query = query.filter(
            func.coalesce(TruckLoad.statement_month, extract("month", TruckLoad.load_date)) == month,
            func.coalesce(TruckLoad.statement_year, extract("year", TruckLoad.load_date)) == year,
        )
    elif period == "year":
        query = query.filter(
            func.coalesce(TruckLoad.statement_year, extract("year", TruckLoad.load_date)) == year,
        )

    result = []
    for r in query.group_by(Subcontractor.id).all():
        income = float(r.income or 0)
        outgoing = float(r.outgoing or 0)
        result.append({
            "subcontractor_id": r.subcontractor_id,
            "income": income,
            "outgoing": outgoing,
            "profit": round(income - outgoing, 2),
        })
    return result


@router.get("/{subcontractor_id}", response_model=SubcontractorOut)
def get_subcontractor(
    subcontractor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)
    linked = db.query(BusinessEntity).filter(
        BusinessEntity.linked_subcontractor_id == subcontractor_id
    ).first()
    out = SubcontractorOut.model_validate(sub)
    return out.model_copy(update={"linked_entity_id": linked.id if linked else None})


@router.post("/", response_model=SubcontractorOut)
def create_subcontractor(
    payload: SubcontractorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(payload.entity_id, current_user)
    sub = Subcontractor(**payload.model_dump())
    db.add(sub)
    log_action(
        db, "subcontractor.created", user_id=current_user.id,
        entity_id=payload.entity_id, resource_type="subcontractor",
        description=f"Created subcontractor {sub.name}",
    )
    db.commit()
    db.refresh(sub)
    return sub


@router.post("/bulk", response_model=List[SubcontractorOut])
def create_subcontractor_bulk(
    payload: SubcontractorBulkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create the same subcontractor across multiple entities at once."""
    if not payload.entity_ids:
        raise HTTPException(status_code=400, detail="At least one entity must be selected")
    for eid in payload.entity_ids:
        _check_entity_access(eid, current_user)

    fields = payload.model_dump(exclude={"entity_ids"})
    try:
        created = []
        for eid in payload.entity_ids:
            sub = Subcontractor(entity_id=eid, **fields)
            db.add(sub)
            log_action(
                db, "subcontractor.created", user_id=current_user.id,
                entity_id=eid, resource_type="subcontractor",
                description=f"Created subcontractor {sub.name}",
            )
            created.append(sub)
        db.commit()
        for s in created:
            db.refresh(s)
        return created
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create subcontractors")


@router.put("/{subcontractor_id}", response_model=SubcontractorOut)
def update_subcontractor(
    subcontractor_id: int,
    payload: SubcontractorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    updates = sent_fields(payload, "notes", exclude={"clear_end_date"})
    old_vals = {k: str(getattr(sub, k)) for k in updates}
    for field, value in updates.items():
        setattr(sub, field, value)
    if payload.clear_end_date:
        old_vals["end_date"] = str(sub.end_date)
        sub.end_date = None

    log_action(
        db, "subcontractor.updated", user_id=current_user.id,
        entity_id=sub.entity_id, resource_type="subcontractor",
        resource_id=subcontractor_id, description=f"Updated subcontractor {sub.name}",
        old_values=old_vals,
    )
    db.commit()
    db.refresh(sub)
    return sub


# ── Per-subcontractor invoices ────────────────────────────────────────────────

def _invoice_to_out(db: Session, inv: SupplierInvoice) -> SupplierInvoiceOut:
    out = SupplierInvoiceOut.model_validate(inv)
    return out.model_copy(update={
        "supplier_name": inv.supplier.name if inv.supplier else inv.supplier_name_text,
        **get_verification_display(db, inv),
    })


@router.get("/{subcontractor_id}/invoices", response_model=List[SupplierStatementGroup])
def get_subcontractor_invoices(
    subcontractor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    invoices = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.subcontractor_id == subcontractor_id,
            SupplierInvoice.is_archived == False,
        )
        .order_by(
            SupplierInvoice.statement_year.desc(),
            SupplierInvoice.statement_month.desc(),
            SupplierInvoice.invoice_date.desc(),
        )
        .all()
    )

    # Group by (statement_year, statement_month)
    from collections import defaultdict
    grouped: dict = defaultdict(list)
    for inv in invoices:
        key = (inv.statement_year or 0, inv.statement_month or 0)
        grouped[key].append(inv)

    result = []
    for (yr, mo) in sorted(grouped.keys(), reverse=True):
        invs = grouped[(yr, mo)]
        inv_outs = [_invoice_to_out(db, i) for i in invs]
        subtotal = sum(i.amount for i in invs)
        last_day = calendar.monthrange(yr, mo)[1] if yr and mo else None
        due_date = (
            datetime(yr, mo, last_day, 23, 59, 59, tzinfo=timezone.utc)
            if yr and mo else None
        )
        result.append(SupplierStatementGroup(
            statement_month=mo,
            statement_year=yr,
            invoices=inv_outs,
            subtotal=subtotal,
            payment_due_date=due_date,
            is_fully_paid=all(i.is_paid for i in invs),
        ))
    return result


@router.post("/{subcontractor_id}/invoices", response_model=SupplierInvoiceOut)
def create_subcontractor_invoice(
    subcontractor_id: int,
    payload: SubcontractorInvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    inv_date = payload.invoice_date
    if inv_date.tzinfo is None:
        inv_date = inv_date.replace(tzinfo=timezone.utc)

    last_day = calendar.monthrange(inv_date.year, inv_date.month)[1]
    due_date = inv_date.replace(day=last_day, hour=23, minute=59, second=59, microsecond=0)

    inv = SupplierInvoice(
        subcontractor_id=subcontractor_id,
        supplier_id=None,
        entity_id=sub.entity_id,
        invoice_date=inv_date,
        invoice_number=payload.invoice_number.strip(),
        amount=payload.amount,
        vat_applicable=payload.vat_applicable,
        vehicle_reg=payload.vehicle_reg.strip() if payload.vehicle_reg else None,
        description=payload.description.strip() if payload.description else None,
        notes=payload.notes.strip() if payload.notes else None,
        statement_month=inv_date.month,
        statement_year=inv_date.year,
        payment_due_date=due_date,
        created_by_id=current_user.id,
    )
    db.add(inv)
    db.flush()
    # Profit Sheet final lock — the typed reg may be an own-fleet truck's.
    ensure_invoice_not_profit_locked(db, inv)
    log_action(
        db, "subcontractor_invoice.created", user_id=current_user.id,
        entity_id=sub.entity_id, resource_type="supplier_invoice",
        description=f"Created invoice {inv.invoice_number} for subcontractor {sub.name}",
    )
    db.commit()
    db.refresh(inv)
    return _invoice_to_out(db, inv)


# ── Costing breakdown ─────────────────────────────────────────────────────────

def _enrich_load(load: TruckLoad) -> TruckLoadOut:
    d = TruckLoadOut.model_validate(load).model_dump()
    d["truck_registration"] = load.truck.registration if load.truck else None
    d["mine_name"]           = load.mine.name if load.mine else None
    d["supplier_name"]       = load.supplier.name if load.supplier else None
    return TruckLoadOut(**d)


def _enrich_invoice(db: Session, inv: SupplierInvoice) -> SupplierInvoiceOut:
    out = SupplierInvoiceOut.model_validate(inv)
    return out.model_copy(update={
        "supplier_name": inv.supplier.name if inv.supplier else inv.supplier_name_text,
        **get_verification_display(db, inv),
    })


def _norm_reg(reg) -> str:
    return (reg or "").replace(" ", "").strip().upper()


def _invoice_display_note(inv: SupplierInvoice, regs: set):
    """Costing display note for one truck: the invoice's own note plus the
    descriptions of this truck's matched sub-lines (fuel lines excluded — their
    per-slip detail lives in the Diesel module), so a note captured on either
    level pulls through — e.g. a R0 tyre jobcard's "what was done" line."""
    parts = []
    if (inv.notes or "").strip():
        parts.append(inv.notes.strip())
    if inv.is_multi_line and inv.line_items and any((li.unit or "").strip() for li in inv.line_items):
        is_diesel = bool(inv.supplier and inv.supplier.is_diesel_supplier)
        for li in inv.line_items:
            if _norm_reg(li.unit) not in regs:
                continue
            if is_diesel and (li.item_code or "").strip():
                continue
            d = (li.item_description or "").strip()
            if d:
                parts.append(d)
    return " · ".join(parts) or None


def _income_split(amount, vat_applicable, vat_rate=DEFAULT_VAT_RATE):
    """Resolve a manual costing-income amount into (excl, incl) figures, mirroring
    the general-expense VAT rule: a VAT-applicable amount IS the inclusive value
    (excl = amount / (1 + vat_rate)); otherwise excl == incl == amount (no VAT)."""
    amt = Decimal(str(amount or 0))
    if vat_applicable:
        excl = (amt / (Decimal("1") + vat_rate)).quantize(Decimal("0.01"))
        return excl, amt
    return amt, amt


def _period_add(year: int, month: int, delta: int):
    """Shift a (year, month) pair by `delta` whole months."""
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _materialize_fixed_expenses(sub, month: int, year: int, db: Session, current_user: User) -> None:
    """Roll fixed (recurring) general expenses forward into (month, year).

    Each fixed general expense (supplier_id null, is_fixed_expense set) is cloned
    one month at a time so every later month gets its own independent, editable
    row. The walk extends only from an ACTIVE predecessor and never recreates a
    month that already has a row (active or archived) — so archiving the latest
    occurrence stops the carry-over, and a deleted month is never back-filled.
    """
    rows = (
        db.query(SupplierInvoice)
        .filter(
            SupplierInvoice.entity_id == sub.entity_id,
            SupplierInvoice.is_fixed_expense == True,
            SupplierInvoice.supplier_id.is_(None),
        )
        .all()
    )
    if not rows:
        return

    target = (year, month)
    groups: dict = {}
    for r in rows:
        groups.setdefault(r.fixed_expense_group_id or r.id, []).append(r)

    created = False
    for gid, instances in groups.items():
        by_period: dict = {}
        for r in instances:
            if r.statement_year is None or r.statement_month is None:
                continue
            key = (r.statement_year, r.statement_month)
            cur = by_period.get(key)
            if cur is None or (cur.is_archived and not r.is_archived):
                by_period[key] = r
        if not by_period:
            continue
        origin = min(by_period)
        if target <= origin:
            continue

        cur_p = origin
        while cur_p != target:
            cur_p = _period_add(cur_p[0], cur_p[1], 1)
            prev_inst = by_period.get(_period_add(cur_p[0], cur_p[1], -1))
            if prev_inst is None or prev_inst.is_archived:
                break                      # chain stopped — no active predecessor
            if cur_p in by_period:
                continue                   # already materialised / intentionally emptied
            clone = SupplierInvoice(
                supplier_id=None,
                supplier_name_text=prev_inst.supplier_name_text,
                entity_id=prev_inst.entity_id,
                invoice_date=prev_inst.invoice_date,
                invoice_number=None,
                amount=prev_inst.amount,
                vat_applicable=prev_inst.vat_applicable,
                vehicle_reg=prev_inst.vehicle_reg,
                description=prev_inst.description,
                statement_month=cur_p[1],
                statement_year=cur_p[0],
                is_fixed_expense=True,
                fixed_expense_group_id=gid,
                created_by_id=current_user.id if current_user else None,
            )
            db.add(clone)
            db.flush()
            by_period[cur_p] = clone
            created = True

    if created:
        db.commit()


def _build_subcontractor_costing(subcontractor_id: int, month: int, year: int, db: Session, current_user: User) -> SubcontractorCostingOut:
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)
    vat_rate = entity_vat_rate(db, sub.entity_id)

    # Carry recurring (fixed) general expenses forward into this period first, so
    # the clones are picked up by the normal per-period invoice query below.
    _materialize_fixed_expenses(sub, month, year, db, current_user)

    trucks = db.query(Truck).filter(Truck.subcontractor_id == subcontractor_id).all()

    # Per-truck overlay rows for this period: carry-over note (awareness only,
    # never totalled) + optional manual net-payable override.
    note_rows_by_truck = {}
    sent_rows_by_truck = {}
    if trucks:
        note_rows_by_truck = {
            n.truck_id: n
            for n in db.query(TruckCostingNote).filter(
                TruckCostingNote.truck_id.in_([t.id for t in trucks]),
                TruckCostingNote.month == month,
                TruckCostingNote.year == year,
            ).all()
        }
        sent_rows_by_truck = {
            s.truck_id: s
            for s in db.query(TruckCostingSent)
            .options(joinedload(TruckCostingSent.sent_by))
            .filter(
                TruckCostingSent.truck_id.in_([t.id for t in trucks]),
                TruckCostingSent.month == month,
                TruckCostingSent.year == year,
            ).all()
        }

    D0 = Decimal("0")
    truck_results = []

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == sub.entity_id).first()
    is_vat_registered = entity.vat_registered if entity else True

    ds = db.query(DieselSettings).filter(DieselSettings.entity_id == sub.entity_id).first()
    fixed_admin_fee = Decimal(str(ds.subcontractor_monthly_admin_fee)) if ds else D0

    # Sent flags for these trucks — a period marked SENT is locked, and any
    # contribution captured after the send rolls forward into the next month.
    sent_map = build_sent_map(db, [t.id for t in trucks])

    # Cash/Current invoices belong to the PREVIOUS costing period (a June cash
    # invoice costs in May); 30-day and custom (no-supplier) invoices sit in
    # their own statement period. Safetec ignores the cash-vs-30-day timing
    # rule entirely. That "natural" period is resolved per invoice in Python
    # (natural_invoice_period), then shifted forward past SENT periods per
    # truck (roll_past_sent) — so an invoice captured after a costing went out
    # lands in the month it was captured instead of changing a sent statement.
    is_safetec = bool(entity and (entity.code or "").upper() == "SFT")

    # Candidate window: statement periods from 3 months back (natural periods
    # that may have rolled forward through consecutive sent months into this
    # one) up to next month (cash invoices whose natural period is this month).
    period_idx = year * 12 + (month - 1)
    stmt_idx = SupplierInvoice.statement_year * 12 + (SupplierInvoice.statement_month - 1)
    # A manual costing override pins the invoice to an explicit month regardless
    # of its statement period, so also fetch any invoice whose override lands on
    # this month (its statement may sit outside the window below).
    override_idx = SupplierInvoice.costing_period_year * 12 + (SupplierInvoice.costing_period_month - 1)

    # All candidate invoices for this entity, fetched once. Diesel suppliers ARE
    # included: `_truck_invoice_contribution` keeps only their non-fuel lines (the
    # fuel lines are costed via DieselFillUp instead), so a diesel statement's
    # parking/maintenance charges still show without double-counting the fuel.
    # Per-truck matching (main-line reg vs. per-sub-line reg) happens in Python
    # via `_truck_invoice_contribution`, so a multi-line/split invoice can pull
    # through to several trucks with each picking up just its own sub-lines.
    # Outer join so custom expenses (null supplier) come through too.
    candidate_invoices = (
        db.query(SupplierInvoice)
        .outerjoin(Supplier, Supplier.id == SupplierInvoice.supplier_id)
        .options(joinedload(SupplierInvoice.line_items), joinedload(SupplierInvoice.supplier))
        .filter(
            SupplierInvoice.entity_id == sub.entity_id,
            SupplierInvoice.is_archived == False,
            or_(
                stmt_idx.between(period_idx - 3, period_idx + 1),
                override_idx == period_idx,
            ),
        )
        .all()
    )
    natural_by_inv = {
        inv.id: natural_invoice_period(inv, is_safetec) for inv in candidate_invoices
    }

    def _invoice_in_period(inv, truck_id: int) -> bool:
        """Does this invoice belong to (year, month) for this truck, after the
        sent roll-forward? Fixed general expenses are per-month clones pinned
        to their own period and never roll."""
        natural = natural_by_inv.get(inv.id)
        if natural is None:
            return False
        # Fixed general expenses are pinned to their period, and a manual costing
        # override pins the month outright — neither rolls past sent costings.
        if inv.is_fixed_expense or costing_override_period(inv) is not None:
            return natural == (year, month)
        return roll_past_sent(natural, truck_id, inv.created_at, sent_map) == (year, month)

    for truck in trucks:
        # Loads belong to their STATEMENT period when one is set (a month-end
        # load can be pushed to the next month's statement), falling back to
        # the load date — same rule as the Truck Loads listing.
        loads = (
            db.query(TruckLoad)
            .filter(
                TruckLoad.truck_id == truck.id,
                func.coalesce(TruckLoad.statement_month, extract("month", TruckLoad.load_date)) == month,
                func.coalesce(TruckLoad.statement_year,  extract("year",  TruckLoad.load_date)) == year,
                TruckLoad.is_archived == False,
            )
            .order_by(TruckLoad.load_date)
            .all()
        )
        income_excl = sum(
            (Decimal(str(l.subcontractor_amount_excl_vat)) for l in loads if l.subcontractor_amount_excl_vat is not None),
            D0,
        )
        income_incl = sum(
            (Decimal(str(l.subcontractor_amount_incl_vat)) for l in loads if l.subcontractor_amount_incl_vat is not None),
            D0,
        )
        # Loads-only income, captured before manual income lines are folded in
        # below — the "Loads" row/total must reflect Truck Loads alone.
        loads_income_excl = income_excl
        loads_income_incl = income_incl

        # Manual costing-only income lines for this truck/period — added straight
        # into the income columns (and so into the net payable below), but never
        # surfaced outside the costing module.
        manual_income_rows = (
            db.query(TruckCostingIncome)
            .filter(
                TruckCostingIncome.truck_id == truck.id,
                TruckCostingIncome.month == month,
                TruckCostingIncome.year == year,
            )
            .order_by(TruckCostingIncome.created_at, TruckCostingIncome.id)
            .all()
        )
        manual_income_out = []
        for mi in manual_income_rows:
            m_excl, m_incl = _income_split(mi.amount, mi.vat_applicable, vat_rate)
            income_excl += m_excl
            income_incl += m_incl
            manual_income_out.append(TruckCostingIncomeOut(
                id=mi.id,
                description=mi.description,
                amount=Decimal(str(mi.amount)),
                vat_applicable=mi.vat_applicable,
                amount_excl_vat=m_excl,
                amount_incl_vat=m_incl,
            ))

        admin_fee = fixed_admin_fee

        # Match each candidate invoice to this truck — single-line by main-line
        # reg, multi-line/split by sub-line reg (taking only the matching portion).
        exp_incl = admin_fee
        exp_excl = D0
        inv_contribs = []  # (invoice, amount_for_this_truck)
        truck_regs = _truck_regs(truck)
        for inv in candidate_invoices:
            if not _invoice_in_period(inv, truck.id):
                continue
            matched, c_excl, c_incl = _truck_invoice_contribution(inv, truck_regs)
            if not matched:
                continue
            exp_excl += c_excl
            exp_incl += c_incl
            inv_contribs.append((inv, c_excl + c_incl, _invoice_display_note(inv, truck_regs)))

        # Diesel fill-ups for this truck — bucketed by the supplier's payment term,
        # mirroring the non-diesel invoice rule above. The fill-up's STATEMENT
        # period (its linked supplier invoice's month/year, falling back to the
        # slip date only when unlinked) is the anchor, so a mis-dated slip still
        # costs in the month it was billed:
        #   30-day  → statement period == costing month (same period)
        #   current → statement period == NEXT month (a June cash fill-up costs in May)
        # As with invoices, the natural period then rolls forward past SENT
        # costing periods when the fill-up was captured after the send.
        diesel_stmt_idx = (
            func.coalesce(SupplierInvoice.statement_year, extract("year", DieselFillUp.fillup_date)) * 12
            + func.coalesce(SupplierInvoice.statement_month, extract("month", DieselFillUp.fillup_date)) - 1
        )
        # A manual costing override on the linked supplier invoice pins the
        # fill-up to an explicit month (same as non-diesel invoices above).
        diesel_override_idx = (
            SupplierInvoice.costing_period_year * 12
            + (SupplierInvoice.costing_period_month - 1)
        )
        candidate_fillups = (
            db.query(DieselFillUp)
            .join(Supplier, Supplier.id == DieselFillUp.supplier_id)
            .outerjoin(SupplierInvoice, SupplierInvoice.id == DieselFillUp.supplier_invoice_id)
            .options(joinedload(DieselFillUp.supplier), joinedload(DieselFillUp.supplier_invoice))
            .filter(
                DieselFillUp.truck_id == truck.id,
                DieselFillUp.is_archived == False,
                or_(
                    diesel_stmt_idx.between(period_idx - 3, period_idx + 1),
                    diesel_override_idx == period_idx,
                ),
            )
            .order_by(DieselFillUp.fillup_date)
            .all()
        )
        fillups = []
        for f in candidate_fillups:
            si = f.supplier_invoice
            override = costing_override_period(si)
            if override is not None:
                # Pinned outright — no cash shift, no roll-forward.
                if override == (year, month):
                    fillups.append(f)
                continue
            stmt_y = si.statement_year if (si and si.statement_year) else f.fillup_date.year
            stmt_m = si.statement_month if (si and si.statement_month) else f.fillup_date.month
            natural = (stmt_y, stmt_m)
            if f.supplier and f.supplier.payment_term == PaymentTermType.current:
                natural = period_add(stmt_y, stmt_m, -1)
            if roll_past_sent(natural, truck.id, f.created_at, sent_map) == (year, month):
                fillups.append(f)
        by_supplier: dict = {}
        for f in fillups:
            by_supplier.setdefault(f.supplier_id, []).append(f)

        diesel_groups = []
        for sup_id, fups in by_supplier.items():
            sup_name = fups[0].supplier.name if fups[0].supplier else f"Supplier #{sup_id}"
            rows = []
            for f in fups:
                amt    = Decimal(str(f.amount))
                fee_ex = Decimal(str(f.admin_fee_amount))
                fee_vt = (fee_ex * vat_rate).quantize(Decimal("0.01"))
                fee_in = (fee_ex * (Decimal("1") + vat_rate)).quantize(Decimal("0.01"))
                rows.append(DieselFillUpCostingRow(
                    fillup_id=f.id,
                    fillup_date=f.fillup_date,
                    slip_number=f.slip_number,
                    depot_slip_number=f.depot_slip_number,
                    invoice_number=f.invoice_number,
                    supplier_name=sup_name,
                    litres=Decimal(str(f.litres)),
                    rate_per_litre=Decimal(str(f.rate_per_litre)),
                    amount_excl=amt,
                    admin_fee_excl=fee_ex,
                    admin_fee_vat=fee_vt,
                    admin_fee_incl=fee_in,
                    grand_total=(amt + fee_in).quantize(Decimal("0.01")),
                ))
            diesel_groups.append(DieselSupplierGroup(
                supplier_name=sup_name,
                rows=rows,
                tot_admin_fee_incl=sum((r.admin_fee_incl for r in rows), D0),
                tot_excl_admin_fee=sum((r.amount_excl for r in rows), D0),
                tot_grand_total=sum((r.grand_total for r in rows), D0),
            ))

        # Add diesel fill-up totals into the expense columns:
        # zero-rated diesel amount → Expenses Excl VAT
        # 1% admin fee (incl VAT)  → Expenses Incl VAT
        exp_excl += sum((g.tot_excl_admin_fee for g in diesel_groups), D0)
        exp_incl += sum((g.tot_admin_fee_incl  for g in diesel_groups), D0)
        income_for_net = income_excl if not is_vat_registered else income_incl
        net_payable_calc = income_for_net - exp_excl - exp_incl

        # Apply a manual "To Be Paid Out" override when the user has set one for
        # this truck/period; otherwise the calculated figure stands.
        note_row = note_rows_by_truck.get(truck.id)
        sent_row = sent_rows_by_truck.get(truck.id)
        override = note_row.net_payable_override if note_row else None
        override = Decimal(str(override)) if override is not None else None
        net_payable = override if override is not None else net_payable_calc

        truck.subcontractor_display_name = sub.name
        truck_results.append(SubcontractorTruckCostingOut(
            truck=TruckOut.model_validate(truck),
            loads=[_enrich_load(l) for l in loads],
            income_excl_vat=income_excl,
            income_incl_vat=income_incl,
            loads_income_excl_vat=loads_income_excl,
            loads_income_incl_vat=loads_income_incl,
            admin_fee=admin_fee,
            supplier_invoices=[
                _enrich_invoice(db, i).model_copy(update={"amount": amt, "notes": note})
                for (i, amt, note) in inv_contribs
            ],
            manual_incomes=manual_income_out,
            total_expenses_excl_vat=exp_excl,
            total_expenses_incl_vat=exp_incl,
            net_payable=net_payable,
            net_payable_calculated=net_payable_calc,
            net_payable_override=override,
            diesel_groups=diesel_groups,
            note=note_row.note if note_row else None,
            sent_at=sent_row.sent_at if sent_row else None,
            sent_by_name=sent_row.sent_by.full_name if sent_row and sent_row.sent_by else None,
        ))

    summary = SubcontractorCostingSummary(
        income_excl_vat=sum((t.income_excl_vat for t in truck_results), D0),
        income_incl_vat=sum((t.income_incl_vat for t in truck_results), D0),
        total_expenses_excl_vat=sum((t.total_expenses_excl_vat for t in truck_results), D0),
        total_expenses_incl_vat=sum((t.total_expenses_incl_vat for t in truck_results), D0),
        net_payable=sum((t.net_payable for t in truck_results), D0),
    )

    diesel_supplier_names = [
        row[0] for row in (
            db.query(Supplier.name)
            .join(DieselRate, DieselRate.supplier_id == Supplier.id)
            .filter(DieselRate.entity_id == sub.entity_id, DieselRate.is_active == True)
            .distinct()
            .order_by(Supplier.name)
            .all()
        )
    ]

    return SubcontractorCostingOut(
        subcontractor=SubcontractorOut.model_validate(sub),
        month=month,
        year=year,
        trucks=truck_results,
        summary=summary,
        diesel_suppliers=diesel_supplier_names,
        is_vat_registered=is_vat_registered,
    )


@router.get("/{subcontractor_id}/costing", response_model=SubcontractorCostingOut)
def get_subcontractor_costing(
    subcontractor_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _build_subcontractor_costing(subcontractor_id, month, year, db, current_user)


def _ensure_costing_not_sent(db: Session, truck_id: int, month: int, year: int):
    """Reject value changes on a costing period that was sent to the
    subcontractor (carry-over notes stay editable — they are awareness only
    and never part of any total)."""
    row = (
        db.query(TruckCostingSent)
        .filter(
            TruckCostingSent.truck_id == truck_id,
            TruckCostingSent.month == month,
            TruckCostingSent.year == year,
        )
        .first()
    )
    if row:
        raise HTTPException(
            status_code=403,
            detail="This costing has been sent to the subcontractor and is locked — "
                   "no values can be added or removed. It must be un-sent first.",
        )


@router.put("/{subcontractor_id}/costing/sent")
def set_truck_costing_sent(
    subcontractor_id: int,
    payload: SubcontractorCostingSentUpdate,
    truck_id: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a truck's costing for this period as SENT to the subcontractor
    (locks it), or un-send it. The optional sent_date backdates the send:
    expenses captured after that date roll forward into the next month's
    costing instead of changing the statement that already went out."""
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    truck = db.query(Truck).filter(
        Truck.id == truck_id,
        Truck.subcontractor_id == subcontractor_id,
    ).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found for this subcontractor")

    row = (
        db.query(TruckCostingSent)
        .filter(
            TruckCostingSent.truck_id == truck_id,
            TruckCostingSent.month == month,
            TruckCostingSent.year == year,
        )
        .first()
    )

    if not payload.sent:
        if not row:
            return {"sent_at": None}
        db.delete(row)
        log_action(
            db, "subcontractor_costing.unsent", user_id=current_user.id,
            entity_id=sub.entity_id, resource_type="truck_costing_sent",
            resource_id=truck_id,
            description=f"Un-sent costing {month:02d}/{year} for {truck.registration} ({sub.name}) — unlocked",
        )
        db.commit()
        return {"sent_at": None}

    if row:
        return {"sent_at": row.sent_at.isoformat()}

    now_utc = datetime.now(timezone.utc)
    # Backdated send: cutoff at end of that day, so everything captured up to
    # and including the sent date counts as part of the sent statement.
    if payload.sent_date and payload.sent_date != now_utc.date():
        sent_at = datetime(
            payload.sent_date.year, payload.sent_date.month, payload.sent_date.day,
            23, 59, 59, tzinfo=timezone.utc,
        )
    else:
        sent_at = now_utc

    row = TruckCostingSent(
        truck_id=truck_id, month=month, year=year,
        sent_at=sent_at, sent_by_id=current_user.id,
    )
    db.add(row)
    log_action(
        db, "subcontractor_costing.sent", user_id=current_user.id,
        entity_id=sub.entity_id, resource_type="truck_costing_sent",
        resource_id=truck_id,
        description=f"Marked costing {month:02d}/{year} for {truck.registration} ({sub.name}) as sent — locked",
        new_values={"sent_at": sent_at.isoformat()},
    )
    db.commit()
    return {"sent_at": row.sent_at.isoformat()}


@router.put("/{subcontractor_id}/costing/note")
def upsert_truck_costing_note(
    subcontractor_id: int,
    payload: SubcontractorCostingNoteUpdate,
    truck_id: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    truck = db.query(Truck).filter(
        Truck.id == truck_id,
        Truck.subcontractor_id == subcontractor_id,
    ).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found for this subcontractor")

    text_val = (payload.note or "").strip() or None
    note_row = (
        db.query(TruckCostingNote)
        .filter(
            TruckCostingNote.truck_id == truck_id,
            TruckCostingNote.month == month,
            TruckCostingNote.year == year,
        )
        .first()
    )

    if text_val is None:
        if note_row:
            # Keep the row if it still carries a net-payable override; only the
            # note is being cleared here.
            if note_row.net_payable_override is not None:
                note_row.note = None
                note_row.updated_by_id = current_user.id
            else:
                db.delete(note_row)
            db.commit()
        return {"note": None}

    if note_row:
        note_row.note = text_val
        note_row.updated_by_id = current_user.id
    else:
        note_row = TruckCostingNote(
            truck_id=truck_id,
            month=month,
            year=year,
            note=text_val,
            updated_by_id=current_user.id,
        )
        db.add(note_row)
    db.commit()
    return {"note": text_val}


@router.put("/{subcontractor_id}/costing/net-override")
def upsert_truck_costing_net_override(
    subcontractor_id: int,
    payload: SubcontractorCostingNetOverrideUpdate,
    truck_id: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set or clear a manual "To Be Paid Out" override for a truck/period.
    A null `net_payable` reverts to the system-calculated figure."""
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    truck = db.query(Truck).filter(
        Truck.id == truck_id,
        Truck.subcontractor_id == subcontractor_id,
    ).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found for this subcontractor")
    _ensure_costing_not_sent(db, truck_id, month, year)

    value = payload.net_payable
    note_row = (
        db.query(TruckCostingNote)
        .filter(
            TruckCostingNote.truck_id == truck_id,
            TruckCostingNote.month == month,
            TruckCostingNote.year == year,
        )
        .first()
    )

    if value is None:
        # Clearing the override — drop the row entirely unless it still holds a note.
        if note_row:
            if note_row.note:
                note_row.net_payable_override = None
                note_row.updated_by_id = current_user.id
            else:
                db.delete(note_row)
            db.commit()
        return {"net_payable_override": None}

    if note_row:
        note_row.net_payable_override = value
        note_row.updated_by_id = current_user.id
    else:
        note_row = TruckCostingNote(
            truck_id=truck_id,
            month=month,
            year=year,
            net_payable_override=value,
            updated_by_id=current_user.id,
        )
        db.add(note_row)
    db.commit()
    return {"net_payable_override": str(value)}


@router.post("/{subcontractor_id}/costing/income", response_model=TruckCostingIncomeOut)
def create_truck_costing_income(
    subcontractor_id: int,
    payload: TruckCostingIncomeCreate,
    truck_id: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a manual income line to a truck's costing for this period. It adds to
    the income column only — it never appears in the Income vs Expenses report
    or the Supplier Invoice Profile."""
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    truck = db.query(Truck).filter(
        Truck.id == truck_id,
        Truck.subcontractor_id == subcontractor_id,
    ).first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found for this subcontractor")
    _ensure_costing_not_sent(db, truck_id, month, year)

    desc = (payload.description or "").strip()
    if not desc:
        raise HTTPException(status_code=400, detail="Description is required")
    amount = Decimal(str(payload.amount or 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Enter a valid amount")

    row = TruckCostingIncome(
        truck_id=truck_id,
        month=month,
        year=year,
        description=desc,
        amount=amount,
        vat_applicable=payload.vat_applicable,
        created_by_id=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    excl, incl = _income_split(row.amount, row.vat_applicable, entity_vat_rate(db, sub.entity_id))
    return TruckCostingIncomeOut(
        id=row.id,
        description=row.description,
        amount=Decimal(str(row.amount)),
        vat_applicable=row.vat_applicable,
        amount_excl_vat=excl,
        amount_incl_vat=incl,
    )


@router.delete("/{subcontractor_id}/costing/income/{income_id}")
def delete_truck_costing_income(
    subcontractor_id: int,
    income_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a manual costing income line."""
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    row = (
        db.query(TruckCostingIncome)
        .join(Truck, Truck.id == TruckCostingIncome.truck_id)
        .filter(
            TruckCostingIncome.id == income_id,
            Truck.subcontractor_id == subcontractor_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Income line not found")
    _ensure_costing_not_sent(db, row.truck_id, row.month, row.year)

    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/{subcontractor_id}/costing/export/pdf")
def export_costing_pdf(
    subcontractor_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import io
    from fastapi.responses import StreamingResponse
    from app.services.costing_exports import generate_costing_pdf

    costing = _build_subcontractor_costing(subcontractor_id, month, year, db, current_user)
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == sub.entity_id).first()

    pdf_bytes = generate_costing_pdf(costing, entity)
    name = sub.name.replace(" ", "-").lower()
    filename = f"costing-{name}-{year}-{month:02d}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{subcontractor_id}/costing/export/excel")
def export_costing_excel(
    subcontractor_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import io
    from fastapi.responses import StreamingResponse
    from app.services.costing_exports import generate_costing_excel

    costing = _build_subcontractor_costing(subcontractor_id, month, year, db, current_user)
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == sub.entity_id).first()

    xl_bytes = generate_costing_excel(costing, entity)
    name = sub.name.replace(" ", "-").lower()
    filename = f"costing-{name}-{year}-{month:02d}.xlsx"
    return StreamingResponse(
        io.BytesIO(xl_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _bundle_safe_filename(name: str) -> str:
    """Strip characters unsafe in a ZIP entry / download filename."""
    return re.sub(r'[^A-Za-z0-9._-]', '_', (name or 'invoice').strip()) or 'invoice'


@router.get("/{subcontractor_id}/costing/export/bundle")
def export_costing_bundle(
    subcontractor_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    fmt: str = Query("pdf", pattern="^(pdf|excel)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ZIP the costing document (PDF or Excel) together with the physical supplier
    invoice attachments that appear in that costing — so the user can send the
    costing and its backing invoices to the subcontractor in one download."""
    import io
    import zipfile
    import logging
    from fastapi.responses import Response
    from app.services.costing_exports import generate_costing_pdf, generate_costing_excel
    from app.services.supplier_invoice_attachments import read_attachment

    logger = logging.getLogger(__name__)

    costing = _build_subcontractor_costing(subcontractor_id, month, year, db, current_user)
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == sub.entity_id).first()

    name = sub.name.replace(" ", "-").lower()
    if fmt == "excel":
        doc_bytes = generate_costing_excel(costing, entity)
        doc_name = f"costing-{name}-{year}-{month:02d}.xlsx"
    else:
        doc_bytes = generate_costing_pdf(costing, entity)
        doc_name = f"costing-{name}-{year}-{month:02d}.pdf"

    # The invoices shown in the costing (deduped — a split invoice appears on
    # several trucks). Only those with an attachment are worth bundling.
    inv_ids = {
        si.id
        for t in costing.trucks
        for si in t.supplier_invoices
        if si.has_attachment
    }
    invoices = (
        db.query(SupplierInvoice).filter(SupplierInvoice.id.in_(inv_ids)).all()
        if inv_ids else []
    )

    buf = io.BytesIO()
    used: dict = {}
    added = 0
    failed = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(doc_name, doc_bytes)
        for inv in invoices:
            if not inv.attachment_key:
                continue
            try:
                file_bytes = read_attachment(inv.attachment_key)
            except Exception:
                failed += 1
                logger.warning(
                    "Skipping supplier invoice %s in costing bundle — attachment read failed (key %s)",
                    inv.id, inv.attachment_key,
                )
                continue
            fallback = f"{inv.invoice_number or inv.id}{Path(inv.attachment_key).suffix}"
            base = _bundle_safe_filename(inv.attachment_filename or fallback)
            # Disambiguate duplicate filenames, keeping the extension intact.
            stem, dot, ext = base.rpartition(".")
            used[base] = used.get(base, 0) + 1
            if used[base] == 1:
                entry = base
            elif dot:
                entry = f"{stem}_{used[base]}.{ext}"
            else:
                entry = f"{base}_{used[base]}"
            zf.writestr(entry, file_bytes)
            added += 1

    # We expected attachments but couldn't fetch a single one — don't hand back a
    # misleading costing-only ZIP. Surface it instead (usually a storage/config
    # problem, e.g. Supabase credentials not set in this environment).
    if invoices and added == 0:
        raise HTTPException(
            status_code=502,
            detail=f"Could not retrieve any of the {failed} supplier-invoice attachment(s) "
                   "for this costing. The invoice files could not be read from storage.",
        )

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="costing-{name}-{year}-{month:02d}.zip"'},
    )


@router.delete("/{subcontractor_id}")
def delete_subcontractor(
    subcontractor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)
    sub.is_active = False
    log_action(
        db, "subcontractor.deleted", user_id=current_user.id,
        entity_id=sub.entity_id, resource_type="subcontractor",
        resource_id=subcontractor_id, description=f"Deactivated subcontractor {sub.name}",
    )
    db.commit()
    return {"detail": "Subcontractor deactivated"}


@router.delete("/{subcontractor_id}/permanent")
def permanently_delete_subcontractor(
    subcontractor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(Subcontractor).filter(Subcontractor.id == subcontractor_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subcontractor not found")
    _check_entity_access(sub.entity_id, current_user)

    # Refuse if other records still reference this subcontractor — archive instead.
    blockers = []
    for label, count in (
        ("truck(s)",            db.query(Truck).filter(Truck.subcontractor_id == subcontractor_id).count()),
        ("supplier invoice(s)", db.query(SupplierInvoice).filter(SupplierInvoice.subcontractor_id == subcontractor_id).count()),
    ):
        if count:
            blockers.append(f"{count} {label}")
    if blockers:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot permanently delete subcontractor '{sub.name}' — {', '.join(blockers)} reference it. Archive instead or remove those first.",
        )

    log_action(
        db, "subcontractor.permanently_deleted", user_id=current_user.id,
        entity_id=sub.entity_id, resource_type="subcontractor",
        resource_id=subcontractor_id, description=f"Permanently deleted subcontractor {sub.name}",
    )
    db.delete(sub)
    db.commit()
    return {"detail": "Subcontractor permanently deleted"}
