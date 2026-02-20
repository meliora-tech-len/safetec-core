"""
seed.py — Populate the database with initial business entities and admin user.
Run: python seed.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db.database import SessionLocal, engine
from app.models.models import Base, User, BusinessEntity, UserEntityAccess, UserRole, Client
from app.core.security import get_password_hash

Base.metadata.create_all(bind=engine)


ENTITIES = [
    {
        "code": "BTP",
        "name": "Border Tradepost (Pty) Ltd",
        "trading_name": "Border Tradepost",
        "invoice_prefix": "BTP",
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
        "bank_name": "Standard Bank",
        "vat_rate": 0.15,
        "vat_number": "4567890123",
        "registration_number": "2021/567890/07",
    },
]

# Sample external clients for demo purposes
EXTERNAL_CLIENTS = [
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
        print("🌱 Seeding database...")
        
        # Seed entities
        entities = []
        for e_data in ENTITIES:
            existing = db.query(BusinessEntity).filter(BusinessEntity.code == e_data["code"]).first()
            if not existing:
                entity = BusinessEntity(**e_data)
                db.add(entity)
                db.flush()
                print(f"  ✓ Created entity: {entity.name}")
                entities.append(entity)
            else:
                print(f"  - Entity exists: {existing.name}")
                entities.append(existing)
        
        db.commit()
        
        # Now add each business as a client to ALL entities (including itself for inter-company invoicing)
        print("\n📋 Adding business entities as clients...")
        for entity in entities:
            for business in entities:
                # Check if this business is already a client of this entity
                existing_client = db.query(Client).filter(
                    Client.entity_id == entity.id,
                    Client.name == business.name
                ).first()
                
                if not existing_client:
                    client = Client(
                        entity_id=entity.id,
                        name=business.name,
                        trading_name=business.trading_name,
                        registration_number=business.registration_number,
                        vat_number=business.vat_number,
                        email=business.email,
                        phone=business.phone,
                        notes=f"Inter-company client (Entity: {business.code})",
                    )
                    db.add(client)
                    print(f"  ✓ Added {business.code} as client to {entity.code}")
        
        db.commit()
        
        # Add some external clients to a few entities for variety
        print("\n👥 Adding external clients for demo...")
        for i, client_data in enumerate(EXTERNAL_CLIENTS):
            # Add to first 3 entities for demo
            for entity in entities[:3]:
                existing = db.query(Client).filter(
                    Client.entity_id == entity.id,
                    Client.name == client_data["name"]
                ).first()
                
                if not existing:
                    client = Client(
                        entity_id=entity.id,
                        **client_data
                    )
                    db.add(client)
                    print(f"  ✓ Added {client_data['name']} to {entity.code}")
        
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
            print(f"\n👤 Created admin user: admin@safetec.co.za / Admin@1234!")
            print("    ⚠️  CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN")
        else:
            print(f"\n  - Admin user already exists")

        db.commit()
        
        # Count totals
        total_clients = db.query(Client).count()
        print(f"\n✅ Seed complete.")
        print(f"   Entities: {len(entities)}")
        print(f"   Clients: {total_clients} (includes {len(entities)} inter-company + {len(EXTERNAL_CLIENTS) * 3} external)")
        print(f"   Admin: admin@safetec.co.za")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Seed failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()