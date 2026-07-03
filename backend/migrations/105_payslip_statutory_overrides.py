"""Migration 105 — editable payslip statutory lines + Tax (SARS) + CTC.

Extends `driver_pay_cycles` so every Payslip Summary amount can be edited per
driver per cycle:

  * `*_override` for the seven statutory lines (NBCRFLI, provident, wellness,
    sick fund, holiday fund, leave pay, PAYE) — null means use the fixed rand
    amount from Payroll Rates; a number replaces it for this cycle only.
  * `tax_sars` — real SARS income tax for the cycle (the existing PAYE line
    holds the capped UIF amount). Manual entry, default 0, deducted from net.
  * `ctc_override` — Cost to Company display line; null = total earnings
    (incl. accruals) + company contributions (provident + NBCRFLI + wellness).
"""
from sqlalchemy import text

NULLABLE_COLS = (
    "nbcrfli_override",
    "provident_override",
    "wellness_override",
    "sick_fund_override",
    "holiday_fund_override",
    "leave_pay_override",
    "paye_override",
    "ctc_override",
)


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        for col in NULLABLE_COLS:
            conn.execute(text(
                f"ALTER TABLE driver_pay_cycles ADD COLUMN IF NOT EXISTS {col} NUMERIC(12, 2)"
            ))
        conn.execute(text(
            "ALTER TABLE driver_pay_cycles "
            "ADD COLUMN IF NOT EXISTS tax_sars NUMERIC(12, 2) NOT NULL DEFAULT 0"
        ))
    else:
        existing = [row[1] for row in conn.execute(text("PRAGMA table_info(driver_pay_cycles)"))]
        for col in NULLABLE_COLS:
            if col not in existing:
                conn.execute(text(
                    f"ALTER TABLE driver_pay_cycles ADD COLUMN {col} NUMERIC(12, 2)"
                ))
        if "tax_sars" not in existing:
            conn.execute(text(
                "ALTER TABLE driver_pay_cycles ADD COLUMN tax_sars NUMERIC(12, 2) NOT NULL DEFAULT 0"
            ))

    conn.commit()
