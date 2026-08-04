-- Undo for sft_june_bank_info_from_may.py (SFT June 2026, budget 22).
-- Removes the copied Bank Info Summary rows and re-blanks the filled fields.
BEGIN;
DELETE FROM budget_bank_rows WHERE id = 29;
DELETE FROM budget_bank_rows WHERE id = 30;
DELETE FROM budget_bank_rows WHERE id = 31;
DELETE FROM budget_bank_rows WHERE id = 32;
DELETE FROM budget_bank_rows WHERE id = 33;
DELETE FROM budget_bank_rows WHERE id = 34;
DELETE FROM budget_bank_rows WHERE id = 35;
DELETE FROM budget_bank_rows WHERE id = 36;
DELETE FROM budget_bank_rows WHERE id = 37;
COMMIT;
