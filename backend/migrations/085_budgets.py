"""Migration 085: Budgets module.

Entity cash-flow budgets mirroring the Excel budget sheets:
budgets -> budget_sections -> budget_lines -> budget_line_values
(values keyed by line+month+year, holding TO PAY / PAID amounts).

Budget access is a per-user, per-entity module permission: 'budgets' in
user_entity_access.allowed_modules (JSON) — no schema change needed there,
existing users simply don't have it until granted.

SQLite dev gets these tables from Base.metadata.create_all; this script is
for PostgreSQL/Supabase prod.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS budgets (
            id SERIAL PRIMARY KEY,
            entity_id INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            name VARCHAR(200),
            period_month INTEGER NOT NULL,
            period_year INTEGER NOT NULL,
            status VARCHAR(20) DEFAULT 'active',
            notes TEXT,
            created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ,
            UNIQUE (entity_id, period_month, period_year)
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budgets_entity_id ON budgets(entity_id)"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS budget_sections (
            id SERIAL PRIMARY KEY,
            budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
            name VARCHAR(200) NOT NULL,
            section_type VARCHAR(20) DEFAULT 'expense',
            sort_order INTEGER DEFAULT 0
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budget_sections_budget_id ON budget_sections(budget_id)"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS budget_lines (
            id SERIAL PRIMARY KEY,
            section_id INTEGER NOT NULL REFERENCES budget_sections(id) ON DELETE CASCADE,
            name VARCHAR(300) NOT NULL,
            notes TEXT,
            sort_order INTEGER DEFAULT 0
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budget_lines_section_id ON budget_lines(section_id)"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS budget_line_values (
            id SERIAL PRIMARY KEY,
            line_id INTEGER NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
            month INTEGER NOT NULL,
            year INTEGER NOT NULL,
            amount_due NUMERIC(15, 2),
            amount_paid NUMERIC(15, 2),
            UNIQUE (line_id, month, year)
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budget_line_values_line_id ON budget_line_values(line_id)"))
