from sqlalchemy import text


def upgrade(conn):
    for sql in [
        "ALTER TABLE business_entities ADD COLUMN is_subcontractor_entity BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE business_entities ADD COLUMN linked_subcontractor_id INTEGER REFERENCES subcontractors(id) ON DELETE SET NULL",
    ]:
        try:
            conn.execute(text(sql))
        except Exception:
            pass
    conn.commit()
