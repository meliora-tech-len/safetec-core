from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List, Any, Dict
from datetime import datetime, date
from decimal import Decimal
from enum import Enum


# ── Enums ─────────────────────────────────────────────────────────────────────

class UserRole(str, Enum):
    admin = "admin"
    standard = "standard"

from app.models.models import InvoiceStatus  # noqa: E402 — single source of truth

class DocumentType(str, Enum):
    invoice = "invoice"
    quote = "quote"
    purchase_order = "purchase_order"


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
    vat_registered: bool = True
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
    vat_registered: Optional[bool] = None
    primary_color: Optional[str] = None
    is_active: Optional[bool] = None

class EntityOut(EntityBase):
    id: int
    invoice_counter: int
    quote_counter: int
    quote_prefix: Optional[str] = "QT"
    vat_registered: bool = True
    is_active: bool
    is_subcontractor_entity: bool = False
    linked_subcontractor_id: Optional[int] = None
    created_at: datetime
    logo_path: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = "#2563eb"
    letterhead_url: Optional[str] = None
    letterhead_path: Optional[str] = None

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
    can_create: bool = True
    can_edit: bool = True
    can_delete: bool = False
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

class PaymentTermType(str, Enum):
    current = "current"
    days_30 = "30_days"


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
    payment_term: PaymentTermType = PaymentTermType.current
    is_diesel_supplier: bool = False
    requires_registration: bool = True

class SupplierCreate(SupplierBase):
    pass

class SupplierBulkCreate(BaseModel):
    entity_ids: List[int]
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
    payment_term: PaymentTermType = PaymentTermType.current
    is_diesel_supplier: bool = False
    requires_registration: bool = True

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
    payment_term: Optional[PaymentTermType] = None
    is_diesel_supplier: Optional[bool] = None
    requires_registration: Optional[bool] = None

class SupplierOut(SupplierBase):
    id: int
    is_active: bool
    is_diesel_supplier: bool
    requires_registration: bool
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


# ── Customers ─────────────────────────────────────────────────────────────────

class CustomerBase(BaseModel):
    entity_id: int
    name: str
    trading_name: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    vat_number: Optional[str] = None
    registration_number: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    trading_name: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = None
    vat_number: Optional[str] = None
    registration_number: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class CustomerOut(CustomerBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomerSummary(BaseModel):
    id: int
    name: str
    trading_name: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

    class Config:
        from_attributes = True


# ── Subcontractors ────────────────────────────────────────────────────────────

class SubcontractorBase(BaseModel):
    entity_id:           int
    name:                str
    trading_name:        Optional[str] = None
    contact_person:      Optional[str] = None
    email:               Optional[str] = None
    phone:               Optional[str] = None
    registration_number: Optional[str] = None
    vat_number:          Optional[str] = None
    notes:               Optional[str] = None


class SubcontractorCreate(SubcontractorBase):
    pass


class SubcontractorBulkCreate(BaseModel):
    entity_ids:          List[int]
    name:                str
    trading_name:        Optional[str] = None
    contact_person:      Optional[str] = None
    email:               Optional[str] = None
    phone:               Optional[str] = None
    registration_number: Optional[str] = None
    vat_number:          Optional[str] = None
    notes:               Optional[str] = None


class SubcontractorUpdate(BaseModel):
    name:                Optional[str]  = None
    trading_name:        Optional[str]  = None
    contact_person:      Optional[str]  = None
    email:               Optional[str]  = None
    phone:               Optional[str]  = None
    registration_number: Optional[str]  = None
    vat_number:          Optional[str]  = None
    notes:               Optional[str]  = None
    is_active:           Optional[bool] = None


class SubcontractorOut(SubcontractorBase):
    id:               int
    is_active:        bool
    linked_entity_id: Optional[int] = None
    created_at:       datetime
    updated_at:       Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Invoice Line Items ────────────────────────────────────────────────────────

class LineItemBase(BaseModel):
    description: Optional[str] = None
    quantity: Optional[Decimal] = None
    unit_price: Optional[Decimal] = None
    amount: Optional[Decimal] = Decimal("0")
    is_vat_exempt: bool = False
    sort_order: int = 0
    line_type: str = 'item'
    loading_number: Optional[str] = None
    offloading_number: Optional[str] = None

    @field_validator('line_type')
    @classmethod
    def validate_line_type(cls, v):
        if v not in {'item', 'header', 'note', 'spacer'}:
            raise ValueError("line_type must be one of: item, header, note, spacer")
        return v

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
    supplier_id: Optional[int] = None
    customer_id: Optional[int] = None
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
    customer_id: Optional[int] = None
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
    customer: Optional[CustomerSummary] = None
    entity: Optional[EntityOut] = None

    class Config:
        from_attributes = True

class InvoiceSummary(BaseModel):
    id: int
    invoice_number: str
    document_type: DocumentType
    status: InvoiceStatus
    supplier_name: Optional[str] = None
    customer_name: Optional[str] = None
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


# ── Invoice Templates ──────────────────────────────────────────────────────────

class TemplateLineItemBase(BaseModel):
    description: Optional[str] = None
    is_vat_exempt: bool = False
    sort_order: int = 0
    line_type: str = 'item'
    quantity: Optional[Decimal] = None
    unit_price: Optional[Decimal] = None
    amount: Optional[Decimal] = None

    @field_validator('is_vat_exempt', mode='before')
    @classmethod
    def coerce_bool(cls, v):
        return bool(v) if v is not None else False

    @field_validator('line_type')
    @classmethod
    def validate_line_type(cls, v):
        if v not in {'item', 'header', 'note', 'spacer'}:
            raise ValueError("line_type must be one of: item, header, note, spacer")
        return v

class TemplateLineItemCreate(TemplateLineItemBase):
    pass

class TemplateLineItemOut(TemplateLineItemBase):
    id: int

    class Config:
        from_attributes = True

class InvoiceTemplateBase(BaseModel):
    entity_id: int
    supplier_id: Optional[int] = None
    customer_id: Optional[int] = None
    name: str
    document_type: DocumentType = DocumentType.invoice
    is_vat_exempt: bool = False
    vat_rate: Optional[Decimal] = Decimal("0.15")
    notes: Optional[str] = None
    print_note: bool = False
    terms: Optional[str] = None

    @field_validator('is_vat_exempt', 'print_note', mode='before')
    @classmethod
    def coerce_bool(cls, v):
        return bool(v) if v is not None else False

class InvoiceTemplateCreate(InvoiceTemplateBase):
    line_items: List[TemplateLineItemCreate] = []

class InvoiceTemplateUpdate(BaseModel):
    supplier_id: Optional[int] = None
    customer_id: Optional[int] = None
    name: Optional[str] = None
    document_type: Optional[DocumentType] = None
    is_vat_exempt: Optional[bool] = None
    vat_rate: Optional[Decimal] = None
    notes: Optional[str] = None
    print_note: Optional[bool] = None
    terms: Optional[str] = None
    line_items: Optional[List[TemplateLineItemCreate]] = None

class InvoiceTemplateOut(InvoiceTemplateBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    line_items: List[TemplateLineItemOut] = []
    supplier: Optional[SupplierSummary] = None
    customer: Optional[CustomerSummary] = None
    entity: Optional[EntityOut] = None

    class Config:
        from_attributes = True

class InvoiceTemplateSummary(BaseModel):
    id: int
    name: str
    document_type: DocumentType
    entity_id: int
    entity_code: Optional[str] = None
    supplier_name: Optional[str] = None
    customer_name: Optional[str] = None
    line_item_count: int = 0

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
    ready_count: int = 0
    recent_invoices: List[InvoiceSummary] = []
    entity_breakdown: List[dict] = []


# ── Rebuild forward references ────────────────────────────────────────────────
Token.model_rebuild()


# ── Fleet Schemas ─────────────────────────────────────────────────────────────

from app.models.models import TruckStatus, TrailerStatus, PersonalVehicleStatus  # noqa: E402


class TrailerBase(BaseModel):
    slot: int
    registration: Optional[str] = None
    vin: Optional[str] = None
    licence_number: Optional[str] = None
    licence_expiry: Optional[datetime] = None
    finance_institution:    Optional[str]      = None
    finance_account_number: Optional[str]      = None
    finance_contract_end:   Optional[datetime] = None
    status: TrailerStatus = TrailerStatus.active
    notes: Optional[str] = None


class TrailerCreate(TrailerBase):
    pass


class TrailerUpdate(BaseModel):
    registration: Optional[str] = None
    vin: Optional[str] = None
    licence_number: Optional[str] = None
    licence_expiry: Optional[datetime] = None
    finance_institution:    Optional[str]      = None
    finance_account_number: Optional[str]      = None
    finance_contract_end:   Optional[datetime] = None
    status: Optional[TrailerStatus] = None
    notes: Optional[str] = None


class TrailerOut(TrailerBase):
    id: int
    truck_id: int
    entity_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TruckBase(BaseModel):
    entity_id: int
    fleet_number: Optional[str] = None
    make: str
    model: Optional[str] = None
    registration: str
    vin: Optional[str] = None
    driver_name: Optional[str] = None
    licence_number: Optional[str] = None
    licence_expiry: Optional[datetime] = None
    finance_institution:    Optional[str]      = None
    finance_account_number: Optional[str]      = None
    finance_contract_end:   Optional[datetime] = None
    is_subcontractor:    bool = False
    subcontractor_name:  Optional[str] = None
    subcontractor_id:    Optional[int] = None
    is_temp_registration: bool = False
    status: TruckStatus = TruckStatus.active
    notes: Optional[str] = None
    operator: Optional[str] = None
    contract_context: Optional[str] = None
    temp_registration: Optional[str] = None


class TruckCreate(TruckBase):
    trailers: Optional[List[TrailerCreate]] = []


class TruckUpdate(BaseModel):
    fleet_number: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    registration: Optional[str] = None
    vin: Optional[str] = None
    driver_name: Optional[str] = None
    licence_number: Optional[str] = None
    licence_expiry: Optional[datetime] = None
    finance_institution:    Optional[str]      = None
    finance_account_number: Optional[str]      = None
    finance_contract_end:   Optional[datetime] = None
    is_subcontractor:   Optional[bool] = None
    subcontractor_name: Optional[str]  = None
    subcontractor_id:   Optional[int]  = None
    status: Optional[TruckStatus] = None
    notes: Optional[str] = None
    operator: Optional[str] = None
    contract_context: Optional[str] = None
    temp_registration: Optional[str] = None
    trailers: Optional[List[TrailerCreate]] = None


class TruckOut(TruckBase):
    id: int
    trailers: List[TrailerOut] = []
    subcontractor_display_name: Optional[str] = None
    entity_is_subcontractor: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TruckSummary(BaseModel):
    id: int
    entity_id: int
    fleet_number: Optional[str] = None
    make: str
    model: Optional[str] = None
    registration: str
    driver_name: Optional[str] = None
    status: TruckStatus
    trailer_count: int = 0

    class Config:
        from_attributes = True


class FleetStats(BaseModel):
    total_trucks: int = 0
    active: int = 0
    inactive: int = 0
    maintenance: int = 0
    total_trailers: int = 0
    total_personal_vehicles: int = 0


class PersonalVehicleBase(BaseModel):
    entity_id: int
    owner: Optional[str] = None
    vehicle_type: str
    year: Optional[int] = None
    registration: Optional[str] = None
    licence_number: Optional[str] = None
    licence_expiry: Optional[datetime] = None
    status: PersonalVehicleStatus = PersonalVehicleStatus.active
    notes: Optional[str] = None


class PersonalVehicleCreate(PersonalVehicleBase):
    pass


class PersonalVehicleUpdate(BaseModel):
    owner: Optional[str] = None
    vehicle_type: Optional[str] = None
    year: Optional[int] = None
    registration: Optional[str] = None
    licence_number: Optional[str] = None
    licence_expiry: Optional[datetime] = None
    status: Optional[PersonalVehicleStatus] = None
    notes: Optional[str] = None


class PersonalVehicleOut(PersonalVehicleBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Truck Monthly Expenses (Profit Sheet) ────────────────────────────────────

class TruckMonthlyExpensesBase(BaseModel):
    income_excl_vat:      Optional[Decimal] = None
    income_incl_vat:      Optional[Decimal] = None
    drivers_salary:       Optional[Decimal] = None
    insurance_trailer:    Optional[Decimal] = None
    liability_3rd_party:  Optional[Decimal] = None
    goods_in_transit:     Optional[Decimal] = None
    loss_of_use:          Optional[Decimal] = None
    personal_accident:    Optional[Decimal] = None
    communication_device: Optional[Decimal] = None
    sauma:                Optional[Decimal] = None
    diesel:               Optional[Decimal] = None
    tyre_maintenance:     Optional[Decimal] = None
    other_suppliers:      Optional[Decimal] = None
    custom_lines:         Optional[List[dict]] = None
    notes:                Optional[str] = None


class TruckMonthlyExpensesOut(TruckMonthlyExpensesBase):
    id:         Optional[int] = None
    truck_id:   int
    year:       int
    month:      int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Licence Alert Acknowledgment Schemas ─────────────────────────────────────

class LicenceAlertAckIn(BaseModel):
    resource_type: str          # 'truck' | 'trailer' | 'personal_vehicle'
    resource_id: int
    acknowledged_expiry: datetime


# ── Driver Schemas ────────────────────────────────────────────────────────────

from app.models.models import DriverType  # noqa: E402
from datetime import date as date_type    # noqa: E402


class DriverLoadBase(BaseModel):
    load_date: date_type
    mine_name: str
    truck_registration: Optional[str] = None
    load_number: Optional[int] = None
    rate: Optional[Decimal] = None
    notes: Optional[str] = None


class DriverLoadCreate(DriverLoadBase):
    pass


class DriverLoadUpdate(BaseModel):
    load_date: Optional[date_type] = None
    mine_name: Optional[str] = None
    truck_registration: Optional[str] = None
    load_number: Optional[int] = None
    rate: Optional[Decimal] = None
    notes: Optional[str] = None


class DriverLoadOut(DriverLoadBase):
    id: int
    driver_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class DriverPaymentBase(BaseModel):
    payment_date: date_type
    amount: Decimal
    payment_source: Optional[str] = None
    description: Optional[str] = None


class DriverPaymentCreate(DriverPaymentBase):
    pass


class DriverPaymentUpdate(BaseModel):
    payment_date: Optional[date_type] = None
    amount: Optional[Decimal] = None
    payment_source: Optional[str] = None
    description: Optional[str] = None


class DriverPaymentOut(DriverPaymentBase):
    id: int
    driver_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class DriverBase(BaseModel):
    entity_id: int
    truck_id: Optional[int] = None
    driver_slot: Optional[int] = None
    employee_number: Optional[str] = None
    first_name: str
    last_name: str
    driver_type: DriverType
    id_number: Optional[str] = None
    tax_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    date_engaged: Optional[date_type] = None
    address: Optional[str] = None
    branch_code: Optional[str] = None
    job_title: Optional[str] = None
    notes: Optional[str] = None


class DriverCreate(DriverBase):
    pass


class DriverUpdate(BaseModel):
    truck_id: Optional[int] = None
    driver_slot: Optional[int] = None
    employee_number: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    driver_type: Optional[DriverType] = None
    id_number: Optional[str] = None
    tax_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    date_engaged: Optional[date_type] = None
    address: Optional[str] = None
    branch_code: Optional[str] = None
    job_title: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class DriverOut(DriverBase):
    id: int
    is_active: bool
    truck_registration: Optional[str] = None
    loads: List[DriverLoadOut] = []
    payments: List[DriverPaymentOut] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CasualTruckAssignmentOut(BaseModel):
    id: int
    truck_id: int
    driver_slot: int
    truck_registration: Optional[str] = None

    class Config:
        from_attributes = True


class DriverSummary(BaseModel):
    id: int
    entity_id: int
    employee_number: Optional[str] = None
    first_name: str
    last_name: str
    driver_type: DriverType
    truck_id: Optional[int] = None
    driver_slot: Optional[int] = None
    truck_registration: Optional[str] = None
    is_active: bool
    load_count_this_month: int = 0
    total_payments_this_month: Decimal = Decimal("0")
    casual_assignments: List['CasualTruckAssignmentOut'] = []

    class Config:
        from_attributes = True


class DriverStats(BaseModel):
    total_drivers: int = 0
    permanent: int = 0
    casual: int = 0
    active: int = 0
    total_loads_this_month: int = 0
    total_payments_this_month: Decimal = Decimal("0")


# ── PayrollMineGroup Schemas ──────────────────────────────────────────────────

class PayrollMineGroupBase(BaseModel):
    name: str
    base_salary: Decimal
    incentive_per_load: Decimal = Decimal("0")
    subs_per_load: Decimal = Decimal("0")
    base_loads: int = 7
    notes: Optional[str] = None


class PayrollMineGroupCreate(PayrollMineGroupBase):
    pass


class PayrollMineGroupUpdate(BaseModel):
    name: Optional[str] = None
    base_salary: Optional[Decimal] = None
    incentive_per_load: Optional[Decimal] = None
    subs_per_load: Optional[Decimal] = None
    base_loads: Optional[int] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class PayrollMineGroupOut(PayrollMineGroupBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── PayrollSettings Schemas ───────────────────────────────────────────────────

class PayrollSettingsOut(BaseModel):
    id: int
    effective_date: datetime
    lohatla_base_salary: Decimal
    lohatla_incentive_per_load: Decimal
    lohatla_subs_per_load: Decimal
    lohatla_casual_rate_per_load: Decimal
    casual_rate_group_a: Decimal
    casual_rate_group_b: Decimal
    assmang_bonus_per_load: Decimal
    nbcrfli_rate: Decimal
    provident_rate: Decimal
    wellness_rate: Decimal
    sick_fund_rate: Decimal
    holiday_fund_rate: Decimal
    leave_pay_rate: Decimal
    paye_fixed: Decimal
    weekly_to_monthly_factor: Decimal
    updated_by: Optional[int] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PayrollSettingsUpdate(BaseModel):
    effective_date: Optional[datetime] = None
    lohatla_base_salary: Optional[Decimal] = None
    lohatla_incentive_per_load: Optional[Decimal] = None
    lohatla_subs_per_load: Optional[Decimal] = None
    lohatla_casual_rate_per_load: Optional[Decimal] = None
    casual_rate_group_a: Optional[Decimal] = None
    casual_rate_group_b: Optional[Decimal] = None
    assmang_bonus_per_load: Optional[Decimal] = None
    nbcrfli_rate: Optional[Decimal] = None
    provident_rate: Optional[Decimal] = None
    wellness_rate: Optional[Decimal] = None
    sick_fund_rate: Optional[Decimal] = None
    holiday_fund_rate: Optional[Decimal] = None
    leave_pay_rate: Optional[Decimal] = None
    paye_fixed: Optional[Decimal] = None
    weekly_to_monthly_factor: Optional[Decimal] = None


# ── DriverPayCycle Schemas ────────────────────────────────────────────────────

class DriverTripLogCreate(BaseModel):
    trip_date: datetime
    mine_name: str
    notes: Optional[str] = None


class DriverTripLogOut(DriverTripLogCreate):
    id: int
    pay_cycle_id: int
    truck_load_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DriverAdditionalLoadCreate(BaseModel):
    load_date: datetime
    route_name: str
    truck_registration: Optional[str] = None
    litres: Optional[Decimal] = None
    amount: Decimal
    delivery_note: Optional[str] = None
    tons: Optional[Decimal] = None
    waiting_for_slips: bool = False
    is_paid: bool = False
    is_verified: bool = False
    notes: Optional[str] = None


class DriverAdditionalLoadUpdate(BaseModel):
    load_date: Optional[datetime] = None
    route_name: Optional[str] = None
    truck_registration: Optional[str] = None
    litres: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    delivery_note: Optional[str] = None
    tons: Optional[Decimal] = None
    waiting_for_slips: Optional[bool] = None
    is_paid: Optional[bool] = None
    is_verified: Optional[bool] = None
    notes: Optional[str] = None


class DriverAdditionalLoadOut(DriverAdditionalLoadCreate):
    id: int
    pay_cycle_id: int
    created_at: datetime
    verified_by: Optional[int] = None
    verified2_by: Optional[int] = None
    verified3_by: Optional[int] = None
    verified_by_initials: Optional[str] = None
    verified_by_date: Optional[str] = None
    verified2_by_initials: Optional[str] = None
    verified2_by_date: Optional[str] = None
    verified3_by_initials: Optional[str] = None
    verified3_by_date: Optional[str] = None

    class Config:
        from_attributes = True


# ── Additional Load Rates (per-customer flat rate, Safetec) ───────────────────

class AdditionalLoadRateCreate(BaseModel):
    entity_id: int
    name: str
    amount: Decimal
    is_active: bool = True


class AdditionalLoadRateUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[Decimal] = None
    is_active: Optional[bool] = None


class AdditionalLoadRateOut(AdditionalLoadRateCreate):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class DriverFoodPaymentCreate(BaseModel):
    payment_date: datetime
    amount: Decimal
    paid_by: Optional[str] = None
    is_verified: bool = False
    notes: Optional[str] = None
    truck_id: Optional[int] = None


class DriverFoodPaymentUpdate(BaseModel):
    payment_date: Optional[datetime] = None
    amount: Optional[Decimal] = None
    paid_by: Optional[str] = None
    is_verified: Optional[bool] = None
    notes: Optional[str] = None


class DriverFoodPaymentOut(DriverFoodPaymentCreate):
    id: int
    pay_cycle_id: int
    created_at: datetime
    verified_by: Optional[int] = None
    verified2_by: Optional[int] = None
    verified3_by: Optional[int] = None
    verified_by_initials: Optional[str] = None
    verified_by_date: Optional[str] = None
    verified2_by_initials: Optional[str] = None
    verified2_by_date: Optional[str] = None
    verified3_by_initials: Optional[str] = None
    verified3_by_date: Optional[str] = None

    class Config:
        from_attributes = True


class DriverPayCycleUpdate(BaseModel):
    lohatla_base_loads: Optional[int] = None
    lohatla_extra_loads: Optional[int] = None
    casual_group_a_loads: Optional[int] = None
    casual_group_b_loads: Optional[int] = None
    subsistence_advance_paid: Optional[Decimal] = None
    subsistence_advance_verified: Optional[bool] = None
    staff_loan_balance: Optional[Decimal] = None
    staff_loan_deduction: Optional[Decimal] = None
    cash_advance_balance: Optional[Decimal] = None
    cash_advance_deduction: Optional[Decimal] = None
    comments: Optional[str] = None


class DriverPayCycleOut(BaseModel):
    id: int
    driver_id: int
    pay_month: int
    pay_year: int
    payroll_settings_id: Optional[int] = None
    lohatla_base_loads: int
    lohatla_extra_loads: int
    casual_group_a_loads: int = 0
    casual_group_b_loads: int = 0
    permanent_split_loads: int = 0
    casual_split_group_a_loads: int = 0
    casual_split_group_b_loads: int = 0
    assmang_loads: int = 0
    assmang_split_loads: int = 0
    subsistence_advance_paid: Decimal
    subsistence_advance_verified: bool
    staff_loan_balance: Decimal
    staff_loan_deduction: Decimal
    cash_advance_balance: Decimal
    cash_advance_deduction: Decimal
    comments: Optional[str] = None
    trip_log: List[DriverTripLogOut] = []
    additional_loads: List[DriverAdditionalLoadOut] = []
    food_payments: List[DriverFoodPaymentOut] = []
    calc: Optional[Any] = None
    was_prefilled: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Mine Schemas ──────────────────────────────────────────────────────────────

class MineRateBase(BaseModel):
    entity_id: int
    rate_per_ton: Decimal
    effective_from: datetime
    notes: Optional[str] = None


class MineRateCreate(MineRateBase):
    pass


class MineRateOut(MineRateBase):
    id: int
    mine_id: int
    effective_to: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class MineBase(BaseModel):
    name: str
    code: str
    casual_group: Optional[str] = None  # 'A', 'B', or None
    notes: Optional[str] = None


class MineCreate(MineBase):
    pass


class MineUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    is_active: Optional[bool] = None
    casual_group: Optional[str] = None
    notes: Optional[str] = None


class MineOut(MineBase):
    id: int
    is_active: bool
    created_at: datetime
    rates: List[MineRateOut] = []

    class Config:
        from_attributes = True


# ── Truck Load Schemas ────────────────────────────────────────────────────────

class TruckLoadBase(BaseModel):
    entity_id: int
    truck_id: int
    mine_id: int
    supplier_id: Optional[int] = None
    load_date: datetime
    slip_number: Optional[str] = None
    po_number: Optional[str] = None
    driver_id: Optional[int] = None
    driver_name: Optional[str] = None
    tonnes: Decimal
    rate_per_ton: Optional[Decimal] = None
    diesel_litres: Optional[Decimal] = None
    diesel_invoice: Optional[str] = None
    diesel_rate: Optional[Decimal] = None
    date_paid: Optional[datetime] = None
    is_paid: bool = False
    is_split_load: bool = False
    is_projection: bool = False
    driver_already_paid: bool = False
    pay_deferred: bool = False
    notes: Optional[str] = None
    checked_by: Optional[str] = None
    statement_month: Optional[int] = None
    statement_year: Optional[int] = None


class TruckLoadCreate(TruckLoadBase):
    pass


class TruckLoadUpdate(BaseModel):
    truck_id: Optional[int] = None
    mine_id: Optional[int] = None
    supplier_id: Optional[int] = None
    load_date: Optional[datetime] = None
    slip_number: Optional[str] = None
    po_number: Optional[str] = None
    driver_id: Optional[int] = None
    driver_name: Optional[str] = None
    tonnes: Optional[Decimal] = None
    rate_per_ton: Optional[Decimal] = None
    diesel_litres: Optional[Decimal] = None
    diesel_invoice: Optional[str] = None
    diesel_rate: Optional[Decimal] = None
    date_paid: Optional[datetime] = None
    is_paid: Optional[bool] = None
    is_split_load: Optional[bool] = None
    is_projection: Optional[bool] = None
    driver_already_paid: Optional[bool] = None
    pay_deferred: Optional[bool] = None
    notes: Optional[str] = None
    checked_by: Optional[str] = None
    statement_month: Optional[int] = None
    statement_year: Optional[int] = None


class TruckLoadDriverSplitBase(BaseModel):
    driver_id: Optional[int] = None
    mine_id: int
    share: Decimal = Decimal("0.5")
    slip_number: Optional[str] = None


class TruckLoadDriverSplitOut(TruckLoadDriverSplitBase):
    id: int
    driver_name: Optional[str] = None
    mine_name: Optional[str] = None

    class Config:
        from_attributes = True


class TruckLoadOut(TruckLoadBase):
    id: int
    rate_per_ton: Decimal
    split_group_id: Optional[int] = None
    driver_splits: List[TruckLoadDriverSplitOut] = []
    amount_excl_vat: Optional[Decimal] = None
    amount_incl_vat: Optional[Decimal] = None
    subcontractor_admin_fee_per_ton: Optional[Decimal] = None
    subcontractor_rate:              Optional[Decimal] = None
    subcontractor_amount_excl_vat:   Optional[Decimal] = None
    subcontractor_amount_incl_vat:   Optional[Decimal] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    truck_registration: Optional[str] = None
    mine_name: Optional[str] = None
    supplier_name: Optional[str] = None

    class Config:
        from_attributes = True


class SplitLoadCreate(BaseModel):
    """One main load plus its driver lines. Each line is 0.5 of a load; a split
    is exactly two drivers. Tonnes/rate live on `load`, never on the lines."""
    load: TruckLoadCreate
    splits: List[TruckLoadDriverSplitBase]

    @field_validator("splits")
    @classmethod
    def _exactly_two(cls, v):
        if len(v) != 2:
            raise ValueError("A split load must have exactly two driver lines")
        return v


class SplitLoadOut(BaseModel):
    load: TruckLoadOut


class TruckLoadBulkCreate(BaseModel):
    loads: List[TruckLoadCreate]


class TruckLoadSummary(BaseModel):
    total_loads: int = 0
    total_tonnes: Decimal = Decimal("0")
    total_excl_vat: Decimal = Decimal("0")
    total_incl_vat: Decimal = Decimal("0")
    total_diesel_litres: Decimal = Decimal("0")
    total_subcontractor_excl_vat: Decimal = Decimal("0")
    total_subcontractor_incl_vat: Decimal = Decimal("0")


class TruckFleetSummaryRow(BaseModel):
    truck_id: int
    truck_registration: str
    fleet_number: Optional[str] = None
    entity_id: int
    entity_name: str
    entity_code: Optional[str] = None
    total_loads: int
    total_tonnes: Decimal
    total_excl_vat: Decimal
    total_incl_vat: Decimal
    loads_missing_invoice: int


# ── Driver Salary Config Schemas ──────────────────────────────────────────────

class DriverSalaryConfigBase(BaseModel):
    entity_id: int
    truck_id: Optional[int] = None
    driver_name: str
    base_salary_near_route: Optional[Decimal] = None
    base_salary_far_route: Optional[Decimal] = None
    extra_per_load_far: Optional[Decimal] = None
    deduction_near: Optional[Decimal] = None
    effective_from: Optional[datetime] = None
    effective_to: Optional[datetime] = None
    notes: Optional[str] = None


class DriverSalaryConfigCreate(DriverSalaryConfigBase):
    pass


class DriverSalaryConfigUpdate(BaseModel):
    truck_id: Optional[int] = None
    driver_name: Optional[str] = None
    base_salary_near_route: Optional[Decimal] = None
    base_salary_far_route: Optional[Decimal] = None
    extra_per_load_far: Optional[Decimal] = None
    deduction_near: Optional[Decimal] = None
    effective_from: Optional[datetime] = None
    effective_to: Optional[datetime] = None
    notes: Optional[str] = None


class DriverSalaryConfigOut(DriverSalaryConfigBase):
    id: int
    is_active: bool
    created_at: datetime
    truck_registration: Optional[str] = None

    class Config:
        from_attributes = True


# ── Supplier Invoice Schemas ──────────────────────────────────────────────────

class SupplierInvoiceLineItemBase(BaseModel):
    item_code: Optional[str] = None
    item_description: Optional[str] = None
    quantity: Optional[Decimal] = None
    unit: Optional[str] = None
    amount_excl_vat: Decimal = Decimal('0')
    amount_incl_vat: Decimal = Decimal('0')
    sort_order: int = 0
    line_date: Optional[date] = None


class SupplierInvoiceLineItemCreate(SupplierInvoiceLineItemBase):
    pass


class SupplierInvoiceLineItemOut(SupplierInvoiceLineItemBase):
    id: int
    invoice_id: int

    class Config:
        from_attributes = True


class InvoiceLineItemImport(BaseModel):
    item_code: Optional[str] = None
    item_description: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[Decimal] = None
    amount_excl_vat: Decimal = Decimal('0')
    amount_incl_vat: Decimal = Decimal('0')
    sort_order: int = 0
    slip_date: Optional[str] = None
    rate_per_litre: Optional[Decimal] = None


class InvoiceImportItem(BaseModel):
    invoice_date: date
    invoice_number: str
    amount: Decimal = Decimal('0')
    line_items: List[InvoiceLineItemImport] = []


class BulkImportPayload(BaseModel):
    supplier_id: int
    entity_id: int
    invoices: List[InvoiceImportItem]


class DieselConflictSide(BaseModel):
    litres: Decimal
    rate_per_litre: Decimal
    amount: Decimal
    fillup_date: Optional[date] = None
    truck_registration: Optional[str] = None


class DieselConflict(BaseModel):
    slip_number: str
    fillup_id: int
    invoice_id: int
    invoice_number: Optional[str] = None
    existing: DieselConflictSide
    incoming: DieselConflictSide


class DieselConflictResolution(BaseModel):
    fillup_id: int
    invoice_id: int
    use_import_values: bool
    litres: Optional[Decimal] = None
    rate_per_litre: Optional[Decimal] = None
    fillup_date: Optional[date] = None


class BulkImportResult(BaseModel):
    created: int
    skipped: int
    skipped_numbers: List[str] = []
    diesel_created: int = 0
    diesel_linked: int = 0
    conflicts: List[DieselConflict] = []


class SupplierInvoiceCreate(BaseModel):
    supplier_id: Optional[int] = None
    subcontractor_id: Optional[int] = None
    entity_id: int
    invoice_date: datetime
    invoice_number: Optional[str] = None
    amount: Decimal = Decimal('0')
    litres: Optional[Decimal] = None
    vat_applicable: bool = True
    vehicle_reg: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    deposit_paid: Optional[Decimal] = None
    is_multi_line: bool = False
    statement_month: Optional[int] = None
    statement_year: Optional[int] = None


class SubcontractorInvoiceCreate(BaseModel):
    invoice_date: datetime
    invoice_number: str
    amount: Decimal
    vat_applicable: bool = True
    vehicle_reg: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class SupplierInvoiceUpdate(BaseModel):
    invoice_date: Optional[datetime] = None
    invoice_number: Optional[str] = None
    amount: Optional[Decimal] = None
    litres: Optional[Decimal] = None
    vat_applicable: Optional[bool] = None
    vehicle_reg: Optional[str] = None
    description: Optional[str] = None
    is_verified: Optional[bool] = None
    is_paid: Optional[bool] = None
    paid_date: Optional[datetime] = None
    payment_reference: Optional[str] = None
    notes: Optional[str] = None
    deposit_paid: Optional[Decimal] = None
    statement_month: Optional[int] = None
    statement_year: Optional[int] = None


class SupplierInvoiceOut(BaseModel):
    id: int
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    subcontractor_id: Optional[int] = None
    entity_id: int
    invoice_date: datetime
    invoice_number: Optional[str] = None
    amount: Decimal
    litres: Optional[Decimal] = None
    vat_applicable: bool
    vehicle_reg: Optional[str] = None
    description: Optional[str] = None
    statement_month: Optional[int] = None
    statement_year: Optional[int] = None
    is_verified: bool
    verified_at: Optional[datetime] = None
    payment_due_date: Optional[datetime] = None
    is_paid: bool
    paid_date: Optional[datetime] = None
    payment_reference: Optional[str] = None
    notes: Optional[str] = None
    deposit_paid: Optional[Decimal] = None
    created_by_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    diesel_fillup_id: Optional[int] = None
    slip_number: Optional[str] = None
    # Verifier IDs (for frontend lock logic)
    verified_by: Optional[int] = None
    verified2_by: Optional[int] = None
    verified3_by: Optional[int] = None
    # Verification display (initials + date)
    verified_by_initials: Optional[str] = None
    verified_by_date: Optional[str] = None
    verified2_by_initials: Optional[str] = None
    verified2_by_date: Optional[str] = None
    verified3_by_initials: Optional[str] = None
    verified3_by_date: Optional[str] = None
    is_multi_line: bool = False
    line_items: List[SupplierInvoiceLineItemOut] = []

    class Config:
        from_attributes = True


class SupplierStatementGroup(BaseModel):
    statement_month: int
    statement_year: int
    invoices: List[SupplierInvoiceOut]
    subtotal: Decimal
    payment_due_date: Optional[datetime] = None
    is_fully_paid: bool


class SupplierCurrentPayable(BaseModel):
    supplier_id: int
    supplier_name: str
    total_outstanding: Decimal
    invoice_count: int
    invoice_month: Optional[int] = None
    invoice_year: Optional[int] = None


class Supplier30DaysPayable(BaseModel):
    supplier_id: int
    supplier_name: str
    statement_month: int
    statement_year: int
    total_outstanding: Decimal
    due_date: Optional[datetime] = None
    invoice_count: int


class SupplierPayablesDashboard(BaseModel):
    current_payables: List[SupplierCurrentPayable] = []
    days_30_payables: List[Supplier30DaysPayable] = []
    other_period_payables: List[SupplierCurrentPayable] = []
    total_current: Decimal = Decimal("0")
    total_30_days: Decimal = Decimal("0")
    total_paid_this_month: Decimal = Decimal("0")
    total_all_outstanding: Decimal = Decimal("0")


# ── Diesel Schemas ─────────────────────────────────────────────────────────────

from datetime import date as date_type  # noqa: E402 (already imported above as date_type for drivers, reuse)


class DieselSettingsOut(BaseModel):
    id: int
    entity_id: int
    admin_fee_pct: Decimal
    apply_admin_fee: bool
    additional_charge_per_ton: Decimal = Decimal("0")
    subcontractor_monthly_admin_fee: Decimal = Decimal("0")
    updated_by: Optional[int] = None
    updated_at: Optional[datetime] = None
    loads_updated: int = 0

    class Config:
        from_attributes = True


class DieselSettingsUpdate(BaseModel):
    admin_fee_pct: Decimal
    apply_admin_fee: bool
    additional_charge_per_ton: Decimal = Decimal("0")
    subcontractor_monthly_admin_fee: Decimal = Decimal("0")


class DieselRateCreate(BaseModel):
    entity_id: int
    supplier_id: int
    rate_per_litre: Decimal
    additional_charge_per_ton: Decimal = Decimal("0")
    effective_date: date_type
    effective_to: Optional[date_type] = None
    notes: Optional[str] = None


class DieselRateUpdate(BaseModel):
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    effective_to: Optional[date_type] = None


class DieselRateOut(BaseModel):
    id: int
    entity_id: int
    supplier_id: int
    rate_per_litre: Decimal
    additional_charge_per_ton: Decimal = Decimal("0")
    effective_date: date_type
    effective_to: Optional[date_type] = None
    notes: Optional[str] = None
    is_active: bool
    created_by: Optional[int] = None
    created_at: datetime
    supplier_name: Optional[str] = None

    class Config:
        from_attributes = True


class DieselFillUpCreate(BaseModel):
    entity_id: int
    truck_id: int
    supplier_id: int
    fillup_date: date_type
    litres: Decimal
    rate_per_litre: Decimal
    invoice_number: Optional[str] = None
    slip_number: Optional[str] = None
    truckload_id: Optional[int] = None
    supplier_invoice_id: Optional[int] = None
    diesel_type: str = 'fillup'
    notes: Optional[str] = None
    # driver_name: Optional[str] = None  # reserved for TruckLoad


class DieselFillUpUpdate(BaseModel):
    truck_id: Optional[int] = None
    supplier_id: Optional[int] = None
    fillup_date: Optional[date_type] = None
    litres: Optional[Decimal] = None
    rate_per_litre: Optional[Decimal] = None
    invoice_number: Optional[str] = None
    slip_number: Optional[str] = None
    truckload_id: Optional[int] = None
    supplier_invoice_id: Optional[int] = None
    diesel_type: Optional[str] = None
    verified: Optional[bool] = None
    notes: Optional[str] = None
    # driver_name: Optional[str] = None  # reserved for TruckLoad


class DieselFillUpOut(BaseModel):
    id: int
    entity_id: int
    truck_id: int
    supplier_id: int
    fillup_date: date_type
    litres: Decimal
    rate_per_litre: Decimal
    amount: Decimal
    admin_fee_pct: Decimal
    admin_fee_amount: Decimal
    admin_fee_vat: Decimal = Decimal("0")
    total_amount: Decimal
    invoice_number: Optional[str] = None
    slip_number: Optional[str] = None
    truckload_id: Optional[int] = None
    supplier_invoice_id: Optional[int] = None
    diesel_type: str = 'fillup'
    verified: bool
    verified_by: Optional[int] = None
    verified_at: Optional[datetime] = None
    notes: Optional[str] = None
    # driver_name: Optional[str] = None  # reserved for TruckLoad
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Enriched
    truck_registration: Optional[str] = None
    supplier_name: Optional[str] = None
    supplier_invoice_number: Optional[str] = None
    verified2_by: Optional[int] = None
    verified2_at: Optional[datetime] = None
    verified3_by: Optional[int] = None
    verified3_at: Optional[datetime] = None
    # Verification display (initials + date)
    verified_by_initials: Optional[str] = None
    verified_by_date: Optional[str] = None
    verified2_by_initials: Optional[str] = None
    verified2_by_date: Optional[str] = None
    verified3_by_initials: Optional[str] = None
    verified3_by_date: Optional[str] = None

    class Config:
        from_attributes = True


class DieselSummaryByTruck(BaseModel):
    truck_reg: str
    fillup_count: int
    total_litres: Decimal
    total_amount: Decimal
    total_admin_fee: Decimal
    grand_total: Decimal


class DieselSupplierReconciliation(BaseModel):
    supplier_name: str
    fillup_count: int
    total_litres: Decimal
    total_amount: Decimal
    verified_amount: Decimal
    unverified_amount: Decimal


class DieselInvoiceReconciliationRow(BaseModel):
    supplier_id: int
    supplier_name: str
    invoice_count: int
    invoice_total: Decimal
    fillup_count: int
    fillup_total: Decimal
    difference: Decimal
    is_matched: bool


class DieselAnnualMonthRow(BaseModel):
    month: int
    fillup_count: int
    total_litres: Decimal
    total_amount: Decimal
    total_admin_fee: Decimal
    grand_total: Decimal


class DieselFillUpSummary(BaseModel):
    total_fillups: int = 0
    total_litres: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    total_admin_fee: Decimal = Decimal("0")
    total_admin_fee_vat: Decimal = Decimal("0")
    grand_total: Decimal = Decimal("0")


# ── Diesel sheet import (e.g. Bokamosho) ──────────────────────────────────────

class DieselImportRow(BaseModel):
    depot: Optional[str] = None
    fillup_date: date
    registration: str
    slip_number: Optional[str] = None
    litres: Decimal
    amount: Decimal              # Sum of AMOUNT (EXCL)


class DieselImportRequest(BaseModel):
    entity_id: int
    # The diesel supplier is resolved per row from its DIESEL DEPO.
    depot_suppliers: Dict[str, int] = {}          # depot name → supplier_id
    default_supplier_id: Optional[int] = None     # fallback when depot has no mapping
    commit: bool = False
    rows: List[DieselImportRow] = []


class DieselImportRowResult(BaseModel):
    registration: str
    slip_number: Optional[str] = None
    fillup_date: date
    litres: Decimal
    amount: Decimal
    rate_per_litre: Decimal
    depot: Optional[str] = None
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    status: str                 # matched | created | duplicate | unmatched | invalid
    truck_id: Optional[int] = None
    truck_registration: Optional[str] = None
    matched_by_temp: bool = False
    message: Optional[str] = None


class DieselImportResult(BaseModel):
    total: int = 0
    matched: int = 0
    created: int = 0
    duplicates: int = 0
    unmatched: int = 0
    invalid: int = 0
    committed: bool = False
    unmatched_registrations: List[str] = []
    rows: List[DieselImportRowResult] = []


# ── PayrollEntry Schemas ──────────────────────────────────────────────────────

from app.models.models import PayrollStatus  # noqa: E402


class PayrollEntryOut(BaseModel):
    id: int
    entity_id: int
    driver_id: int
    pay_month: int
    pay_year: int
    status: PayrollStatus
    payroll_settings_id: Optional[int] = None

    lohatla_base_loads: int
    lohatla_extra_loads: int
    lohatla_total_loads: int

    # Income
    basic_salary: Decimal
    load_earnings: Decimal
    subsistence: Decimal
    assmang_bonus: Decimal
    additional_income: Decimal
    gross: Decimal

    # Statutory deductions
    nbcrfli: Decimal
    provident: Decimal
    wellness: Decimal
    sick_fund: Decimal
    holiday_fund: Decimal
    leave_pay: Decimal
    paye: Decimal
    uif: Decimal
    total_statutory: Decimal

    # Manual deductions
    subsistence_advance: Decimal
    staff_loan_deduction: Decimal
    cash_advance_deduction: Decimal

    total_deductions: Decimal
    net_payable: Decimal

    truckload_changed: bool
    truckload_changed_note: Optional[str] = None

    payment_date: Optional[date_type] = None
    payment_reference: Optional[str] = None
    comments: Optional[str] = None

    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    verified_by: Optional[int] = None
    verified_at: Optional[datetime] = None

    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PayrollEntryUpdate(BaseModel):
    """Fields the user can manually edit regardless of status."""
    lohatla_base_loads: Optional[int] = None
    lohatla_extra_loads: Optional[int] = None
    lohatla_total_loads: Optional[int] = None
    subsistence_advance: Optional[Decimal] = None
    staff_loan_deduction: Optional[Decimal] = None
    cash_advance_deduction: Optional[Decimal] = None
    additional_income: Optional[Decimal] = None
    payment_date: Optional[date_type] = None
    payment_reference: Optional[str] = None
    comments: Optional[str] = None
    truckload_changed_note: Optional[str] = None


class PayrollEntryStatusTransition(BaseModel):
    """Advance or revert the status of a payroll entry."""
    status: PayrollStatus


# ── Subcontractor Costing Schemas ─────────────────────────────────────────────

class DieselFillUpCostingRow(BaseModel):
    fillup_date: date
    slip_number: Optional[str] = None
    invoice_number: Optional[str] = None
    supplier_name: Optional[str] = None
    litres: Decimal
    rate_per_litre: Decimal
    amount_excl: Decimal
    admin_fee_excl: Decimal
    admin_fee_vat: Decimal
    admin_fee_incl: Decimal
    grand_total: Decimal


class DieselSupplierGroup(BaseModel):
    supplier_name: str
    rows: List[DieselFillUpCostingRow]
    tot_admin_fee_incl: Decimal
    tot_excl_admin_fee: Decimal
    tot_grand_total: Decimal


class SubcontractorTruckCostingOut(BaseModel):
    truck: TruckOut
    loads: List[TruckLoadOut]
    income_excl_vat: Decimal
    income_incl_vat: Decimal
    admin_fee: Decimal
    supplier_invoices: List[SupplierInvoiceOut]
    total_expenses_excl_vat: Decimal
    total_expenses_incl_vat: Decimal
    net_payable: Decimal
    diesel_groups: List[DieselSupplierGroup] = []


class SubcontractorCostingSummary(BaseModel):
    income_excl_vat: Decimal
    income_incl_vat: Decimal
    total_expenses_excl_vat: Decimal
    total_expenses_incl_vat: Decimal
    net_payable: Decimal


# ── Statements ────────────────────────────────────────────────────────────────

class StatementLineBase(BaseModel):
    line_date:      Optional[date] = None
    description:    Optional[str]  = None
    invoice_number: Optional[str]  = None
    amount:         Decimal        = Decimal("0")
    sort_order:     int            = 0

class StatementLineCreate(StatementLineBase):
    pass

class StatementLineOut(StatementLineBase):
    id:           int
    statement_id: int
    class Config:
        from_attributes = True

class StatementBase(BaseModel):
    entity_id:      int
    customer_id:    Optional[int] = None
    statement_type: str           = "invoice"
    statement_date: date
    title:          Optional[str] = None
    notes:          Optional[str] = None

class StatementCreate(StatementBase):
    lines: List[StatementLineCreate] = []

class StatementUpdate(BaseModel):
    customer_id:    Optional[int]                    = None
    statement_type: Optional[str]                    = None
    statement_date: Optional[date]                   = None
    title:          Optional[str]                    = None
    notes:          Optional[str]                    = None
    lines:          Optional[List[StatementLineCreate]] = None

class StatementOut(StatementBase):
    id:            int
    lines:         List[StatementLineOut] = []
    created_at:    datetime
    updated_at:    Optional[datetime]     = None
    customer_name: Optional[str]          = None
    entity_code:   Optional[str]          = None
    total:         Optional[float]        = None
    class Config:
        from_attributes = True


class SubcontractorCostingOut(BaseModel):
    subcontractor: SubcontractorOut
    month: int
    year: int
    trucks: List[SubcontractorTruckCostingOut]
    summary: SubcontractorCostingSummary
    diesel_suppliers: List[str] = []
    is_vat_registered: bool = True