-- 098 — add Oukop & Tradekor as Bokamosho (BKMO) diesel suppliers
-- Makes them appear as diesel template rows (OUKOP DIESEL / TRADEKOR DIESEL) on
-- the BKMO subcontractors' costing sheets, next to Intsimbi. Idempotent.
-- Run in the Supabase SQL editor.

-- 1) Ensure Oukop & Tradekor exist as suppliers under the BKMO entity.
INSERT INTO suppliers
    (entity_id, name, is_active, payment_term, is_diesel_supplier,
     is_intercompany, requires_registration, short_name, category, created_at)
SELECT e.id, v.name, TRUE, 'current', TRUE, FALSE, FALSE, v.name, 'Diesel', now()
FROM business_entities e
CROSS JOIN (VALUES ('Oukop'), ('Tradekor')) AS v(name)
WHERE e.code = 'BKMO'
  AND NOT EXISTS (
      SELECT 1 FROM suppliers s
      WHERE s.entity_id = e.id AND UPPER(s.name) = UPPER(v.name)
  );

-- 2) Make sure they are flagged as diesel suppliers (covers a pre-existing
--    "Parking" Tradekor row under BKMO).
UPDATE suppliers s
SET is_diesel_supplier = TRUE,
    category = 'Diesel'
FROM business_entities e
WHERE e.code = 'BKMO'
  AND s.entity_id = e.id
  AND UPPER(s.name) IN ('OUKOP', 'TRADEKOR');

-- 3) Give each an active diesel rate — this is what makes the supplier show as a
--    costing template row. Placeholder rate; set the real per-litre figure on the
--    Diesel Rates page if needed (it does not affect pulled-through fill-up totals).
INSERT INTO diesel_rates
    (entity_id, supplier_id, rate_per_litre, additional_charge_per_ton,
     effective_date, is_active, notes, created_at)
SELECT s.entity_id, s.id, 20.0000, 0, DATE '2025-01-01', TRUE,
       'Placeholder rate — set the real per-litre figure on the Diesel Rates page', now()
FROM suppliers s
JOIN business_entities e ON e.id = s.entity_id
WHERE e.code = 'BKMO'
  AND UPPER(s.name) IN ('OUKOP', 'TRADEKOR')
  AND NOT EXISTS (
      SELECT 1 FROM diesel_rates dr
      WHERE dr.entity_id = s.entity_id AND dr.supplier_id = s.id AND dr.is_active = TRUE
  );

-- 4) Verify: BKMO's active diesel rates (these are the costing template rows).
SELECT dr.entity_id, e.code, s.name, dr.rate_per_litre, dr.is_active
FROM diesel_rates dr
JOIN suppliers s ON s.id = dr.supplier_id
JOIN business_entities e ON e.id = dr.entity_id
WHERE e.code = 'BKMO' AND dr.is_active = TRUE
ORDER BY s.name;

-- 5) Sanity check: confirm the Bokamosho subcontractors really sit under BKMO.
--    If their entity_id/code is NOT BKMO, the rows above won't show on their
--    sheets — tell me the entity shown here and I'll re-target.
SELECT sc.id, sc.name, sc.entity_id, e.code AS entity_code
FROM subcontractors sc
JOIN business_entities e ON e.id = sc.entity_id
ORDER BY sc.entity_id, sc.name;
