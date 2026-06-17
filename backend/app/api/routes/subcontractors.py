import calendar
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, extract, func
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from decimal import Decimal
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Subcontractor, Truck, TruckLoad, SupplierInvoice, SupplierInvoiceLineItem, BusinessEntity, DieselSettings, DieselRate, Supplier, DieselFillUp, PaymentTermType, TruckCostingNote
from app.schemas.schemas import (
    SubcontractorCreate, SubcontractorBulkCreate,
    SubcontractorUpdate, SubcontractorOut,
    TruckLoadOut, TruckOut, SupplierInvoiceOut,
    SubcontractorCostingOut, SubcontractorCostingSummary, SubcontractorTruckCostingOut,
    SupplierStatementGroup, SubcontractorInvoiceCreate,
    DieselFillUpCostingRow, DieselSupplierGroup, SubcontractorCostingNoteUpdate,
    SubcontractorCostingNetOverrideUpdate,
)
from app.services.audit import log_action
from app.services.verification import get_verification_display

router = APIRouter(prefix="/api/subcontractors", tags=["subcontractors"])


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


@router.get("/", response_model=List[SubcontractorOut])
def list_subcontractors(
    entity_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
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

    old_vals = {k: str(getattr(sub, k)) for k in payload.model_dump(exclude_none=True)}
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(sub, field, value)

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


def _truck_regs(truck: Truck) -> set:
    """Every registration this truck is known by: the real plate plus any
    temp/old plate, so invoices captured under either stay with the truck
    after a registration change."""
    return {r for r in (_norm_reg(truck.registration), _norm_reg(truck.temp_registration)) if r}


def _truck_invoice_contribution(inv: SupplierInvoice, truck_regs: set):
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
    """
    D0 = Decimal("0")
    if not truck_regs:
        return False, D0, D0

    if inv.is_multi_line and inv.line_items:
        has_line_reg = any((li.unit or "").strip() for li in inv.line_items)
        if has_line_reg:
            excl_nonvat, incl_vat = D0, D0
            matched = False
            for li in inv.line_items:
                if _norm_reg(li.unit) not in truck_regs:
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

    if _norm_reg(inv.vehicle_reg) in truck_regs:
        amt = Decimal(str(inv.amount))
        if amt == 0:
            return False, D0, D0
        if inv.vat_applicable:
            return True, D0, amt
        return True, amt, D0
    return False, D0, D0


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

    # Carry recurring (fixed) general expenses forward into this period first, so
    # the clones are picked up by the normal per-period invoice query below.
    _materialize_fixed_expenses(sub, month, year, db, current_user)

    trucks = db.query(Truck).filter(Truck.subcontractor_id == subcontractor_id).all()

    # Per-truck overlay rows for this period: carry-over note (awareness only,
    # never totalled) + optional manual net-payable override.
    note_rows_by_truck = {}
    if trucks:
        note_rows_by_truck = {
            n.truck_id: n
            for n in db.query(TruckCostingNote).filter(
                TruckCostingNote.truck_id.in_([t.id for t in trucks]),
                TruckCostingNote.month == month,
                TruckCostingNote.year == year,
            ).all()
        }

    D0 = Decimal("0")
    truck_results = []

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == sub.entity_id).first()
    is_vat_registered = entity.vat_registered if entity else True

    ds = db.query(DieselSettings).filter(DieselSettings.entity_id == sub.entity_id).first()
    fixed_admin_fee = Decimal(str(ds.subcontractor_monthly_admin_fee)) if ds else D0

    # Cash/Current invoices belong to the PREVIOUS costing period, so to
    # populate costing for `month` we fetch their invoices from month+1.
    # 30-day invoices sit in the same month as their statement period.
    cash_stmt_month = month + 1 if month < 12 else 1
    cash_stmt_year  = year      if month < 12 else year + 1

    # Safetec ignores the current/cash-vs-30-day timing rule: every non-diesel
    # invoice captured in the statement month belongs to that same month's
    # costing, regardless of payment term. Other entities keep the rule above.
    is_safetec = bool(entity and (entity.code or "").upper() == "SFT")
    if is_safetec:
        supplier_period_clause = and_(
            SupplierInvoice.supplier_id.isnot(None),
            SupplierInvoice.statement_month == month,
            SupplierInvoice.statement_year == year,
        )
    else:
        supplier_period_clause = or_(
            and_(
                Supplier.payment_term == PaymentTermType.days_30,
                SupplierInvoice.statement_month == month,
                SupplierInvoice.statement_year == year,
            ),
            and_(
                Supplier.payment_term == PaymentTermType.current,
                SupplierInvoice.statement_month == cash_stmt_month,
                SupplierInvoice.statement_year == cash_stmt_year,
            ),
        )

    # Custom (free-text) expenses have no supplier and therefore no payment term,
    # so the cash-vs-30-day timing rule can't apply — they simply belong to the
    # statement period they were captured in (the costing month/year).
    custom_period_clause = and_(
        SupplierInvoice.supplier_id.is_(None),
        SupplierInvoice.statement_month == month,
        SupplierInvoice.statement_year == year,
    )

    # All candidate non-diesel invoices for this entity/period, fetched once.
    # Per-truck matching (main-line reg vs. per-sub-line reg) happens in Python
    # via `_truck_invoice_contribution`, so a multi-line/split invoice can pull
    # through to several trucks with each picking up just its own sub-lines.
    # Outer join so custom expenses (null supplier) come through too.
    period_invoices = (
        db.query(SupplierInvoice)
        .outerjoin(Supplier, Supplier.id == SupplierInvoice.supplier_id)
        .options(joinedload(SupplierInvoice.line_items))
        .filter(
            SupplierInvoice.entity_id == sub.entity_id,
            SupplierInvoice.is_archived == False,
            or_(Supplier.is_diesel_supplier == False, SupplierInvoice.supplier_id.is_(None)),
            or_(supplier_period_clause, custom_period_clause),
        )
        .all()
    )

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
        admin_fee = fixed_admin_fee

        # Match each candidate invoice to this truck — single-line by main-line
        # reg, multi-line/split by sub-line reg (taking only the matching portion).
        exp_incl = admin_fee
        exp_excl = D0
        inv_contribs = []  # (invoice, amount_for_this_truck)
        truck_regs = _truck_regs(truck)
        for inv in period_invoices:
            matched, c_excl, c_incl = _truck_invoice_contribution(inv, truck_regs)
            if not matched:
                continue
            exp_excl += c_excl
            exp_incl += c_incl
            inv_contribs.append((inv, c_excl + c_incl))

        # Diesel fill-ups for this truck — bucketed by the supplier's payment term,
        # mirroring the non-diesel invoice rule above. Diesel has no statement period
        # (not captured on the standalone module or the Diesel tab), so the fill-up
        # DATE stands in for it:
        #   30-day  → fill-ups dated in the costing month (same period)
        #   current → fill-ups dated in the NEXT month (they belong to the previous
        #             costing period, e.g. a June cash fill-up costs in May)
        fillups = (
            db.query(DieselFillUp)
            .join(Supplier, Supplier.id == DieselFillUp.supplier_id)
            .filter(
                DieselFillUp.truck_id == truck.id,
                DieselFillUp.is_archived == False,
                or_(
                    and_(
                        Supplier.payment_term == PaymentTermType.days_30,
                        extract("month", DieselFillUp.fillup_date) == month,
                        extract("year",  DieselFillUp.fillup_date) == year,
                    ),
                    and_(
                        Supplier.payment_term == PaymentTermType.current,
                        extract("month", DieselFillUp.fillup_date) == cash_stmt_month,
                        extract("year",  DieselFillUp.fillup_date) == cash_stmt_year,
                    ),
                ),
            )
            .order_by(DieselFillUp.fillup_date)
            .all()
        )
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
                fee_vt = (fee_ex * Decimal("0.15")).quantize(Decimal("0.01"))
                fee_in = (fee_ex * Decimal("1.15")).quantize(Decimal("0.01"))
                rows.append(DieselFillUpCostingRow(
                    fillup_id=f.id,
                    fillup_date=f.fillup_date,
                    slip_number=f.slip_number,
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
        override = note_row.net_payable_override if note_row else None
        override = Decimal(str(override)) if override is not None else None
        net_payable = override if override is not None else net_payable_calc

        truck.subcontractor_display_name = sub.name
        truck_results.append(SubcontractorTruckCostingOut(
            truck=TruckOut.model_validate(truck),
            loads=[_enrich_load(l) for l in loads],
            income_excl_vat=income_excl,
            income_incl_vat=income_incl,
            admin_fee=admin_fee,
            supplier_invoices=[
                _enrich_invoice(db, i).model_copy(update={"amount": amt})
                for (i, amt) in inv_contribs
            ],
            total_expenses_excl_vat=exp_excl,
            total_expenses_incl_vat=exp_incl,
            net_payable=net_payable,
            net_payable_calculated=net_payable_calc,
            net_payable_override=override,
            diesel_groups=diesel_groups,
            note=note_row.note if note_row else None,
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
