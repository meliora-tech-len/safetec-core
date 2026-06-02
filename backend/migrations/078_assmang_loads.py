"""
Migration 078 — Assmang bonus per-mine load counts.

The Assmang bonus (R150/load) is paid only for loads delivered to the ASSMANG
mine, not all loads. These columns store the synced Assmang load counts on the
pay cycle (mirrors lohatla_/casual_ counts):

assmang_loads:        full (non-split) loads to ASSMANG credited to the driver.
assmang_split_loads:  split lines to ASSMANG (each worth 0.5 of a load).

Effective bonus loads = assmang_loads + 0.5 × assmang_split_loads.

Existing cycles self-heal: opening a cycle re-syncs these from truck loads.
"""
from sqlalchemy import text


def upgrade(conn):
    for col in ("assmang_loads", "assmang_split_loads"):
        try:
            conn.execute(text(
                f"ALTER TABLE driver_pay_cycles ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0"
            ))
        except Exception:
            pass  # column already exists
    conn.commit()
