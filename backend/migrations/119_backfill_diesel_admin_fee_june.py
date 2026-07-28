"""
Migration 119 — Backfill the diesel admin fee on June 2026 fill-ups.

The admin fee % is snapshotted onto each DieselFillUp at creation time (every
creation path reads DieselSettings live), and changing the setting afterwards
never revisits existing rows. Safetec's (entity 3) diesel admin fee was set to
0% on 2026-05-30 and only turned back to 1% on 2026-07-03, so every fill-up
captured in between stored admin_fee_pct = 0 / admin_fee_amount = 0. The result:
the Diesel module shows blank admin fees for Safetec across May and June while
July is correct.

This repairs June only — May is already reconciled and invoiced, so moving
~R83k of cost into it would rewrite a closed month. Deliberately narrow:

  * June 2026 by STATEMENT period, coalescing to fillup_date exactly as
    diesel._apply_period_filter does, so a mis-dated slip is fixed under the
    month the module actually lists it in.
  * only entities whose CURRENT settings say the fee applies (apply_admin_fee
    and admin_fee_pct > 0) — an entity that genuinely charges no fee is left be.
  * only rows still sitting at 0% — anything already carrying a fee (Intsimbi's
    per-line 1.5%, the handful of 1% rows) keeps its own snapshotted pct.
  * skips archived rows and rows under the final verification lock.

Amounts mirror DieselCalculationService.calculate_fillup_amounts: the fee is
rounded to 2dp first, then VAT is charged on that rounded fee, and the total is
amount + fee + VAT.

Migration 059 did this same backfill once before; it predates migration 063
(admin_fee_vat), so it cannot be re-run as-is — it would leave the VAT at zero
and understate total_amount.
"""
from sqlalchemy import text


# Statement period the Diesel module files a fill-up under: the linked supplier
# invoice's period, falling back to the slip's own date.
EFF_YEAR = """
    COALESCE(
        (SELECT si.statement_year FROM supplier_invoices si WHERE si.id = f.supplier_invoice_id),
        EXTRACT(YEAR FROM f.fillup_date)
    )
"""
EFF_MONTH = """
    COALESCE(
        (SELECT si.statement_month FROM supplier_invoices si WHERE si.id = f.supplier_invoice_id),
        EXTRACT(MONTH FROM f.fillup_date)
    )
"""

TARGET = f"""
    FROM diesel_fillups f
    JOIN diesel_settings ds     ON ds.entity_id = f.entity_id
    JOIN business_entities be   ON be.id = f.entity_id
    WHERE ds.apply_admin_fee = TRUE
      AND ds.admin_fee_pct > 0
      AND COALESCE(f.admin_fee_pct, 0) = 0
      AND f.is_archived = FALSE
      AND f.verified3_by IS NULL
      AND {EFF_YEAR} = 2026
      AND {EFF_MONTH} = 6
"""


def upgrade(conn):
    before = conn.execute(text(f"""
        SELECT COUNT(*), COALESCE(SUM(f.amount), 0) {TARGET}
    """)).one()
    print(f"Migration 119: {before[0]} June 2026 fill-ups at 0% admin fee "
          f"(net R{before[1]:,.2f})")

    result = conn.execute(text(f"""
        UPDATE diesel_fillups AS f
        SET admin_fee_pct    = ds.admin_fee_pct,
            admin_fee_amount = ROUND(f.amount * ds.admin_fee_pct, 2),
            admin_fee_vat    = ROUND(ROUND(f.amount * ds.admin_fee_pct, 2)
                                     * COALESCE(be.vat_rate, 0.15), 2),
            total_amount     = f.amount
                             + ROUND(f.amount * ds.admin_fee_pct, 2)
                             + ROUND(ROUND(f.amount * ds.admin_fee_pct, 2)
                                     * COALESCE(be.vat_rate, 0.15), 2)
        FROM diesel_settings ds, business_entities be
        WHERE ds.entity_id = f.entity_id
          AND be.id = f.entity_id
          AND ds.apply_admin_fee = TRUE
          AND ds.admin_fee_pct > 0
          AND COALESCE(f.admin_fee_pct, 0) = 0
          AND f.is_archived = FALSE
          AND f.verified3_by IS NULL
          AND {EFF_YEAR} = 2026
          AND {EFF_MONTH} = 6
    """))
    conn.commit()

    print(f"Migration 119: recalculated {result.rowcount} fill-ups")
    for row in conn.execute(text("""
        SELECT f.entity_id, COUNT(*), SUM(f.admin_fee_amount), SUM(f.admin_fee_vat)
        FROM diesel_fillups f
        LEFT JOIN supplier_invoices si ON si.id = f.supplier_invoice_id
        WHERE f.is_archived = FALSE
          AND COALESCE(si.statement_year,  EXTRACT(YEAR  FROM f.fillup_date)) = 2026
          AND COALESCE(si.statement_month, EXTRACT(MONTH FROM f.fillup_date)) = 6
        GROUP BY f.entity_id ORDER BY f.entity_id
    """)):
        print(f"  entity {row[0]}: {row[1]} fill-ups, "
              f"admin fee R{row[2]:,.2f} excl + R{row[3]:,.2f} VAT")
