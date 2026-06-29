-- ============================================================================
-- Move OBHI subcontractor Food Allowance entries from the JUNE pay cycle to the
-- JULY 2026 pay cycle (so they show under July Truck Loads, not June).
-- ----------------------------------------------------------------------------
-- WHY THIS IS NEEDED
--   A food payment's statement period is decided by the PAY CYCLE it is attached
--   to (driver_pay_cycles.pay_year / pay_month) — NOT by payment_date. The Truck
--   Loads "Food Allowance" tab filters on the cycle's year/month and only uses
--   payment_date for ordering. So the earlier re-date script (29 Jun -> 1 Jul)
--   changed the displayed date but left the rows on each driver's JUNE cycle,
--   keeping them under the June statement period.
--
-- WHAT THIS DOES
--   1. Creates a July 2026 pay cycle for any affected driver that doesn't have
--      one yet (blank load counts — they re-sync from truck loads when the July
--      cycle is opened in the app).
--   2. Re-points the re-dated food payments (payment_date = 2026-07-01) from the
--      June cycle to that driver's July cycle.
--
-- SCOPE  Food payments on a 2026-06 cycle, captured against a truck that is
--        is_subcontractor = true AND entity_id = 2 (OBHI), dated 2026-07-01.
--        (Run the previous re-date script FIRST so the dates are already 1 Jul.)
--
-- Run in the Supabase SQL editor. STEP 1 previews; STEP 2 applies in a txn.
-- ============================================================================

-- ── STEP 1: PREVIEW (read-only) — these are the rows that will be moved ──────
SELECT fp.id,
       fp.payment_date,
       fp.amount,
       d.first_name || ' ' || d.last_name AS driver,
       t.registration                      AS truck,
       jun.id   AS june_cycle_id,
       jul.id   AS july_cycle_id            -- NULL = July cycle will be created
FROM   driver_food_payments fp
JOIN   driver_pay_cycles jun ON jun.id = fp.pay_cycle_id
JOIN   trucks t              ON t.id  = fp.truck_id
JOIN   drivers d            ON d.id  = jun.driver_id
LEFT   JOIN driver_pay_cycles jul
       ON jul.driver_id = jun.driver_id
      AND jul.pay_year  = 2026
      AND jul.pay_month = 7
WHERE  jun.pay_year  = 2026
  AND  jun.pay_month = 6
  AND  t.is_subcontractor    = true
  AND  t.entity_id           = 2
  AND  fp.payment_date::date = DATE '2026-07-01'
ORDER  BY t.registration, driver;

-- ── STEP 2: APPLY — run after the preview looks correct ──────────────────────
BEGIN;

-- 2a) Create a July 2026 cycle for affected drivers that don't have one yet.
--     NOT NULL load-count columns are seeded to 0; opening the July cycle in the
--     app re-syncs them from the actual July truck loads.
INSERT INTO driver_pay_cycles (
    driver_id, pay_year, pay_month, payroll_settings_id,
    lohatla_base_loads, lohatla_extra_loads,
    casual_group_a_loads, casual_group_b_loads,
    permanent_split_loads, casual_split_group_a_loads, casual_split_group_b_loads,
    assmang_loads, assmang_split_loads
)
SELECT DISTINCT
    jun.driver_id, 2026, 7, jun.payroll_settings_id,
    0, 0,
    0, 0,
    0, 0, 0,
    0, 0
FROM   driver_food_payments fp
JOIN   driver_pay_cycles jun ON jun.id = fp.pay_cycle_id
JOIN   trucks t              ON t.id  = fp.truck_id
WHERE  jun.pay_year  = 2026
  AND  jun.pay_month = 6
  AND  t.is_subcontractor    = true
  AND  t.entity_id           = 2
  AND  fp.payment_date::date = DATE '2026-07-01'
  AND  NOT EXISTS (
        SELECT 1 FROM driver_pay_cycles jul
        WHERE  jul.driver_id = jun.driver_id
          AND  jul.pay_year  = 2026
          AND  jul.pay_month = 7
  );

-- 2b) Re-point the matched food payments onto the July cycle.
UPDATE driver_food_payments fp
SET    pay_cycle_id = jul.id
FROM   driver_pay_cycles jun,
       driver_pay_cycles jul,
       trucks t
WHERE  fp.pay_cycle_id      = jun.id
  AND  jun.pay_year         = 2026
  AND  jun.pay_month        = 6
  AND  jul.driver_id        = jun.driver_id
  AND  jul.pay_year         = 2026
  AND  jul.pay_month        = 7
  AND  t.id                 = fp.truck_id
  AND  t.is_subcontractor   = true
  AND  t.entity_id          = 2
  AND  fp.payment_date::date = DATE '2026-07-01';

-- Verify the moved-row count matches STEP 1, then finish:
--   COMMIT;     -- keep the change
--   ROLLBACK;   -- undo if the count is wrong
COMMIT;
