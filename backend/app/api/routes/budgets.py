import re
from datetime import datetime, timezone
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
    BudgetBankRow, BudgetIncomeAssignment,
)
from app.schemas.schemas import (
    BudgetCreate, BudgetUpdate, BudgetOut, BudgetDetailOut, BudgetLockUpdate,
    BudgetBankRowCreate, BudgetBankRowUpdate, BudgetBankRowOut,
    BudgetSectionCreate, BudgetSectionUpdate, BudgetSectionOut, BudgetSectionRestore,
    BudgetLineCreate, BudgetLineUpdate, BudgetLineOut,
    BudgetLineValueIn, BudgetLineValueOut,
    BudgetLineTemplateCreate, BudgetLineTemplateUpdate, BudgetLineTemplateOut,
    BudgetIncomeCandidateOut, BudgetIncomeSelection, BudgetReplicateOut,
    BudgetPruneItemOut, BudgetPrunePreviewOut, BudgetBankPruneItemOut,
)
from app.services.audit import log_action
from app.services.budget_autofill import (
    compute_autofill, income_candidates, SECTION_SOURCES, SEC_INCOME,
    _prev_month, _next_month,
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


# Bank Info Summary — every trading entity keeps its own account balances, so the
# block is seeded for all of them (SP, the dormant one, is left out). Labels come
# from Larissa's Safetec sheet and are seeded as a STARTING POINT for the others:
# amounts are read off the banking system by hand, so a new budget starts with the
# rows present and empty, and every row is freely renamable/deletable afterwards —
# an entity that has no money market accounts just deletes those rows.
BANK_INFO_ENTITIES = {"SFT", "OBHI", "BTP", "TP", "BKMO"}
DEFAULT_BANK_ROWS = [
    ("bank", "CURRENT ACC"),
    ("bank", "MONEY MARKET 001"),
    ("bank", "MONEY MARKET 002 - VAT"),
    ("bank", "MONEY MARKET 003 - BUILD UP"),
    ("bank", "MONEY MARKET 004 - INTEREST"),
    ("bank", "MONEY MARKET 005"),
    ("bank", "CASH FLOW TOTAL"),
    ("to_be_paid", "30days"),
    ("to_be_paid", "current"),
    ("to_be_paid", "KRIP & 7CS"),
]
BANK_ROW_KINDS = {"bank", "to_be_paid"}

# The CASH FLOW TOTAL row is computed, not captured: the page shows the sum of the
# account rows above it (typing an amount pins it; blanking goes back to the sum).
# Matched by label so the user's own June row counts, however it was typed.
CASH_FLOW_TOTAL_RE = re.compile(r"cash\s*flow\s*total", re.IGNORECASE)

# The 'to_be_paid' list, the profit line and the vat-back adjustment under it are
# Safetec's sheet alone; the other entities show the account balances only, so they
# are seeded with the 'bank' rows and nothing else.
FULL_BANK_BLOCK_ENTITIES = {"SFT"}


def _seed_bank_rows(budget: Budget, entity, db: Session) -> int:
    """Seed the Bank Info Summary rows (labels only) on a new budget."""
    code = (entity.code or "").upper()
    if code not in BANK_INFO_ENTITIES:
        return 0
    existing = db.query(BudgetBankRow).filter(BudgetBankRow.budget_id == budget.id).count()
    if existing:
        return 0
    rows = [(k, l) for (k, l) in DEFAULT_BANK_ROWS
            if k == "bank" or code in FULL_BANK_BLOCK_ENTITIES]
    for order, (kind, label) in enumerate(rows):
        db.add(BudgetBankRow(budget_id=budget.id, kind=kind, label=label, sort_order=order))
    db.flush()
    return len(rows)


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


def ensure_budget_not_locked(budget: Budget):
    """A locked budget is final (mirrors the costing "Sent" lock): nothing may
    be added, changed or removed. Every mutating budget endpoint funnels
    through here — the lock toggle itself is the one exception."""
    if budget.locked_at is not None:
        raise HTTPException(
            status_code=403,
            detail=f"The {budget.period_month:02d}/{budget.period_year} budget is locked — "
                   "nothing can be added or changed. It must be unlocked first.",
        )


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


def _missing_default_sections(budget: Budget) -> list:
    """The entity's standard sections this budget hasn't got, in default order.

    A deleted section leaves no trace of itself, so the page needs to be told what
    *should* be there — that's what drives the "restore" prompt."""
    have = {(s.name or "").strip().upper() for s in budget.sections}
    return [(name, stype) for (name, stype) in _sections_for_entity(budget.entity)
            if name.upper() not in have]


def _load_detail(budget_id: int, db: Session) -> Budget:
    budget = db.query(Budget).options(
        joinedload(Budget.sections).joinedload(BudgetSection.lines).joinedload(BudgetLine.values),
        joinedload(Budget.bank_rows),
    ).filter(Budget.id == budget_id).first()
    if budget:
        # Not a mapped column — attached for the response schema to pick up.
        budget.missing_sections = [
            {"name": n, "section_type": t} for (n, t) in _missing_default_sections(budget)
        ]
    return budget


def _rolling_months(month: int, year: int, n: int = ROLLING_MONTHS):
    """[(month, year), (+1), (+2)] — the budget's rolling window."""
    out = []
    y, m = year, month
    for _ in range(n):
        out.append((m, y))
        idx = y * 12 + (m - 1) + 1
        y, m = idx // 12, idx % 12 + 1
    return out


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
            if not line.name_overridden:
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
    _seed_bank_rows(budget, entity, db)
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
    ensure_budget_not_locked(budget)
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


# The INCOME section carries two GENERIC lines; the modal assigns each income
# candidate to one of them and the line's figure is the sum of its candidates.
# Keyed by bucket → (auto-line source_key, line name). The names match the ones
# on the June Safetec sheet, so existing lines with those names are adopted.
INCOME_BUCKETS = {
    "tradekor": ("income:bucket:tradekor", "TRADEKOR INCOME ONLY"),
    "other": ("income:bucket:other", "OTHER INCOME"),
}


def _default_bucket(candidate: dict) -> str:
    """Where a candidate lands when the user hasn't chosen: Tradekor customers
    into TRADEKOR INCOME ONLY, everything else into OTHER INCOME."""
    return "tradekor" if "tradekor" in (candidate.get("customer_name") or "").lower() else "other"


@router.get("/{budget_id}/income-candidates", response_model=List[BudgetIncomeCandidateOut])
def list_income_candidates(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every income row the system can offer this budget: one per PO, plus one
    per invoice that has no PO (labelled by its invoice number). `selected` marks
    the ones already counted in the budget's income and `bucket` says which
    generic line each feeds, so the modal opens exactly as it was left."""
    budget = _get_budget_checked(budget_id, current_user, db)
    code = (budget.entity.code or "").upper()
    months = _budget_window(code, budget.period_month, budget.period_year)
    candidates = income_candidates(budget.entity_id, months)

    assignments = {
        a.source_key: a.bucket
        for a in db.query(BudgetIncomeAssignment).filter(
            BudgetIncomeAssignment.budget_id == budget_id).all()
    }

    # Legacy budgets: income picked before the generic lines existed left one
    # auto line per candidate and no stored assignments. Those keys still count
    # as selected (in their default bucket) so nothing looks unticked until the
    # selection is re-applied.
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
        key = c["source_key"]
        out.append(BudgetIncomeCandidateOut(
            source_key=key,
            line_name=c["line_name"],
            invoice_number=c.get("invoice_number"),
            po_number=c.get("po_number"),
            customer_name=c.get("customer_name"),
            values=[{"month": m, "year": y, "amount_due": v["due"]} for (m, y), v in values],
            issue_months=c.get("issue_months") or [],
            total=sum((v["due"] for v in c["values"].values()), Decimal("0")),
            selected=key in assignments or key in existing,
            bucket=assignments.get(key) or _default_bucket(c),
        ))
    return out


@router.put("/{budget_id}/income-lines", response_model=BudgetDetailOut)
def set_income_lines(
    budget_id: int,
    payload: BudgetIncomeSelection,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set the budget's income to the assigned candidates, aggregated into the
    two generic income lines (TRADEKOR INCOME ONLY / OTHER INCOME).

    Each generic line's monthly figure is the SUM of the candidates assigned to
    it; the per-candidate choices are stored so the modal reopens as it was
    left. Authoritative for AUTO income lines only: a bucket with candidates is
    created/refreshed, an empty one is removed, and any old per-PO auto lines
    are folded away. A hand-added line already NAMED like a generic line (June's
    OTHER INCOME) is adopted rather than duplicated, keeping its id, pinned
    cells and verification marks. Other manual income lines are never touched.
    """
    budget = _get_budget_checked(budget_id, current_user, db)
    ensure_budget_not_locked(budget)
    code = (budget.entity.code or "").upper()
    months = _budget_window(code, budget.period_month, budget.period_year)

    candidates = income_candidates(budget.entity_id, months)
    by_key = {c["source_key"]: c for c in candidates}

    assignments = dict(payload.assignments or {})
    # Legacy shape: bare source_keys land in their default bucket.
    for k in payload.source_keys or []:
        assignments.setdefault(k, _default_bucket(by_key.get(k, {})))

    unknown = set(assignments) - set(by_key)
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"No such income for this period: {', '.join(sorted(unknown))}",
        )
    bad = sorted({b for b in assignments.values() if b not in INCOME_BUCKETS})
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown income line: {', '.join(bad)} — use one of {', '.join(INCOME_BUCKETS)}",
        )

    # This payload is the whole selection, so the stored choices are replaced.
    db.query(BudgetIncomeAssignment).filter(
        BudgetIncomeAssignment.budget_id == budget_id).delete()
    for k, b in assignments.items():
        db.add(BudgetIncomeAssignment(budget_id=budget_id, source_key=k, bucket=b))
    db.flush()

    # One spec per non-empty bucket: its candidates' figures summed per month.
    specs = []
    for bucket, (skey, line_name) in INCOME_BUCKETS.items():
        members = [by_key[k] for k, b in assignments.items() if b == bucket]
        if not members:
            continue
        values: dict = {}
        for c in members:
            for (m, y), amts in c["values"].items():
                cell = values.setdefault((m, y), {"due": Decimal("0"), "paid": None})
                cell["due"] += amts["due"]
        specs.append({
            "section_name": SEC_INCOME[0], "section_type": SEC_INCOME[1],
            "source_key": skey, "line_name": line_name, "values": values,
        })
    wanted = {s["source_key"] for s in specs}

    section = db.query(BudgetSection).filter(
        BudgetSection.budget_id == budget_id,
        BudgetSection.name == SEC_INCOME[0],
    ).first()
    removed = 0
    if section:
        lines = db.query(BudgetLine).filter(BudgetLine.section_id == section.id).all()
        by_src = {l.source_key: l for l in lines if l.source == "auto" and l.source_key}
        by_name: dict = {}
        for l in sorted(lines, key=lambda l: (l.sort_order or 0, l.id)):
            by_name.setdefault((l.name or "").strip().upper(), l)
        # Adopt before pruning: an existing line named like a generic line
        # becomes that line (only when the bucket is actually wanted — adopting
        # for an empty bucket would hand a manual line to the delete pass).
        for bucket, (skey, line_name) in INCOME_BUCKETS.items():
            if skey not in wanted or skey in by_src:
                continue
            match = by_name.get(line_name.upper())
            if match is not None and match.source_key != skey:
                match.source = "auto"
                match.source_key = skey
                by_src[skey] = match
        db.flush()
        for line in lines:
            if line.source == "auto" and line.source_key not in wanted:
                db.delete(line)   # values cascade
                removed += 1
        db.flush()

    _apply_autofill(budget, db, current_user, section_names={SEC_INCOME[0]}, specs=specs)

    log_action(
        db, "budget.income_selected", user_id=current_user.id,
        resource_type="budget", resource_id=budget_id,
        description=f"Assigned {len(assignments)} income row(s) into {len(specs)} generic line(s)"
                    + (f", removed {removed} old line(s)" if removed else "")
                    + f" on budget {budget.period_month}/{budget.period_year}",
    )
    db.commit()
    return _load_detail(budget_id, db)


# ── Prune (the "match exactly" half of replicate) ─────────────────────────────
# Replicate only ever merges, so a target month that was pulled (or seeded with
# constants) before being replicated into keeps every line the source doesn't
# have, and the two months drift apart. Pruning removes those extras.

def _line_ident(line) -> str:
    """How replicate decides two lines are the same one — keep the two in step."""
    return line.source_key or ("name:" + (line.name or "").strip().lower())


def _prunable(line, values) -> bool:
    """Can this extra line go without losing anything the user typed?

    Empty lines always can. A system line can too: its figures came from a pull
    and another pull brings them back. What we never touch is a hand-typed
    figure — a manual line with an amount on it, or an auto cell the user pinned.
    """
    if not any(v.amount_due is not None or v.amount_paid is not None for v in values):
        return True
    if line.source == "manual":
        return False
    return not any(v.is_overridden for v in values)


def _prune_plan(db: Session, source: Budget, target: Budget):
    """Extras the target has and the source doesn't.

    Returns (remove, keep, sections_to_remove). `remove` and `keep` are lists of
    (section_name, BudgetLine); `keep` is the extras protected by _prunable.
    Safe to compute before the merge: the merge only ever adds lines the source
    has, and those are exactly the ones this never touches.
    """
    src_sections = db.query(BudgetSection).filter(BudgetSection.budget_id == source.id).all()
    src_idents = {}
    for s in src_sections:
        counts: dict = {}
        for l in db.query(BudgetLine).filter(BudgetLine.section_id == s.id).all():
            counts[_line_ident(l)] = counts.get(_line_ident(l), 0) + 1
        src_idents[s.name] = counts

    remove, keep, sections_to_remove = [], [], []
    for tsec in db.query(BudgetSection).filter(BudgetSection.budget_id == target.id).all():
        tgt_lines = db.query(BudgetLine).filter(BudgetLine.section_id == tsec.id).all()
        wanted = src_idents.get(tsec.name)
        section_gone = wanted is None
        if section_gone:
            wanted = {}

        # Duplicate names are real (three CENTRA FIN (BIKE) rows, say), so match
        # by count: keep as many as the source has, the rest are extras.
        seen: dict = {}
        extras = []
        for l in tgt_lines:
            k = _line_ident(l)
            seen[k] = seen.get(k, 0) + 1
            if seen[k] > wanted.get(k, 0):
                extras.append(l)

        blocked = False
        for l in extras:
            values = db.query(BudgetLineValue).filter(BudgetLineValue.line_id == l.id).all()
            if _prunable(l, values):
                remove.append((tsec.name, l))
            else:
                keep.append((tsec.name, l))
                blocked = True

        # A section only goes once nothing of the user's is left standing in it.
        if section_gone and not blocked:
            sections_to_remove.append(tsec)

    return remove, keep, sections_to_remove


def _apply_prune(db: Session, source: Budget, target: Budget):
    """Delete the extras, then put the target's sections and lines in the
    source's order so the two months read the same top to bottom."""
    remove, keep, sections_to_remove = _prune_plan(db, source, target)

    for _, line in remove:
        db.query(BudgetLineValue).filter(BudgetLineValue.line_id == line.id).delete()
        db.delete(line)
    db.flush()
    for sec in sections_to_remove:
        db.delete(sec)
    db.flush()

    src_sections = {s.name: s for s in db.query(BudgetSection).filter(
        BudgetSection.budget_id == source.id).all()}
    for tsec in db.query(BudgetSection).filter(BudgetSection.budget_id == target.id).all():
        ssec = src_sections.get(tsec.name)
        if ssec is None:
            continue
        tsec.sort_order = ssec.sort_order
        order = {}
        for i, sl in enumerate(db.query(BudgetLine).filter(
                BudgetLine.section_id == ssec.id).order_by(BudgetLine.sort_order, BudgetLine.id).all()):
            order.setdefault(_line_ident(sl), []).append(i)
        for tl in db.query(BudgetLine).filter(
                BudgetLine.section_id == tsec.id).order_by(BudgetLine.sort_order, BudgetLine.id).all():
            slot = order.get(_line_ident(tl))
            if slot:
                tl.sort_order = slot.pop(0)

    return len(remove), len(keep), len(sections_to_remove)


def _bank_ident(row) -> str:
    """How replicate decides two Bank Info Summary rows are the same one."""
    return f"{row.kind}:{(row.label or '').strip().lower()}"


def _replicate_bank_rows(db: Session, source: Budget, target: Budget):
    """Carry the Bank Info Summary block forward.

    The block is a plain list of hand-captured rows, not lines under a section,
    so the section/line merge above walks straight past it and a replicated
    month used to come out with no bank block at all.

    Same merge rule as the lines: a row the target hasn't got is created with the
    source's label, note and amount; a row it already has keeps what is on it and
    only has its blanks filled. Balances are read off the banking system by hand
    each month, so what carries over is last month's figure as a STARTING POINT —
    typing over it is the normal way to use it, and replicating again won't undo
    that. Returns (rows_added, amounts_filled).
    """
    src_rows = db.query(BudgetBankRow).filter(
        BudgetBankRow.budget_id == source.id
    ).order_by(BudgetBankRow.sort_order, BudgetBankRow.id).all()
    if not src_rows:
        return 0, 0

    tgt_rows = db.query(BudgetBankRow).filter(BudgetBankRow.budget_id == target.id).all()
    pool: dict = {}
    for r in tgt_rows:
        pool.setdefault(_bank_ident(r), []).append(r)
    # New rows go on the end of their own list, mirroring add_bank_row.
    next_order = {
        k: max([r.sort_order or 0 for r in tgt_rows if r.kind == k], default=-1) + 1
        for k in BANK_ROW_KINDS
    }

    rows_added = amounts_filled = 0
    for src in src_rows:
        # CASH FLOW TOTAL is computed on the page from the rows above it — carrying
        # last month's figure would pin the new month at a stale total, so the row
        # comes over but its amount stays blank (= auto-sum).
        carry_amount = None if CASH_FLOW_TOTAL_RE.search(src.label or "") else src.amount
        bucket = pool.get(_bank_ident(src))
        tgt = bucket.pop(0) if bucket else None
        if tgt is None:
            order = next_order.get(src.kind, 0)
            next_order[src.kind] = order + 1
            db.add(BudgetBankRow(budget_id=target.id, kind=src.kind, label=src.label,
                                 note=src.note, amount=carry_amount, sort_order=order))
            rows_added += 1
            if carry_amount is not None:
                amounts_filled += 1
            continue
        if tgt.amount is None and carry_amount is not None:
            tgt.amount = carry_amount
            amounts_filled += 1
        if not (tgt.note or "").strip() and src.note:
            tgt.note = src.note
    db.flush()
    return rows_added, amounts_filled


def _bank_prune_plan(db: Session, source: Budget, target: Budget):
    """Bank Info Summary rows the target has and the source doesn't.

    Returns (remove, keep) as lists of BudgetBankRow. Nothing in this block comes
    from a pull — every figure on it was read off the banking system by hand — so
    the protection rule is simpler than _prunable's: a row with an amount or a
    note on it is someone's work and stays; a bare label can go.

    Safe to compute after the merge, which only ever adds rows the source has:
    those are matched off against the source's own count and never land in
    `remove`.
    """
    src_rows = db.query(BudgetBankRow).filter(BudgetBankRow.budget_id == source.id).all()
    if not src_rows:
        # No block to match against — leave the target's alone rather than
        # emptying it out against a source that never had one.
        return [], []

    wanted: dict = {}
    for r in src_rows:
        wanted[_bank_ident(r)] = wanted.get(_bank_ident(r), 0) + 1

    seen: dict = {}
    remove, keep = [], []
    for r in db.query(BudgetBankRow).filter(
            BudgetBankRow.budget_id == target.id
    ).order_by(BudgetBankRow.sort_order, BudgetBankRow.id).all():
        k = _bank_ident(r)
        seen[k] = seen.get(k, 0) + 1
        if seen[k] <= wanted.get(k, 0):
            continue    # the source has one of these, so it is not an extra
        if r.amount is None and not (r.note or "").strip():
            remove.append(r)
        else:
            keep.append(r)
    return remove, keep


def _apply_bank_prune(db: Session, source: Budget, target: Budget):
    """Delete the extra bank rows, then put the rest in the source's order so the
    two months' Bank Info Summary reads the same top to bottom."""
    remove, keep = _bank_prune_plan(db, source, target)
    for row in remove:
        db.delete(row)
    db.flush()

    order: dict = {}
    for r in db.query(BudgetBankRow).filter(
            BudgetBankRow.budget_id == source.id
    ).order_by(BudgetBankRow.sort_order, BudgetBankRow.id).all():
        order.setdefault(_bank_ident(r), []).append(r.sort_order or 0)
    # Extras that survived go under their list rather than jumbling into it.
    tail = {k: max([r.sort_order or 0 for r in db.query(BudgetBankRow).filter(
        BudgetBankRow.budget_id == source.id, BudgetBankRow.kind == k).all()], default=-1) + 1
        for k in BANK_ROW_KINDS}
    for r in db.query(BudgetBankRow).filter(
            BudgetBankRow.budget_id == target.id
    ).order_by(BudgetBankRow.sort_order, BudgetBankRow.id).all():
        slot = order.get(_bank_ident(r))
        if slot:
            r.sort_order = slot.pop(0)
        else:
            r.sort_order = tail.get(r.kind, 0)
            tail[r.kind] = r.sort_order + 1
    return len(remove), len(keep)


@router.get("/{budget_id}/replicate-preview", response_model=BudgetPrunePreviewOut)
def replicate_preview(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """What a pruning replicate would remove from next month. Read-only."""
    source = _get_budget_checked(budget_id, current_user, db)
    tm, ty = _next_month(source.period_month, source.period_year)
    target = db.query(Budget).filter(
        Budget.entity_id == source.entity_id,
        Budget.period_month == tm,
        Budget.period_year == ty,
    ).first()
    if target is None:
        # Nothing there yet, so replicate creates it and there is nothing to prune.
        return BudgetPrunePreviewOut(target_month=tm, target_year=ty, target_exists=False,
                                     remove=[], keep=[], sections_removed=[])

    remove, keep, sections_to_remove = _prune_plan(db, source, target)
    # The merge hasn't run here, so this is what the bank block looks like BEFORE
    # the missing rows are added — which is exactly right: the merge only adds
    # rows the source has, and those are never extras.
    bank_remove, bank_keep = _bank_prune_plan(db, source, target)

    def out(items):
        return [
            BudgetPruneItemOut(
                line_id=l.id, section=sec, name=l.name, source=l.source,
                has_figures=db.query(BudgetLineValue).filter(
                    BudgetLineValue.line_id == l.id,
                    or_(BudgetLineValue.amount_due.isnot(None),
                        BudgetLineValue.amount_paid.isnot(None)),
                ).count() > 0,
            )
            for sec, l in items
        ]

    def bank_out(rows):
        return [BudgetBankPruneItemOut(row_id=r.id, kind=r.kind, label=r.label) for r in rows]

    return BudgetPrunePreviewOut(
        target_month=tm, target_year=ty, target_exists=True,
        remove=out(remove), keep=out(keep),
        sections_removed=[s.name for s in sections_to_remove],
        bank_remove=bank_out(bank_remove), bank_keep=bank_out(bank_keep),
    )


@router.post("/{budget_id}/replicate", response_model=BudgetReplicateOut)
def replicate_budget(
    budget_id: int,
    prune: bool = False,
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

    `prune=true` finishes the job the other way round: after the merge, extra
    lines the target has and the source doesn't are removed and the target is put
    in the source's order, so the two months end up structurally identical.
    Hand-typed figures are never removed (see _prunable) — those extras stay and
    are counted in `lines_kept`. Call GET /replicate-preview first to show the
    user what will go.
    """
    source = _get_budget_checked(budget_id, current_user, db)
    tm, ty = _next_month(source.period_month, source.period_year)

    target = db.query(Budget).filter(
        Budget.entity_id == source.entity_id,
        Budget.period_month == tm,
        Budget.period_year == ty,
    ).first()
    created = target is None
    if not created:
        # Replicating FROM a locked month is fine (it only reads the source);
        # replicating INTO a locked month would change it, so that is blocked.
        ensure_budget_not_locked(target)
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
        # match on name — otherwise every replicate would duplicate them. Each
        # target line can only stand in for ONE source line, so the same name
        # three times over (three CENTRA FIN (BIKE) rows) carries over as three.
        pool: dict = {}
        for l in tgt_lines:
            pool.setdefault(_line_ident(l), []).append(l)
        next_order = max([l.sort_order or 0 for l in tgt_lines], default=-1) + 1

        src_lines = db.query(BudgetLine).filter(
            BudgetLine.section_id == src_sec.id
        ).order_by(BudgetLine.sort_order).all()

        for src_line in src_lines:
            bucket = pool.get(_line_ident(src_line))
            tgt_line = bucket.pop(0) if bucket else None
            if tgt_line is None:
                tgt_line = BudgetLine(
                    section_id=tgt_sec.id, name=src_line.name, notes=src_line.notes,
                    source=src_line.source, source_key=src_line.source_key,
                    name_overridden=src_line.name_overridden,
                    sort_order=next_order,
                )
                next_order += 1
                db.add(tgt_line)
                db.flush()
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

    # Safetec's Bank Info Summary lives outside the sections, so it needs its own
    # pass — otherwise the target month comes out with an empty bank block.
    bank_rows_added, bank_amounts_filled = _replicate_bank_rows(db, source, target)

    lines_removed = sections_removed = lines_kept = 0
    bank_rows_removed = bank_rows_kept = 0
    if prune and not created:
        db.flush()   # the merge's new lines must be visible to the plan
        lines_removed, lines_kept, sections_removed = _apply_prune(db, source, target)
        bank_rows_removed, bank_rows_kept = _apply_bank_prune(db, source, target)

    log_action(
        db, "budget.replicated", user_id=current_user.id,
        resource_type="budget", resource_id=target.id,
        description=f"Replicated budget {source.period_month}/{source.period_year} → {tm}/{ty} "
                    f"({'created' if created else 'merged into existing'}; "
                    f"{lines_added} line(s) added, {values_filled} value(s) filled"
                    + (f"; bank info: {bank_rows_added} row(s) added, "
                       f"{bank_amounts_filled} amount(s) carried"
                       if bank_rows_added or bank_amounts_filled else "")
                    + (f"; pruned to match: {lines_removed} line(s) and "
                       f"{sections_removed} section(s) removed, {lines_kept} kept "
                       f"(hand-typed figures)"
                       + (f", bank info {bank_rows_removed} row(s) removed, "
                          f"{bank_rows_kept} kept"
                          if bank_rows_removed or bank_rows_kept else "")
                       if prune else "")
                    + ")",
    )
    db.commit()
    return BudgetReplicateOut(
        budget=_load_detail(target.id, db),
        created=created,
        lines_added=lines_added,
        values_filled=values_filled,
        lines_removed=lines_removed,
        sections_removed=sections_removed,
        lines_kept=lines_kept,
        bank_rows_added=bank_rows_added,
        bank_amounts_filled=bank_amounts_filled,
        bank_rows_removed=bank_rows_removed,
        bank_rows_kept=bank_rows_kept,
    )


@router.get("/{budget_id}", response_model=BudgetDetailOut)
def get_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = _load_detail(budget_id, db)
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
    ensure_budget_not_locked(budget)
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


@router.put("/{budget_id}/lock", response_model=BudgetOut)
def set_budget_lock(
    budget_id: int,
    payload: BudgetLockUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lock or unlock this budget (mirrors the costing "Sent" flag). Locked =
    final: no sections, lines, amounts or bank rows may be added, changed or
    removed — enforced server-side on every mutating endpoint. Anyone with
    budget access for the entity may toggle it; every toggle is audited."""
    budget = _get_budget_checked(budget_id, current_user, db)

    if payload.locked and budget.locked_at is None:
        budget.locked_at = datetime.now(timezone.utc)
        budget.locked_by_id = current_user.id
        log_action(
            db, "budget.locked", user_id=current_user.id,
            resource_type="budget", resource_id=budget.id,
            description=f"Locked budget {budget.period_month}/{budget.period_year} "
                        f"(entity {budget.entity_id}) — no values can be added or changed",
            new_values={"locked_at": budget.locked_at.isoformat()},
        )
        db.commit()
    elif not payload.locked and budget.locked_at is not None:
        log_action(
            db, "budget.unlocked", user_id=current_user.id,
            resource_type="budget", resource_id=budget.id,
            description=f"Unlocked budget {budget.period_month}/{budget.period_year} "
                        f"(entity {budget.entity_id})",
        )
        budget.locked_at = None
        budget.locked_by_id = None
        db.commit()

    db.refresh(budget)
    return budget


@router.get("/{budget_id}/export/pdf")
def export_budget_pdf(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import io
    from fastapi.responses import StreamingResponse
    from app.services.budget_exports import generate_budget_pdf

    _get_budget_checked(budget_id, current_user, db)
    budget = _load_detail(budget_id, db)
    months = _budget_window(budget.entity.code, budget.period_month, budget.period_year)

    pdf_bytes = generate_budget_pdf(budget, budget.entity, months)
    code = (budget.entity.code or "entity").lower()
    filename = f"budget-{code}-{budget.period_year}-{budget.period_month:02d}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{budget_id}/export/excel")
def export_budget_excel(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import io
    from fastapi.responses import StreamingResponse
    from app.services.budget_exports import generate_budget_excel

    _get_budget_checked(budget_id, current_user, db)
    budget = _load_detail(budget_id, db)
    months = _budget_window(budget.entity.code, budget.period_month, budget.period_year)

    xl_bytes = generate_budget_excel(budget, budget.entity, months)
    code = (budget.entity.code or "entity").lower()
    filename = f"budget-{code}-{budget.period_year}-{budget.period_month:02d}.xlsx"
    return StreamingResponse(
        io.BytesIO(xl_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{budget_id}")
def delete_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = _get_budget_checked(budget_id, current_user, db)
    ensure_budget_not_locked(budget)
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
    ensure_budget_not_locked(budget)
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
    ensure_budget_not_locked(section.budget)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(section, field, value)
    db.commit()
    db.refresh(section)
    return section


@router.post("/{budget_id}/sections/restore", response_model=BudgetDetailOut)
def restore_sections(
    budget_id: int,
    payload: Optional[BudgetSectionRestore] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Put back a standard section this budget is missing — the one that was there
    when the budget was created and has since been deleted.

    Structure only: the section comes back empty, in its usual place, with its usual
    type, so the normal "Pull from System" / income modal can refill it. The lines and
    amounts that were in it when it was deleted are NOT recovered here — for auto lines
    a pull brings identical figures back, but hand-typed ones are gone.
    """
    budget = _get_budget_checked(budget_id, current_user, db)
    ensure_budget_not_locked(budget)
    missing = _missing_default_sections(budget)
    if payload and payload.names:
        wanted = {n.strip().upper() for n in payload.names}
        unknown = wanted - {n.upper() for (n, _) in missing}
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Not a missing standard section for this budget: {', '.join(sorted(unknown))}",
            )
        missing = [(n, t) for (n, t) in missing if n.upper() in wanted]
    if not missing:
        raise HTTPException(status_code=400, detail="This budget already has every standard section")

    # Where a restored section belongs: ahead of the first section that comes after
    # it in the default layout. Everything else keeps its current relative order, so
    # a hand-added section the user positioned themselves is never shuffled.
    default_rank = {name.upper(): i for i, (name, _) in enumerate(_sections_for_entity(budget.entity))}
    ordered = sorted(budget.sections, key=lambda s: (s.sort_order or 0, s.id))
    for name, section_type in missing:
        section = BudgetSection(budget_id=budget.id, name=name, section_type=section_type)
        rank = default_rank[name.upper()]
        at = len(ordered)
        for i, s in enumerate(ordered):
            other = default_rank.get((s.name or "").strip().upper())
            if other is not None and other > rank:
                at = i
                break
        ordered.insert(at, section)
        db.add(section)
    for i, s in enumerate(ordered):
        s.sort_order = i
    db.flush()

    names = ", ".join(n for (n, _) in missing)
    log_action(
        db, "budget.section_restored", user_id=current_user.id,
        resource_type="budget", resource_id=budget.id,
        description=f"Restored missing section(s) {names} "
                    f"on budget {budget.period_month}/{budget.period_year}",
    )
    db.commit()
    return _load_detail(budget_id, db)


def _section_snapshot(section: BudgetSection) -> dict:
    """Everything a deleted section held, small enough to park in the audit log.

    Deleting a section cascades through its lines and their amounts, so without this
    the only record of what was lost is the user's memory."""
    return {
        "name": section.name,
        "section_type": section.section_type,
        "sort_order": section.sort_order,
        "lines": [
            {
                "name": l.name,
                "notes": l.notes,
                "source": l.source,
                "source_key": l.source_key,
                "sort_order": l.sort_order,
                "name_overridden": l.name_overridden,
                "values": [
                    {
                        "month": v.month, "year": v.year,
                        "amount_due": str(v.amount_due) if v.amount_due is not None else None,
                        "amount_paid": str(v.amount_paid) if v.amount_paid is not None else None,
                        "is_overridden": v.is_overridden,
                    }
                    for v in l.values
                ],
            }
            for l in section.lines
        ],
    }


@router.delete("/sections/{section_id}")
def delete_section(
    section_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    section = _get_section_checked(section_id, current_user, db)
    budget = section.budget
    ensure_budget_not_locked(budget)
    log_action(
        db, "budget.section_deleted", user_id=current_user.id,
        resource_type="budget", resource_id=budget.id,
        description=f"Deleted section {section.name} ({len(section.lines)} line(s)) "
                    f"from budget {budget.period_month}/{budget.period_year}",
        old_values=_section_snapshot(section),
    )
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
    ensure_budget_not_locked(section.budget)
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
    ensure_budget_not_locked(line.section.budget)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="A name is required")
        changes["name"] = name
        # A hand-typed name on a system line has to survive the next pull.
        if name != line.name:
            line.name_overridden = True
    for field, value in changes.items():
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
    ensure_budget_not_locked(line.section.budget)
    db.delete(line)
    db.commit()
    return {"detail": "Line deleted"}


# ── Bank Info Summary rows ────────────────────────────────────────────────────
# Two lists on one table, told apart by `kind`: the account balances at the top and
# the boxed TO BE PAID list at the bottom. Both are hand-captured, so these are plain
# CRUD — nothing here pulls from the system.

def _get_bank_row_checked(row_id: int, user: User, db: Session) -> BudgetBankRow:
    row = db.query(BudgetBankRow).filter(BudgetBankRow.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Bank row not found")
    ensure_budget_access(user, row.budget.entity_id, db)
    return row


@router.post("/{budget_id}/bank-rows", response_model=BudgetBankRowOut)
def add_bank_row(
    budget_id: int,
    payload: BudgetBankRowCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    budget = _get_budget_checked(budget_id, current_user, db)
    ensure_budget_not_locked(budget)
    if payload.kind not in BANK_ROW_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(BANK_ROW_KINDS)}")
    # Order within the row's own list, so adding an account never lands it in the
    # middle of the TO BE PAID box.
    siblings = [r.sort_order or 0 for r in budget.bank_rows if r.kind == payload.kind]
    row = BudgetBankRow(
        budget_id=budget.id,
        kind=payload.kind,
        label=payload.label,
        note=payload.note,
        amount=payload.amount,
        sort_order=payload.sort_order if payload.sort_order is not None else max(siblings, default=-1) + 1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/bank-rows/{row_id}", response_model=BudgetBankRowOut)
def update_bank_row(
    row_id: int,
    payload: BudgetBankRowUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = _get_bank_row_checked(row_id, current_user, db)
    ensure_budget_not_locked(row.budget)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/bank-rows/{row_id}")
def delete_bank_row(
    row_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = _get_bank_row_checked(row_id, current_user, db)
    ensure_budget_not_locked(row.budget)
    db.delete(row)
    db.commit()
    return {"detail": "Bank row deleted"}


# ── Values (upsert per line+month) ────────────────────────────────────────────

@router.put("/lines/{line_id}/values", response_model=BudgetLineValueOut)
def upsert_line_value(
    line_id: int,
    payload: BudgetLineValueIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    line = _get_line_checked(line_id, current_user, db)
    ensure_budget_not_locked(line.section.budget)
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
    # A hand-edit pins the cell so a later refresh-from-system won't overwrite it —
    # but clearing the cell RELEASES the pin, so the next pull fills it from the
    # system again. Without that there is no way back: a cell typed once (or zeroed
    # while tabbing down a column) ignores every future pull forever, and Replicate
    # carries the pin into the next month's budget with it.
    # "Cleared" means the whole cell is blank — both To Pay and Paid — since the pin
    # is per cell, not per box.
    if line.source == "auto":
        value.is_overridden = not (value.amount_due is None and value.amount_paid is None)

    db.commit()
    db.refresh(value)
    return value
