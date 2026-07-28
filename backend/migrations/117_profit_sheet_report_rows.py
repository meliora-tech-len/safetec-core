"""Migration 117 — profit_sheet_report_rows: the editable Profit Sheet report.

The report is a one-line-per-truck summary for a month (reg, driver, diesel,
diesel per load, loads, profit, sand loads, profit excl. sand, notes). Every
figure auto-fills from the existing modules — loads, diesel fill-ups and the
per-truck Profit Sheet — but the user must be able to correct any of them by
hand before exporting.

So this table stores ONLY overrides, never the auto figures: a NULL column means
"use the calculated value", which keeps the report live when the underlying data
is corrected afterwards. A row with truck_id NULL is a free-text row the user
added by hand (the source sheet has a couple of unattributed profit lines).
"""
from sqlalchemy import text


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"

    if is_pg:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS profit_sheet_report_rows (
                id                        SERIAL PRIMARY KEY,
                entity_id                 INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
                year                      INTEGER NOT NULL,
                month                     INTEGER NOT NULL,
                truck_id                  INTEGER REFERENCES trucks(id) ON DELETE CASCADE,
                sort_order                INTEGER DEFAULT 0,
                reg_no_override           VARCHAR(50),
                driver_override           VARCHAR(200),
                diesel_override           NUMERIC(14, 2),
                diesel_avg_override       NUMERIC(14, 2),
                loads_override            NUMERIC(10, 2),
                profit_override           NUMERIC(14, 2),
                sand_loads_incl_vat       NUMERIC(14, 2),
                profit_excl_sand_override NUMERIC(14, 2),
                notes                     TEXT,
                created_at                TIMESTAMPTZ DEFAULT NOW(),
                updated_at                TIMESTAMPTZ
            )
        """))
    else:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS profit_sheet_report_rows (
                id                        INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id                 INTEGER NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
                year                      INTEGER NOT NULL,
                month                     INTEGER NOT NULL,
                truck_id                  INTEGER REFERENCES trucks(id) ON DELETE CASCADE,
                sort_order                INTEGER DEFAULT 0,
                reg_no_override           VARCHAR(50),
                driver_override           VARCHAR(200),
                diesel_override           NUMERIC(14, 2),
                diesel_avg_override       NUMERIC(14, 2),
                loads_override            NUMERIC(10, 2),
                profit_override           NUMERIC(14, 2),
                sand_loads_incl_vat       NUMERIC(14, 2),
                profit_excl_sand_override NUMERIC(14, 2),
                notes                     TEXT,
                created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at                TIMESTAMP
            )
        """))

    # One override row per truck per period. Deliberately NOT unique for
    # truck_id NULL (both PostgreSQL and SQLite treat NULLs as distinct here) —
    # the user can add as many hand-written rows to a month as she needs.
    conn.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_profit_sheet_report_row
        ON profit_sheet_report_rows (entity_id, year, month, truck_id)
    """))
    # The report always loads one entity-month at a time.
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_profit_sheet_report_period
        ON profit_sheet_report_rows (entity_id, year, month)
    """))

    conn.commit()
    print("  created profit_sheet_report_rows")
