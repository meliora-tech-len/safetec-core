"""Add split load support: is_split_load on truck_loads, truck_load_lines table,
and split load count columns on driver_pay_cycles."""
from sqlalchemy import text


def upgrade(conn):
    # is_split_load flag on truck_loads
    try:
        conn.execute(text(
            "ALTER TABLE truck_loads ADD COLUMN is_split_load BOOLEAN NOT NULL DEFAULT FALSE"
        ))
    except Exception:
        pass

    # truck_load_lines table (PostgreSQL)
    try:
        conn.execute(text("""
            CREATE TABLE truck_load_lines (
                id            SERIAL PRIMARY KEY,
                truck_load_id INTEGER NOT NULL REFERENCES truck_loads(id) ON DELETE CASCADE,
                driver_id     INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
                sort_order    INTEGER NOT NULL DEFAULT 0,
                notes         TEXT,
                created_at    TIMESTAMPTZ DEFAULT NOW()
            )
        """))
    except Exception:
        # SQLite fallback
        try:
            conn.execute(text("""
                CREATE TABLE truck_load_lines (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    truck_load_id INTEGER NOT NULL REFERENCES truck_loads(id) ON DELETE CASCADE,
                    driver_id     INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
                    sort_order    INTEGER NOT NULL DEFAULT 0,
                    notes         TEXT,
                    created_at    TEXT DEFAULT (datetime('now'))
                )
            """))
        except Exception:
            pass

    try:
        conn.execute(text(
            "CREATE INDEX ix_truck_load_lines_load_id ON truck_load_lines(truck_load_id)"
        ))
    except Exception:
        pass

    # Split load count columns on driver_pay_cycles
    for col in [
        "ALTER TABLE driver_pay_cycles ADD COLUMN permanent_split_loads INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE driver_pay_cycles ADD COLUMN casual_split_group_a_loads INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE driver_pay_cycles ADD COLUMN casual_split_group_b_loads INTEGER NOT NULL DEFAULT 0",
    ]:
        try:
            conn.execute(text(col))
        except Exception:
            pass

    conn.commit()
