-- ============================================================
-- Clear transactional data for OBHI (entity_id = 2)
-- Keeps: trucks, trailers, drivers, customers, suppliers,
--        subcontractors, diesel rates/settings, mine rates,
--        driver salary configs, user access, business entity row.
--
-- HOW TO USE:
--   1. Run the SELECT block below first to preview row counts.
--   2. Run the DELETE block inside a transaction.
--      Supabase SQL editor: paste the whole thing and run —
--      it will commit automatically. Wrap in BEGIN/ROLLBACK
--      first if you want a dry run.
-- ============================================================

-- ── 1. PREVIEW (run this first to check counts) ──────────────

SELECT 'driver_trip_logs'            AS table_name, COUNT(*) AS rows FROM driver_trip_logs       WHERE pay_cycle_id IN (SELECT id FROM driver_pay_cycles WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2))
UNION ALL
SELECT 'driver_additional_loads',                   COUNT(*)         FROM driver_additional_loads WHERE pay_cycle_id IN (SELECT id FROM driver_pay_cycles WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2))
UNION ALL
SELECT 'driver_food_payments',                      COUNT(*)         FROM driver_food_payments    WHERE pay_cycle_id IN (SELECT id FROM driver_pay_cycles WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2))
UNION ALL
SELECT 'driver_pay_cycles',                         COUNT(*)         FROM driver_pay_cycles       WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2)
UNION ALL
SELECT 'driver_loads',                              COUNT(*)         FROM driver_loads             WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2)
UNION ALL
SELECT 'driver_payments',                           COUNT(*)         FROM driver_payments          WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2)
UNION ALL
SELECT 'payroll_entries',                           COUNT(*)         FROM payroll_entries          WHERE entity_id = 2
UNION ALL
SELECT 'diesel_fillups',                            COUNT(*)         FROM diesel_fillups           WHERE entity_id = 2
UNION ALL
SELECT 'truck_monthly_expenses',                    COUNT(*)         FROM truck_monthly_expenses   WHERE truck_id IN (SELECT id FROM trucks WHERE entity_id = 2)
UNION ALL
SELECT 'truck_loads',                               COUNT(*)         FROM truck_loads              WHERE entity_id = 2
UNION ALL
SELECT 'invoice_line_items',                        COUNT(*)         FROM invoice_line_items       WHERE invoice_id IN (SELECT id FROM invoices WHERE entity_id = 2)
UNION ALL
SELECT 'invoices',                                  COUNT(*)         FROM invoices                 WHERE entity_id = 2
UNION ALL
SELECT 'supplier_invoice_line_items',               COUNT(*)         FROM supplier_invoice_line_items WHERE invoice_id IN (SELECT id FROM supplier_invoices WHERE entity_id = 2)
UNION ALL
SELECT 'supplier_invoices',                         COUNT(*)         FROM supplier_invoices        WHERE entity_id = 2
UNION ALL
SELECT 'audit_logs',                                COUNT(*)         FROM audit_logs               WHERE entity_id = 2;


-- ── 2. DELETE (paste into Supabase SQL editor and run) ────────

BEGIN;

-- Driver pay cycle children
DELETE FROM driver_trip_logs
WHERE pay_cycle_id IN (
    SELECT id FROM driver_pay_cycles
    WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2)
);

DELETE FROM driver_additional_loads
WHERE pay_cycle_id IN (
    SELECT id FROM driver_pay_cycles
    WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2)
);

DELETE FROM driver_food_payments
WHERE pay_cycle_id IN (
    SELECT id FROM driver_pay_cycles
    WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2)
);

-- Driver pay cycles, loads, payments
DELETE FROM driver_pay_cycles
WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2);

DELETE FROM driver_loads
WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2);

DELETE FROM driver_payments
WHERE driver_id IN (SELECT id FROM drivers WHERE entity_id = 2);

-- Payroll entries
DELETE FROM payroll_entries WHERE entity_id = 2;

-- Diesel fill-ups
DELETE FROM diesel_fillups WHERE entity_id = 2;

-- Truck monthly expenses
DELETE FROM truck_monthly_expenses
WHERE truck_id IN (SELECT id FROM trucks WHERE entity_id = 2);

-- Truck loads
DELETE FROM truck_loads WHERE entity_id = 2;

-- Invoices
DELETE FROM invoice_line_items
WHERE invoice_id IN (SELECT id FROM invoices WHERE entity_id = 2);

DELETE FROM invoices WHERE entity_id = 2;

-- Supplier invoices
DELETE FROM supplier_invoice_line_items
WHERE invoice_id IN (SELECT id FROM supplier_invoices WHERE entity_id = 2);

DELETE FROM supplier_invoices WHERE entity_id = 2;

-- Audit logs
DELETE FROM audit_logs WHERE entity_id = 2;

-- Optional: reset invoice/quote counters back to 0
-- UPDATE business_entities SET invoice_counter = 0, quote_counter = 0 WHERE id = 2;

COMMIT;
