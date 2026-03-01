"""
Migration 001: Add branding, module permissions, and app settings
Run once against your Supabase PostgreSQL database.

Usage:
  python migrations/001_add_branding_permissions_settings.py
"""

import os
import sys
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable not set")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

MIGRATIONS = [
    # ── BusinessEntity: branding columns ─────────────────────────────────────
    """
    ALTER TABLE business_entities
      ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) DEFAULT '#2563eb',
      ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);
    """,

    # ── BusinessEntity: rename logo_path -> keep both for compatibility ───────
    # (logo_url is the Supabase Storage public URL; logo_path kept for legacy)

    # ── BusinessEntity: invoice/quote number editable ─────────────────────────
    # invoice_prefix & invoice_counter already exist; add quote_prefix
    """
    ALTER TABLE business_entities
      ADD COLUMN IF NOT EXISTS quote_prefix VARCHAR(10) DEFAULT 'QT';
    """,

    # ── UserEntityAccess: module-level permissions ────────────────────────────
    """
    ALTER TABLE user_entity_access
      ADD COLUMN IF NOT EXISTS allowed_modules JSONB DEFAULT '[]'::jsonb;
    """,

    # ── Invoice: non-vat at invoice level ─────────────────────────────────────
    """
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS is_vat_exempt BOOLEAN DEFAULT FALSE;
    """,

    # ── InvoiceLineItem: non-vat at line level ────────────────────────────────
    """
    ALTER TABLE invoice_line_items
      ADD COLUMN IF NOT EXISTS is_vat_exempt BOOLEAN DEFAULT FALSE;
    """,

    # ── AppSettings table ─────────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS app_settings (
      id          SERIAL PRIMARY KEY,
      key         VARCHAR(100) UNIQUE NOT NULL,
      value       TEXT NOT NULL,
      label       VARCHAR(200),
      category    VARCHAR(50) DEFAULT 'system',
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT now(),
      updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    """,

    # ── Seed default settings ─────────────────────────────────────────────────
    """
    INSERT INTO app_settings (key, value, label, category) VALUES
      ('vat_rate',        '0.15',                                    'Global VAT Rate',     'billing'),
      ('roles',           '["admin", "management", "standard"]',     'User Roles',          'system'),
      ('invoice_modules', '["clients","invoices","suppliers","fleet","diesel"]', 'Available Modules', 'system')
    ON CONFLICT (key) DO NOTHING;
    """,
]


def run():
    with engine.connect() as conn:
        for i, sql in enumerate(MIGRATIONS, 1):
            try:
                conn.execute(text(sql.strip()))
                conn.commit()
                print(f"  ✓ Step {i} complete")
            except Exception as e:
                conn.rollback()
                print(f"  ✗ Step {i} failed: {e}")
                raise

    print("\n✅ Migration complete")


if __name__ == "__main__":
    print("Running migration 001...")
    run()
