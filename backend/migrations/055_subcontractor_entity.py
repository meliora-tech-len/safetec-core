from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        ALTER TABLE business_entities
          ADD COLUMN IF NOT EXISTS is_subcontractor_entity BOOLEAN NOT NULL DEFAULT FALSE
    """))
    conn.execute(text("""
        ALTER TABLE business_entities
          ADD COLUMN IF NOT EXISTS linked_subcontractor_id INTEGER
            REFERENCES subcontractors(id) ON DELETE SET NULL
    """))
    conn.commit()
