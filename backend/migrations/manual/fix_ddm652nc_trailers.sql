-- Add trailers for DDM652NC to the OBHI copy of the truck.
-- The truck INSERT has already been run; this finds the new OBHI truck id
-- via subquery and copies the trailers from the Re Ama original.

-- Preview first
SELECT tr.id, tr.slot, tr.registration, tr.vin, tr.licence_number,
       tr.licence_expiry, tr.status, tr.notes
FROM trailers tr
JOIN trucks t ON t.id = tr.truck_id
WHERE t.registration = 'DDM652NC'
  AND t.entity_id != 2;

-- Insert
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
    (SELECT id FROM trucks WHERE registration = 'DDM652NC' AND entity_id = 2 LIMIT 1) AS truck_id,
    2               AS entity_id,
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
WHERE t.registration = 'DDM652NC'
  AND t.entity_id != 2;
