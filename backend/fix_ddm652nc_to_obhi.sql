-- ============================================================
-- Move truck DDM652NC (+ its 2 trailers) to OBHI (entity_id=2)
-- as a subcontractor truck owned/operated by Re Ama Setshaba.
--
-- HOW TO USE:
--   Step 1 — Run the PREVIEW queries to confirm current state.
--   Step 2 — Run the INSERT block (truck + trailers in one transaction).
--   Step 3 — Manually delete the originals from Re Ama's fleet
--             in the app, or uncomment the DELETEs at the bottom.
-- ============================================================


-- ── STEP 1: PREVIEW ──────────────────────────────────────────

-- Current truck record for DDM652NC
SELECT
    t.id,
    t.entity_id,
    be.name   AS entity_name,
    t.make,
    t.model,
    t.registration,
    t.vin,
    t.fleet_number,
    t.is_subcontractor,
    t.subcontractor_name,
    t.subcontractor_id,
    t.operator,
    t.contract_context,
    t.licence_number,
    t.licence_expiry,
    t.status,
    t.notes
FROM trucks t
JOIN business_entities be ON be.id = t.entity_id
WHERE t.registration = 'DDM652NC';

-- Trailers linked to that truck
SELECT
    tr.id,
    tr.truck_id,
    tr.slot,
    tr.registration,
    tr.vin,
    tr.licence_number,
    tr.licence_expiry,
    tr.finance_institution,
    tr.finance_account_number,
    tr.finance_contract_end,
    tr.status,
    tr.notes
FROM trailers tr
JOIN trucks t ON t.id = tr.truck_id
WHERE t.registration = 'DDM652NC';

-- Re Ama subcontractor record linked to OBHI (entity_id=2)
SELECT id, entity_id, name, trading_name
FROM subcontractors
WHERE entity_id = 2
  AND name ILIKE '%re ama%';


-- ── STEP 2: INSERT truck + trailers under OBHI ───────────────
-- Uses a CTE to capture the new truck's id and link the trailers to it.

BEGIN;

WITH new_truck AS (
    INSERT INTO trucks (
        entity_id,
        fleet_number,
        make,
        model,
        registration,
        vin,
        driver_name,
        licence_number,
        licence_expiry,
        finance_institution,
        finance_account_number,
        finance_contract_end,
        is_subcontractor,
        subcontractor_name,
        subcontractor_id,
        operator,
        contract_context,
        temp_registration,
        is_temp_registration,
        status,
        notes,
        created_at,
        updated_at
    )
    SELECT
        2                       AS entity_id,       -- OBHI
        fleet_number,
        make,
        model,
        registration,
        vin,
        driver_name,
        licence_number,
        licence_expiry,
        finance_institution,
        finance_account_number,
        finance_contract_end,
        true                    AS is_subcontractor,
        'Re Ama Setshaba'       AS subcontractor_name,
        (SELECT id FROM subcontractors WHERE entity_id = 2 AND name ILIKE '%re ama%' LIMIT 1) AS subcontractor_id,
        'Re Ama'                AS operator,
        'OBHI'                  AS contract_context,
        temp_registration,
        is_temp_registration,
        status,
        notes,
        NOW(),
        NOW()
    FROM trucks
    WHERE registration = 'DDM652NC'
      AND entity_id != 2
    LIMIT 1
    RETURNING id
)
INSERT INTO trailers (
    truck_id,
    entity_id,
    slot,
    registration,
    vin,
    licence_number,
    licence_expiry,
    finance_institution,
    finance_account_number,
    finance_contract_end,
    status,
    notes,
    created_at,
    updated_at
)
SELECT
    new_truck.id            AS truck_id,
    2                       AS entity_id,   -- OBHI
    tr.slot,
    tr.registration,
    tr.vin,
    tr.licence_number,
    tr.licence_expiry,
    tr.finance_institution,
    tr.finance_account_number,
    tr.finance_contract_end,
    tr.status,
    tr.notes,
    NOW(),
    NOW()
FROM trailers tr
JOIN trucks t ON t.id = tr.truck_id
CROSS JOIN new_truck
WHERE t.registration = 'DDM652NC'
  AND t.entity_id != 2;

COMMIT;


-- ── STEP 3: (optional) delete originals from Re Ama ──────────
-- Trailers cascade-delete when the truck is deleted.
-- Only run after confirming the OBHI copies look correct.

-- DELETE FROM trucks
-- WHERE registration = 'DDM652NC'
--   AND entity_id != 2;
