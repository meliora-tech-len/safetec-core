"""Migration 104 — statutory deductions as fixed rand amounts.

Payroll Rates previously stored the six statutory deductions as fractions
(e.g. provident_rate = 0.10 → 10% of the basic salary, sick/holiday/leave as a
% of one week's wage). Users now capture the rand value directly, so each
deduction gets a NUMERIC(12,2) `*_amount` column holding the amount deducted
per pay cycle.

Existing rows are seeded from their own rate × salary so historic settings
reproduce the exact deductions they used to compute:

  * nbcrfli / provident / wellness — rate × lohatla_base_salary
  * sick / holiday / leave         — rate × (lohatla_base_salary ÷ weekly factor)

The old `*_rate` columns are kept (unused) for history.
"""
from sqlalchemy import text

AMOUNT_COLS = (
    "nbcrfli_amount",
    "provident_amount",
    "wellness_amount",
    "sick_fund_amount",
    "holiday_fund_amount",
    "leave_pay_amount",
)


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        for col in AMOUNT_COLS:
            conn.execute(text(
                f"ALTER TABLE payroll_settings "
                f"ADD COLUMN IF NOT EXISTS {col} NUMERIC(12, 2) NOT NULL DEFAULT 0"
            ))
    else:
        existing = [row[1] for row in conn.execute(text("PRAGMA table_info(payroll_settings)"))]
        for col in AMOUNT_COLS:
            if col not in existing:
                conn.execute(text(
                    f"ALTER TABLE payroll_settings "
                    f"ADD COLUMN {col} NUMERIC(12, 2) NOT NULL DEFAULT 0"
                ))

    # Seed every row from its own historic rates. Only fill rows still at the
    # 0 default so a re-run never clobbers amounts users have since edited.
    conn.execute(text("""
        UPDATE payroll_settings SET
            nbcrfli_amount      = ROUND(lohatla_base_salary * nbcrfli_rate, 2),
            provident_amount    = ROUND(lohatla_base_salary * provident_rate, 2),
            wellness_amount     = ROUND(lohatla_base_salary * wellness_rate, 2),
            sick_fund_amount    = ROUND(lohatla_base_salary / weekly_to_monthly_factor * sick_fund_rate, 2),
            holiday_fund_amount = ROUND(lohatla_base_salary / weekly_to_monthly_factor * holiday_fund_rate, 2),
            leave_pay_amount    = ROUND(lohatla_base_salary / weekly_to_monthly_factor * leave_pay_rate, 2)
        WHERE nbcrfli_amount = 0 AND provident_amount = 0 AND wellness_amount = 0
          AND sick_fund_amount = 0 AND holiday_fund_amount = 0 AND leave_pay_amount = 0
          AND weekly_to_monthly_factor <> 0
    """))

    conn.commit()
