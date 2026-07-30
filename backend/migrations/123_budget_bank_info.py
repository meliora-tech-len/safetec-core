"""Migration 123 — Bank Info Summary on the Safetec budget.

Mirrors the "BANK INFO SUMMARY" block on Larissa's sheet, which sits under the
profit summary added in migration 122:

    BANK INFO SUMMARY          <- account balances, read off the banking system
      CURRENT ACC                 by hand each month, so they are stored, not derived
      MONEY MARKET 001 … 005
    PROFIT FOR <MONTH> <YEAR>  <- pulled: Income − Expenses for the base month
    vat back trailer           <- typed in; no system source (see below)
    profit would have been…    <- computed: profit + vat back
    TO BE PAID: 30days / current / KRIP & 7CS + total

budget_bank_rows holds both label/amount lists (kind = 'bank' | 'to_be_paid') as
free rows rather than fixed columns: the account list changes as accounts open and
close, and the sheet carries free-text notes on some of them ("R1879550.29 - to be
paid back"), which is what `note` is for.

The three new budgets columns are override-only in the Profit Sheet report sense —
NULL means "use the calculated value", so a correction to the underlying budget
still flows through until someone deliberately pins a figure:

  vat_back_trailer               the VAT-back figure itself. Nothing in this system
                                 models a VAT claim on a specific trailer purchase
                                 (the VAT machinery is aggregate input/output VAT for
                                 the SARS report), so it is captured by hand.
  bank_profit_override           pins PROFIT FOR <MONTH>, normally pulled.
  profit_excl_vat_back_override  pins "profit would have been without vat back",
                                 normally profit + vat_back_trailer.

Existing Safetec budgets are seeded with the row LABELS from the sheet and no
amounts — the figures are hers to enter. Other entities get nothing; the block is
Safetec-only, like the profit summary above it.
"""
from sqlalchemy import text


BANK_ROWS = [
    "CURRENT ACC",
    "MONEY MARKET 001",
    "MONEY MARKET 002 - VAT",
    "MONEY MARKET 003 - BUILD UP",
    "MONEY MARKET 004 - INTEREST",
    "MONEY MARKET 005",
]

TO_BE_PAID_ROWS = ["30days", "current", "KRIP & 7CS"]


def upgrade(conn):
    is_pg = conn.dialect.name == "postgresql"
    money = "NUMERIC(15, 2)" if is_pg else "NUMERIC"

    for col in ("vat_back_trailer", "bank_profit_override", "profit_excl_vat_back_override"):
        conn.execute(text(f"ALTER TABLE budgets ADD COLUMN {col} {money}"))

    if is_pg:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS budget_bank_rows (
                id         SERIAL PRIMARY KEY,
                budget_id  INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
                kind       VARCHAR(20) NOT NULL DEFAULT 'bank',
                label      VARCHAR(300) NOT NULL,
                note       VARCHAR(300),
                amount     NUMERIC(15, 2),
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ
            )
        """))
    else:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS budget_bank_rows (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                budget_id  INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
                kind       VARCHAR(20) NOT NULL DEFAULT 'bank',
                label      VARCHAR(300) NOT NULL,
                note       VARCHAR(300),
                amount     NUMERIC,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budget_bank_rows_budget_id ON budget_bank_rows (budget_id)"))

    # Seed the sheet's row labels into every existing Safetec budget. Labels only —
    # the amounts are read off the banking system by hand.
    budget_ids = [r[0] for r in conn.execute(text("""
        SELECT b.id FROM budgets b
        JOIN business_entities e ON e.id = b.entity_id
        WHERE UPPER(e.code) = 'SFT'
    """))]
    seeded = 0
    for budget_id in budget_ids:
        existing = conn.execute(text(
            "SELECT COUNT(*) FROM budget_bank_rows WHERE budget_id = :b"
        ), {"b": budget_id}).scalar()
        if existing:
            continue
        rows = [("bank", n) for n in BANK_ROWS] + [("to_be_paid", n) for n in TO_BE_PAID_ROWS]
        for order, (kind, label) in enumerate(rows):
            conn.execute(text("""
                INSERT INTO budget_bank_rows (budget_id, kind, label, sort_order)
                VALUES (:b, :k, :l, :o)
            """), {"b": budget_id, "k": kind, "l": label, "o": order})
            seeded += 1
    print(f"Migration 123: seeded {seeded} bank rows across {len(budget_ids)} Safetec budget(s)")


def downgrade(conn):
    conn.execute(text("DROP TABLE IF EXISTS budget_bank_rows"))
    for col in ("vat_back_trailer", "bank_profit_override", "profit_excl_vat_back_override"):
        conn.execute(text(f"ALTER TABLE budgets DROP COLUMN {col}"))
