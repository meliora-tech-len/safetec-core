"""Migration 102 — per-driver Mine bonus exclusion + manual pay-cycle overrides.

Two related payroll changes:

  * `drivers.exclude_mine_bonus` — when true the per-load Mine (Assmang) bonus is
    never paid to that driver, regardless of qualifying-mine loads.

  * `driver_pay_cycles.*_override` — nullable manual overrides for the four
    auto-calculated earnings lines (basic salary, subsistence, load incentive,
    mine bonus). Null means use the computed value; a number replaces it and
    flows through to gross, statutory deductions and net payable.
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    # ── drivers.exclude_mine_bonus ─────────────────────────────────────────────
    if is_pg:
        conn.execute(text(
            "ALTER TABLE drivers "
            "ADD COLUMN IF NOT EXISTS exclude_mine_bonus BOOLEAN NOT NULL DEFAULT FALSE"
        ))
    else:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(drivers)"))]
        if "exclude_mine_bonus" not in cols:
            conn.execute(text(
                "ALTER TABLE drivers ADD COLUMN exclude_mine_bonus BOOLEAN NOT NULL DEFAULT 0"
            ))

    # ── driver_pay_cycles.*_override ───────────────────────────────────────────
    override_cols = (
        "basic_salary_override",
        "subsistence_override",
        "load_incentive_override",
        "mine_bonus_override",
    )
    if is_pg:
        for col in override_cols:
            conn.execute(text(
                f"ALTER TABLE driver_pay_cycles ADD COLUMN IF NOT EXISTS {col} NUMERIC(12, 2)"
            ))
    else:
        existing = [row[1] for row in conn.execute(text("PRAGMA table_info(driver_pay_cycles)"))]
        for col in override_cols:
            if col not in existing:
                conn.execute(text(
                    f"ALTER TABLE driver_pay_cycles ADD COLUMN {col} NUMERIC(12, 2)"
                ))

    conn.commit()
