"""
Migration 107: budget line templates ("constants").

A recurring "usual" line every budget should carry (e.g. Travel & Accom,
Provisional Tax, Bank Charges) — admin-managed, applies across every entity.
Seeded on budget creation and added by "Pull from system" if a budget is
missing one (e.g. it was added to the template list after the budget already
existed). Replaces the previous hardcoded DEFAULT_OTHER_LINES constant.
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS budget_line_templates (
            id SERIAL PRIMARY KEY,
            name VARCHAR(300) NOT NULL,
            section_name VARCHAR(200) NOT NULL,
            sort_order INTEGER DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE
        )
    """))

    # Seed the three "usuals" that used to be hardcoded — only if the table is empty,
    # so a re-run doesn't recreate rows a user has since edited/deleted.
    existing = conn.execute(text("SELECT COUNT(*) FROM budget_line_templates")).scalar()
    if not existing:
        conn.execute(text("""
            INSERT INTO budget_line_templates (name, section_name, sort_order, is_active)
            VALUES
                ('Travel & Accom',  'OTHER', 0, TRUE),
                ('Provisional Tax', 'OTHER', 1, TRUE),
                ('Bank Charges',    'OTHER', 2, TRUE)
        """))
    conn.commit()
