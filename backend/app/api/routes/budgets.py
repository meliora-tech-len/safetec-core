from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, UserEntityAccess, BusinessEntity,
    Budget, BudgetSection, BudgetLine, BudgetLineValue,
)
from app.schemas.schemas import (
    BudgetCreate, BudgetUpdate, BudgetOut, BudgetDetailOut,
    BudgetSectionCreate, BudgetSectionUpdate, BudgetSectionOut,
    BudgetLineCreate, BudgetLineUpdate, BudgetLineOut,
    BudgetLineValueIn, BudgetLineValueOut,
)
from app.services.audit import log_action

router = APIRouter(prefix="/api/budgets", tags=["budgets"])

BUDGET_MODULE = "budgets"

# Default section template applied to every new budget — mirrors the structure
# shared by all the entity budget spreadsheets. Per-entity customisation
# happens by editing sections/lines after creation (or custom templates later).
DEFAULT_SECTIONS = [
    ("INCOME",                  "income"),
    ("30 DAY SUPPLIERS",        "expense"),
    ("CASH / CURRENT SUPPLIERS", "expense"),
    ("DIESEL",                  "expense"),
    ("INTERCOMPANY INVOICES",   "expense"),
    ("SUB CONTRACTORS",         "expense"),
    ("DEBIT ORDERS",            "expense"),
    ("WAGES",                   "expense"),
    ("OTHER",                   "expense"),
]


# ── Permission helpers ────────────────────────────────────────────────────────

def ensure_budget_access(user: User, entity_id: int, db: Session):
    """Budgets has its own per-entity permission: having access to an entity
    does NOT imply budget access — 'budgets' must be in allowed_modules."""
    if user.role == "admin":
        return
    access = db.query(UserEntityAccess).filter(
        UserEntityAccess.user_id == user.id,
        UserEntityAccess.entity_id == entity_id,
    ).first()
    if not access or BUDGET_MODULE not in (access.allowed_modules or []):
        raise HTTPException(status_code=403, detail="You do not have budget access for this entity")


def budget_entity_ids(user: User, db: Session) -> Optional[List[int]]:
    """Entity ids the user may see budgets for. None = unrestricted (admin)."""
    if user.role == "admin":
        return None
    rows = db.query(UserEntityAccess).filter(UserEntityAccess.user_id == user.id).all()
    return [a.entity_id for a in rows if BUDGET_MODULE in (a.allowed_modules or [])]


def _get_budget_checked(budget_id: int, user: User, db: Session) -> Budget:
    budget = db.query(Budget).filter(Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    ensure_budget_access(user, budget.entity_id, db)
    return budget


def _get_section_checked(section_id: int, user: User, db: Session) -> BudgetSection:
    section = db.query(BudgetSection).filter(BudgetSection.id == section_id).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    ensure_budget_access(user, section.budget.entity_id, db)
    return section


def _get_line_checked(line_id: int, user: User, db: Session) -> BudgetLine:
    line = db.query(BudgetLine).filter(BudgetLine.id == line_id).first()
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")
    ensure_budget_access(user, line.section.budget.entity_id, db)
    return line


# ── Budgets ───────────────────────────────────────────────────────────────────

@router.get("", response_model=List[BudgetOut])
def list_budgets(
    entity_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed = budget_entity_ids(current_user, db)
    if entity_id is not None:
        ensure_budget_access(current_user, entity_id, db)

    q = db.query(Budget)
    if entity_id is not None:
        q = q.filter(Budget.entity_id == entity_id)
    elif allowed is not None:
        if not allowed:
            return []
        q = q.filter(Budget.entity_id.in_(allowed))
    if year is not None:
        q = q.filter(Budget.period_year == year)
    return q.order_by(Budget.period_year.desc(), Budget.period_month.desc()).all()


@router.post("", response_model=BudgetDetailOut)
def create_budget(
    payload: BudgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ensure_budget_access(current_user, payload.entity_id, db)
    if not (1 <= payload.period_month <= 12):
        raise HTTPException(status_code=400, detail="period_month must be 1-12")

    entity = db.query(BusinessEntity).filter(BusinessEntity.id == payload.entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    existing = db.query(Budget).filter(
        Budget.entity_id == payload.entity_id,
        Budget.period_month == payload.period_month,
        Budget.period_year == payload.period_year,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="A budget for this entity and period already exists")

    budget = Budget(
        entity_id=payload.entity_id,
        name=payload.name,
        period_month=payload.period_month,
        period_year=payload.period_year,
        notes=payload.notes,
        created_by_id=current_user.id,
    )
    db.add(budget)
    db.flush()

    for i, (name, section_type) in enumerate(DEFAULT_SECTIONS):
        db.add(BudgetSection(budget_id=budget.id, name=name, section_type=section_type, sort_order=i))

    log_action(
        db, "budget.created", user_id=current_user.id,
        resource_type="budget", resource_id=budget.id,
        description=f"Created budget {payload.period_month}/{payload.period_year} for {entity.code}",
    )
    db.commit()
    db.refresh(budget)
    return budget


@router.get("/{budget_id}", response_model=BudgetDetailOut)
def get_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = db.query(Budget).options(
        joinedload(Budget.sections).joinedload(BudgetSection.lines).joinedload(BudgetLine.values)
    ).filter(Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    ensure_budget_access(current_user, budget.entity_id, db)
    return budget


@router.patch("/{budget_id}", response_model=BudgetOut)
def update_budget(
    budget_id: int,
    payload: BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = _get_budget_checked(budget_id, current_user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(budget, field, value)
    log_action(
        db, "budget.updated", user_id=current_user.id,
        resource_type="budget", resource_id=budget_id,
        description=f"Updated budget {budget.period_month}/{budget.period_year}",
    )
    db.commit()
    db.refresh(budget)
    return budget


@router.delete("/{budget_id}")
def delete_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = _get_budget_checked(budget_id, current_user, db)
    log_action(
        db, "budget.deleted", user_id=current_user.id,
        resource_type="budget", resource_id=budget_id,
        description=f"Deleted budget {budget.period_month}/{budget.period_year} (entity {budget.entity_id})",
    )
    db.delete(budget)
    db.commit()
    return {"detail": "Budget deleted"}


# ── Sections ──────────────────────────────────────────────────────────────────

@router.post("/{budget_id}/sections", response_model=BudgetSectionOut)
def add_section(
    budget_id: int,
    payload: BudgetSectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = _get_budget_checked(budget_id, current_user, db)
    max_order = max([s.sort_order or 0 for s in budget.sections], default=-1)
    section = BudgetSection(
        budget_id=budget.id,
        name=payload.name,
        section_type=payload.section_type,
        sort_order=max_order + 1,
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


@router.patch("/sections/{section_id}", response_model=BudgetSectionOut)
def update_section(
    section_id: int,
    payload: BudgetSectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    section = _get_section_checked(section_id, current_user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(section, field, value)
    db.commit()
    db.refresh(section)
    return section


@router.delete("/sections/{section_id}")
def delete_section(
    section_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    section = _get_section_checked(section_id, current_user, db)
    db.delete(section)
    db.commit()
    return {"detail": "Section deleted"}


# ── Lines ─────────────────────────────────────────────────────────────────────

@router.post("/sections/{section_id}/lines", response_model=BudgetLineOut)
def add_line(
    section_id: int,
    payload: BudgetLineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    section = _get_section_checked(section_id, current_user, db)
    max_order = max([l.sort_order or 0 for l in section.lines], default=-1)
    line = BudgetLine(
        section_id=section.id,
        name=payload.name,
        notes=payload.notes,
        sort_order=max_order + 1,
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    return line


@router.patch("/lines/{line_id}", response_model=BudgetLineOut)
def update_line(
    line_id: int,
    payload: BudgetLineUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    line = _get_line_checked(line_id, current_user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(line, field, value)
    db.commit()
    db.refresh(line)
    return line


@router.delete("/lines/{line_id}")
def delete_line(
    line_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    line = _get_line_checked(line_id, current_user, db)
    db.delete(line)
    db.commit()
    return {"detail": "Line deleted"}


# ── Values (upsert per line+month) ────────────────────────────────────────────

@router.put("/lines/{line_id}/values", response_model=BudgetLineValueOut)
def upsert_line_value(
    line_id: int,
    payload: BudgetLineValueIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    line = _get_line_checked(line_id, current_user, db)
    if not (1 <= payload.month <= 12):
        raise HTTPException(status_code=400, detail="month must be 1-12")

    value = db.query(BudgetLineValue).filter(
        BudgetLineValue.line_id == line.id,
        BudgetLineValue.month == payload.month,
        BudgetLineValue.year == payload.year,
    ).first()
    if not value:
        value = BudgetLineValue(line_id=line.id, month=payload.month, year=payload.year)
        db.add(value)

    data = payload.model_dump(exclude_unset=True)
    if "amount_due" in data:
        value.amount_due = data["amount_due"]
    if "amount_paid" in data:
        value.amount_paid = data["amount_paid"]

    db.commit()
    db.refresh(value)
    return value
