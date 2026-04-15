"""
Migration 009: Add driver pay cycles, trip logs, additional loads, food payments, payroll settings.

Run against Supabase/PostgreSQL before deploying.
SQLite: tables are auto-created by SQLAlchemy on startup — run this only for PostgreSQL.
"""

from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS payroll_settings (
            id SERIAL PRIMARY KEY,
            effective_date TIMESTAMPTZ NOT NULL,
            hotazel_base_salary NUMERIC(12,2) NOT NULL DEFAULT 13574.38,
            lohatla_base_salary NUMERIC(12,2) NOT NULL DEFAULT 16481.55,
            hotazel_incentive_per_load NUMERIC(12,2) NOT NULL DEFAULT 2900.00,
            lohatla_incentive_per_load NUMERIC(12,2) NOT NULL DEFAULT 2610.00,
            hotazel_subs_per_load NUMERIC(12,2) NOT NULL DEFAULT 405.00,
            lohatla_subs_per_load NUMERIC(12,2) NOT NULL DEFAULT 459.66,
            assmang_bonus_per_load NUMERIC(12,2) NOT NULL DEFAULT 150.00,
            nbcrfli_rate NUMERIC(6,4) NOT NULL DEFAULT 0.004,
            provident_rate NUMERIC(6,4) NOT NULL DEFAULT 0.10,
            wellness_rate NUMERIC(6,4) NOT NULL DEFAULT 0.01,
            sick_fund_rate NUMERIC(6,4) NOT NULL DEFAULT 0.20,
            holiday_fund_rate NUMERIC(6,4) NOT NULL DEFAULT 0.3608,
            leave_pay_rate NUMERIC(6,4) NOT NULL DEFAULT 0.25,
            paye_fixed NUMERIC(12,2) NOT NULL DEFAULT 177.12,
            weekly_to_monthly_factor NUMERIC(6,4) NOT NULL DEFAULT 4.3333,
            updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_at TIMESTAMPTZ DEFAULT now()
        );
    """))

    conn.execute(text("""
        INSERT INTO payroll_settings (effective_date)
        SELECT '2023-03-01'
        WHERE NOT EXISTS (SELECT 1 FROM payroll_settings);
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS driver_pay_cycles (
            id SERIAL PRIMARY KEY,
            driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
            pay_month INTEGER NOT NULL,
            pay_year INTEGER NOT NULL,
            payroll_settings_id INTEGER REFERENCES payroll_settings(id) ON DELETE RESTRICT,
            hotazel_base_loads INTEGER NOT NULL DEFAULT 0,
            hotazel_extra_loads INTEGER NOT NULL DEFAULT 0,
            lohatla_base_loads INTEGER NOT NULL DEFAULT 0,
            lohatla_extra_loads INTEGER NOT NULL DEFAULT 0,
            subsistence_advance_paid NUMERIC(12,2) DEFAULT 0,
            subsistence_advance_verified BOOLEAN DEFAULT FALSE,
            staff_loan_balance NUMERIC(12,2) DEFAULT 0,
            staff_loan_deduction NUMERIC(12,2) DEFAULT 0,
            cash_advance_balance NUMERIC(12,2) DEFAULT 0,
            cash_advance_deduction NUMERIC(12,2) DEFAULT 0,
            comments TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ,
            UNIQUE (driver_id, pay_year, pay_month)
        );
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS driver_trip_logs (
            id SERIAL PRIMARY KEY,
            pay_cycle_id INTEGER NOT NULL REFERENCES driver_pay_cycles(id) ON DELETE CASCADE,
            trip_date TIMESTAMPTZ NOT NULL,
            mine_name VARCHAR(200) NOT NULL,
            notes VARCHAR(500),
            created_at TIMESTAMPTZ DEFAULT now()
        );
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS driver_additional_loads (
            id SERIAL PRIMARY KEY,
            pay_cycle_id INTEGER NOT NULL REFERENCES driver_pay_cycles(id) ON DELETE CASCADE,
            load_date TIMESTAMPTZ NOT NULL,
            route_name VARCHAR(200) NOT NULL,
            truck_registration VARCHAR(50),
            litres NUMERIC(10,2),
            amount NUMERIC(12,2) NOT NULL,
            is_verified BOOLEAN DEFAULT FALSE,
            notes VARCHAR(500),
            created_at TIMESTAMPTZ DEFAULT now()
        );
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS driver_food_payments (
            id SERIAL PRIMARY KEY,
            pay_cycle_id INTEGER NOT NULL REFERENCES driver_pay_cycles(id) ON DELETE CASCADE,
            payment_date TIMESTAMPTZ NOT NULL,
            amount NUMERIC(12,2) NOT NULL,
            paid_by VARCHAR(100),
            is_verified BOOLEAN DEFAULT FALSE,
            notes VARCHAR(500),
            created_at TIMESTAMPTZ DEFAULT now()
        );
    """))

    conn.commit()
    print("Migration 009 complete.")


if __name__ == "__main__":
    import os
    from sqlalchemy import create_engine
    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.connect() as conn:
        upgrade(conn)
