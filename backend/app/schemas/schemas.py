from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List, Any
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
    quote_prefix: Optional[str] = "QT"
    vat_rate: Optional[Decimal] = Decimal("0.15")
    primary_color: Optional[str] = "#2563eb"

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
    invoice_prefix: Optional[str] = None
    invoice_counter: Optional[int] = None
    quote_prefix: Optional[str] = None
    quote_counter: Optional[int] = None
    vat_rate: Optional[Decimal] = None
    primary_color: Optional[str] = None
    is_active: Optional[bool] = None

class EntityOut(EntityBase):
    id: int
    invoice_counter: int
    quote_counter: int
    quote_prefix: Optional[str] = "QT"
    is_active: bool
    created_at: datetime
    logo_path: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = "#2563eb"

    class Config:
        from_attributes = True


# ── App Settings ──────────────────────────────────────────────────────────────

class AppSettingOut(BaseModel):
    id: int
    key: str
    value: str
    label: Optional[str] = None
    category: Optional[str] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class AppSettingUpdate(BaseModel):
    value: str
    label: Optional[str] = None
    category: Optional[str] = None

class AppSettingCreate(BaseModel):
    key: str
    value: str
    label: Optional[str] = None
    category: Optional[str] = "system"


# ── Users ─────────────────────────────────────────────────────────────────────

class UserEntityAccessOut(BaseModel):
    entity_id: int
    entity_code: Optional[str] = None
    entity_name: Optional[str] = None
    can_create: bool
    can_edit: bool
    can_delete: bool
    allowed_modules: Optional[List[str]] = []

    class Config:
        from_attributes = True

class EntityPermissionUpdate(BaseModel):
    entity_id: int
    can_create: bool = True
    can_edit: bool = True
    can_delete: bool = False
    allowed_modules: List[str] = []

class RoleOut(BaseModel):
    key: str
    display_name: str
    is_protected: bool

    class Config:
        from_attributes = True

class RoleCreate(BaseModel):
    key: str
    display_name: str

class UserBase(BaseModel):
    email: str
    full_name: str
    role: str = "standard"

class UserCreate(UserBase):
    password: str
    entity_ids: Optional[List[int]] = []

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    entity_ids: Optional[List[int]] = None

class UserPermissionsUpdate(BaseModel):
    permissions: List[EntityPermissionUpdate]

class PasswordReset(BaseModel):
    new_password: str

class UserOut(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None
    entity_access: List[UserEntityAccessOut] = []

    class Config:
        from_attributes = True


# ── Token — defined AFTER UserOut so the reference resolves ──────────────────

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut

    class Config:
        from_attributes = True


# ── Suppliers ─────────────────────────────────────────────────────────────────

class SupplierBase(BaseModel):
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

class SupplierCreate(SupplierBase):
    pass

class SupplierUpdate(BaseModel):
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

class SupplierOut(SupplierBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class SupplierSummary(BaseModel):
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
    description: Optional[str] = None
    quantity: Decimal = Decimal("1")
    unit_price: Decimal = Decimal("0")
    amount: Optional[Decimal] = Decimal("0")
    is_vat_exempt: bool = False
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
    supplier_id: int
    document_type: DocumentType = DocumentType.invoice
    invoice_number: Optional[str] = None
    status: InvoiceStatus = InvoiceStatus.draft
    is_vat_exempt: bool = False
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    vat_rate: Optional[Decimal] = None
    notes: Optional[str] = None
    print_note: bool = False
    terms: Optional[str] = None

class InvoiceCreate(InvoiceBase):
    line_items: List[LineItemCreate] = []

class InvoiceUpdate(BaseModel):
    supplier_id: Optional[int] = None
    status: Optional[InvoiceStatus] = None
    invoice_number: Optional[str] = None
    is_vat_exempt: Optional[bool] = None
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    paid_date: Optional[datetime] = None
    payment_reference: Optional[str] = None
    vat_rate: Optional[Decimal] = None
    notes: Optional[str] = None
    print_note: Optional[bool] = None
    terms: Optional[str] = None
    line_items: Optional[List[LineItemCreate]] = None

class InvoiceOut(InvoiceBase):
    id: int
    invoice_number: str
    subtotal: Decimal
    vat_rate: Decimal
    vat_amount: Decimal
    total: Decimal
    paid_date: Optional[datetime] = None
    payment_reference: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    line_items: List[LineItemOut] = []
    supplier: Optional[SupplierSummary] = None
    entity: Optional[EntityOut] = None

    class Config:
        from_attributes = True

class InvoiceSummary(BaseModel):
    id: int
    invoice_number: str
    document_type: DocumentType
    status: InvoiceStatus
    supplier_name: Optional[str] = None
    entity_code: Optional[str] = None
    total: Decimal
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None

    class Config:
        from_attributes = True

class NextNumberOut(BaseModel):
    next_number: str
    prefix: str
    counter: int


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
    created_at: Optional[datetime] = None
    user: Optional[UserOut] = None

    class Config:
        from_attributes = True


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_invoices: int = 0
    total_quotes: int = 0
    outstanding_total: Decimal = Decimal("0")
    paid_this_month: Decimal = Decimal("0")
    overdue_count: int = 0
    draft_count: int = 0
    recent_invoices: List[InvoiceSummary] = []
    entity_breakdown: List[dict] = []


# ── Rebuild forward references ────────────────────────────────────────────────
Token.model_rebuild()