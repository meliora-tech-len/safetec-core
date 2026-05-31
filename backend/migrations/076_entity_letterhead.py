"""Add letterhead_url and letterhead_path to business_entities"""
from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("ALTER TABLE business_entities ADD COLUMN letterhead_url VARCHAR(500)"))
    conn.execute(text("ALTER TABLE business_entities ADD COLUMN letterhead_path VARCHAR(500)"))
