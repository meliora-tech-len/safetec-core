"""
seed.py — Populate the database with initial business entities and admin user.
Run: python seed.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db.database import SessionLocal, engine
from app.models.models import Base, User, BusinessEntity, UserEntityAccess, UserRole, Supplier, AppSetting
from app.core.security import get_password_hash

Base.metadata.create_all(bind=engine)


_GQEBERHA_ADDRESS = "16 Lower Valley Road\nSouth End\nGqeberha\nEastern Cape\n6001"
_GQEBERHA_PHONE   = "041 008 5009"

ENTITIES = [
    {
        "code": "BTP",
        "name": "Border Tradepost (Pty) Ltd",
        "trading_name": "Border Tradepost",
        "invoice_prefix": "BTP",
        "email": "admin@btpo.co.za",
        "phone": _GQEBERHA_PHONE,
        "address": _GQEBERHA_ADDRESS,
        "bank_name": "Standard Bank",
        "bank_branch": "Walmer",
        "vat_rate": 0.15,
        "vat_number": "4123456789",
        "registration_number": "2020/123456/07",
    },
    {
        "code": "OBHI",
        "name": "OBHI (Pty) Ltd",
        "trading_name": "OBHI",
        "invoice_prefix": "OBHI",
        "email": "admin@obhi.co.za",
        "phone": _GQEBERHA_PHONE,
        "address": _GQEBERHA_ADDRESS,
        "bank_name": "Standard Bank",
        "bank_branch": "051001",
        "bank_account_number": "33 335 32 69",
        "bank_branch_code": "051001",
        "bank_reference": "INVOICE NO",
        "vat_rate": 0.15,
        "vat_number": "4234567890",
        "registration_number": "2019/234567/07",
    },
    {
        "code": "SFT",
        "name": "Safetec (Pty) Ltd",
        "trading_name": "Safetec",
        "invoice_prefix": "SFT",
        "email": "admin@safetec.co.za",
        "phone": _GQEBERHA_PHONE,
        "address": _GQEBERHA_ADDRESS,
        "bank_name": "Standard Bank",
        "bank_branch": "Walmer",
        "bank_account_number": "080096832",
        "vat_rate": 0.15,
        "vat_number": "4345678901",
        "registration_number": "2018/345678/07",
    },
    {
        "code": "TP",
        "name": "Thembis People (Pty) Ltd",
        "trading_name": "Thembis People",
        "invoice_prefix": "TP",
        "email": "admin@thembis.co.za",
        "phone": _GQEBERHA_PHONE,
        "address": _GQEBERHA_ADDRESS,
        "bank_name": "Standard Bank",
        "bank_branch": "Walmer",
        "bank_account_number": "061446211",
        "vat_rate": 0.15,
        "vat_number": "4456789012",
        "registration_number": "2017/456789/07",
    },
    {
        "code": "BKMO",
        "name": "Bokamosho (Pty) Ltd",
        "trading_name": "Bokamosho",
        "invoice_prefix": "BKMO",
        "email": "admin@bokamosho.co.za",
        "phone": "068 884 7098",
        "address": "2400 Industrial Road\nOlifantshoek\nNorthern Cape\n8450",
        "bank_name": "Standard Bank",
        "vat_rate": 0.15,
        "vat_number": "4567890123",
        "registration_number": "2021/567890/07",
    },
]

# Sample external suppliers for demo purposes
EXTERNAL_SUPPLIERS = [
    {
        "name": "ABC Mining Corporation",
        "trading_name": "ABC Mining",
        "contact_person": "John Smith",
        "email": "john.smith@abcmining.co.za",
        "phone": "+27 41 582 3456",
        "vat_number": "4987654321",
        "registration_number": "2015/987654/07",
        "address": "45 Industrial Road, Port Elizabeth, 6001",
    },
    {
        "name": "XYZ Logistics (Pty) Ltd",
        "trading_name": "XYZ Logistics",
        "contact_person": "Sarah Johnson",
        "email": "sarah@xyzlogistics.co.za",
        "phone": "+27 41 585 7890",
        "vat_number": "4876543210",
        "registration_number": "2016/876543/07",
        "address": "22 Transport Avenue, Uitenhage, 6229",
    },
    {
        "name": "Nelson Mandela Bay Municipality",
        "contact_person": "David Williams",
        "email": "d.williams@nmbm.gov.za",
        "phone": "+27 41 506 2000",
        "vat_number": "4765432109",
        "address": "City Hall, Govan Mbeki Avenue, Port Elizabeth, 6001",
    },
]


def seed():
    db = SessionLocal()
    try:
        print("Seeding database...")

        # Seed entities
        entities = []
        for e_data in ENTITIES:
            existing = db.query(BusinessEntity).filter(BusinessEntity.code == e_data["code"]).first()
            if not existing:
                entity = BusinessEntity(**e_data)
                db.add(entity)
                db.flush()
                print(f"  Created entity: {entity.name}")
                entities.append(entity)
            else:
                print(f"  Entity exists: {existing.name}")
                entities.append(existing)

        db.commit()

        # Now add each business as a supplier to ALL entities (including itself for inter-company invoicing)
        print("\nAdding business entities as suppliers...")
        for entity in entities:
            for business in entities:
                existing_supplier = db.query(Supplier).filter(
                    Supplier.entity_id == entity.id,
                    Supplier.name == business.name
                ).first()

                if not existing_supplier:
                    supplier = Supplier(
                        entity_id=entity.id,
                        name=business.name,
                        trading_name=business.trading_name,
                        registration_number=business.registration_number,
                        vat_number=business.vat_number,
                        email=business.email,
                        phone=business.phone,
                        notes=f"Inter-company supplier (Entity: {business.code})",
                    )
                    db.add(supplier)
                    print(f"  Added {business.code} as supplier to {entity.code}")

        db.commit()

        # Add some external suppliers to a few entities for variety
        print("\nAdding external suppliers for demo...")
        for i, supplier_data in enumerate(EXTERNAL_SUPPLIERS):
            # Add to first 3 entities for demo
            for entity in entities[:3]:
                existing = db.query(Supplier).filter(
                    Supplier.entity_id == entity.id,
                    Supplier.name == supplier_data["name"]
                ).first()

                if not existing:
                    supplier = Supplier(
                        entity_id=entity.id,
                        **supplier_data
                    )
                    db.add(supplier)
                    print(f"  Added {supplier_data['name']} to {entity.code}")

        db.commit()

        # Seed admin user
        admin = db.query(User).filter(User.email == "admin@safetec.co.za").first()
        if not admin:
            admin = User(
                email="admin@safetec.co.za",
                full_name="System Administrator",
                hashed_password=get_password_hash("Admin@1234!"),
                role=UserRole.admin,
            )
            db.add(admin)
            db.flush()
            print(f"\nCreated admin user: admin@safetec.co.za / Admin@1234!")
            print("    WARNING: CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN")
        else:
            print(f"\n  Admin user already exists")

        db.commit()

        # Seed default app settings
        print("\nSeeding app settings...")
        default_settings = [
            {"key": "vat_rate",        "value": "0.15",                                                  "label": "Global VAT Rate",   "category": "billing"},
            {"key": "roles",           "value": '["admin", "standard"]',                                  "label": "User Roles",        "category": "system"},
            {"key": "invoice_modules", "value": '["suppliers","invoices","fleet","diesel"]',               "label": "Available Modules", "category": "system"},
        ]
        for s in default_settings:
            if not db.query(AppSetting).filter(AppSetting.key == s["key"]).first():
                db.add(AppSetting(**s))
                print(f"  Created setting: {s['key']}")
            else:
                print(f"  Setting exists: {s['key']}")
        db.commit()

        # Grant admin access to all entities
        print("\nAssigning entity access to admin...")
        all_modules = ["suppliers", "invoices", "fleet", "diesel"]
        for entity in entities:
            existing_access = db.query(UserEntityAccess).filter(
                UserEntityAccess.user_id == admin.id,
                UserEntityAccess.entity_id == entity.id,
            ).first()
            if not existing_access:
                db.add(UserEntityAccess(
                    user_id=admin.id,
                    entity_id=entity.id,
                    can_create=True,
                    can_edit=True,
                    can_delete=True,
                    allowed_modules=all_modules,
                ))
                print(f"  Granted admin access to {entity.code}")
        db.commit()

        # Count totals
        total_suppliers = db.query(Supplier).count()
        print(f"\nSeed complete.")
        print(f"   Entities: {len(entities)}")
        print(f"   Suppliers: {total_suppliers} (includes {len(entities)} inter-company + {len(EXTERNAL_SUPPLIERS) * 3} external)")
        print(f"   Admin: admin@safetec.co.za")

    except Exception as e:
        db.rollback()
        print(f"Seed failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
