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
    code = Column(String(20), unique=True, nullable=False)  # OBHI, SFT, TP, BTP, BKMO, KS
    name = Column(String(200), nullable=False)
    trading_name = Column(String(200))
    registration_number = Column(String(100))
    vat_number = Column(String(50))
    address = Column(Text)
    phone = Column(String(50))
    email = Column(String(200))
    bank_name = Column(String(100))
    bank_branch = Column(String(100))
    bank_account_number = Column(String(50))
    bank_branch_code = Column(String(20))
    bank_reference = Column(String(200))
    logo_path = Column(String(500))
    invoice_prefix = Column(String(10))       # OBHI, SFT, TP, etc.
    invoice_counter = Column(Integer, default=0)
    quote_counter = Column(Integer, default=0)
    vat_rate = Column(Numeric(5, 4), default=0.15)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    clients = relationship("Client", back_populates="entity")
    invoices = relationship("Invoice", back_populates="entity")
    user_access = relationship("UserEntityAccess", back_populates="entity")


# ── Users & Access Control ────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(200), unique=True, nullable=False, index=True)
    full_name = Column(String(200), nullable=False)
    hashed_password = Column(String(500), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.standard, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True))

    # Relationships
    entity_access = relationship("UserEntityAccess", back_populates="user")
    audit_logs = relationship("AuditLog", back_populates="user")


class UserEntityAccess(Base):
    """Defines which business entities a user can access (RBAC)"""
    __tablename__ = "user_entity_access"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="CASCADE"), nullable=False)
    can_create = Column(Boolean, default=True)
    can_edit = Column(Boolean, default=True)
    can_delete = Column(Boolean, default=False)

    user = relationship("User", back_populates="entity_access")
    entity = relationship("BusinessEntity", back_populates="user_access")


# ── Clients ───────────────────────────────────────────────────────────────────

class Client(Base):
    __tablename__ = "clients"

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

    entity = relationship("BusinessEntity", back_populates="clients")
    invoices = relationship("Invoice", back_populates="client")


# ── Invoices & Line Items ─────────────────────────────────────────────────────

class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="RESTRICT"), nullable=False)
    client_id = Column(Integer, ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False)

    document_type = Column(Enum(DocumentType), default=DocumentType.invoice, nullable=False)
    invoice_number = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(Enum(InvoiceStatus), default=InvoiceStatus.draft, nullable=False)

    issue_date = Column(DateTime(timezone=True), server_default=func.now())
    due_date = Column(DateTime(timezone=True))
    paid_date = Column(DateTime(timezone=True))

    subtotal = Column(Numeric(12, 2), default=0)
    vat_amount = Column(Numeric(12, 2), default=0)
    total = Column(Numeric(12, 2), default=0)
    vat_rate = Column(Numeric(5, 4), default=0.15)

    notes = Column(Text)
    terms = Column(Text)
    created_by_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    entity = relationship("BusinessEntity", back_populates="invoices")
    client = relationship("Client", back_populates="invoices")
    line_items = relationship("InvoiceLineItem", back_populates="invoice", cascade="all, delete-orphan")
    created_by = relationship("User")


class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    description = Column(Text, nullable=False)
    quantity = Column(Numeric(10, 2), default=1)
    unit_price = Column(Numeric(12, 2), default=0)
    amount = Column(Numeric(12, 2), default=0)
    sort_order = Column(Integer, default=0)

    invoice = relationship("Invoice", back_populates="line_items")


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    entity_id = Column(Integer, ForeignKey("business_entities.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=False)   # e.g. "invoice.created", "client.updated"
    resource_type = Column(String(50))             # "invoice", "client", "user"
    resource_id = Column(Integer)
    description = Column(Text)
    ip_address = Column(String(50))
    old_values = Column(JSON)
    new_values = Column(JSON)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="audit_logs")
