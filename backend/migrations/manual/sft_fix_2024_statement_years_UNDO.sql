-- UNDO for sft_fix_2024_statement_years.py
BEGIN;
update truck_loads set statement_year = 2024 where id = 2079;
update truck_loads set statement_year = 2024 where id = 2562;
COMMIT;
