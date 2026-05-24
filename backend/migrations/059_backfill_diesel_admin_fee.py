from sqlalchemy import text


def upgrade(conn):
    """Recalculate admin_fee_amount and total_amount for fill-ups where admin_fee_pct=0
    but the entity's current DieselSettings has a non-zero admin_fee_pct and apply_admin_fee=true."""
    conn.execute(text("""
        UPDATE diesel_fillups AS f
        SET
            admin_fee_pct    = ds.admin_fee_pct,
            admin_fee_amount = ROUND(f.amount * ds.admin_fee_pct, 2),
            total_amount     = ROUND(f.amount + (f.amount * ds.admin_fee_pct), 2)
        FROM diesel_settings AS ds
        WHERE f.entity_id = ds.entity_id
          AND ds.apply_admin_fee = TRUE
          AND ds.admin_fee_pct > 0
          AND f.admin_fee_pct = 0
          AND f.is_archived = FALSE
    """))
    conn.commit()
