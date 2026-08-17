"""Profit Sheet final lock — shared enforcement helpers.

When the admin final-locks the Profit Sheet report for an entity-month
(`profit_sheet_locks`), every reg on that sheet is closed for that month:
truck loads, food allowance, diesel fill-ups and truck-linked supplier-invoice
expenses may no longer be added or changed for those trucks in that period.

Blocked writes raise 423 with a STRUCTURED detail (code
"profit_sheet_locked") so the client can show the dedicated block screen —
"ask <admin> to unlock" — instead of a plain toast. The admin named is the
user who set the lock, falling back to any active admin.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import BusinessEntity, ProfitSheetLock, Truck, User
from app.services.costing_sent import (
    _norm_reg, costing_override_period, natural_invoice_period,
)

from app.core.constants import MONTH_NAMES_0 as MONTH_NAMES


def get_profit_sheet_lock(db: Session, entity_id: int, year: int,
                          month: int) -> Optional[ProfitSheetLock]:
    if not (entity_id and year and month):
        return None
    return db.query(ProfitSheetLock).filter(
        ProfitSheetLock.entity_id == entity_id,
        ProfitSheetLock.year == year,
        ProfitSheetLock.month == month,
    ).first()


def lock_admin_name(db: Session, lock: Optional[ProfitSheetLock]) -> str:
    """Who to ask: the admin that set the lock, or failing that (deleted user)
    any active admin."""
    if lock is not None and lock.locked_by is not None:
        return lock.locked_by.full_name
    admin = (
        db.query(User)
        .filter(User.role == "admin", User.is_active == True)  # noqa: E712
        .order_by(User.id)
        .first()
    )
    return admin.full_name if admin else "an admin user"


def profit_sheet_lock_detail(db: Session, lock: ProfitSheetLock, reg: str,
                             year: int, month: int) -> dict:
    period = f"{MONTH_NAMES[month - 1]} {year}"
    admin = lock_admin_name(db, lock)
    reg = (reg or "").strip() or "this reg"
    return {
        "code": "profit_sheet_locked",
        "reg": reg,
        "year": year,
        "month": month,
        "period": period,
        "admin_name": admin,
        "message": (
            f"The Profit Sheet for {period} has been final locked. "
            f"To add or change a record for {reg} under {period}, "
            f"please ask {admin} to unlock it."
        ),
    }


def ensure_truck_month_open(db: Session, truck, year: int, month: int):
    """Block the write when the truck's entity has a final-locked Profit Sheet
    for (year, month). `truck` may be a Truck or a truck id; None / missing
    period is a no-op (nothing attributable to a locked sheet).

    Only own-fleet trucks appear on the Profit Sheet, so subcontractor trucks
    pass through untouched.
    """
    if truck is None or not (year and month):
        return
    if not isinstance(truck, Truck):
        truck = db.query(Truck).filter(Truck.id == truck).first()
        if truck is None:
            return
    if truck.is_subcontractor or truck.subcontractor_id is not None:
        return
    lock = get_profit_sheet_lock(db, truck.entity_id, year, month)
    if lock is not None:
        raise HTTPException(
            status_code=423,
            detail=profit_sheet_lock_detail(db, lock, truck.registration, year, month),
        )


def ensure_reg_month_open(db: Session, reg: str, year: int, month: int):
    """Reg-string variant of ensure_truck_month_open — resolves the reg (real
    or temp plate) to an own-fleet truck; unknown regs pass through."""
    norm = _norm_reg(reg)
    if not norm:
        return
    for t in db.query(Truck).filter(
        Truck.is_subcontractor == False,          # noqa: E712 — SQL boolean
        Truck.subcontractor_id.is_(None),
    ).all():
        if norm in {x for x in (_norm_reg(t.registration), _norm_reg(t.temp_registration)) if x}:
            ensure_truck_month_open(db, t, year, month)


def ensure_invoice_not_profit_locked(db: Session, inv, extra_reg: str = None,
                                     updates: dict = None,
                                     allowed_fields: set = None):
    """Block a supplier-invoice write when the expense lands on a reg whose
    Profit Sheet month is final locked.

    Matching mirrors `invoices_by_vehicle_regs` (what the Profit Sheet sums):
    the invoice's regs — main-line `vehicle_reg` plus every line-item reg in
    `unit`, plus `extra_reg` for an incoming line — resolved to own-fleet
    trucks by real or temp plate. The month is the invoice's costing period
    (`natural_invoice_period`); own-fleet trucks have no sent costings, so no
    roll-forward applies.

    `updates` + `allowed_fields` mirror ensure_not_locked: pure workflow-status
    changes (marking paid etc.) pass through on locked records.
    """
    if updates is not None and allowed_fields is not None and set(updates) <= allowed_fields:
        return

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
        return

    trucks = (
        db.query(Truck)
        .filter(
            Truck.is_subcontractor == False,      # noqa: E712 — SQL boolean
            Truck.subcontractor_id.is_(None),
        )
        .all()
    )
    matched = [
        t for t in trucks
        if regs & {x for x in (_norm_reg(t.registration), _norm_reg(t.temp_registration)) if x}
    ]
    if not matched:
        return

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == inv.entity_id).first()
    is_safetec = bool(entity and (entity.code or "").upper() == "SFT")
    period = costing_override_period(inv) or natural_invoice_period(inv, is_safetec)
    if period is None:
        return

    for t in matched:
        lock = get_profit_sheet_lock(db, t.entity_id, period[0], period[1])
        if lock is not None:
            raise HTTPException(
                status_code=423,
                detail=profit_sheet_lock_detail(db, lock, t.registration, period[0], period[1]),
            )
