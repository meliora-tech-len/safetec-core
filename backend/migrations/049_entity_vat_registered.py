"""Add vat_registered flag to business_entities. Default TRUE for all, FALSE for BKMO."""
from sqlalchemy import text

def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE business_entities
        ADD COLUMN IF NOT EXISTS vat_registered BOOLEAN NOT NULL DEFAULT TRUE
    """))
    conn.execute(text("""
        UPDATE business_entities SET vat_registered = FALSE WHERE code = 'BKMO'
    """))
    conn.commit()
