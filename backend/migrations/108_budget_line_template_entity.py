"""
Migration 108: budget line templates can target a single entity.

entity_id NULL keeps the existing "applies to every entity" behaviour (Travel &
Accom, Provisional Tax, etc.). A set entity_id scopes the constant to just that
entity's budgets (e.g. an OBHI-only debit order for a specific truck's finance).
"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text(
        "ALTER TABLE budget_line_templates ADD COLUMN IF NOT EXISTS entity_id "
        "INTEGER REFERENCES business_entities(id) ON DELETE CASCADE"
    ))
    conn.commit()
