"""
Migration 120 — Backfill the diesel admin fee on May 2026 fill-ups.

The other half of migration 119. Safetec's (entity 3) diesel admin fee was set
to 0% on 2026-05-30 and only back to 1% on 2026-07-03, and because the fee % is
snapshotted onto each DieselFillUp at capture time, every fill-up logged in
between stored admin_fee_pct = 0. 119 repaired June and deliberately left May
alone as an already-reconciled month; Larissa has since decided May's ~R83k of
admin fee should be recovered too, so this repairs it on the same terms.

Deliberately kept a separate, month-scoped migration rather than widening 119:
119 has already run against production, and each period this touches is a
book-affecting decision that should be its own reviewable, re-runnable step.

Same guards as 119 — May 2026 by STATEMENT period (coalescing to fillup_date,
as diesel._apply_period_filter does), only entities whose current settings have
the fee on, only rows still sitting at 0% (so a supplier-billed per-line fee
such as Intsimbi's 1.5% survives), skipping archived and finally-verified rows.
Amounts mirror DieselCalculationService.calculate_fillup_amounts: fee rounded to
2dp first, VAT charged on that rounded fee, total = amount + fee + VAT.
"""
from sqlalchemy import text


YEAR, MONTH = 2026, 5

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

WHERE = f"""
    ds.apply_admin_fee = TRUE
      AND ds.admin_fee_pct > 0
      AND COALESCE(f.admin_fee_pct, 0) = 0
      AND f.is_archived = FALSE
      AND f.verified3_by IS NULL
      AND {EFF_YEAR} = :year
      AND {EFF_MONTH} = :month
"""


def upgrade(conn):
    params = {"year": YEAR, "month": MONTH}

    before = conn.execute(text(f"""
        SELECT COUNT(*), COALESCE(SUM(f.amount), 0)
        FROM diesel_fillups f
        JOIN diesel_settings ds ON ds.entity_id = f.entity_id
        WHERE {WHERE}
    """), params).one()
    print(f"Migration 120: {before[0]} {YEAR}-{MONTH:02d} fill-ups at 0% admin fee "
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
          AND {WHERE}
    """), params)
    conn.commit()

    print(f"Migration 120: recalculated {result.rowcount} fill-ups")
    for row in conn.execute(text("""
        SELECT f.entity_id, COUNT(*), SUM(f.admin_fee_amount), SUM(f.admin_fee_vat)
        FROM diesel_fillups f
        LEFT JOIN supplier_invoices si ON si.id = f.supplier_invoice_id
        WHERE f.is_archived = FALSE
          AND COALESCE(si.statement_year,  EXTRACT(YEAR  FROM f.fillup_date)) = :year
          AND COALESCE(si.statement_month, EXTRACT(MONTH FROM f.fillup_date)) = :month
        GROUP BY f.entity_id ORDER BY f.entity_id
    """), params):
        print(f"  entity {row[0]}: {row[1]} fill-ups, "
              f"admin fee R{row[2]:,.2f} excl + R{row[3]:,.2f} VAT")
