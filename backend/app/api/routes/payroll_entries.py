from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, PayrollEntry, Driver

router = APIRouter(prefix="/api/payroll-entries", tags=["payroll-entries"])


def _check_entity_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    access_ids = [a.entity_id for a in user.entity_access]
    if entity_id not in access_ids:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _accessible_entity_ids(user: User):
    if user.role == "admin":
        return None
    return [a.entity_id for a in user.entity_access]


@router.get("/")
def list_payroll_entries(
    entity_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    driver_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accessible = _accessible_entity_ids(current_user)
    q = db.query(PayrollEntry)
    if accessible is not None:
        q = q.filter(PayrollEntry.entity_id.in_(accessible))
    if entity_id:
        _check_entity_access(entity_id, current_user)
        q = q.filter(PayrollEntry.entity_id == entity_id)
    if year:
        q = q.filter(PayrollEntry.pay_year == year)
    if month:
        q = q.filter(PayrollEntry.pay_month == month)
    if driver_id:
        q = q.filter(PayrollEntry.driver_id == driver_id)
    if status:
        q = q.filter(PayrollEntry.status == status)

    entries = q.order_by(PayrollEntry.pay_year.desc(), PayrollEntry.pay_month.desc()).offset(skip).limit(limit).all()

    result = []
    for e in entries:
        d = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        d['driver_name'] = f"{e.driver.first_name} {e.driver.last_name}".strip() if e.driver else None
        result.append(d)
    return result


@router.get("/summary")
def payroll_summary(
    entity_id: int = Query(...),
    year: int = Query(...),
    month: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_entity_access(entity_id, current_user)
    q = db.query(PayrollEntry).filter(
        PayrollEntry.entity_id == entity_id,
        PayrollEntry.pay_year == year,
    )
    if month:
        q = q.filter(PayrollEntry.pay_month == month)

    rows = q.with_entities(
        func.count(PayrollEntry.id),
        func.coalesce(func.sum(PayrollEntry.gross), 0),
        func.coalesce(func.sum(PayrollEntry.net_payable), 0),
        func.coalesce(func.sum(PayrollEntry.total_deductions), 0),
    ).one()

    return {
        'count':            rows[0],
        'total_gross':      float(rows[1]),
        'total_net':        float(rows[2]),
        'total_deductions': float(rows[3]),
    }
