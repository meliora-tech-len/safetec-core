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


# ── Fleet Schemas ─────────────────────────────────────────────────────────────

from app.models.models import TruckStatus, TrailerStatus  # noqa: E402


class TrailerBase(BaseModel):
    slot: int
    registration: Optional[str] = None
    vin: Optional[str] = None
    status: TrailerStatus = TrailerStatus.active
    notes: Optional[str] = None


class TrailerCreate(TrailerBase):
    pass


class TrailerUpdate(BaseModel):
    registration: Optional[str] = None
    vin: Optional[str] = None
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
    finance_institution: Optional[str] = None
    status: TruckStatus = TruckStatus.active
    notes: Optional[str] = None


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
    finance_institution: Optional[str] = None
    status: Optional[TruckStatus] = None
    notes: Optional[str] = None
    trailers: Optional[List[TrailerCreate]] = None


class TruckOut(TruckBase):
    id: int
    trailers: List[TrailerOut] = []
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
    employee_number: Optional[str] = None
    first_name: str
    last_name: str
    driver_type: DriverType
    id_number: Optional[str] = None
    tax_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    notes: Optional[str] = None


class DriverCreate(DriverBase):
    pass


class DriverUpdate(BaseModel):
    truck_id: Optional[int] = None
    employee_number: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    driver_type: Optional[DriverType] = None
    id_number: Optional[str] = None
    tax_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
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


class DriverSummary(BaseModel):
    id: int
    entity_id: int
    employee_number: Optional[str] = None
    first_name: str
    last_name: str
    driver_type: DriverType
    truck_registration: Optional[str] = None
    is_active: bool
    load_count_this_month: int = 0
    total_payments_this_month: Decimal = Decimal("0")

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
    hotazel_base_salary: Decimal
    lohatla_base_salary: Decimal
    hotazel_incentive_per_load: Decimal
    lohatla_incentive_per_load: Decimal
    hotazel_subs_per_load: Decimal
    lohatla_subs_per_load: Decimal
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
    hotazel_base_salary: Optional[Decimal] = None
    lohatla_base_salary: Optional[Decimal] = None
    hotazel_incentive_per_load: Optional[Decimal] = None
    lohatla_incentive_per_load: Optional[Decimal] = None
    hotazel_subs_per_load: Optional[Decimal] = None
    lohatla_subs_per_load: Optional[Decimal] = None
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
    created_at: datetime

    class Config:
        from_attributes = True


class DriverAdditionalLoadCreate(BaseModel):
    load_date: datetime
    route_name: str
    truck_registration: Optional[str] = None
    litres: Optional[Decimal] = None
    amount: Decimal
    is_verified: bool = False
    notes: Optional[str] = None


class DriverAdditionalLoadUpdate(BaseModel):
    load_date: Optional[datetime] = None
    route_name: Optional[str] = None
    truck_registration: Optional[str] = None
    litres: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    is_verified: Optional[bool] = None
    notes: Optional[str] = None


class DriverAdditionalLoadOut(DriverAdditionalLoadCreate):
    id: int
    pay_cycle_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class DriverFoodPaymentCreate(BaseModel):
    payment_date: datetime
    amount: Decimal
    paid_by: Optional[str] = None
    is_verified: bool = False
    notes: Optional[str] = None


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

    class Config:
        from_attributes = True


class DriverPayCycleUpdate(BaseModel):
    hotazel_base_loads: Optional[int] = None
    hotazel_extra_loads: Optional[int] = None
    lohatla_base_loads: Optional[int] = None
    lohatla_extra_loads: Optional[int] = None
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
    hotazel_base_loads: int
    hotazel_extra_loads: int
    lohatla_base_loads: int
    lohatla_extra_loads: int
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
    notes: Optional[str] = None


class MineCreate(MineBase):
    pass


class MineUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    is_active: Optional[bool] = None
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
    load_date: datetime
    slip_number: Optional[str] = None
    po_number: Optional[str] = None
    driver_name: Optional[str] = None
    tonnes: Decimal
    rate_per_ton: Optional[Decimal] = None
    diesel_litres: Optional[Decimal] = None
    diesel_invoice: Optional[str] = None
    diesel_rate: Optional[Decimal] = None
    date_paid: Optional[datetime] = None
    is_paid: bool = False
    notes: Optional[str] = None
    checked_by: Optional[str] = None


class TruckLoadCreate(TruckLoadBase):
    pass


class TruckLoadUpdate(BaseModel):
    truck_id: Optional[int] = None
    mine_id: Optional[int] = None
    load_date: Optional[datetime] = None
    slip_number: Optional[str] = None
    po_number: Optional[str] = None
    driver_name: Optional[str] = None
    tonnes: Optional[Decimal] = None
    rate_per_ton: Optional[Decimal] = None
    diesel_litres: Optional[Decimal] = None
    diesel_invoice: Optional[str] = None
    diesel_rate: Optional[Decimal] = None
    date_paid: Optional[datetime] = None
    is_paid: Optional[bool] = None
    notes: Optional[str] = None
    checked_by: Optional[str] = None


class TruckLoadOut(TruckLoadBase):
    id: int
    rate_per_ton: Decimal
    amount_excl_vat: Optional[Decimal] = None
    amount_incl_vat: Optional[Decimal] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    truck_registration: Optional[str] = None
    mine_name: Optional[str] = None

    class Config:
        from_attributes = True


class TruckLoadBulkCreate(BaseModel):
    loads: List[TruckLoadCreate]


class TruckLoadSummary(BaseModel):
    total_loads: int = 0
    total_tonnes: Decimal = Decimal("0")
    total_excl_vat: Decimal = Decimal("0")
    total_incl_vat: Decimal = Decimal("0")
    total_diesel_litres: Decimal = Decimal("0")


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
    created_at: datetime
    truck_registration: Optional[str] = None

    class Config:
        from_attributes = True