"""Split loads redesign: header/line model.

A split load is now ONE truck_loads row (the main record, carrying the full
tonnes/rate/amount) plus child driver lines in truck_load_driver_splits. Each
driver line credits 0.5 of a load to that driver's payroll. Tonnes play no role
in the split — they stay on the main load only.

This replaces the old two-row scheme (rows paired via split_group_id), which
double-counted tonnes/revenue and credited payroll by counting is_split_load rows.
"""
from sqlalchemy import text


def upgrade(conn):
    # ── New child table: one row per driver involved in a split load ────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS truck_load_driver_splits (
            id            SERIAL PRIMARY KEY,
            truck_load_id INTEGER NOT NULL REFERENCES truck_loads(id) ON DELETE CASCADE,
            driver_id     INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
            mine_id       INTEGER NOT NULL REFERENCES mines(id) ON DELETE RESTRICT,
            share         NUMERIC(4,3) NOT NULL DEFAULT 0.5,
            slip_number   VARCHAR(50),
            sort_order    INTEGER DEFAULT 0,
            created_at    TIMESTAMPTZ DEFAULT now()
        )
    """))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_tlds_load ON truck_load_driver_splits(truck_load_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_tlds_driver ON truck_load_driver_splits(driver_id)"
    ))

    # ── Back-migrate existing split pairs into header/line model ────────────────
    # Old model: each split was two truck_loads rows sharing split_group_id, each
    # carrying its own driver_id + mine_id (and, historically, the full tonnes).
    # We keep the FIRST row of each pair as the surviving main load WITHOUT touching
    # its tonnes/amount, turn both rows' driver+mine into 0.5 driver lines, then
    # delete the second row.
    groups = conn.execute(text("""
        SELECT split_group_id, array_agg(id ORDER BY id) AS ids
        FROM truck_loads
        WHERE is_split_load = TRUE AND split_group_id IS NOT NULL
        GROUP BY split_group_id
    """)).fetchall()

    for grp in groups:
        ids = list(grp[1])
        if not ids:
            continue
        survivor_id = ids[0]

        # Build a 0.5 driver line from every row in the pair (survivor included).
        rows = conn.execute(text("""
            SELECT id, driver_id, mine_id, slip_number
            FROM truck_loads
            WHERE id = ANY(:ids)
            ORDER BY id
        """), {"ids": ids}).fetchall()

        for order, row in enumerate(rows):
            # Skip rows already migrated (idempotency)
            existing = conn.execute(text("""
                SELECT 1 FROM truck_load_driver_splits
                WHERE truck_load_id = :sid AND sort_order = :ord
            """), {"sid": survivor_id, "ord": order}).first()
            if existing:
                continue
            conn.execute(text("""
                INSERT INTO truck_load_driver_splits
                    (truck_load_id, driver_id, mine_id, share, slip_number, sort_order)
                VALUES (:sid, :driver_id, :mine_id, 0.5, :slip, :ord)
            """), {
                "sid": survivor_id,
                "driver_id": row[1],
                "mine_id": row[2],
                "slip": row[3],
                "ord": order,
            })

        # Delete the non-survivor rows of the pair.
        extra = [i for i in ids if i != survivor_id]
        if extra:
            conn.execute(text(
                "DELETE FROM truck_loads WHERE id = ANY(:ids)"
            ), {"ids": extra})

    conn.commit()
