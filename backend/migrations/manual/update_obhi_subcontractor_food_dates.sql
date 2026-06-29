-- ============================================================================
-- Re-date OBHI subcontractor Food Allowance entries: 29 Jun 2026 -> 1 Jul 2026
-- ----------------------------------------------------------------------------
-- Scope: Food Allowance (driver_food_payments) captured against trucks that are
--        flagged is_subcontractor = true AND belong to OBHI (entity_id = 2),
--        where payment_date falls on 2026-06-29.
--
-- Adding 2 days lands every matched row on 2026-07-01 while preserving the
-- original time-of-day / timezone offset.
--
-- Run in the Supabase SQL editor. STEP 1 previews; STEP 2 applies in a txn.
-- ============================================================================

-- ── STEP 1: PREVIEW (read-only) — confirm these are the rows you expect ──────
SELECT fp.id,
       fp.payment_date,
       fp.amount,
       d.first_name || ' ' || d.last_name AS driver,
       t.registration                      AS truck,
       t.is_subcontractor,
       t.entity_id
FROM   driver_food_payments fp
JOIN   trucks t            ON t.id  = fp.truck_id
JOIN   driver_pay_cycles c ON c.id  = fp.pay_cycle_id
JOIN   drivers d           ON d.id  = c.driver_id
WHERE  t.is_subcontractor = true
  AND  t.entity_id        = 2
  AND  fp.payment_date::date = DATE '2026-06-29'
ORDER  BY t.registration, driver;

-- ── STEP 2: UPDATE — run after the preview looks correct ─────────────────────
-- Wrapped in a transaction: check the reported row count, then COMMIT (or
-- ROLLBACK if it differs from STEP 1).
BEGIN;

UPDATE driver_food_payments fp
SET    payment_date = fp.payment_date + INTERVAL '2 days'
FROM   trucks t
WHERE  fp.truck_id        = t.id
  AND  t.is_subcontractor = true
  AND  t.entity_id        = 2
  AND  fp.payment_date::date = DATE '2026-06-29';

-- Verify, then finish:
--   COMMIT;     -- keep the change
--   ROLLBACK;   -- undo if the count is wrong
COMMIT;
