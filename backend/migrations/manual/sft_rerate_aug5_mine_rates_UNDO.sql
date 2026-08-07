-- UNDO for sft_rerate_aug5_mine_rates.py
BEGIN;
update truck_loads set rate_per_ton = 855.00, amount_excl_vat = 32985.90, amount_incl_vat = 37933.78, subcontractor_rate = NULL, subcontractor_amount_excl_vat = NULL, subcontractor_amount_incl_vat = NULL where id = 2614;
update truck_loads set rate_per_ton = 855.00, amount_excl_vat = 32592.60, amount_incl_vat = 37481.49, subcontractor_rate = NULL, subcontractor_amount_excl_vat = NULL, subcontractor_amount_incl_vat = NULL where id = 2627;
update truck_loads set rate_per_ton = 855.00, amount_excl_vat = 32814.90, amount_incl_vat = 37737.14, subcontractor_rate = NULL, subcontractor_amount_excl_vat = NULL, subcontractor_amount_incl_vat = NULL where id = 2628;
update truck_loads set rate_per_ton = 855.00, amount_excl_vat = 32678.10, amount_incl_vat = 37579.82, subcontractor_rate = NULL, subcontractor_amount_excl_vat = NULL, subcontractor_amount_incl_vat = NULL where id = 2629;
update truck_loads set rate_per_ton = 855.00, amount_excl_vat = 33225.30, amount_incl_vat = 38209.10, subcontractor_rate = 850.00, subcontractor_amount_excl_vat = 33031.00, subcontractor_amount_incl_vat = 37985.65 where id = 2631;
update truck_loads set rate_per_ton = 855.00, amount_excl_vat = 32780.70, amount_incl_vat = 37697.80, subcontractor_rate = NULL, subcontractor_amount_excl_vat = NULL, subcontractor_amount_incl_vat = NULL where id = 2633;
update truck_loads set rate_per_ton = 855.00, amount_excl_vat = 32746.50, amount_incl_vat = 37658.48, subcontractor_rate = NULL, subcontractor_amount_excl_vat = NULL, subcontractor_amount_incl_vat = NULL where id = 2634;
update truck_loads set rate_per_ton = 855.00, amount_excl_vat = 33071.40, amount_incl_vat = 38032.11, subcontractor_rate = NULL, subcontractor_amount_excl_vat = NULL, subcontractor_amount_incl_vat = NULL where id = 2636;
update truck_loads set rate_per_ton = 858.00, amount_excl_vat = 33170.28, amount_incl_vat = 38145.82, subcontractor_rate = NULL, subcontractor_amount_excl_vat = NULL, subcontractor_amount_incl_vat = NULL where id = 2626;
COMMIT;
