"""Migration 084: backfill diesel_type by supplier.

Business rule (single source of truth: diesel_service.diesel_type_for_supplier):
Merino & Oukop fill-ups are always 'topup'; WBG Diesel is always 'fillup'.
Existing rows pre-date the auto-tagging, so align them here. Other suppliers
are left untouched (no fixed rule).

Uses plain '<>' / 'IS NULL' (not 'IS DISTINCT FROM') so it runs on both
SQLite (dev) and PostgreSQL (prod).
"""
from sqlalchemy import text


def upgrade(conn):
    # Merino & Oukop -> topup
    conn.execute(text("""
        UPDATE diesel_fillups
        SET diesel_type = 'topup'
        WHERE supplier_id IN (
            SELECT id FROM suppliers
            WHERE LOWER(name) LIKE '%merino%'
               OR LOWER(name) LIKE '%oukop%'
               OR LOWER(COALESCE(short_name, '')) LIKE '%merino%'
               OR LOWER(COALESCE(short_name, '')) LIKE '%oukop%'
        )
        AND (diesel_type <> 'topup' OR diesel_type IS NULL)
    """))

    # WBG Diesel -> fillup
    conn.execute(text("""
        UPDATE diesel_fillups
        SET diesel_type = 'fillup'
        WHERE supplier_id IN (
            SELECT id FROM suppliers
            WHERE LOWER(name) LIKE '%wbg%'
               OR LOWER(COALESCE(short_name, '')) LIKE '%wbg%'
        )
        AND (diesel_type <> 'fillup' OR diesel_type IS NULL)
    """))

    conn.commit()
