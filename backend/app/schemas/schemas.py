from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List
from datetime import datetime
from decimal import Decimal
from enum import Enum


# ── Enums ─────────────────────────────────────────────────────────────────────

class UserRole(str, Enum):
    admin = "admin"
    standard = "standard"

class InvoiceStatus(str, Enum):
    draft = "draft"
    sent = "sent"
    paid = "paid"
    overdue = "overdue"
    cancelled = "cancelled"

class DocumentType(str, Enum):
    invoice = "invoice"
    quote = "quote"


# ── Auth ──────────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str
    user: "UserOut"

class TokenData(BaseModel):
    user_id: Optional[int] = None


# ── Business Entity ───────────────────────────────────────────────────────────

class EntityBase(BaseModel):
    code: str
    name: str
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    vat_number: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bank_name: Optional[str] = None
    bank_branch: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_branch_code: Optional[str] = None
    bank_reference: Optional[str] = None
    invoice_prefix: Optional[str] = None
    vat_rate: Optional[Decimal] = Decimal("0.15")

class EntityCreate(EntityBase):
    pass

class EntityUpdate(BaseModel):
    name: Optional[str] = None
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    vat_number: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bank_name: Optional[str] = None
    bank_branch: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_branch_code: Optional[str] = None
    bank_reference: Optional[str] = None
    vat_rate: Optional[Decimal] = None

class EntityOut(EntityBase):
    id: int
    invoice_counter: int
    quote_counter: int
    is_active: bool
    created_at: datetime
    logo_path: Optional[str] = None

    class Config:
        from_attributes = True


# ── Users ─────────────────────────────────────────────────────────────────────

class UserEntityAccessOut(BaseModel):
    entity_id: int
    entity_code: Optional[str] = None
    entity_name: Optional[str] = None
    can_create: bool
    can_edit: bool
    can_delete: bool

    class Config:
        from_attributes = True

class UserBase(BaseModel):
    email: str
    full_name: str
    role: UserRole = UserRole.standard

class UserCreate(UserBase):
    password: str
    entity_ids: Optional[List[int]] = []

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    entity_ids: Optional[List[int]] = None

class UserOut(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None
    entity_access: List[UserEntityAccessOut] = []

    class Config:
        from_attributes = True


# ── Clients ───────────────────────────────────────────────────────────────────

class ClientBase(BaseModel):
    entity_id: int
    name: str
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    vat_number: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    notes: Optional[str] = None

class ClientCreate(ClientBase):
    pass

class ClientUpdate(BaseModel):
    name: Optional[str] = None
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    vat_number: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

class ClientOut(ClientBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ClientSummary(BaseModel):
    id: int
    name: str
    trading_name: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

    class Config:
        from_attributes = True


# ── Invoice Line Items ────────────────────────────────────────────────────────

class LineItemBase(BaseModel):
    description: str
    quantity: Decimal = Decimal("1")
    unit_price: Decimal = Decimal("0")
    sort_order: int = 0

class LineItemCreate(LineItemBase):
    pass

class LineItemOut(LineItemBase):
    id: int
    amount: Decimal

    class Config:
        from_attributes = True


# ── Invoices ──────────────────────────────────────────────────────────────────

class InvoiceBase(BaseModel):
    entity_id: int
    client_id: int
    document_type: DocumentType = DocumentType.invoice
    status: InvoiceStatus = InvoiceStatus.draft
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    notes: Optional[str] = None
    terms: Optional[str] = None

class InvoiceCreate(InvoiceBase):
    line_items: List[LineItemCreate] = []

class InvoiceUpdate(BaseModel):
    client_id: Optional[int] = None
    status: Optional[InvoiceStatus] = None
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    paid_date: Optional[datetime] = None
    notes: Optional[str] = None
    terms: Optional[str] = None
    line_items: Optional[List[LineItemCreate]] = None

class InvoiceOut(InvoiceBase):
    id: int
    invoice_number: str
    subtotal: Decimal
    vat_amount: Decimal
    total: Decimal
    vat_rate: Decimal
    paid_date: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    line_items: List[LineItemOut] = []
    client: Optional[ClientSummary] = None
    entity: Optional[EntityOut] = None

    class Config:
        from_attributes = True

class InvoiceSummary(BaseModel):
    id: int
    invoice_number: str
    document_type: DocumentType
    status: InvoiceStatus
    client_name: Optional[str] = None
    entity_code: Optional[str] = None
    total: Decimal
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    entity_id: Optional[int] = None
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[int] = None
    description: Optional[str] = None
    ip_address: Optional[str] = None
    timestamp: datetime
    user: Optional[UserOut] = None

    class Config:
        from_attributes = True


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_invoices: int
    total_quotes: int
    outstanding_total: Decimal
    paid_this_month: Decimal
    overdue_count: int
    draft_count: int
    recent_invoices: List[InvoiceSummary] = []
    entity_breakdown: List[dict] = []


Token.model_rebuild()
