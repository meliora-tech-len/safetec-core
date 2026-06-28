"""Migration 101 — drop the WAGES section from existing OBHI budgets.

OBHI has no payroll, so the WAGES section doesn't belong on its budgets. New
budgets now skip it via ENTITY_SECTION_EXCLUSIONS in the budgets route; this
back-fills the same rule onto budgets created before that change.

NOTE: the OTHER section is intentionally LEFT IN PLACE — OBHI keeps OTHER for
manually-entered expenses. (An earlier revision of this migration also dropped
OTHER; that was reversed.)

Safety: only an EMPTY WAGES section is removed — one whose lines carry no
non-zero TO PAY / PAID value — so any hand-entered figure is preserved for
review. budget_sections cascades to budget_lines and budget_line_values, so
removing the section removes its rows.
"""
from sqlalchemy import text, bindparam


def upgrade(conn):
    # WAGES sections on OBHI budgets that hold no real data.
    select_empty = text("""
        SELECT s.id
        FROM budget_sections s
        JOIN budgets b ON b.id = s.budget_id
        JOIN business_entities e ON e.id = b.entity_id
        WHERE UPPER(e.code) = 'OBHI'
          AND s.name = 'WAGES'
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
