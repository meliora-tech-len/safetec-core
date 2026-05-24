from sqlalchemy import text


def upgrade(conn):
    # Mark trucks as is_subcontractor=True when their entity is a subcontractor entity
    conn.execute(text("""
        UPDATE trucks
        SET is_subcontractor = TRUE
        WHERE entity_id IN (
            SELECT id FROM business_entities WHERE is_subcontractor_entity = TRUE
        )
        AND is_subcontractor = FALSE
    """))
    conn.commit()
