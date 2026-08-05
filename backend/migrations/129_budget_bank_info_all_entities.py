"""Migration 129 — Bank Info Summary for the other trading entities.

Migration 123 added the block (budget_bank_rows + the three override columns on
budgets) but seeded it for Safetec only, because it was lifted straight off the
Safetec sheet. Every trading entity banks its own money, so the block now applies
to OBHI, Border Trade Post (BTP), Thembi (TP) and Bokamosho (BKMO) as well — SP,
the dormant entity, is left out.

Only the ACCOUNT rows are seeded, and only their labels: the amounts are read off
the banking system by hand each month. The Safetec account names are a starting
point, not a schema — an entity without money market accounts deletes those rows.

What sits UNDER the accounts on the Safetec block — the profit line, the trailer
VAT-back adjustment off it and the TO BE PAID list — stays Safetec-only, so the
'to_be_paid' rows are not seeded here and the frontend hides that half of the
block for everyone else.

Budgets that already carry bank rows (Safetec's, or anything re-run) are skipped,
so this is safe to run twice.
"""
from sqlalchemy import text


ENTITY_CODES = ["OBHI", "BTP", "TP", "BKMO"]

# Mirrors the 'bank' half of DEFAULT_BANK_ROWS in app/api/routes/budgets.py.
BANK_ROWS = [
    "CURRENT ACC",
    "MONEY MARKET 001",
    "MONEY MARKET 002 - VAT",
    "MONEY MARKET 003 - BUILD UP",
    "MONEY MARKET 004 - INTEREST",
    "MONEY MARKET 005",
]


CODE_LIST = ", ".join(f"'{c}'" for c in ENTITY_CODES)


def upgrade(conn):
    budgets = conn.execute(text(f"""
        SELECT b.id, e.code
        FROM budgets b
        JOIN business_entities e ON e.id = b.entity_id
        WHERE UPPER(e.code) IN ({CODE_LIST})
        ORDER BY b.id
    """)).fetchall()

    rows = [("bank", n) for n in BANK_ROWS]
    seeded = touched = 0
    for budget_id, code in budgets:
        existing = conn.execute(text(
            "SELECT COUNT(*) FROM budget_bank_rows WHERE budget_id = :b"
        ), {"b": budget_id}).scalar()
        if existing:
            continue
        for order, (kind, label) in enumerate(rows):
            conn.execute(text("""
                INSERT INTO budget_bank_rows (budget_id, kind, label, sort_order)
                VALUES (:b, :k, :l, :o)
            """), {"b": budget_id, "k": kind, "l": label, "o": order})
            seeded += 1
        touched += 1
    print(f"Migration 129: seeded {seeded} bank rows across {touched} budget(s) "
          f"(of {len(budgets)} for {', '.join(ENTITY_CODES)})")


def downgrade(conn):
    """Remove the seeded rows again — but only the untouched ones. A row someone
    has already renamed or put a figure on is theirs, not seed data."""
    removed = conn.execute(text(f"""
        DELETE FROM budget_bank_rows
        WHERE amount IS NULL AND note IS NULL
          AND budget_id IN (
              SELECT b.id FROM budgets b
              JOIN business_entities e ON e.id = b.entity_id
              WHERE UPPER(e.code) IN ({CODE_LIST})
          )
    """)).rowcount
    print(f"Migration 129 downgrade: removed {removed} untouched bank row(s)")
