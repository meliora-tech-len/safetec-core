from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey,
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
