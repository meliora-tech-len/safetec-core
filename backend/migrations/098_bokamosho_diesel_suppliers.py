"""Migration 098 — add Oukop & Tradekor as Bokamosho (BKMO) diesel suppliers.

Bokamosho's subcontractor costing only listed "Intsimbi Diesel" as a diesel
template row, because that template list is driven by the *active diesel rates*
for the entity (see subcontractors._build_subcontractor_costing → diesel_supplier_names).

This migration adds Oukop and Tradekor as diesel suppliers under the BKMO entity
and gives each an active diesel rate, so they show as their own diesel rows on
Bokamosho's costing sheet (same section as Intsimbi) and their fill-up values pull
through as usual. It deliberately targets ONLY the BKMO entity — not every entity
that has an Intsimbi rate (e.g. OBHI), which should be left unchanged.

The seeded rate_per_litre is a PLACEHOLDER: BKMO diesel is captured via the sheet
import, which derives the per-litre rate from amount/litres on each row, and the
costing reads the stored fill-up amounts — so this fallback rate does not affect
the figures pulled through. Set the real per-litre figure on the Diesel Rates
page if manual single captures are ever needed.

Idempotent: re-running creates no duplicate supplier or rate rows.
"""
from sqlalchemy import text

# Diesel rows wanted under Bokamosho costing: (supplier name, payment term)
SUPPLIERS = [("Oukop", "current"), ("Tradekor", "current")]

PLACEHOLDER_RATE = "20.0000"
RATE_EFFECTIVE_DATE = "2025-01-01"


def upgrade(conn):
    bkmo = conn.execute(
        text("SELECT id FROM business_entities WHERE code = 'BKMO'")
    ).fetchone()
    if not bkmo:
        print("BKMO entity not found — nothing to do")
        return
    entity_id = bkmo[0]

    for name, term in SUPPLIERS:
        # 1) Ensure the supplier exists under the BKMO entity.
        conn.execute(text("""
            INSERT INTO suppliers
                (entity_id, name, is_active, payment_term, is_diesel_supplier,
                 is_intercompany, requires_registration, short_name, category, created_at)
            SELECT :eid, :name, TRUE, :term, TRUE, FALSE, FALSE, :name, 'Diesel', CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
                SELECT 1 FROM suppliers
                WHERE entity_id = :eid AND UPPER(name) = UPPER(:name)
            )
        """), {"eid": entity_id, "name": name, "term": term})

        # 2) Make sure the supplier (new or pre-existing, e.g. a Parking-category
        #    Tradekor) is flagged as a diesel supplier so it behaves like one.
        conn.execute(text("""
            UPDATE suppliers
            SET is_diesel_supplier = TRUE,
                category = 'Diesel'
            WHERE entity_id = :eid AND UPPER(name) = UPPER(:name)
        """), {"eid": entity_id, "name": name})

        # 3) Resolve the supplier id.
        supplier_id = conn.execute(text("""
            SELECT id FROM suppliers
            WHERE entity_id = :eid AND UPPER(name) = UPPER(:name)
            ORDER BY id LIMIT 1
        """), {"eid": entity_id, "name": name}).fetchone()[0]

        # 4) Ensure an active diesel rate exists for this supplier/entity — this is
        #    what makes the supplier appear as a costing template row.
        conn.execute(text("""
            INSERT INTO diesel_rates
                (entity_id, supplier_id, rate_per_litre, additional_charge_per_ton,
                 effective_date, is_active, notes, created_at)
            SELECT :eid, :sid, :rate, 0, :eff, TRUE,
                   'Placeholder rate — set the real per-litre figure on the Diesel Rates page',
                   CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
                SELECT 1 FROM diesel_rates
                WHERE entity_id = :eid AND supplier_id = :sid AND is_active = TRUE
            )
        """), {"eid": entity_id, "sid": supplier_id, "rate": PLACEHOLDER_RATE, "eff": RATE_EFFECTIVE_DATE})

        print(f"Ensured BKMO diesel supplier + active rate: {name} (supplier_id={supplier_id})")

    conn.commit()
