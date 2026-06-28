"""Migration 101 — drop WAGES / OTHER sections from existing OBHI budgets.

OBHI has no payroll, and its other expenses are already deducted elsewhere, so
neither the WAGES nor the OTHER section belongs on its budgets. New budgets now
skip these sections via ENTITY_SECTION_EXCLUSIONS in the budgets route; this
back-fills the same rule onto budgets that were created before that change.

Safety: only EMPTY sections are removed — a section is dropped only when none of
its lines carry a non-zero TO PAY / PAID value. So a hand-entered figure (if one
ever existed) is preserved, leaving that section in place for review. The empty
template sections (the actual situation) are cleared. budget_sections cascades to
budget_lines and budget_line_values, so removing the section removes its rows.
"""
from sqlalchemy import text, bindparam


def upgrade(conn):
    # Sections on OBHI budgets named WAGES / OTHER that hold no real data.
    select_empty = text("""
        SELECT s.id
        FROM budget_sections s
        JOIN budgets b ON b.id = s.budget_id
        JOIN business_entities e ON e.id = b.entity_id
        WHERE UPPER(e.code) = 'OBHI'
          AND s.name IN ('WAGES', 'OTHER')
          AND NOT EXISTS (
              SELECT 1
              FROM budget_lines l
              JOIN budget_line_values v ON v.line_id = l.id
              WHERE l.section_id = s.id
                AND (
                    (v.amount_due IS NOT NULL AND v.amount_due <> 0)
                    OR (v.amount_paid IS NOT NULL AND v.amount_paid <> 0)
                )
          )
    """)
    ids = [row[0] for row in conn.execute(select_empty)]
    if ids:
        conn.execute(
            text("DELETE FROM budget_sections WHERE id IN :ids").bindparams(
                bindparam("ids", expanding=True)
            ),
            {"ids": ids},
        )
    conn.commit()
