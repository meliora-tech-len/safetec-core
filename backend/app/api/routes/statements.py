import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import extract
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from app.db.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Statement, StatementLine, BusinessEntity, Customer
from app.schemas.schemas import StatementCreate, StatementUpdate, StatementOut
from app.services.statement_generator import generate_statement_pdf, generate_statement_excel

router = APIRouter(prefix="/api/statements", tags=["statements"])


def _filename(data: StatementCreate, entity, ext: str) -> str:
    code = (entity.code if entity else None) or "ENT"
    ttl  = (data.title or "STATEMENT").strip().replace(" ", "_")
    return f"{code}_{ttl}.{ext}"


def _check_access(entity_id: int, user: User):
    if user.role == "admin":
        return
    if entity_id not in [a.entity_id for a in user.entity_access]:
        raise HTTPException(status_code=403, detail="Access denied to this entity")


def _load(stmt_id: int, db: Session) -> Statement:
    s = (
        db.query(Statement)
        .options(
            joinedload(Statement.lines),
            joinedload(Statement.customer),
            joinedload(Statement.entity),
        )
        .filter(Statement.id == stmt_id)
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Statement not found")
    return s


@router.get("/", response_model=List[StatementOut])
def list_statements(
    entity_id:      Optional[int] = Query(None),
    statement_type: Optional[str] = Query(None),
    month:          Optional[int] = Query(None, ge=1, le=12),
    year:           Optional[int] = Query(None, ge=2000, le=2100),
    db:             Session       = Depends(get_db),
    current_user:   User          = Depends(get_current_user),
):
    q = db.query(Statement).options(
        joinedload(Statement.lines),
        joinedload(Statement.customer),
        joinedload(Statement.entity),
    )
    if entity_id:
        q = q.filter(Statement.entity_id == entity_id)
    elif current_user.role != "admin":
        ids = [a.entity_id for a in current_user.entity_access]
        q = q.filter(Statement.entity_id.in_(ids))
    if statement_type:
        q = q.filter(Statement.statement_type == statement_type)
    if month:
        q = q.filter(extract("month", Statement.statement_date) == month)
    if year:
        q = q.filter(extract("year", Statement.statement_date) == year)
    return q.order_by(Statement.statement_date.desc(), Statement.id.desc()).all()


@router.post("/", response_model=StatementOut, status_code=201)
def create_statement(
    data:         StatementCreate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    _check_access(data.entity_id, current_user)
    stmt = Statement(
        entity_id      = data.entity_id,
        customer_id    = data.customer_id,
        statement_type = data.statement_type,
        statement_date = data.statement_date,
        title          = data.title,
        notes          = data.notes,
        created_by_id  = current_user.id,
    )
    db.add(stmt)
    db.flush()
    for i, line in enumerate(data.lines):
        db.add(StatementLine(
            statement_id   = stmt.id,
            line_date      = line.line_date,
            description    = line.description,
            invoice_number = line.invoice_number,
            amount         = line.amount,
            kind           = line.kind,
            sort_order     = i,
        ))
    db.commit()
    return _load(stmt.id, db)


def _export_prep(data: StatementCreate, db: Session, current_user: User):
    _check_access(data.entity_id, current_user)
    entity = db.query(BusinessEntity).filter(BusinessEntity.id == data.entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    customer = (db.query(Customer).filter(Customer.id == data.customer_id).first()
                if data.customer_id else None)
    return entity, customer


@router.post("/export/pdf")
async def export_statement_pdf(
    data:         StatementCreate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    entity, customer = _export_prep(data, db, current_user)
    pdf_bytes = await asyncio.to_thread(generate_statement_pdf, data, entity, customer)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_filename(data, entity, "pdf")}"'},
    )


@router.post("/export/xlsx")
async def export_statement_xlsx(
    data:         StatementCreate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    entity, customer = _export_prep(data, db, current_user)
    xlsx_bytes = await asyncio.to_thread(generate_statement_excel, data, entity, customer)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{_filename(data, entity, "xlsx")}"'},
    )


@router.get("/{stmt_id}", response_model=StatementOut)
def get_statement(
    stmt_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    s = _load(stmt_id, db)
    _check_access(s.entity_id, current_user)
    return s


@router.put("/{stmt_id}", response_model=StatementOut)
def update_statement(
    stmt_id:      int,
    data:         StatementUpdate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    s = _load(stmt_id, db)
    _check_access(s.entity_id, current_user)

    if data.customer_id    is not None: s.customer_id    = data.customer_id
    if data.statement_type is not None: s.statement_type = data.statement_type
    if data.statement_date is not None: s.statement_date = data.statement_date
    if data.title          is not None: s.title          = data.title
    if data.notes          is not None: s.notes          = data.notes

    if data.lines is not None:
        db.query(StatementLine).filter(StatementLine.statement_id == stmt_id).delete()
        for i, line in enumerate(data.lines):
            db.add(StatementLine(
                statement_id   = stmt_id,
                line_date      = line.line_date,
                description    = line.description,
                invoice_number = line.invoice_number,
                amount         = line.amount,
                kind           = line.kind,
                sort_order     = i,
            ))

    db.commit()
    return _load(stmt_id, db)


@router.delete("/{stmt_id}", status_code=204)
def delete_statement(
    stmt_id:      int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    s = _load(stmt_id, db)
    _check_access(s.entity_id, current_user)
    db.delete(s)
    db.commit()
