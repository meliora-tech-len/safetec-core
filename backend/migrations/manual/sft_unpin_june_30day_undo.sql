-- Undo for sft_unpin_june_30day.py (SFT 30 DAY SUPPLIERS, 6/2026).
-- Re-pins the cells and restores the amounts they held when the pin was cleared.
-- NOTE: run this BEFORE any further pull, or a pull will already have
-- overwritten the amounts (the pin is what was stopping it).
BEGIN;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 239;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 248;
UPDATE budget_line_values SET is_overridden = true, amount_due = NULL, amount_paid = 0.00 WHERE id = 256;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 258;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 270;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 298;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 309;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 320;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 1271;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 1273;
UPDATE budget_line_values SET is_overridden = true, amount_due = NULL, amount_paid = 0.00 WHERE id = 1274;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 1275;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 1276;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 1278;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 1279;
UPDATE budget_line_values SET is_overridden = true, amount_due = 0.00, amount_paid = 0.00 WHERE id = 1280;
COMMIT;
