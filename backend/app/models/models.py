from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Date, ForeignKey,
    Text, Numeric, Enum, JSON, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base
from decimal import Decimal
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
    ready = "ready"      # PDF generated, not yet sent
    sent = "sent"
    accepted = "accepted"  # quote accepted by client
    paid = "paid"
    overdue = "overdue"
    cancelled = "cancelled"


class DocumentType(str, enum.Enum):
    invoice = "invoice"
    quote = "quote"
    purchase_order = "purchase_order"


class PaymentTermType(str, enum.Enum):
    current = "current"
    days_30 = "30_days"


class TruckStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    maintenance = "maintenance"


class TrailerStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    maintenance = "maintenance"


class PersonalVehicleStatus(str, enum.Enum):
    active = "active"
    sold = "sold"
    written_off = "written_off"


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
    vat_registered = Column(Boolean, default=True, nullable=False)

    is_active = Column(Boolean, default=True)
    is_subcontractor_entity = Column(Boolean, default=False, nullable=False, server_default='false')
    linked_subcontractor_id = Column(Integer, ForeignKey("subcontractors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    suppliers       = relationship("Supplier",       back_populates="entity")
    subcontractors  = relationship("Subcontractor",  back_populates="entity", foreign_keys="Subcontractor.entity_id")
    customers       = relationship("Customer",       back_populates="entity")
    invoices = relationship("Invoice", back_populates="entity")
    invoice_templates = relationship("InvoiceTemplate", back_populates="entity")
    user_access = relationship("UserEntityAccess", back_populates="entity")
    trucks = relationship("Truck", back_populates="entity")
    drivers = relationship("Driver", back_populates="entity")
    truck_loads = relationship("TruckLoad", back_populates="entity")
    linked_subcontractor = relationship("Subcontractor", foreign_keys=[linked_subcontractor_id])


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
    can_create = Column(Boolean, default=True, server_default='true')
    can_edit = Column(Boolean, default=True, server_default='true')
    can_delete = Column(Boolean, default=False, server_default='false')

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

    short_name = Column(String(100))
    category = Column(String(100))
    payment_term = Column(Enum(PaymentTermType), nullable=False, default=PaymentTermType.current)
    is_diesel_supplier       = Column(Boolean, default=False)
    requires_registration    = Column(Boolean, nullable=False, default=True)

    entity = relationship("BusinessEntity", back_populates="suppliers")
    invoices = relationship("Invoice", back_populates="supplier")
    supplier_invoices = relationship("SupplierInvoice", back_populates="supplier", cascade="all, delete-orphan")


# ── Customers ─────────────────────────────────────────────────────────────────

class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(300), nullable=False)
    trading_name = Column(String(300))
    contact_person = Column(String(200))
    email = Column(String(200))
    phone = Column(String(50))
    address = Column(Text)
    city = Column(String(100))
    postal_code = Column(String(20))
    vat_number = Column(String(50))
    registration_number = Column(String(100))
    notes = Column(Text)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    entity = relationship("BusinessEntity", back_populates="customers")
    invoices = relationship("Invoice", back_populates="customer")


# ── Subcontractors ────────────────────────────────────────────────────────────

class Subcontractor(Base):
    __tablename__ = "subcontractors"

    id                  = Column(Integer, primary_key=True, index=True)
    entity_id           = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    name                = Column(String(300), nullable=False)
    trading_name        = Column(String(300))
    contact_person      = Column(String(200))
    email               = Column(String(200))
    phone               = Column(String(50))
    registration_number = Column(String(100))
    vat_number          = Column(String(50))
    notes               = Column(Text)
    is_active           = Column(Boolean, default=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity", back_populates="subcontractors", foreign_keys=[entity_id])
    trucks = relationship("Truck", back_populates="subcontractor")


# ── Invoices & Line Items ─────────────────────────────────────────────────────

class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="RESTRICT"), nullable=True)

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
    supplier = relationship("Supplier", back_populates="invoices", foreign_keys=[supplier_id])
    customer = relationship("Customer", back_populates="invoices", foreign_keys=[customer_id])
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
    line_type  = Column(String(20), default='item')
    loading_number    = Column(String(100), nullable=True)
    offloading_number = Column(String(100), nullable=True)

    invoice = relationship("Invoice", back_populates="line_items")


# ── Invoice Templates ──────────────────────────────────────────────────────────

class InvoiceTemplate(Base):
    __tablename__ = "invoice_templates"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True)

    name = Column(String(200), nullable=False)
    document_type = Column(Enum(DocumentType), default=DocumentType.invoice, nullable=False)
    is_vat_exempt = Column(Boolean, default=False)
    vat_rate = Column(Numeric(5, 4), default=0.15)
    notes = Column(Text)
    print_note = Column(Boolean, default=False)
    terms = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity", back_populates="invoice_templates")
    supplier = relationship("Supplier", foreign_keys=[supplier_id])
    customer = relationship("Customer", foreign_keys=[customer_id])
    line_items = relationship("InvoiceTemplateLineItem", back_populates="template",
                              cascade="all, delete-orphan", order_by="InvoiceTemplateLineItem.sort_order")


class InvoiceTemplateLineItem(Base):
    __tablename__ = "invoice_template_line_items"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("invoice_templates.id", ondelete="CASCADE"), nullable=False)
    description = Column(Text)
    is_vat_exempt = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    line_type = Column(String(20), default='item')
    quantity = Column(Numeric(12, 4))
    unit_price = Column(Numeric(12, 2))
    amount = Column(Numeric(12, 2))

    template = relationship("InvoiceTemplate", back_populates="line_items")


# ── Supplier Invoices (incoming payables) ─────────────────────────────────────

class SupplierInvoice(Base):
    __tablename__ = "supplier_invoices"

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=True)
    subcontractor_id = Column(Integer, ForeignKey("subcontractors.id", ondelete="CASCADE"), nullable=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)

    invoice_date = Column(DateTime(timezone=True), nullable=False)
    invoice_number = Column(String(100), nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)
    litres = Column(Numeric(10, 3), nullable=True)
    vat_applicable = Column(Boolean, default=True)
    is_archived = Column(Boolean, nullable=False, default=False)
    vehicle_reg = Column(String(50))
    description = Column(Text)

    statement_month = Column(Integer)
    statement_year = Column(Integer)

    is_verified  = Column(Boolean, default=False)
    verified_by  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_at  = Column(DateTime(timezone=True))
    verified2_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified2_at = Column(DateTime(timezone=True))
    verified3_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified3_at = Column(DateTime(timezone=True))
    payment_due_date = Column(DateTime(timezone=True))
    is_paid = Column(Boolean, default=False)
    paid_date = Column(DateTime(timezone=True))
    payment_reference = Column(String(200))

    notes = Column(Text)
    deposit_paid = Column(Numeric(12, 2), nullable=True)
    is_multi_line = Column(Boolean, default=False, nullable=False, server_default='false')
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    supplier = relationship("Supplier", back_populates="supplier_invoices")
    subcontractor = relationship("Subcontractor", foreign_keys=[subcontractor_id])
    entity = relationship("BusinessEntity")
    created_by = relationship("User", foreign_keys=[created_by_id])
    diesel_fillups = relationship("DieselFillUp", back_populates="supplier_invoice")
    line_items = relationship(
        "SupplierInvoiceLineItem", back_populates="invoice",
        order_by="SupplierInvoiceLineItem.sort_order",
        cascade="all, delete-orphan",
    )


class SupplierInvoiceLineItem(Base):
    __tablename__ = "supplier_invoice_line_items"

    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("supplier_invoices.id", ondelete="CASCADE"), nullable=False)
    sort_order = Column(Integer, default=0)
    item_code = Column(String(100))
    item_description = Column(Text)
    quantity = Column(Numeric(12, 3))
    unit = Column(String(50))
    amount_excl_vat = Column(Numeric(12, 2), nullable=False, default=0)
    amount_incl_vat = Column(Numeric(12, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invoice = relationship("SupplierInvoice", back_populates="line_items")


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

    finance_institution     = Column(String(200))
    finance_account_number  = Column(String(100))
    finance_contract_end    = Column(DateTime(timezone=True))

    is_subcontractor    = Column(Boolean, default=False, nullable=False)
    subcontractor_name  = Column(String(200))
    subcontractor_id    = Column(Integer, ForeignKey("subcontractors.id", ondelete="SET NULL"), nullable=True)

    # Grouping / ownership fields (see migration 022)
    # operator: who operates the truck — None = entity-owned fleet
    #           e.g. "Betopess", "Alex Maintenance", "Julian"
    operator         = Column(String(100))
    # contract_context: which work programme the truck belongs to
    #           e.g. "OBHI", "Safetec", "Intsimbi"
    contract_context = Column(String(100))
    # temp_registration: old or temporary plate (e.g. GP reg before EC transfer)
    # TECH-DEBT: existing TruckLoad.driver_name links to driver by name string,
    # not by driver FK. Should be migrated to FK when driver-load linking is implemented.
    temp_registration    = Column(String(50))
    is_temp_registration = Column(Boolean, default=False, nullable=False)

    status = Column(Enum(TruckStatus), default=TruckStatus.active, nullable=False)
    notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity        = relationship("BusinessEntity", back_populates="trucks")
    subcontractor = relationship("Subcontractor",  back_populates="trucks", foreign_keys=[subcontractor_id])
    trailers      = relationship("Trailer",         back_populates="truck", cascade="all, delete-orphan", order_by="Trailer.slot")
    drivers       = relationship("Driver",          back_populates="truck")
    truck_loads   = relationship("TruckLoad",       back_populates="truck")


class Trailer(Base):
    __tablename__ = "trailers"

    id = Column(Integer, primary_key=True, index=True)
    truck_id = Column(Integer, ForeignKey("trucks.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)

    slot = Column(Integer, nullable=False)
    registration = Column(String(50), index=True)
    vin = Column(String(100))
    licence_number = Column(String(100))
    licence_expiry = Column(DateTime(timezone=True))
    finance_institution    = Column(String(200))
    finance_account_number = Column(String(100))
    finance_contract_end   = Column(DateTime(timezone=True))
    status = Column(Enum(TrailerStatus), default=TrailerStatus.active, nullable=False)
    notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    truck = relationship("Truck", back_populates="trailers")
    entity = relationship("BusinessEntity")


class PersonalVehicle(Base):
    __tablename__ = "personal_vehicles"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)

    owner = Column(String(100))
    vehicle_type = Column(String(200), nullable=False)
    year = Column(Integer)
    registration = Column(String(50), index=True)
    licence_number = Column(String(100))
    licence_expiry = Column(DateTime(timezone=True))

    status = Column(Enum(PersonalVehicleStatus), default=PersonalVehicleStatus.active, nullable=False)
    notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity")


class TruckMonthlyExpenses(Base):
    __tablename__ = "truck_monthly_expenses"

    id                  = Column(Integer, primary_key=True, index=True)
    truck_id            = Column(Integer, ForeignKey("trucks.id", ondelete="CASCADE"), nullable=False)
    year                = Column(Integer, nullable=False)
    month               = Column(Integer, nullable=False)

    # Income (manually entered; auto-fill from loads added later)
    income_excl_vat     = Column(Numeric(12, 2), nullable=True)
    income_incl_vat     = Column(Numeric(12, 2), nullable=True)

    # Expenses
    drivers_salary      = Column(Numeric(12, 2), nullable=True)
    insurance_trailer   = Column(Numeric(12, 2), nullable=True)
    liability_3rd_party = Column(Numeric(12, 2), nullable=True)
    goods_in_transit    = Column(Numeric(12, 2), nullable=True)
    loss_of_use         = Column(Numeric(12, 2), nullable=True)
    personal_accident   = Column(Numeric(12, 2), nullable=True)
    communication_device= Column(Numeric(12, 2), nullable=True)
    sauma               = Column(Numeric(12, 2), nullable=True)
    diesel              = Column(Numeric(12, 2), nullable=True)
    tyre_maintenance    = Column(Numeric(12, 2), nullable=True)
    other_suppliers     = Column(Numeric(12, 2), nullable=True)

    # Freeform additional expense lines: [{"id": str, "description": str, "amount": float}]
    custom_lines        = Column(JSON, nullable=True)

    notes               = Column(Text, nullable=True)

    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), onupdate=func.now())

    truck               = relationship("Truck")

    __table_args__ = (UniqueConstraint("truck_id", "year", "month", name="uq_truck_monthly_expenses"),)


# ── Drivers ───────────────────────────────────────────────────────────────────

class DriverType(str, enum.Enum):
    permanent = "permanent"
    casual = "casual"


class PayrollStatus(str, enum.Enum):
    auto_draft = "auto_draft"
    pending_review = "pending_review"
    verified = "verified"
    paid = "paid"


class Driver(Base):
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    truck_id    = Column(Integer, ForeignKey("trucks.id", ondelete="SET NULL"), nullable=True)
    driver_slot = Column(Integer, nullable=True)  # 1 = Driver 1, 2 = Driver 2; null = unassigned

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
    payroll_entries = relationship("PayrollEntry", back_populates="driver", cascade="all, delete-orphan", order_by="PayrollEntry.pay_year.desc(), PayrollEntry.pay_month.desc()")
    casual_assignments = relationship("CasualTruckAssignment", back_populates="driver", cascade="all, delete-orphan")


class CasualTruckAssignment(Base):
    """Junction table: allows a casual driver to be assigned to multiple trucks simultaneously."""
    __tablename__ = "casual_truck_assignments"
    __table_args__ = (
        UniqueConstraint("truck_id", "driver_slot", name="uq_casual_truck_slot"),
    )

    id        = Column(Integer, primary_key=True)
    driver_id = Column(Integer, ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False)
    truck_id  = Column(Integer, ForeignKey("trucks.id", ondelete="CASCADE"), nullable=False)
    driver_slot = Column(Integer, nullable=False)
    entity_id = Column(Integer, ForeignKey("business_entities.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    driver = relationship("Driver", back_populates="casual_assignments")
    truck  = relationship("Truck")


# ── PayrollSettings ───────────────────────────────────────────────────────────

class PayrollSettings(Base):
    __tablename__ = "payroll_settings"

    id = Column(Integer, primary_key=True)
    effective_date = Column(DateTime(timezone=True), nullable=False)

    # Base salaries (weekly, 7 loads)
    lohatla_base_salary       = Column(Numeric(12, 2), nullable=False, default=16481.55)

    # Load incentive per extra load (above 7)
    lohatla_incentive_per_load = Column(Numeric(12, 2), nullable=False, default=2610.00)

    # Subsistence per load
    lohatla_subs_per_load     = Column(Numeric(12, 2), nullable=False, default=459.66)

    # Casual driver rates by mine group
    lohatla_casual_rate_per_load = Column(Numeric(12, 2), nullable=False, default=2610.00)  # kept for legacy records
    casual_rate_group_a          = Column(Numeric(12, 2), nullable=False, default=2200.00)  # Mokala/Assmang/Sebilo/Tawana
    casual_rate_group_b          = Column(Numeric(12, 2), nullable=False, default=1900.00)  # Glosam/Driehoek/Future/Afrimat/Boskop

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

    lohatla_base_loads    = Column(Integer, default=0, nullable=False)
    lohatla_extra_loads   = Column(Integer, default=0, nullable=False)

    # Casual driver: loads split by mine group rate
    casual_group_a_loads  = Column(Integer, default=0, nullable=False)  # R2200 mines
    casual_group_b_loads  = Column(Integer, default=0, nullable=False)  # R1900 mines

    # Split load counts (auto-synced from truck_load_lines)
    permanent_split_loads      = Column(Integer, default=0, nullable=False)
    casual_split_group_a_loads = Column(Integer, default=0, nullable=False)
    casual_split_group_b_loads = Column(Integer, default=0, nullable=False)

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

    id             = Column(Integer, primary_key=True, index=True)
    pay_cycle_id   = Column(Integer, ForeignKey("driver_pay_cycles.id", ondelete="CASCADE"), nullable=False)
    trip_date      = Column(DateTime(timezone=True), nullable=False)
    mine_name      = Column(String(200), nullable=False)
    notes          = Column(String(500), nullable=True)
    truck_load_id  = Column(Integer, ForeignKey("truck_loads.id", ondelete="SET NULL"), nullable=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())

    pay_cycle  = relationship("DriverPayCycle", back_populates="trip_log")
    truck_load = relationship("TruckLoad")


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
    verified_by     = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_at     = Column(DateTime(timezone=True))
    verified2_by    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified2_at    = Column(DateTime(timezone=True))
    verified3_by    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified3_at    = Column(DateTime(timezone=True))
    notes           = Column(String(500), nullable=True)
    is_archived     = Column(Boolean, nullable=False, default=False)
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
    verified_by  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_at  = Column(DateTime(timezone=True))
    verified2_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified2_at = Column(DateTime(timezone=True))
    verified3_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified3_at = Column(DateTime(timezone=True))
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
    casual_group = Column(String(1), nullable=True)  # 'A', 'B', or None
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
    entity_id   = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)
    truck_id    = Column(Integer, ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False)
    mine_id     = Column(Integer, ForeignKey("mines.id", ondelete="RESTRICT"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)

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

    subcontractor_admin_fee_per_ton = Column(Numeric(10, 2), nullable=True)
    subcontractor_rate              = Column(Numeric(10, 2), nullable=True)
    subcontractor_amount_excl_vat   = Column(Numeric(12, 2), nullable=True)
    subcontractor_amount_incl_vat   = Column(Numeric(12, 2), nullable=True)

    date_paid = Column(DateTime(timezone=True))
    is_paid = Column(Boolean, default=False)
    is_archived = Column(Boolean, nullable=False, default=False)
    is_split_load = Column(Boolean, nullable=False, default=False)
    driver_id     = Column(Integer, ForeignKey("drivers.id", ondelete="SET NULL"), nullable=True)
    split_group_id = Column(Integer, nullable=True)
    notes = Column(Text)
    checked_by = Column(String(50))
    statement_month = Column(Integer)
    statement_year  = Column(Integer)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity   = relationship("BusinessEntity", back_populates="truck_loads")
    truck    = relationship("Truck", back_populates="truck_loads")
    mine     = relationship("Mine", back_populates="truck_loads")
    supplier = relationship("Supplier", foreign_keys=[supplier_id])
    driver   = relationship("Driver", foreign_keys=[driver_id])
    driver_splits = relationship(
        "TruckLoadDriverSplit", back_populates="truck_load",
        cascade="all, delete-orphan", order_by="TruckLoadDriverSplit.sort_order",
    )


class TruckLoadDriverSplit(Base):
    """A driver line on a split load. The main TruckLoad keeps the full tonnes/amount;
    each driver line credits `share` (fixed 0.5) of a load to that driver's payroll.
    Tonnes are deliberately absent — a split is only about which drivers + mines."""
    __tablename__ = "truck_load_driver_splits"

    id            = Column(Integer, primary_key=True)
    truck_load_id = Column(Integer, ForeignKey("truck_loads.id", ondelete="CASCADE"), nullable=False)
    driver_id     = Column(Integer, ForeignKey("drivers.id", ondelete="SET NULL"), nullable=True)
    mine_id       = Column(Integer, ForeignKey("mines.id", ondelete="RESTRICT"), nullable=False)
    share         = Column(Numeric(4, 3), nullable=False, default=Decimal("0.5"))
    slip_number   = Column(String(50))
    sort_order    = Column(Integer, default=0)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    truck_load = relationship("TruckLoad", back_populates="driver_splits")
    driver     = relationship("Driver", foreign_keys=[driver_id])
    mine       = relationship("Mine", foreign_keys=[mine_id])


# ── Driver Salary Config ───────────────────────────────────────────────────────

class DriverSalaryConfig(Base):
    """Versioned salary config per driver. Each update creates a new row; the old one is deactivated."""
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
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity")
    truck = relationship("Truck")


# ── Diesel Module ─────────────────────────────────────────────────────────────

class DieselSettings(Base):
    """Per-entity diesel admin fee configuration."""
    __tablename__ = "diesel_settings"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False, unique=True)
    admin_fee_pct = Column(Numeric(5, 4), nullable=False, default=0)
    apply_admin_fee = Column(Boolean, nullable=False, default=True)
    additional_charge_per_ton = Column(Numeric(10, 2), nullable=False, default=0)
    subcontractor_monthly_admin_fee = Column(Numeric(10, 2), nullable=False, default=0, server_default='0')
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    entity = relationship("BusinessEntity")
    updater = relationship("User", foreign_keys=[updated_by])


class DieselRate(Base):
    """Versioned price-per-litre per supplier/entity. A new row is added when the rate changes."""
    __tablename__ = "diesel_rates"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False)
    rate_per_litre = Column(Numeric(10, 4), nullable=False)
    additional_charge_per_ton = Column(Numeric(10, 2), nullable=False, default=0)
    effective_date = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    notes = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    entity = relationship("BusinessEntity")
    supplier = relationship("Supplier")
    creator = relationship("User", foreign_keys=[created_by])


class DieselFillUp(Base):
    """A single diesel fill-up transaction."""
    __tablename__ = "diesel_fillups"

    id = Column(Integer, primary_key=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)
    truck_id = Column(Integer, ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False)

    fillup_date = Column(Date, nullable=False)
    litres = Column(Numeric(10, 2), nullable=False)
    rate_per_litre = Column(Numeric(10, 4), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)           # litres × rate
    admin_fee_pct = Column(Numeric(5, 4), nullable=False, default=0)
    admin_fee_amount = Column(Numeric(12, 2), nullable=False, default=0)  # excl VAT
    admin_fee_vat = Column(Numeric(12, 2), nullable=False, default=0, server_default='0')  # VAT on admin fee
    total_amount = Column(Numeric(12, 2), nullable=False)     # amount + admin_fee_amount + admin_fee_vat

    invoice_number = Column(String(100))
    slip_number = Column(String(100))
    truckload_id = Column(Integer, ForeignKey("truck_loads.id", ondelete="SET NULL"), nullable=True)
    supplier_invoice_id = Column(Integer, ForeignKey("supplier_invoices.id", ondelete="SET NULL"), nullable=True)
    is_archived  = Column(Boolean, nullable=False, default=False)

    verified     = Column(Boolean, nullable=False, default=False)
    verified_by  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_at  = Column(DateTime(timezone=True))
    verified2_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified2_at = Column(DateTime(timezone=True))
    verified3_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified3_at = Column(DateTime(timezone=True))

    diesel_type = Column(String(10), nullable=False, default='fillup', server_default='fillup')
    notes = Column(Text)
    # driver_name reserved for TruckLoad; not stored on DieselFillUp until Loads import is confirmed
    # driver_name = Column(String(200), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity           = relationship("BusinessEntity")
    truck            = relationship("Truck")
    supplier         = relationship("Supplier")
    truckload        = relationship("TruckLoad")
    supplier_invoice = relationship("SupplierInvoice", back_populates="diesel_fillups")
    verifier         = relationship("User", foreign_keys=[verified_by])
    verifier2        = relationship("User", foreign_keys=[verified2_by])
    creator          = relationship("User", foreign_keys=[created_by])


# ── Payroll Entries (auto-draft workflow) ─────────────────────────────────────

class PayrollEntry(Base):
    """
    One record per driver per calendar month. Created automatically when the
    first truckload for that driver/month is captured; updated on every
    subsequent truckload change while still in auto_draft. Once advanced past
    auto_draft the truckload_changed flag is raised instead of overwriting.

    Status machine: auto_draft → pending_review → verified → paid
    """
    __tablename__ = "payroll_entries"
    __table_args__ = (
        UniqueConstraint("driver_id", "pay_month", "pay_year", name="uq_payroll_entry_driver_month"),
    )

    id                      = Column(Integer, primary_key=True, index=True)
    entity_id               = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)
    driver_id               = Column(Integer, ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False)
    pay_month               = Column(Integer, nullable=False)
    pay_year                = Column(Integer, nullable=False)

    status                  = Column(Enum(PayrollStatus), nullable=False, default=PayrollStatus.auto_draft)

    payroll_settings_id     = Column(Integer, ForeignKey("payroll_settings.id", ondelete="RESTRICT"), nullable=True)

    # Load counts
    lohatla_base_loads      = Column(Integer, nullable=False, default=0)
    lohatla_extra_loads     = Column(Integer, nullable=False, default=0)
    lohatla_total_loads     = Column(Integer, nullable=False, default=0)

    # Computed income
    basic_salary            = Column(Numeric(12, 2), nullable=False, default=0)
    load_earnings           = Column(Numeric(12, 2), nullable=False, default=0)
    subsistence             = Column(Numeric(12, 2), nullable=False, default=0)
    assmang_bonus           = Column(Numeric(12, 2), nullable=False, default=0)
    additional_income       = Column(Numeric(12, 2), nullable=False, default=0)
    gross                   = Column(Numeric(12, 2), nullable=False, default=0)

    # Statutory deductions (permanent only; casual rows store 0)
    nbcrfli                 = Column(Numeric(12, 2), nullable=False, default=0)
    provident               = Column(Numeric(12, 2), nullable=False, default=0)
    wellness                = Column(Numeric(12, 2), nullable=False, default=0)
    sick_fund               = Column(Numeric(12, 2), nullable=False, default=0)
    holiday_fund            = Column(Numeric(12, 2), nullable=False, default=0)
    leave_pay               = Column(Numeric(12, 2), nullable=False, default=0)
    paye                    = Column(Numeric(12, 2), nullable=False, default=0)
    uif                     = Column(Numeric(12, 2), nullable=False, default=0)
    total_statutory         = Column(Numeric(12, 2), nullable=False, default=0)

    # Manual deductions (editable at any status)
    subsistence_advance     = Column(Numeric(12, 2), nullable=False, default=0)
    staff_loan_deduction    = Column(Numeric(12, 2), nullable=False, default=0)
    cash_advance_deduction  = Column(Numeric(12, 2), nullable=False, default=0)

    total_deductions        = Column(Numeric(12, 2), nullable=False, default=0)
    net_payable             = Column(Numeric(12, 2), nullable=False, default=0)

    # Warning flag: truckload edited/deleted after entry moved past auto_draft
    truckload_changed       = Column(Boolean, nullable=False, default=False)
    truckload_changed_note  = Column(Text, nullable=True)

    # Payment info
    payment_date            = Column(Date, nullable=True)
    payment_reference       = Column(String(200), nullable=True)

    comments                = Column(Text, nullable=True)

    # Workflow audit
    reviewed_by             = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at             = Column(DateTime(timezone=True), nullable=True)
    verified_by             = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_at             = Column(DateTime(timezone=True), nullable=True)

    created_at              = Column(DateTime(timezone=True), server_default=func.now())
    updated_at              = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    # Relationships
    driver                  = relationship("Driver", back_populates="payroll_entries")
    entity                  = relationship("BusinessEntity")
    payroll_settings        = relationship("PayrollSettings")
    reviewer                = relationship("User", foreign_keys=[reviewed_by])
    verifier                = relationship("User", foreign_keys=[verified_by])


# ── Licence Alert Acknowledgments ─────────────────────────────────────────────

class LicenceAlertAck(Base):
    __tablename__ = "licence_alert_acks"

    id                  = Column(Integer, primary_key=True)
    resource_type       = Column(String(30), nullable=False)   # truck | trailer | personal_vehicle
    resource_id         = Column(Integer, nullable=False)
    acknowledged_expiry = Column(DateTime(timezone=True), nullable=False)
    acknowledged_by     = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    acknowledged_at     = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("resource_type", "resource_id", "acknowledged_expiry"),)
