"""
Migration 015: payroll_entries table — auto-draft payroll workflow.

Creates the `payroll_entries` table with:
  - Status state machine: auto_draft → pending_review → verified → paid
  - Full computed income + statutory + manual deduction columns
  - truckload_changed flag: raised when a truckload is edited/deleted after
    the entry has moved past auto_draft
  - UNIQUE(driver_id, pay_month, pay_year): one entry per driver per month

PostgreSQL / Supabase: run via SQL editor.
SQLite (local dev): table created automatically by SQLAlchemy create_all() on
startup; this file is provided for Supabase only.
"""

from sqlalchemy import text


def upgrade(conn):
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS payroll_entries (
            id                      SERIAL PRIMARY KEY,
            entity_id               INTEGER NOT NULL
                                        REFERENCES business_entities(id) ON DELETE RESTRICT,
            driver_id               INTEGER NOT NULL
                                        REFERENCES drivers(id) ON DELETE RESTRICT,
            pay_month               INTEGER NOT NULL,
            pay_year                INTEGER NOT NULL,

            status                  VARCHAR(30) NOT NULL DEFAULT 'auto_draft'
                                        CHECK (status IN (
                                            'auto_draft',
                                            'pending_review',
                                            'verified',
                                            'paid'
                                        )),

            payroll_settings_id     INTEGER
                                        REFERENCES payroll_settings(id) ON DELETE RESTRICT,

            -- Load counts (permanent uses base+extra; casual uses total only)
            lohatla_base_loads      INTEGER NOT NULL DEFAULT 0,
            lohatla_extra_loads     INTEGER NOT NULL DEFAULT 0,
            lohatla_total_loads     INTEGER NOT NULL DEFAULT 0,

            -- Computed income
            basic_salary            NUMERIC(12, 2) NOT NULL DEFAULT 0,
            load_earnings           NUMERIC(12, 2) NOT NULL DEFAULT 0,
            subsistence             NUMERIC(12, 2) NOT NULL DEFAULT 0,
            assmang_bonus           NUMERIC(12, 2) NOT NULL DEFAULT 0,
            additional_income       NUMERIC(12, 2) NOT NULL DEFAULT 0,
            gross                   NUMERIC(12, 2) NOT NULL DEFAULT 0,

            -- Statutory deductions (permanent only; casual = 0)
            nbcrfli                 NUMERIC(12, 2) NOT NULL DEFAULT 0,
            provident               NUMERIC(12, 2) NOT NULL DEFAULT 0,
            wellness                NUMERIC(12, 2) NOT NULL DEFAULT 0,
            sick_fund               NUMERIC(12, 2) NOT NULL DEFAULT 0,
            holiday_fund            NUMERIC(12, 2) NOT NULL DEFAULT 0,
            leave_pay               NUMERIC(12, 2) NOT NULL DEFAULT 0,
            paye                    NUMERIC(12, 2) NOT NULL DEFAULT 0,
            uif                     NUMERIC(12, 2) NOT NULL DEFAULT 0,
            total_statutory         NUMERIC(12, 2) NOT NULL DEFAULT 0,

            -- Manual deductions
            subsistence_advance     NUMERIC(12, 2) NOT NULL DEFAULT 0,
            staff_loan_deduction    NUMERIC(12, 2) NOT NULL DEFAULT 0,
            cash_advance_deduction  NUMERIC(12, 2) NOT NULL DEFAULT 0,

            total_deductions        NUMERIC(12, 2) NOT NULL DEFAULT 0,
            net_payable             NUMERIC(12, 2) NOT NULL DEFAULT 0,

            -- Truckload-change warning
            truckload_changed       BOOLEAN NOT NULL DEFAULT FALSE,
            truckload_changed_note  TEXT,

            -- Payment info (filled when status = paid)
            payment_date            DATE,
            payment_reference       VARCHAR(200),

            -- Audit / workflow
            comments                TEXT,
            reviewed_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at             TIMESTAMP WITH TIME ZONE,
            verified_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
            verified_at             TIMESTAMP WITH TIME ZONE,

            created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

            UNIQUE (driver_id, pay_month, pay_year)
        );
    """))

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_payroll_entries_entity_id
            ON payroll_entries (entity_id);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_payroll_entries_driver_id
            ON payroll_entries (driver_id);
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_payroll_entries_status
            ON payroll_entries (status);
    """))
