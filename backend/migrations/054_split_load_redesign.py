"""Redesign split loads: drop truck_load_lines, add split_group_id and driver_id to truck_loads."""
from sqlalchemy import text


def upgrade(conn):
    # Remove the old split-lines table (added in 053, empty before production deploy)
    try:
        conn.execute(text("DROP TABLE IF EXISTS truck_load_lines"))
    except Exception:
        pass

    # Each split load now carries its own driver FK
    try:
        conn.execute(text(
            "ALTER TABLE truck_loads ADD COLUMN driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL"
        ))
    except Exception:
        pass

    # Two split loads share the same split_group_id (= id of the first load in the pair)
    try:
        conn.execute(text(
            "ALTER TABLE truck_loads ADD COLUMN split_group_id INTEGER"
        ))
    except Exception:
        pass

    conn.commit()
