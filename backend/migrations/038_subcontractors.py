"""
Migration 038: Create subcontractors table and add subcontractor_id FK to trucks.

Subcontractors replaces the free-text operator/subcontractor_name approach with
proper CRUD-managed records linked to trucks via FK.

SQLite: applied by upgrade() — safe to re-run.

PostgreSQL / Supabase — run manually in the SQL editor:

    CREATE TABLE IF NOT EXISTS subcontractors (
        id                  SERIAL PRIMARY KEY,
        entity_id           INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
        name                VARCHAR(300) NOT NULL,
        trading_name        VARCHAR(300),
        contact_person      VARCHAR(200),
        email               VARCHAR(200),
        phone               VARCHAR(50),
        registration_number VARCHAR(100),
        vat_number          VARCHAR(50),
        notes               TEXT,
        is_active           BOOLEAN NOT NULL DEFAULT TRUE,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ
    );

    ALTER TABLE trucks
        ADD COLUMN IF NOT EXISTS subcontractor_id INTEGER
        REFERENCES subcontractors(id) ON DELETE SET NULL;

    SELECT setval('subcontractors_id_seq', 1, false);
"""

from sqlalchemy import text


def upgrade(conn):
    # Create subcontractors table
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS subcontractors (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id           INTEGER NOT NULL
                    REFERENCES business_entities(id) ON DELETE CASCADE,
                name                VARCHAR(300) NOT NULL,
                trading_name        VARCHAR(300),
                contact_person      VARCHAR(200),
                email               VARCHAR(200),
                phone               VARCHAR(50),
                registration_number VARCHAR(100),
                vat_number          VARCHAR(50),
                notes               TEXT,
                is_active           BOOLEAN NOT NULL DEFAULT 1,
                created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at          DATETIME
            )
        """))
    except Exception:
        pass

    # Add FK column to trucks (no inline REFERENCES — SQLite compat)
    try:
        conn.execute(text(
            "ALTER TABLE trucks ADD COLUMN subcontractor_id INTEGER"
        ))
    except Exception:
        pass

    conn.commit()
