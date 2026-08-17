-- ============================================================================
-- Delete all diesel fill-up records for Bokamosho (BKMO, entity_id = 5)
-- ============================================================================
-- Run in the Supabase SQL editor. Wrapped in a transaction so you can review
-- the row counts before committing. Resolve the entity by CODE (not a hard-
-- coded id) so it's safe across environments.
--
-- Scope: this deletes the diesel_fillups rows. It does NOT delete the diesel
-- supplier invoices that some fill-ups were auto-created from (those are real
-- accounting documents; their FK back-pointer just becomes NULL). It also does
-- NOT touch diesel_rates / diesel_settings. See the optional blocks at the end.
-- ============================================================================

BEGIN;

-- 0. Sanity check — how many fill-ups are about to be deleted.
SELECT count(*) AS fillups_to_delete
FROM diesel_fillups
WHERE entity_id = (SELECT id FROM business_entities WHERE code = 'BKMO');

-- 1. Clear the diesel snapshot fields on any truck loads linked to these
--    fill-ups (the truckload_id FK is ON DELETE SET NULL, but these denormalised
--    snapshot columns would otherwise be left stale).
UPDATE truck_loads tl
SET diesel_invoice = NULL,
    diesel_litres  = NULL,
    diesel_rate    = NULL
WHERE tl.id IN (
    SELECT f.truckload_id
    FROM diesel_fillups f
    WHERE f.entity_id = (SELECT id FROM business_entities WHERE code = 'BKMO')
      AND f.truckload_id IS NOT NULL
);

-- 2. Delete the fill-ups.
DELETE FROM diesel_fillups
WHERE entity_id = (SELECT id FROM business_entities WHERE code = 'BKMO');

-- Review the results above, then:
COMMIT;
-- ...or, if anything looks wrong:
-- ROLLBACK;


-- ============================================================================
-- OPTIONAL — uncomment only if you also want these gone.
-- ============================================================================

-- (A) Delete the diesel supplier invoices that were auto-created from these
--     fill-ups. WARNING: these are real supplier invoices — only do this if the
--     diesel data was imported in error and the invoices should go too.
-- DELETE FROM supplier_invoices
-- WHERE entity_id = (SELECT id FROM business_entities WHERE code = 'BKMO')
--   AND id IN (
--       SELECT supplier_invoice_id FROM diesel_fillups
--       WHERE entity_id = (SELECT id FROM business_entities WHERE code = 'BKMO')
--         AND supplier_invoice_id IS NOT NULL
--   );
-- (Run BEFORE step 2 above if used, since deleting fill-ups loses the link.)

-- (B) Delete Bokamosho's diesel rate history and settings.
-- DELETE FROM diesel_rates    WHERE entity_id = (SELECT id FROM business_entities WHERE code = 'BKMO');
-- DELETE FROM diesel_settings WHERE entity_id = (SELECT id FROM business_entities WHERE code = 'BKMO');
