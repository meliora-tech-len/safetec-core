"""Migration 130: backfill diesel_type for ALL suppliers.

Business rule (single source of truth: diesel_service.diesel_type_for_supplier):
Merino & Oukop fill-ups are always 'topup'; EVERY other supplier is 'fillup'.

Migration 084 aligned Merino/Oukop and WBG only, leaving other suppliers'
rows (Intsimbi, Tradekor, ...) with whatever tag they were captured under —
and the manual capture form let the tag be toggled by hand, so wrong tags
exist on both sides. Align everything with the fixed rule.

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

    # Everyone else (including rows with no supplier at all) -> fillup
    conn.execute(text("""
        UPDATE diesel_fillups
        SET diesel_type = 'fillup'
        WHERE (supplier_id IS NULL OR supplier_id NOT IN (
            SELECT id FROM suppliers
            WHERE LOWER(name) LIKE '%merino%'
               OR LOWER(name) LIKE '%oukop%'
               OR LOWER(COALESCE(short_name, '')) LIKE '%merino%'
               OR LOWER(COALESCE(short_name, '')) LIKE '%oukop%'
        ))
        AND (diesel_type <> 'fillup' OR diesel_type IS NULL)
    """))

    conn.commit()
