from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import (
    User, UserEntityAccess, BusinessEntity,
    Budget, BudgetSection, BudgetLine, BudgetLineValue, BudgetLineTemplate,
)
from app.schemas.schemas import (
    BudgetCreate, BudgetUpdate, BudgetOut, BudgetDetailOut,
    BudgetSectionCreate, BudgetSectionUpdate, BudgetSectionOut,
    BudgetLineCreate, BudgetLineUpdate, BudgetLineOut,
    BudgetLineValueIn, BudgetLineValueOut,
    BudgetLineTemplateCreate, BudgetLineTemplateUpdate, BudgetLineTemplateOut,
    BudgetIncomeCandidateOut, BudgetIncomeSelection, BudgetReplicateOut,
)
from app.services.audit import log_action
from app.services.budget_autofill import (
    compute_autofill, income_candidates, SECTION_SOURCES, SEC_INCOME,
)

router = APIRouter(prefix="/api/budgets", tags=["budgets"])

BUDGET_MODULE = "budgets"

# How many months a budget rolls across (base month + the next two).
ROLLING_MONTHS = 3

# Entities whose budget is built around a single STATEMENT PERIOD rather than a
# forward-rolling window. For these, the selected month IS the statement period and
# the grid shows [statement-1, statement]: 30-day supplier invoices land in the
# previous month, cash (and everything else) in the statement month. Empty for now —
# OBHI used to be statement-period but now uses the standard rolling window like
# every other entity (selecting May shows May/June/July).
STATEMENT_PERIOD_ENTITIES = set()

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

# Some sections don't apply to certain entities (keyed by entity code). OBHI has
# no payroll, so it should never get a WAGES section.
ENTITY_SECTION_EXCLUSIONS = {
    # OBHI has no payroll, so it should never get a WAGES section. The OTHER
    # section stays — the user fills it in manually (nothing auto-pulls into it).
    "OBHI": {"WAGES"},
}

def _sections_for_entity(entity) -> list:
    """DEFAULT_SECTIONS minus any sections that don't apply to this entity."""
    excluded = ENTITY_SECTION_EXCLUSIONS.get((entity.code or "").upper(), set())
    return [(name, st) for (name, st) in DEFAULT_SECTIONS if name not in excluded]


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


def _load_detail(budget_id: int, db: Session) -> Budget:
    return db.query(Budget).options(
        joinedload(Budget.sections).joinedload(BudgetSection.lines).joinedload(BudgetLine.values)
    ).filter(Budget.id == budget_id).first()


def _rolling_months(month: int, year: int, n: int = ROLLING_MONTHS):
    """[(month, year), (+1), (+2)] — the budget's rolling window."""
    out = []
    y, m = year, month
    for _ in range(n):
        out.append((m, y))
        idx = y * 12 + (m - 1) + 1
        y, m = idx // 12, idx % 12 + 1
    return out


def _prev_month(month: int, year: int):
    return (12, year - 1) if month == 1 else (month - 1, year)


def _next_month(month: int, year: int):
    return (1, year + 1) if month == 12 else (month + 1, year)


def _statement_window(month: int, year: int):
    """[(prev), (statement)] — statement-period budgets show the statement month
    plus the one before it (30-day invoices land in the previous month)."""
    return [_prev_month(month, year), (month, year)]


def _budget_window(entity_code: str, month: int, year: int):
    """The (month, year) columns a budget spans, per entity style."""
    if (entity_code or "").upper() in STATEMENT_PERIOD_ENTITIES:
        return _statement_window(month, year)
    return _rolling_months(month, year)


SECTION_TYPE_BY_NAME = dict(DEFAULT_SECTIONS)


def _apply_constants(budget: Budget, db: Session, sections: dict, section_names: set = None) -> int:
    """Ensure every active BudgetLineTemplate that applies to this budget's entity
    ('usual' recurring line, e.g. Travel & Accom — entity_id NULL means every entity;
    a set entity_id scopes it to just that one) exists as a line in this budget. Only
    adds what's missing — never touches an existing line's name/section/values, so a
    user can freely rename or delete their copy per budget. Values are always left
    blank for the user to type in; nothing here ever sets an amount. Creates the
    target section too if a budget predates it (e.g. an older budget from before
    OTHER was added to DEFAULT_SECTIONS) — but never for a section this entity
    excludes.

    section_names limits seeding to those sections, so a per-section pull only
    ever seeds its own section's constants. None = every section."""
    templates = (
        db.query(BudgetLineTemplate)
        .filter(
            BudgetLineTemplate.is_active == True,  # noqa: E712
            or_(BudgetLineTemplate.entity_id.is_(None), BudgetLineTemplate.entity_id == budget.entity_id),
        )
        .order_by(BudgetLineTemplate.sort_order)
        .all()
    )
    if section_names is not None:
        templates = [t for t in templates if t.section_name in section_names]
    if not templates:
        return 0

    code = (budget.entity.code or "").upper()
    excluded = ENTITY_SECTION_EXCLUSIONS.get(code, set())
    next_section_order = max([s.sort_order or 0 for s in sections.values()], default=-1) + 1

    section_ids = [s.id for s in sections.values()]
    existing_keys = {
        l.source_key for l in db.query(BudgetLine).filter(
            BudgetLine.section_id.in_(section_ids) if section_ids else False,
            BudgetLine.source == "constant",
        ).all()
    } if section_ids else set()

    next_order: dict = {}
    added = 0
    for t in templates:
        key = f"constant:{t.id}"
        if key in existing_keys:
            continue
        if t.section_name in excluded:
            continue   # this entity never gets this section at all (e.g. OBHI/WAGES)
        sec = sections.get(t.section_name)
        if sec is None:
            sec = BudgetSection(
                budget_id=budget.id, name=t.section_name,
                section_type=SECTION_TYPE_BY_NAME.get(t.section_name, "expense"),
                sort_order=next_section_order,
            )
            next_section_order += 1
            db.add(sec); db.flush()
            sections[sec.name] = sec
        if sec.id not in next_order:
            max_order = db.query(func.max(BudgetLine.sort_order)).filter(BudgetLine.section_id == sec.id).scalar()
            next_order[sec.id] = (max_order or -1) + 1
        db.add(BudgetLine(section_id=sec.id, name=t.name, source="constant",
                          source_key=key, sort_order=next_order[sec.id]))
        next_order[sec.id] += 1
        added += 1
    return added


def _apply_autofill(budget: Budget, db: Session, current_user: User,
                    section_names: set = None, specs: list = None) -> int:
    """Pull system data into this budget's AUTO lines. Manual lines are never
    touched, and a hand-edited (overridden) value on an auto line is preserved.
    Reads sections/lines/values fresh so it works during create (pre-commit) too.

    section_names scopes the whole operation to those sections — the pull, the
    stale-value prune and the constant seeding all stay inside them, so the
    per-section "Pull from System" button can never disturb a sibling section.
    None = every section with a system source.

    specs lets the caller supply the line specs itself instead of pulling them
    (the Income modal passes exactly the candidates the user ticked). Same shape
    either way, so both paths share this one materialisation routine.
    """
    code = (budget.entity.code or "").upper()
    if specs is None:
        shift_30day = code in STATEMENT_PERIOD_ENTITIES
        months = _budget_window(code, budget.period_month, budget.period_year)
        # compute_autofill reads in its own isolated sessions — never this write txn —
        # so a heavy/dropped subcontractor read can't corrupt the budget being saved.
        specs = compute_autofill(budget.entity_id, months, current_user,
                                 shift_30day=shift_30day, section_names=section_names)
    else:
        months = _budget_window(code, budget.period_month, budget.period_year)

    # Drop any specs for sections that don't apply to this entity (e.g. OBHI has
    # no WAGES), so a stray source can't recreate the excluded section.
    excluded = ENTITY_SECTION_EXCLUSIONS.get(code, set())
    if excluded:
        specs = [s for s in specs if s["section_name"] not in excluded]

    sections = {s.name: s for s in db.query(BudgetSection).filter(BudgetSection.budget_id == budget.id).all()}
    next_section_order = max([s.sort_order or 0 for s in sections.values()], default=-1) + 1

    # Sections this pass owns. Only these get pruned or seeded — a sibling
    # section's lines must survive a pull they weren't part of.
    scoped = {n for n in sections if section_names is None or n in section_names}
    section_name_by_id = {s.id: s.name for s in sections.values()}

    # Indexed across EVERY section, not just the scoped ones: a supplier that's
    # been reclassified (flagged diesel, say) still has last pull's line sitting
    # in its old section, and we have to find it there to move it. Scoping this
    # to `scoped` would miss it and create a duplicate alongside the stale one.
    auto_lines: dict = {}          # source_key -> BudgetLine
    line_order: dict = {}          # section_id -> next sort_order
    provided: dict = {}            # source_key -> set of (month, year) this pull supplied
    for s in sections.values():
        lines = db.query(BudgetLine).filter(BudgetLine.section_id == s.id).all()
        line_order[s.id] = max([l.sort_order or 0 for l in lines], default=-1) + 1
        for l in lines:
            if l.source == "auto" and l.source_key:
                auto_lines[l.source_key] = l

    for spec in specs:
        sec = sections.get(spec["section_name"])
        if sec is None:
            sec = BudgetSection(budget_id=budget.id, name=spec["section_name"],
                                section_type=spec["section_type"], sort_order=next_section_order)
            next_section_order += 1
            db.add(sec); db.flush()
            sections[sec.name] = sec
            section_name_by_id[sec.id] = sec.name
            scoped.add(sec.name)   # a section this pull just created is by definition its own
            line_order[sec.id] = 0

        line = auto_lines.get(spec["source_key"])
        if line is None:
            line = BudgetLine(section_id=sec.id, name=spec["line_name"], source="auto",
                              source_key=spec["source_key"], sort_order=line_order.get(sec.id, 0))
            line_order[sec.id] = line_order.get(sec.id, 0) + 1
            db.add(line); db.flush()
            auto_lines[spec["source_key"]] = line
        else:
            line.name = spec["line_name"]   # keep fresh (e.g. supplier renamed)
            if line.section_id != sec.id:
                # Classification changed (e.g. a supplier was flagged intercompany) —
                # move the line, and its value history, into its new section.
                line.section_id = sec.id
                line.sort_order = line_order.get(sec.id, 0)
                line_order[sec.id] = line_order.get(sec.id, 0) + 1

        provided[spec["source_key"]] = set(spec["values"].keys())
        existing = {(v.month, v.year): v for v in db.query(BudgetLineValue).filter(BudgetLineValue.line_id == line.id).all()}
        for (m, y), amts in spec["values"].items():
            val = existing.get((m, y))
            if val is None:
                val = BudgetLineValue(line_id=line.id, month=m, year=y)
                db.add(val)
                existing[(m, y)] = val
            if val.is_overridden:
                continue            # user hand-edited this cell — leave it
            val.amount_due = amts.get("due")
            val.amount_paid = amts.get("paid")

    # Prune stale auto values: within the budget's window, drop any auto-line value
    # the latest pull no longer supplies (e.g. a 30-day amount that moved to the
    # previous month, or an invoice that was archived). User-pinned cells are kept.
    # Scoped to the sections this pull owns — auto_lines spans the whole budget so
    # reclassified lines can be found, but a line parked in a section we didn't
    # pull was never offered a spec and must not be treated as stale.
    window_set = set(months)
    for src_key, line in auto_lines.items():
        if section_name_by_id.get(line.section_id) not in scoped:
            continue
        keep = provided.get(src_key, set())
        for v in db.query(BudgetLineValue).filter(BudgetLineValue.line_id == line.id).all():
            if (v.month, v.year) in window_set and (v.month, v.year) not in keep and not v.is_overridden:
                db.delete(v)

    added_constants = _apply_constants(budget, db, sections, section_names=section_names)

    db.commit()
    return len(specs) + added_constants


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

    for i, (name, section_type) in enumerate(_sections_for_entity(entity)):
        db.add(BudgetSection(budget_id=budget.id, name=name, section_type=section_type, sort_order=i))
    db.flush()

    log_action(
        db, "budget.created", user_id=current_user.id,
        resource_type="budget", resource_id=budget.id,
        description=f"Created budget {payload.period_month}/{payload.period_year} for {entity.code}",
    )
    # Every section is created empty. The user populates each one from its own
    # header — "Pull from System" for the system-fed sections, the income modal
    # for INCOME — so nothing lands in a budget without having been asked for.
    # Only the recurring "constant" lines are seeded up front, and those carry
    # no amounts anyway (they exist for the user to type into).
    sections = {s.name: s for s in db.query(BudgetSection).filter(BudgetSection.budget_id == budget.id).all()}
    _apply_constants(budget, db, sections)
    db.commit()
    return _load_detail(budget.id, db)


# ── Line Templates ("constants") ──────────────────────────────────────────────
# Admin-managed, global (apply across every entity's budgets). Each active template
# is seeded into a budget's matching section on creation and on every "Pull from
# system" refresh (see _apply_constants) if it isn't already there.
# NOTE: these must be registered before the /{budget_id} routes below — otherwise
# Starlette's path matcher treats "line-templates" as a candidate budget_id and a
# 422 (not the intended handler) would answer GET /api/budgets/line-templates.

def _ensure_admin(user: User):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can manage budget constants")


@router.get("/line-templates", response_model=List[BudgetLineTemplateOut])
def list_line_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(BudgetLineTemplate).order_by(BudgetLineTemplate.section_name, BudgetLineTemplate.sort_order).all()


@router.post("/line-templates", response_model=BudgetLineTemplateOut)
def create_line_template(
    payload: BudgetLineTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_admin(current_user)
    template = BudgetLineTemplate(
        name=payload.name, section_name=payload.section_name,
        sort_order=payload.sort_order, is_active=payload.is_active,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.patch("/line-templates/{template_id}", response_model=BudgetLineTemplateOut)
def update_line_template(
    template_id: int,
    payload: BudgetLineTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_admin(current_user)
    template = db.query(BudgetLineTemplate).filter(BudgetLineTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Budget constant not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field, value)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/line-templates/{template_id}")
def delete_line_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_admin(current_user)
    template = db.query(BudgetLineTemplate).filter(BudgetLineTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Budget constant not found")
    db.delete(template)
    db.commit()
    return {"detail": "Budget constant deleted"}


@router.post("/{budget_id}/sections/{section_id}/pull", response_model=BudgetDetailOut)
def pull_section_from_system(
    budget_id: int,
    section_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Pull system data into ONE section's auto lines. Manual lines, hand-edited
    (overridden) cells, and every other section are left untouched."""
    budget = _get_budget_checked(budget_id, current_user, db)
    section = db.query(BudgetSection).filter(
        BudgetSection.id == section_id,
        BudgetSection.budget_id == budget_id,
    ).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    if section.name == SEC_INCOME[0]:
        raise HTTPException(
            status_code=400,
            detail="Income is chosen, not pulled — use the income selection modal",
        )
    if section.name not in SECTION_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"{section.name} has no system data to pull — add its lines by hand",
        )

    count = _apply_autofill(budget, db, current_user, section_names={section.name})
    log_action(
        db, "budget.section_pulled", user_id=current_user.id,
        resource_type="budget", resource_id=budget_id,
        description=f"Pulled {count} system line(s) into {section.name} "
                    f"on budget {budget.period_month}/{budget.period_year}",
    )
    db.commit()
    return _load_detail(budget_id, db)


@router.get("/{budget_id}/income-candidates", response_model=List[BudgetIncomeCandidateOut])
def list_income_candidates(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every income row the system can offer this budget: one per PO, plus an
    "All Invoices Paid" bucket for invoices without one. `selected` marks the
    ones already in the budget so the modal opens with them ticked."""
    budget = _get_budget_checked(budget_id, current_user, db)
    code = (budget.entity.code or "").upper()
    months = _budget_window(code, budget.period_month, budget.period_year)
    candidates = income_candidates(budget.entity_id, months)

    section = db.query(BudgetSection).filter(
        BudgetSection.budget_id == budget_id,
        BudgetSection.name == SEC_INCOME[0],
    ).first()
    existing = set()
    if section:
        existing = {
            l.source_key for l in db.query(BudgetLine).filter(
                BudgetLine.section_id == section.id,
                BudgetLine.source == "auto",
            ).all() if l.source_key
        }

    out = []
    for c in candidates:
        values = sorted(c["values"].items(), key=lambda kv: (kv[0][1], kv[0][0]))
        out.append(BudgetIncomeCandidateOut(
            source_key=c["source_key"],
            line_name=c["line_name"],
            values=[{"month": m, "year": y, "amount_due": v["due"]} for (m, y), v in values],
            total=sum((v["due"] for v in c["values"].values()), Decimal("0")),
            selected=c["source_key"] in existing,
        ))
    return out


@router.put("/{budget_id}/income-lines", response_model=BudgetDetailOut)
def set_income_lines(
    budget_id: int,
    payload: BudgetIncomeSelection,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set the budget's income lines to exactly the ticked candidates.

    Authoritative for AUTO income lines only: a ticked key is created (or has its
    figures refreshed), an unticked one is removed. Manually added income lines
    are never touched — they aren't candidates and have no source_key.
    """
    budget = _get_budget_checked(budget_id, current_user, db)
    code = (budget.entity.code or "").upper()
    months = _budget_window(code, budget.period_month, budget.period_year)

    wanted = set(payload.source_keys)
    candidates = income_candidates(budget.entity_id, months)
    known = {c["source_key"] for c in candidates}
    unknown = wanted - known
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"No such income for this period: {', '.join(sorted(unknown))}",
        )

    section = db.query(BudgetSection).filter(
        BudgetSection.budget_id == budget_id,
        BudgetSection.name == SEC_INCOME[0],
    ).first()
    removed = 0
    if section:
        for line in db.query(BudgetLine).filter(
            BudgetLine.section_id == section.id,
            BudgetLine.source == "auto",
        ).all():
            if line.source_key not in wanted:
                db.delete(line)   # values cascade
                removed += 1
        db.flush()

    specs = [c for c in candidates if c["source_key"] in wanted]
    _apply_autofill(budget, db, current_user, section_names={SEC_INCOME[0]}, specs=specs)

    log_action(
        db, "budget.income_selected", user_id=current_user.id,
        resource_type="budget", resource_id=budget_id,
        description=f"Set income to {len(specs)} line(s)"
                    + (f", removed {removed}" if removed else "")
                    + f" on budget {budget.period_month}/{budget.period_year}",
    )
    db.commit()
    return _load_detail(budget_id, db)


@router.post("/{budget_id}/replicate", response_model=BudgetReplicateOut)
def replicate_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Carry this budget forward into the next month, creating it if needed.

    The month shift is what makes this non-trivial. A budget's columns are a
    rolling window — June spans [Jun, Jul, Aug], July spans [Jul, Aug, Sep] — but
    a BudgetLineValue is keyed by its ABSOLUTE (month, year). So the figures
    don't move: June's Jul figure is already July's Jul figure. What shifts is
    the window around them. Copying therefore means keeping every value whose
    month still falls inside the TARGET's window and dropping the rest — June's
    own Jun column has rolled off and must not follow, and Sep is left blank for
    the user to pull or type.

    Merge, never overwrite: missing lines are added and only blank cells are
    filled, so a target month someone has already worked in keeps its figures and
    pressing Replicate twice changes nothing the second time.
    """
    source = _get_budget_checked(budget_id, current_user, db)
    tm, ty = _next_month(source.period_month, source.period_year)

    target = db.query(Budget).filter(
        Budget.entity_id == source.entity_id,
        Budget.period_month == tm,
        Budget.period_year == ty,
    ).first()
    created = target is None
    if created:
        target = Budget(
            entity_id=source.entity_id,
            name=source.name,
            period_month=tm,
            period_year=ty,
            created_by_id=current_user.id,
        )
        db.add(target)
        db.flush()
        for i, (name, section_type) in enumerate(_sections_for_entity(source.entity)):
            db.add(BudgetSection(budget_id=target.id, name=name, section_type=section_type, sort_order=i))
        db.flush()

    code = (source.entity.code or "").upper()
    window = set(_budget_window(code, tm, ty))
    excluded = ENTITY_SECTION_EXCLUSIONS.get(code, set())

    tgt_sections = {s.name: s for s in db.query(BudgetSection).filter(BudgetSection.budget_id == target.id).all()}
    next_section_order = max([s.sort_order or 0 for s in tgt_sections.values()], default=-1) + 1

    lines_added = 0
    values_filled = 0

    src_sections = db.query(BudgetSection).filter(
        BudgetSection.budget_id == source.id
    ).order_by(BudgetSection.sort_order).all()

    for src_sec in src_sections:
        if src_sec.name in excluded:
            continue
        tgt_sec = tgt_sections.get(src_sec.name)
        if tgt_sec is None:
            # A section the user added by hand to the source budget.
            tgt_sec = BudgetSection(budget_id=target.id, name=src_sec.name,
                                    section_type=src_sec.section_type, sort_order=next_section_order)
            next_section_order += 1
            db.add(tgt_sec)
            db.flush()
            tgt_sections[src_sec.name] = tgt_sec

        tgt_lines = db.query(BudgetLine).filter(BudgetLine.section_id == tgt_sec.id).all()
        # System lines match on source_key; hand-added ones have none, so they
        # match on name — otherwise every replicate would duplicate them.
        by_key = {l.source_key: l for l in tgt_lines if l.source_key}
        by_name = {(l.name or "").strip().lower(): l for l in tgt_lines}
        next_order = max([l.sort_order or 0 for l in tgt_lines], default=-1) + 1

        src_lines = db.query(BudgetLine).filter(
            BudgetLine.section_id == src_sec.id
        ).order_by(BudgetLine.sort_order).all()

        for src_line in src_lines:
            name_key = (src_line.name or "").strip().lower()
            tgt_line = by_key.get(src_line.source_key) if src_line.source_key else by_name.get(name_key)
            if tgt_line is None:
                tgt_line = BudgetLine(
                    section_id=tgt_sec.id, name=src_line.name, notes=src_line.notes,
                    source=src_line.source, source_key=src_line.source_key,
                    sort_order=next_order,
                )
                next_order += 1
                db.add(tgt_line)
                db.flush()
                if src_line.source_key:
                    by_key[src_line.source_key] = tgt_line
                by_name[name_key] = tgt_line
                lines_added += 1

            existing = {
                (v.month, v.year): v for v in
                db.query(BudgetLineValue).filter(BudgetLineValue.line_id == tgt_line.id).all()
            }
            for src_val in db.query(BudgetLineValue).filter(BudgetLineValue.line_id == src_line.id).all():
                if (src_val.month, src_val.year) not in window:
                    continue    # rolled off the front of the new window
                tgt_val = existing.get((src_val.month, src_val.year))
                if tgt_val is None:
                    tgt_val = BudgetLineValue(line_id=tgt_line.id, month=src_val.month, year=src_val.year)
                    db.add(tgt_val)
                    existing[(src_val.month, src_val.year)] = tgt_val
                elif tgt_val.amount_due is not None or tgt_val.amount_paid is not None:
                    continue    # already has a figure — the user's work wins
                tgt_val.amount_due = src_val.amount_due
                tgt_val.amount_paid = src_val.amount_paid
                # Carry the pin, don't invent one: a figure the user typed stays
                # pinned against the next pull, a plain system figure stays
                # refreshable so pulling the new month overwrites it with real data.
                tgt_val.is_overridden = src_val.is_overridden
                values_filled += 1

    log_action(
        db, "budget.replicated", user_id=current_user.id,
        resource_type="budget", resource_id=target.id,
        description=f"Replicated budget {source.period_month}/{source.period_year} → {tm}/{ty} "
                    f"({'created' if created else 'merged into existing'}; "
                    f"{lines_added} line(s) added, {values_filled} value(s) filled)",
    )
    db.commit()
    return BudgetReplicateOut(
        budget=_load_detail(target.id, db),
        created=created,
        lines_added=lines_added,
        values_filled=values_filled,
    )


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
    # A hand-edit pins the cell so a later refresh-from-system won't overwrite it.
    if line.source == "auto":
        value.is_overridden = True

    db.commit()
    db.refresh(value)
    return value
