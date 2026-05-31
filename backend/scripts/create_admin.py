"""
create_admin.py
===============
Creates a new admin user in the database (local SQLite or Supabase).

Run from the backend/ directory:

    python scripts/create_admin.py

Edit the USER block below before running.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_env_file = Path(__file__).resolve().parents[1] / ".env"
if _env_file.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_file, override=False)

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models.models import Base, User, UserEntityAccess
from app.core.security import get_password_hash

# ── Edit these before running ─────────────────────────────────────────────────

EMAIL     = "engelbrecht.larissa@gmail.com"
FULL_NAME = "Larissa Engelbrecht"
PASSWORD  = "Admin@1234!"          # Change this to something you'll remember

# ─────────────────────────────────────────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in .env")
    sys.exit(1)

engine = create_engine(DATABASE_URL, echo=False)

with Session(bind=engine) as db:
    existing = db.query(User).filter(User.email == EMAIL).first()
    if existing:
        print(f"User '{EMAIL}' already exists (id={existing.id}, role={existing.role}).")
        print("If you need to reset the password, run with RESET=1:")
        print("  RESET=1 python scripts/create_admin.py")
        if os.environ.get("RESET") == "1":
            existing.hashed_password = get_password_hash(PASSWORD)
            existing.role = "admin"
            existing.is_active = True
            db.commit()
            print(f"  Password reset for '{EMAIL}'.")
        sys.exit(0)

    user = User(
        email=EMAIL,
        full_name=FULL_NAME,
        hashed_password=get_password_hash(PASSWORD),
        role="admin",
        is_active=True,
    )
    db.add(user)
    db.flush()  # get user.id

    # Grant full access to all 6 entities
    for entity_id in range(1, 7):
        db.add(UserEntityAccess(
            user_id=user.id,
            entity_id=entity_id,
            can_create=True,
            can_edit=True,
            can_delete=True,
            allowed_modules=["clients", "invoices", "suppliers", "fleet", "diesel"],
        ))

    db.commit()
    print(f"Admin user created:")
    print(f"  Email:    {EMAIL}")
    print(f"  Password: {PASSWORD}")
    print(f"  Role:     admin")
    print(f"  Entities: 1–6 (full access)")
    print()
    print("Log in and change your password via Settings > Profile.")
