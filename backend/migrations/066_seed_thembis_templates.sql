-- =================================================================
-- Thembis People (TP) templates seed for Supabase
-- Run AFTER 065_seed_invoice_templates.sql
-- Requires migration 066 columns on invoice_template_line_items:
--   ALTER TABLE invoice_template_line_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,4);
--   ALTER TABLE invoice_template_line_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2);
--   ALTER TABLE invoice_template_line_items ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);
-- =================================================================

-- ── Ensure customers exist under TP entity ─────────────────────
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'TRADEKOR PE (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'TRADEKOR PE (PTY) LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'TRIBAL HOUSE INVESTMENT HOLDING (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'TRIBAL HOUSE INVESTMENT HOLDING (PTY) LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'INTSIMBI HANDLING (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'INTSIMBI HANDLING (PTY) LTD'
  );

-- ── Templates ──────────────────────────────────────────────────

-- TP - Intsimbi Wages Markman
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Intsimbi Wages Markman') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='INTSIMBI HANDLING (PTY) LTD' LIMIT 1),
      'TP - Intsimbi Wages Markman',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'INTSIMBI SITE MARKMAN - LABOUR HOURS', FALSE, 0, 'item', 399600.81);
  END IF;
END $$;

-- TP - Safetec Driver Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Safetec Driver Wages') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='Safetec (PTY) Ltd' LIMIT 1),
      'TP - Safetec Driver Wages',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'DRIVERS WAGES', FALSE, 0, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'JZS095EC - Hollander Aresti (THEM-021)', FALSE, 1, 'item', 40852.17);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KPH748EC - Setlhare Roy (THEM-026)', FALSE, 2, 'item', 44329.03);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KNF472EC - Silomo Sibusiso (THEM-027)', FALSE, 3, 'item', 47199.89);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KPK198EC - Kambinda Luizi (THEM002)', FALSE, 4, 'item', 45475.04);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KMR411EC - Ndlala Simon (THEM004)', FALSE, 5, 'item', 44531.03);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KNS946EC - Mana Abongile (THEM008)', FALSE, 6, 'item', 44061.04);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KBD393EC - Williams Kliffet (THEM011)', FALSE, 7, 'item', 41392.18);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KMT481EC - Mahlamba Sam (THEM028)', FALSE, 8, 'item', 50878.75);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KRM473EC - Pretorius Petrus (THEM031)', FALSE, 9, 'item', 45764.5);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KGJ578EC - Mathe Andries (THEM033)', FALSE, 10, 'item', 37779.31);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KLC159EC - Dimengu Job (THEM037)', FALSE, 11, 'item', 40650.17);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KSZ397EC - Sefadi Stoffel (THEM043)', FALSE, 12, 'item', 50878.71);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KSV060EC - Domingo Samuel (THEM045)', FALSE, 13, 'item', 47198.09);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KFK772EC - Matiwane Phikane (THEM046)', FALSE, 14, 'item', 44328.99);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KRC830EC - Mocwane Jackson (THEM047)', FALSE, 15, 'item', 44328.99);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KDJ034EC - Bosch Randall (THEM048)', FALSE, 16, 'item', 28558.89);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KNP861EC - Tapiwa Ruwatira (THEM049)', FALSE, 17, 'item', 47198.05);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KKF401EC - Mmotsi Samuel (THEM050)', FALSE, 18, 'item', 40650.17);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'JZS083EC - Boss Freek (THEM051)', FALSE, 19, 'item', 37375.31);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KRW188EC - Gaebidiwe Aubry (THEM054)', FALSE, 20, 'item', 43923.21);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'JYC247EC - Hendricks Pieter (THEM056)', FALSE, 21, 'item', 31781.27);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KFT767EC - Maseka Miguel (THEM057)', FALSE, 22, 'item', 44531.03);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'JXP816EC - Sethunya Tshidiso (THEM058)', FALSE, 23, 'item', 44329.03);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KGX782EC - Jacobs Johny (THEM060)', FALSE, 24, 'item', 41054.17);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KDZ484EC - Mohapeloa David (THEM061)', FALSE, 25, 'item', 47199.89);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KPS102EC - Malo Adriaan (THEM062)', FALSE, 26, 'item', 39012.74);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KCY733EC - Voyizana Gerald (THEM063)', FALSE, 27, 'item', 43925.03);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'KSZ633EC - Dintwe Frans (THEM065)', FALSE, 28, 'item', 43668.72);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'JRC117EC - Sekgokwe Matthews (THEM066)', FALSE, 29, 'item', 44329.04);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, NULL, FALSE, 30, 'spacer', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUALS', FALSE, 31, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Johannes', FALSE, 32, 'item', 14500);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Boto', FALSE, 33, 'item', 5100);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Marvin', FALSE, 34, 'item', 5300);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Andre', FALSE, 35, 'item', 7450);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Maskito', FALSE, 36, 'item', 14125);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Ives', FALSE, 37, 'item', 8800);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Jones', FALSE, 38, 'item', 10200);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Piet', FALSE, 39, 'item', 11575);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - David', FALSE, 40, 'item', 12550);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Samuel Jaars', FALSE, 41, 'item', 10200);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'CASUAL - Jady', FALSE, 42, 'item', 7450);
  END IF;
END $$;

-- TP - Tradekor FPT Casuals Not on Payroll
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tradekor FPT Casuals Not on Payroll') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'TP - Tradekor FPT Casuals Not on Payroll',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'FPT CASUALS NOT ON PAYROLL', FALSE, 0, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'SEE ATTACHED SPREADSHEET', FALSE, 1, 'note', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'FPT', FALSE, 2, 'item', 106520.1);
  END IF;
END $$;

-- TP - Tradekor FPT Payroll Employees
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tradekor FPT Payroll Employees') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'TP - Tradekor FPT Payroll Employees',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'THEMBIS PAYROLL EMPLOYEES - FPT', FALSE, 0, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'SEE ATTACHED COSTING REPORT', FALSE, 1, 'item', 1262916.93);
  END IF;
END $$;

-- TP - Tradekor Markman Casuals Not on Payroll
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tradekor Markman Casuals Not on Payroll') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'TP - Tradekor Markman Casuals Not on Payroll',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'MARKMAN CASUALS NOT ON PAYROLL', FALSE, 0, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'SEE ATTACHED SPREADSHEET', FALSE, 1, 'note', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'MARKMAN', FALSE, 2, 'item', 192163.4);
  END IF;
END $$;

-- TP - Tradekor Markman North Payroll
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tradekor Markman North Payroll') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'TP - Tradekor Markman North Payroll',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'THEMBIS PAYROLL EMPLOYEES - MARKMAN NORTH', FALSE, 0, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'SEE ATTACHED COSTING REPORT', FALSE, 1, 'item', 1970636.3);
  END IF;
END $$;

-- TP - Tradekor Markman South Payroll
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tradekor Markman South Payroll') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'TP - Tradekor Markman South Payroll',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'THEMBIS PAYROLL EMPLOYEES - MARKMAN SOUTH', FALSE, 0, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'SEE ATTACHED COSTING REPORT', FALSE, 1, 'item', 2282118.83);
  END IF;
END $$;

-- TP - Tradekor Refund Invoice
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tradekor Refund Invoice') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'TP - Tradekor Refund Invoice',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'TRADEKOR REFUND', FALSE, 0, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'TRANSPORT', FALSE, 1, 'item', 48000);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'HR FUNCTION / DESIRE: STAFF CLOCK HOURS, LEAVE, HEARINGS, SHIFT BOOKING CONTROLS', FALSE, 2, 'item', 21800);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'DESIRE SERVICE REWARD', FALSE, 3, 'item', 4000);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, '1/AFTERNOON SHIFT - MARKMAN SOUTH - SUPERVISION FUNCTIONS', FALSE, 4, 'item', 27832.5);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, '2/TAT SHED - SUPERVISION FUNCTIONS', FALSE, 5, 'item', 9277.5);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'JACO SERVICE REWARD', FALSE, 6, 'item', 2500);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'JAN LE ROUX: FINANCIAL MANAGER', FALSE, 7, 'item', 78452.12);
  END IF;
END $$;

-- TP - Tradekor TAT Payroll
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tradekor TAT Payroll') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'TP - Tradekor TAT Payroll',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'THEMBIS PAYROLL EMPLOYEES - TAT', FALSE, 0, 'header', NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'SEE ATTACHED COSTING REPORT', FALSE, 1, 'item', 420473.64);
  END IF;
END $$;

-- TP - Tradekor Wages Admin Fee
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tradekor Wages Admin Fee') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'TP - Tradekor Wages Admin Fee',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'WAGES ADMIN FEE', FALSE, 0, 'item', 32760);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'AKIHA PERSONNEL PAYROLL', FALSE, 1, 'item', 50211.47);
  END IF;
END $$;

-- TP - Tribal House Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Tribal House Wages') THEN
    INSERT INTO invoice_templates (entity_id, customer_id, name, document_type, is_vat_exempt, vat_rate)
    VALUES (
      _entity_id,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='TRIBAL HOUSE INVESTMENT HOLDING (PTY) LTD' LIMIT 1),
      'TP - Tribal House Wages',
      'invoice',
      FALSE,
      0.15
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'WAGES FOR AV MDINGI (ROY) & AWIVE HOZA', FALSE, 0, 'item', 77967.38);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, amount)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item', 3000);
  END IF;
END $$;
