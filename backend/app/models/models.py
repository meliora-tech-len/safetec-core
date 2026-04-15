from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Date, ForeignKey,
    Text, Numeric, Enum, JSON
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base
import enum


class UserRole(str, enum.Enum):
    admin = "admin"
    standard = "standard"


# ── Roles ─────────────────────────────────────────────────────────────────────

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    key = Column(String(100), unique=True, nullable=False)
    display_name = Column(String(200), nullable=False)
    is_protected = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InvoiceStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"
    paid = "paid"
    overdue = "overdue"
    cancelled = "cancelled"


class DocumentType(str, enum.Enum):
    invoice = "invoice"
    quote = "quote"
    purchase_order = "purchase_order"


class TruckStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    maintenance = "maintenance"


class TrailerStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    maintenance = "maintenance"


# ── Business Entities ────────────────────────────────────────────────────────

class BusinessEntity(Base):
    __tablename__ = "business_entities"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    trading_name = Column(String(200))
    registration_number = Column(String(100))
    vat_number = Column(String(50))
    address = Column(Text)
    phone = Column(String(50))
    email = Column(String(200))

    # Banking
    bank_name = Column(String(100))
    bank_branch = Column(String(100))
    bank_account_number = Column(String(50))
    bank_branch_code = Column(String(20))
    bank_reference = Column(String(200))

    # Branding
    logo_path = Column(String(500))        # legacy / local path
    logo_url = Column(String(500))         # Supabase Storage public URL
    primary_color = Column(String(7), default="#2563eb")

    # Invoice config
    invoice_prefix = Column(String(10))
    invoice_counter = Column(Integer, default=0)
    quote_prefix = Column(String(10), default="QT")
    quote_counter = Column(Integer, default=0)

    # Tax
    vat_rate = Column(Numeric(5, 4), default=0.15)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    suppliers = relationship("Supplier", back_populates="entity")
    invoices = relationship("Invoice", back_populates="entity")
    user_access = relationship("UserEntityAccess", back_populates="entity")
    trucks = relationship("Truck", back_populates="entity")
    drivers = relationship("Driver", back_populates="entity")
    truck_loads = relationship("TruckLoad", back_populates="entity")


# ── Users & Access Control ────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(200), unique=True, nullable=False, index=True)
    full_name = Column(String(200), nullable=False)
    hashed_password = Column(String(500), nullable=False)
    role = Column(String(100), default="standard", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True))
    password_reset_token = Column(String(100))
    password_reset_expires = Column(DateTime(timezone=True))

    # Relationships
    entity_access = relationship("UserEntityAccess", back_populates="user", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="user")


class UserEntityAccess(Base):
    """Defines which business entities a user can access, and which modules within each."""
    __tablename__ = "user_entity_access"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)

    # CRUD permissions
    can_create = Column(Boolean, default=True)
    can_edit = Column(Boolean, default=True)
    can_delete = Column(Boolean, default=False)

    # Module-level access: ["clients", "invoices", "suppliers", "fleet", "diesel"]
    allowed_modules = Column(JSON, default=list)

    user = relationship("User", back_populates="entity_access")
    entity = relationship("BusinessEntity", back_populates="user_access")


# ── App Settings ──────────────────────────────────────────────────────────────

class AppSetting(Base):
    """Global application settings configurable by admin."""
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=False)
    label = Column(String(200))
    category = Column(String(50), default="system")
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    updater = relationship("User", foreign_keys=[updated_by])


# ── Suppliers ─────────────────────────────────────────────────────────────────

class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(300), nullable=False)
    trading_name = Column(String(300))
    registration_number = Column(String(100))
    vat_number = Column(String(50))
    contact_person = Column(String(200))
    email = Column(String(200))
    phone = Column(String(50))
    address = Column(Text)
    city = Column(String(100))
    postal_code = Column(String(20))
    notes = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity", back_populates="suppliers")
    invoices = relationship("Invoice", back_populates="supplier")


# ── Invoices & Line Items ─────────────────────────────────────────────────────

class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False)

    document_type = Column(Enum(DocumentType), default=DocumentType.invoice, nullable=False)
    invoice_number = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(Enum(InvoiceStatus), default=InvoiceStatus.draft, nullable=False)

    # VAT
    is_vat_exempt = Column(Boolean, default=False)  # whole invoice is non-VAT

    issue_date = Column(DateTime(timezone=True), server_default=func.now())
    due_date = Column(DateTime(timezone=True))
    paid_date = Column(DateTime(timezone=True))

    subtotal = Column(Numeric(15, 2), default=0)
    vat_rate = Column(Numeric(5, 4), default=0.15)
    vat_amount = Column(Numeric(15, 2), default=0)
    total = Column(Numeric(15, 2), default=0)

    notes = Column(Text)
    print_note = Column(Boolean, default=False)
    terms = Column(Text)
    payment_reference = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity", back_populates="invoices")
    supplier = relationship("Supplier", back_populates="invoices")
    line_items = relationship("InvoiceLineItem", back_populates="invoice",
                              cascade="all, delete-orphan", order_by="InvoiceLineItem.sort_order")


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    description = Column(Text)
    quantity = Column(Numeric(12, 4), default=1)
    unit_price = Column(Numeric(15, 2), default=0)
    amount = Column(Numeric(15, 2), default=0)
    is_vat_exempt = Column(Boolean, default=False)  # line-item level non-VAT override
    sort_order = Column(Integer, default=0)

    invoice = relationship("Invoice", back_populates="line_items")


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String(100), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="SET NULL"), nullable=True)
    resource_type = Column(String(50))
    resource_id = Column(Integer)
    description = Column(Text)
    ip_address = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    old_values = Column(JSON, nullable=True)
    new_values = Column(JSON, nullable=True)

    user = relationship("User", back_populates="audit_logs")


# ── Fleet ─────────────────────────────────────────────────────────────────────

class Truck(Base):
    __tablename__ = "trucks"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)

    fleet_number = Column(String(20))
    make = Column(String(100), nullable=False)
    model = Column(String(100))
    registration = Column(String(50), nullable=False, index=True)
    vin = Column(String(100))

    driver_name = Column(String(200))

    licence_number = Column(String(100))
    licence_expiry = Column(DateTime(timezone=True))

    finance_institution = Column(String(200))

    status = Column(Enum(TruckStatus), default=TruckStatus.active, nullable=False)
    notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity", back_populates="trucks")
    trailers = relationship("Trailer", back_populates="truck", cascade="all, delete-orphan", order_by="Trailer.slot")
    drivers = relationship("Driver", back_populates="truck")
    truck_loads = relationship("TruckLoad", back_populates="truck")


class Trailer(Base):
    __tablename__ = "trailers"

    id = Column(Integer, primary_key=True, index=True)
    truck_id = Column(Integer, ForeignKey("trucks.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)

    slot = Column(Integer, nullable=False)
    registration = Column(String(50), index=True)
    vin = Column(String(100))
    status = Column(Enum(TrailerStatus), default=TrailerStatus.active, nullable=False)
    notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    truck = relationship("Truck", back_populates="trailers")
    entity = relationship("BusinessEntity")


# ── Drivers ───────────────────────────────────────────────────────────────────

class DriverType(str, enum.Enum):
    permanent = "permanent"
    casual = "casual"


class Driver(Base):
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    truck_id = Column(Integer, ForeignKey("trucks.id", ondelete="SET NULL"), nullable=True)

    employee_number = Column(String(50))
    first_name = Column(String(200), nullable=False)
    last_name = Column(String(200), nullable=False)
    driver_type = Column(Enum(DriverType), nullable=False)

    id_number = Column(String(100))
    tax_number = Column(String(100))
    bank_name = Column(String(200))
    bank_account_number = Column(String(100))

    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity", back_populates="drivers")
    truck = relationship("Truck", back_populates="drivers")
    loads = relationship("DriverLoad", back_populates="driver", cascade="all, delete-orphan", order_by="DriverLoad.load_date.desc()")
    payments = relationship("DriverPayment", back_populates="driver", cascade="all, delete-orphan", order_by="DriverPayment.payment_date.desc()")
    pay_cycles = relationship("DriverPayCycle", back_populates="driver", cascade="all, delete-orphan")


# ── PayrollSettings ───────────────────────────────────────────────────────────

class PayrollSettings(Base):
    __tablename__ = "payroll_settings"

    id = Column(Integer, primary_key=True)
    effective_date = Column(DateTime(timezone=True), nullable=False)

    # Base salaries (weekly, 7 loads)
    hotazel_base_salary       = Column(Numeric(12, 2), nullable=False, default=13574.38)
    lohatla_base_salary       = Column(Numeric(12, 2), nullable=False, default=16481.55)

    # Load incentive per extra load (above 7)
    hotazel_incentive_per_load = Column(Numeric(12, 2), nullable=False, default=2900.00)
    lohatla_incentive_per_load = Column(Numeric(12, 2), nullable=False, default=2610.00)

    # Subsistence per load
    hotazel_subs_per_load     = Column(Numeric(12, 2), nullable=False, default=405.00)
    lohatla_subs_per_load     = Column(Numeric(12, 2), nullable=False, default=459.66)

    # Assmang bonus (per load, applied to ALL loads)
    assmang_bonus_per_load    = Column(Numeric(12, 2), nullable=False, default=150.00)

    # Statutory deduction rates
    nbcrfli_rate              = Column(Numeric(6, 4), nullable=False, default=0.004)
    provident_rate            = Column(Numeric(6, 4), nullable=False, default=0.10)
    wellness_rate             = Column(Numeric(6, 4), nullable=False, default=0.01)
    sick_fund_rate            = Column(Numeric(6, 4), nullable=False, default=0.20)
    holiday_fund_rate         = Column(Numeric(6, 4), nullable=False, default=0.3608)
    leave_pay_rate            = Column(Numeric(6, 4), nullable=False, default=0.25)
    paye_fixed                = Column(Numeric(12, 2), nullable=False, default=177.12)
    weekly_to_monthly_factor  = Column(Numeric(6, 4), nullable=False, default=4.3333)

    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


# ── DriverPayCycle & sub-tables ───────────────────────────────────────────────

class DriverPayCycle(Base):
    __tablename__ = "driver_pay_cycles"

    id = Column(Integer, primary_key=True, index=True)
    driver_id             = Column(Integer, ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False)
    pay_month             = Column(Integer, nullable=False)
    pay_year              = Column(Integer, nullable=False)
    payroll_settings_id   = Column(Integer, ForeignKey("payroll_settings.id", ondelete="RESTRICT"), nullable=True)

    hotazel_base_loads    = Column(Integer, default=0, nullable=False)
    hotazel_extra_loads   = Column(Integer, default=0, nullable=False)
    lohatla_base_loads    = Column(Integer, default=0, nullable=False)
    lohatla_extra_loads   = Column(Integer, default=0, nullable=False)

    subsistence_advance_paid     = Column(Numeric(12, 2), default=0)
    subsistence_advance_verified = Column(Boolean, default=False)

    staff_loan_balance    = Column(Numeric(12, 2), default=0)
    staff_loan_deduction  = Column(Numeric(12, 2), default=0)
    cash_advance_balance  = Column(Numeric(12, 2), default=0)
    cash_advance_deduction = Column(Numeric(12, 2), default=0)

    comments = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    driver           = relationship("Driver", back_populates="pay_cycles")
    trip_log         = relationship("DriverTripLog", back_populates="pay_cycle", cascade="all, delete-orphan")
    additional_loads = relationship("DriverAdditionalLoad", back_populates="pay_cycle", cascade="all, delete-orphan")
    food_payments    = relationship("DriverFoodPayment", back_populates="pay_cycle", cascade="all, delete-orphan")


class DriverTripLog(Base):
    __tablename__ = "driver_trip_logs"

    id           = Column(Integer, primary_key=True, index=True)
    pay_cycle_id = Column(Integer, ForeignKey("driver_pay_cycles.id", ondelete="CASCADE"), nullable=False)
    trip_date    = Column(DateTime(timezone=True), nullable=False)
    mine_name    = Column(String(200), nullable=False)
    notes        = Column(String(500), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    pay_cycle = relationship("DriverPayCycle", back_populates="trip_log")


class DriverAdditionalLoad(Base):
    __tablename__ = "driver_additional_loads"

    id              = Column(Integer, primary_key=True, index=True)
    pay_cycle_id    = Column(Integer, ForeignKey("driver_pay_cycles.id", ondelete="CASCADE"), nullable=False)
    load_date       = Column(DateTime(timezone=True), nullable=False)
    route_name      = Column(String(200), nullable=False)
    truck_registration = Column(String(50), nullable=True)
    litres          = Column(Numeric(10, 2), nullable=True)
    amount          = Column(Numeric(12, 2), nullable=False)
    is_verified     = Column(Boolean, default=False)
    notes           = Column(String(500), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    pay_cycle = relationship("DriverPayCycle", back_populates="additional_loads")


class DriverFoodPayment(Base):
    __tablename__ = "driver_food_payments"

    id           = Column(Integer, primary_key=True, index=True)
    pay_cycle_id = Column(Integer, ForeignKey("driver_pay_cycles.id", ondelete="CASCADE"), nullable=False)
    payment_date = Column(DateTime(timezone=True), nullable=False)
    amount       = Column(Numeric(12, 2), nullable=False)
    paid_by      = Column(String(100), nullable=True)
    is_verified  = Column(Boolean, default=False)
    notes        = Column(String(500), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    pay_cycle = relationship("DriverPayCycle", back_populates="food_payments")


class DriverLoad(Base):
    __tablename__ = "driver_loads"

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False)

    load_date = Column(Date, nullable=False)
    mine_name = Column(String(200), nullable=False)
    truck_registration = Column(String(50))
    load_number = Column(Integer)
    rate = Column(Numeric(12, 2))
    notes = Column(String(500))

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    driver = relationship("Driver", back_populates="loads")


class DriverPayment(Base):
    __tablename__ = "driver_payments"

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False)

    payment_date = Column(Date, nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    payment_source = Column(String(100))
    description = Column(String(500))

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    driver = relationship("Driver", back_populates="payments")


# ── Payroll Mine Groups ───────────────────────────────────────────────────────

class PayrollMineGroup(Base):
    """A named mine route group with its own salary/incentive/subs rates."""
    __tablename__ = "payroll_mine_groups"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)           # e.g. "Lohatla"
    base_salary = Column(Numeric(12, 2), nullable=False)
    incentive_per_load = Column(Numeric(12, 2), nullable=False, default=0)
    subs_per_load = Column(Numeric(12, 2), nullable=False, default=0)
    base_loads = Column(Integer, default=7)              # loads that make up the base salary week
    is_active = Column(Boolean, default=True)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# ── Mines & Rates ──────────────────────────────────────────────────────────────

class Mine(Base):
    __tablename__ = "mines"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    code = Column(String(30), nullable=False)
    is_active = Column(Boolean, default=True)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    rates = relationship("MineRate", back_populates="mine", cascade="all, delete-orphan")
    truck_loads = relationship("TruckLoad", back_populates="mine")


class MineRate(Base):
    """Rate per ton for a given mine, per entity. Supports rate history."""
    __tablename__ = "mine_rates"

    id = Column(Integer, primary_key=True)
    mine_id = Column(Integer, ForeignKey("mines.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    rate_per_ton = Column(Numeric(10, 2), nullable=False)
    effective_from = Column(DateTime(timezone=True), nullable=False)
    effective_to = Column(DateTime(timezone=True), nullable=True)
    notes = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    mine = relationship("Mine", back_populates="rates")
    entity = relationship("BusinessEntity")


# ── Truck Loads ────────────────────────────────────────────────────────────────

class TruckLoad(Base):
    __tablename__ = "truck_loads"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)
    truck_id = Column(Integer, ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False)
    mine_id = Column(Integer, ForeignKey("mines.id", ondelete="RESTRICT"), nullable=False)

    load_date = Column(DateTime(timezone=True), nullable=False)
    slip_number = Column(String(50))
    po_number = Column(String(50))
    driver_name = Column(String(100))
    tonnes = Column(Numeric(8, 3), nullable=False)
    rate_per_ton = Column(Numeric(10, 2), nullable=False)
    amount_excl_vat = Column(Numeric(12, 2))
    amount_incl_vat = Column(Numeric(12, 2))

    diesel_litres = Column(Numeric(10, 3))
    diesel_invoice = Column(String(50))
    diesel_rate = Column(Numeric(10, 4))

    date_paid = Column(DateTime(timezone=True))
    is_paid = Column(Boolean, default=False)
    notes = Column(Text)
    checked_by = Column(String(50))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity", back_populates="truck_loads")
    truck = relationship("Truck", back_populates="truck_loads")
    mine = relationship("Mine", back_populates="truck_loads")


# ── Driver Salary Config ───────────────────────────────────────────────────────

class DriverSalaryConfig(Base):
    """Base salary config for a driver assigned to a truck. Stored in settings."""
    __tablename__ = "driver_salary_configs"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    truck_id = Column(Integer, ForeignKey("trucks.id", ondelete="CASCADE"), nullable=True)
    driver_name = Column(String(100), nullable=False)
    base_salary_near_route = Column(Numeric(10, 2))
    base_salary_far_route = Column(Numeric(10, 2))
    extra_per_load_far = Column(Numeric(10, 2))
    deduction_near = Column(Numeric(10, 2))
    effective_from = Column(DateTime(timezone=True))
    effective_to = Column(DateTime(timezone=True))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    entity = relationship("BusinessEntity")
    truck = relationship("Truck")
