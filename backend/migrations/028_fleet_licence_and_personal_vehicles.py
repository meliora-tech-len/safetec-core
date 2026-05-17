"""
Migration 028: Add licence fields to trailers + create personal_vehicles table.

SQLite: applied by upgrade() — safe to re-run.
PostgreSQL/Supabase: run the SQL block manually via the SQL editor.
"""

from sqlalchemy import text


def _add(conn, sql):
    try:
        conn.execute(text(sql))
    except Exception:
        pass  # column or table already exists


def upgrade(conn):
    _add(conn, "ALTER TABLE trailers ADD COLUMN licence_number VARCHAR(100)")
    _add(conn, "ALTER TABLE trailers ADD COLUMN licence_expiry DATETIME")
    _add(conn, """
        CREATE TABLE IF NOT EXISTS personal_vehicles (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id    INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
            owner        VARCHAR(100),
            vehicle_type VARCHAR(200) NOT NULL,
            year         INTEGER,
            registration VARCHAR(50),
            licence_number VARCHAR(100),
            licence_expiry DATETIME,
            status       VARCHAR(50) NOT NULL DEFAULT 'active',
            notes        TEXT,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at   DATETIME
        )
    """)
    conn.commit()


# ── PostgreSQL equivalent (run manually in Supabase SQL editor) ───────────────
#
# ALTER TABLE trailers ADD COLUMN IF NOT EXISTS licence_number VARCHAR(100);
# ALTER TABLE trailers ADD COLUMN IF NOT EXISTS licence_expiry TIMESTAMPTZ;
#
# CREATE TABLE IF NOT EXISTS personal_vehicles (
#     id           SERIAL PRIMARY KEY,
#     entity_id    INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
#     owner        VARCHAR(100),
#     vehicle_type VARCHAR(200) NOT NULL,
#     year         INTEGER,
#     registration VARCHAR(50),
#     licence_number VARCHAR(100),
#     licence_expiry TIMESTAMPTZ,
#     status       VARCHAR(50) NOT NULL DEFAULT 'active',
#     notes        TEXT,
#     created_at   TIMESTAMPTZ DEFAULT NOW(),
#     updated_at   TIMESTAMPTZ
# );
