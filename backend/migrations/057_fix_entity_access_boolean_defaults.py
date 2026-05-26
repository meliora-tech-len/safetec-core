from sqlalchemy import text


def upgrade(conn):
    # Fix existing NULL rows (inserted via raw SQL without ORM defaults)
    conn.execute(text(
        "UPDATE user_entity_access SET can_create = TRUE WHERE can_create IS NULL"
    ))
    conn.execute(text(
        "UPDATE user_entity_access SET can_edit = TRUE WHERE can_edit IS NULL"
    ))
    conn.execute(text(
        "UPDATE user_entity_access SET can_delete = FALSE WHERE can_delete IS NULL"
    ))
    # Add server-side defaults — PostgreSQL only (SQLite handles defaults at ORM level)
    for sql in [
        "ALTER TABLE user_entity_access ALTER COLUMN can_create SET DEFAULT TRUE",
        "ALTER TABLE user_entity_access ALTER COLUMN can_edit SET DEFAULT TRUE",
        "ALTER TABLE user_entity_access ALTER COLUMN can_delete SET DEFAULT FALSE",
    ]:
        try:
            conn.execute(text(sql))
        except Exception:
            pass
    conn.commit()
