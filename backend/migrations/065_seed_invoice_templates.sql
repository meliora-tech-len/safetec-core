-- =================================================================
-- Invoice Templates: table creation + seed for Supabase/PostgreSQL
-- Run this entire script in the Supabase SQL editor.
-- Safe to re-run: tables use IF NOT EXISTS, inserts skip duplicates.
-- =================================================================

-- ── Create tables ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_templates (
    id SERIAL PRIMARY KEY,
    entity_id INTEGER NOT NULL REFERENCES business_entities(id),
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    name VARCHAR(200) NOT NULL,
    document_type VARCHAR(20) NOT NULL DEFAULT 'invoice',
    is_vat_exempt BOOLEAN NOT NULL DEFAULT FALSE,
    vat_rate NUMERIC(5,4) DEFAULT 0.15,
    notes TEXT,
    print_note BOOLEAN NOT NULL DEFAULT FALSE,
    terms TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_template_line_items (
    id SERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES invoice_templates(id) ON DELETE CASCADE,
    description TEXT,
    is_vat_exempt BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    line_type VARCHAR(20) DEFAULT 'item',
    quantity NUMERIC(12,4),
    unit_price NUMERIC(12,2),
    amount NUMERIC(12,2)
);

CREATE INDEX IF NOT EXISTS ix_invoice_templates_entity_id ON invoice_templates(entity_id);
CREATE INDEX IF NOT EXISTS ix_invoice_template_line_items_template_id ON invoice_template_line_items(template_id);

-- ── Ensure customers exist (insert if not already present) ────────
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'FPT GROUP (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'BTP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'BTP' AND c2.name = 'FPT GROUP (PTY) LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'ALEX MAINTENANCE & ELECTRICAL SERVICES CC', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'ALEX MAINTENANCE & ELECTRICAL SERVICES CC'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'BELORADO INVESTMENTS CC', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'BELORADO INVESTMENTS CC'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'BETOPESS LOGISTICS (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'BETOPESS LOGISTICS (PTY) LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'BOKAMOSHO TRADING PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'BOKAMOSHO TRADING PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'CLS PARTNERS', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'CLS PARTNERS'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'JULIAN TRANSPORT', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'JULIAN TRANSPORT'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'PHEZULU PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'PHEZULU PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'RE AMA SETSHABA LOGISTICS', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'RE AMA SETSHABA LOGISTICS'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'RENEWSOL PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'RENEWSOL PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'SOUTH CAPE CONCRETE FLOORS CC', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'SOUTH CAPE CONCRETE FLOORS CC'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'Safetec (PTY) Ltd', TRUE
FROM business_entities be
WHERE be.code = 'OBHI'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'OBHI' AND c2.name = 'Safetec (PTY) Ltd'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, '7CS PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = '7CS PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'BOKAMOSHO TRADING PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = 'BOKAMOSHO TRADING PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'BORDER TRADEPOST (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = 'BORDER TRADEPOST (PTY) LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'K.R.I.P. PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = 'K.R.I.P. PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'NGQURA TRANSPORT SERVICES', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = 'NGQURA TRANSPORT SERVICES'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'OBHI PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = 'OBHI PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'THEMBIS PEOPLE', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = 'THEMBIS PEOPLE'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'TRADEKOR PE (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = 'TRADEKOR PE (PTY) LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'TRUCK MECH (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'SFT'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'SFT' AND c2.name = 'TRUCK MECH (PTY) LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'BOKAMOSHO TRADING PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'BOKAMOSHO TRADING PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'BORDER TRADE POST (PTY) LTD', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'BORDER TRADE POST (PTY) LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'NARROW PATH TRADING PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'NARROW PATH TRADING PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'OBHI PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'OBHI PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'POLY ACRES PTY LTD', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'POLY ACRES PTY LTD'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'SILVER FALLS TRADING', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'SILVER FALLS TRADING'
  );
INSERT INTO customers (entity_id, name, is_active)
SELECT be.id, 'Safetec (PTY) Ltd', TRUE
FROM business_entities be
WHERE be.code = 'TP'
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    JOIN business_entities be2 ON be2.id = c2.entity_id
    WHERE be2.code = 'TP' AND c2.name = 'Safetec (PTY) Ltd'
  );

-- ── Invoice Templates ──────────────────────────────────────────────

-- BTP: BTP - FPT Broom Operator Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT Broom Operator Wages') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT Broom Operator Wages',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPT BROOM OPERATOR WAGES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'NORMAL HOURS', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SATURDAY HOURS', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SUNDAY & P/H HOURS', FALSE, 4, 'item');
  END IF;
END $$;

-- BTP: BTP - FPT Domestic Worker
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT Domestic Worker') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT Domestic Worker',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPT CLEANER / DOMESTIC WORKER', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '9 HOURS PER DAY', FALSE, 2, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FIXED SALARY PER MONTH ([DATE RANGE])', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OVERTIME HOURS', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SATURDAY HOURS', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SUNDAY HOURS', FALSE, 6, 'item');
  END IF;
END $$;

-- BTP: BTP - FPT Monthly Insurance Costs
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT Monthly Insurance Costs') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT Monthly Insurance Costs',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'MONTHLY COSTS', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
  END IF;
END $$;

-- BTP: BTP - FPT Water Truck Driver Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT Water Truck Driver Wages') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT Water Truck Driver Wages',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVER OF FPT MERCEDES BENZ WATER TRUCK', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'NORMAL HOURS', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SATURDAY HOURS', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SUNDAY HOURS', FALSE, 4, 'item');
  END IF;
END $$;

-- BTP: BTP - FPT Water Truck Hours BPO
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT Water Truck Hours BPO') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT Water Truck Hours BPO',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'PAYMENT FOR CONTRACTORS RECOVERY - WATER TRUCK HOURS-BPO', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'NORMAL', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SATURDAY HOURS', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SUNDAY HOURS', FALSE, 4, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex JPL694EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex JPL694EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex JPL694EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL JPL694EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex JPL694EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex JPL694EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex JPL694EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JPL694EC EXPENSES', FALSE, 0, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex JTH936EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex JTH936EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex JTH936EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL JTH936EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex JTH936EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex JTH936EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex JTH936EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JTH936EC EXPENSES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JTH936EC EXPENSE', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex JZF207EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex JZF207EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex JZF207EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL JZF207EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex JZF207EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex JZF207EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex JZF207EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JZF207EC EXPENSES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JZF207EC EXPENSE', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex JZS468EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex JZS468EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex JZS468EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL JZS468EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex JZS468EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex JZS468EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex JZS468EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JZS468EC EXPENSES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JZS468EC EXPENSE', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex KGW055EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex KGW055EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex KGW055EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KGW055EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex KGW055EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex KGW055EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex KGW055EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KGW055EC EXPENSES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KGW055EC EXPENSE', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex KKP390EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex KKP390EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex KKP390EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KKP390EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex KKP390EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex KKP390EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex KKP390EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KKP390EC EXPENSES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KKP390EC EXPENSE', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex KKP393EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex KKP393EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex KKP393EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KKP393EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Alex KKP393EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Alex KKP393EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='ALEX MAINTENANCE & ELECTRICAL SERVICES CC' LIMIT 1),
      'OBHI - Alex KKP393EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KKP393EC EXPENSES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KKP393EC EXPENSE', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Belorado KRL688EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Belorado KRL688EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='BELORADO INVESTMENTS CC' LIMIT 1),
      'OBHI - Belorado KRL688EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KRL688EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Belorado KRL688EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Belorado KRL688EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='BELORADO INVESTMENTS CC' LIMIT 1),
      'OBHI - Belorado KRL688EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'EXPENSES KRL688EC', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'VAT EXPENSES', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Belorado KRR116EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Belorado KRR116EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='BELORADO INVESTMENTS CC' LIMIT 1),
      'OBHI - Belorado KRR116EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KRR116EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Belorado KRR116EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Belorado KRR116EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='BELORADO INVESTMENTS CC' LIMIT 1),
      'OBHI - Belorado KRR116EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'EXPENSES KRR116EC', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'VAT EXPENSES', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Betopess Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Betopess Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='BETOPESS LOGISTICS (PTY) LTD' LIMIT 1),
      'OBHI - Betopess Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KMC765EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KPV364EC', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KGY077EC', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KKY108EC', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KTK577EC', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 9, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KDS053EC', FALSE, 10, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 11, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KJW398EC', FALSE, 12, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 13, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KKL390EC', FALSE, 14, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 15, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Betopess Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Betopess Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='BETOPESS LOGISTICS (PTY) LTD' LIMIT 1),
      'OBHI - Betopess Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KMC765EC EXPENSES', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KPV364EC EXPENSES', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KJW398EC EXPENSES', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KKY108EC EXPENSES', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KTK577EC EXPENSES', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KDS053EC EXPENSES', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KGY077EC EXPENSES', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KKL390EC EXPENSES', FALSE, 7, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Bokamosho Recoveries
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Bokamosho Recoveries') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='BOKAMOSHO TRADING PTY LTD' LIMIT 1),
      'OBHI - Bokamosho Recoveries',
      'invoice',
      FALSE,
      0.15,
      'KRY BY BIANCA (vir Johan & Venessa kommissie)',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'RECOVERIES FOR EXPENSES PAID OUT OF OBHI', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JOHAN & VENESSA COMMISSION- [MONTH YEAR]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE & ELIAS BREAKDOWNS', FALSE, 2, 'item');
  END IF;
END $$;

-- OBHI: OBHI - CLS Partners Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - CLS Partners Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='CLS PARTNERS' LIMIT 1),
      'OBHI - CLS Partners Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - CLS Partners Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - CLS Partners Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='CLS PARTNERS' LIMIT 1),
      'OBHI - CLS Partners Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'EXPENSES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'INSURANCE', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'VAT EXPENSES', FALSE, 5, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Julian JLX484EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Julian JLX484EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='JULIAN TRANSPORT' LIMIT 1),
      'OBHI - Julian JLX484EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL JLX484EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Julian JLX484EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Julian JLX484EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='JULIAN TRANSPORT' LIMIT 1),
      'OBHI - Julian JLX484EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JLX484EC EXPENSES', FALSE, 0, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Phezulu KRV199EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Phezulu KRV199EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='PHEZULU PTY LTD' LIMIT 1),
      'OBHI - Phezulu KRV199EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KRV199EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Phezulu KRV199EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Phezulu KRV199EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='PHEZULU PTY LTD' LIMIT 1),
      'OBHI - Phezulu KRV199EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'EXPENSES KRV199EC', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'VAT EXPENSES', FALSE, 3, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Re Ama Admin Fee
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Re Ama Admin Fee') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='RE AMA SETSHABA LOGISTICS' LIMIT 1),
      'OBHI - Re Ama Admin Fee',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE DCF980NC ([MONTH])', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE DCS301NC ([MONTH])', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE DDV962NC ([MONTH])', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE EFP053GP ([MONTH])', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DDV962NC & DCF980NC CAMER FEE ([MONTH])', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ERP TRUCKING - [MONTH] DGT484NC', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'YORK WASHBAY DCF980NC & DGM174NC', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'preparing invoices', FALSE, 7, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'preparing monthly statement', FALSE, 8, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'diesel recon', FALSE, 9, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'collecting of slips from driver', FALSE, 10, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'delivering invoices to Tradekor', FALSE, 11, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'emailing invoices and statements', FALSE, 12, 'note');
  END IF;
END $$;

-- OBHI: OBHI - Re Ama DDM652NC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Re Ama DDM652NC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='RE AMA SETSHABA LOGISTICS' LIMIT 1),
      'OBHI - Re Ama DDM652NC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL DDM652NC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Re Ama DDM652NC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Re Ama DDM652NC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='RE AMA SETSHABA LOGISTICS' LIMIT 1),
      'OBHI - Re Ama DDM652NC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DDM652NC EXPENSES', FALSE, 0, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Renewsol Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Renewsol Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='RENEWSOL PTY LTD' LIMIT 1),
      'OBHI - Renewsol Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[MONTH YEAR] DIESEL :', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KPS629EC', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES- TRUCK REPAIRS & WASHES', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KSC007EC', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES- TRUCK REPAIRS & WASHES', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KST708EC', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES- TRUCK REPAIRS & WASHES', FALSE, 6, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Renewsol Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Renewsol Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='RENEWSOL PTY LTD' LIMIT 1),
      'OBHI - Renewsol Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[MONTH YEAR] EXPENSES- KPS629EC', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRUCK REPAIRS', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[MONTH YEAR] EXPENSES- KSC007EC', FALSE, 5, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRUCK REPAIRS', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES', FALSE, 9, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[MONTH YEAR] EXPENSES- KST708EC', FALSE, 10, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL ADMIN FEE', FALSE, 11, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE', FALSE, 12, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRUCK REPAIRS', FALSE, 13, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES', FALSE, 14, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Safetec JRC117EC Installment
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Safetec JRC117EC Installment') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='Safetec (PTY) Ltd' LIMIT 1),
      'OBHI - Safetec JRC117EC Installment',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JRC117EC SAFETEC TRUCK INSTALLMENT GOING OFF IN OBHI', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE] INSTALLMENT', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - Safetec Johan TDK Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - Safetec Johan TDK Wages') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='Safetec (PTY) Ltd' LIMIT 1),
      'OBHI - Safetec Johan TDK Wages',
      'invoice',
      FALSE,
      0.15,
      'AS DAAR N TDK YEARLY INCRASE IS, GAAN DIE BEDRAG VERANDER',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JOHAN TDK PORTION OF WAGES PAID OUT OF OBHI', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
  END IF;
END $$;

-- OBHI: OBHI - South Cape Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - South Cape Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='SOUTH CAPE CONCRETE FLOORS CC' LIMIT 1),
      'OBHI - South Cape Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[MONTH YEAR] DIESEL', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KKV898EC', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JWM651EC', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '207JGXEC', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JXG657EC', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '907JLTEC', FALSE, 9, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 10, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '529FHREC', FALSE, 11, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 12, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KBB933EC', FALSE, 13, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 14, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KFJ378EC', FALSE, 15, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 16, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KMP690EC', FALSE, 17, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER EXPENSES EXCL VAT', FALSE, 18, 'item');
  END IF;
END $$;

-- OBHI: OBHI - South Cape Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'OBHI';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='OBHI - South Cape Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='OBHI' AND c.name='SOUTH CAPE CONCRETE FLOORS CC' LIMIT 1),
      'OBHI - South Cape Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[MONTH YEAR] ADMIN FEE AND EXPENSES', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KKV898EC', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JWM651EC', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '207JGXEC', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JXG657EC', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '907JLTEC', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '529FHREC', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KBB933EC', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KFJ378EC', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KMP690EC', FALSE, 9, 'item');
  END IF;
END $$;

-- SFT: SFT - 7CS KSZ633EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - 7CS KSZ633EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='7CS PTY LTD' LIMIT 1),
      'SFT - 7CS KSZ633EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL KSZ633EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- SFT: SFT - 7CS KSZ633EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - 7CS KSZ633EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='7CS PTY LTD' LIMIT 1),
      'SFT - 7CS KSZ633EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KSZ633EC - EXPENSES', FALSE, 0, 'item');
  END IF;
END $$;

-- SFT: SFT - BTP Recovery Invoice (Aluminium)
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - BTP Recovery Invoice (Aluminium)') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='BORDER TRADEPOST (PTY) LTD' LIMIT 1),
      'SFT - BTP Recovery Invoice (Aluminium)',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BORDER TRADEPOST RECOVERY INVOICE FOR SAFETEC', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'RECOVERY INVOICE FOR ALUMINIUM PURPOSE - MPOFU', FALSE, 2, 'item');
  END IF;
END $$;

-- SFT: SFT - BTP Rental
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - BTP Rental') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='BORDER TRADEPOST (PTY) LTD' LIMIT 1),
      'SFT - BTP Rental',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '16 LOWER VALLEY, SOUTHEND', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OFFICE RENTAL - MONTHLY', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WIFI - MONTHLY', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BUSINESS ONLINE RECOVERIES - MONTHLY', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADOBE', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KONICA MINOLTA', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KONDURA', FALSE, 6, 'item');
  END IF;
END $$;

-- SFT: SFT - BTP Transport Invoice
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - BTP Transport Invoice') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='BORDER TRADEPOST (PTY) LTD' LIMIT 1),
      'SFT - BTP Transport Invoice',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BORDER TRADEPOST INVOICE ON SAFETEC ACCOUNTS', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRANSPORT', FALSE, 2, 'item');
  END IF;
END $$;

-- SFT: SFT - Bokamosho on Safetec Accounts
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Bokamosho on Safetec Accounts') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='BOKAMOSHO TRADING PTY LTD' LIMIT 1),
      'SFT - Bokamosho on Safetec Accounts',
      'invoice',
      FALSE,
      0.15,
      'CONFIRM MET JOHAN. BEDRAG GAAN VERANDER - CHECK MET V & J',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BOKAMOSHO INVOICE ON SAFETEC ACCOUNTS', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DEPOSIT REPAYMENT - TROK', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KONDURA (DOMAIN NAME)', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRAILERS HIRE', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'LISENSIE TRAILERS', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ROADWORTHIES', FALSE, 6, 'item');
  END IF;
END $$;

-- SFT: SFT - KRIP JYC247EC Diesel
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - KRIP JYC247EC Diesel') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='K.R.I.P. PTY LTD' LIMIT 1),
      'SFT - KRIP JYC247EC Diesel',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DIESEL JYC247EC', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OTHER NON VAT EXPENSES', FALSE, 1, 'item');
  END IF;
END $$;

-- SFT: SFT - KRIP JYC247EC Expenses
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - KRIP JYC247EC Expenses') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='K.R.I.P. PTY LTD' LIMIT 1),
      'SFT - KRIP JYC247EC Expenses',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JYC247EC - EXPENSES', FALSE, 0, 'item');
  END IF;
END $$;

-- SFT: SFT - Ngqura Transport
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Ngqura Transport') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='NGQURA TRANSPORT SERVICES' LIMIT 1),
      'SFT - Ngqura Transport',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'NGQURA TRANSPORT (GROBLERSHOOP) - [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ORDER : NTS LOOP [DATE]', FALSE, 1, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KDJ034EC - [SLIP REF] - [DATE]', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KDJ034EC - [SLIP REF] - [DATE]', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KMT481EC - [SLIP REF] - [DATE]', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KMT481EC - [SLIP REF] - [DATE]', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JXP816EC - [SLIP REF] - [DATE]', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JXP816EC - [SLIP REF] - [DATE]', FALSE, 7, 'item');
  END IF;
END $$;

-- SFT: SFT - OBHI Commission
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - OBHI Commission') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='OBHI PTY LTD' LIMIT 1),
      'SFT - OBHI Commission',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OBHI COMMISSION', FALSE, 0, 'item');
  END IF;
END $$;

-- SFT: SFT - OBHI Insurance Trailers
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - OBHI Insurance Trailers') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='OBHI PTY LTD' LIMIT 1),
      'SFT - OBHI Insurance Trailers',
      'invoice',
      FALSE,
      0.15,
      'CHECK INSURANCE SKEDULE ELKE MAAND VIR VERANDERINGE',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ONE SURE INSURANCE TO BE CLAIMED FROM SUBBIES IN OBHI TO BE PAID TO SAFETEC FOR DEBIT ORDER', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JLX484EC - TRUCK INSURANCE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRAILER INSURANCE : JXP754EC - AA9S236WANLVB2046', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRAILER INSURANCE : JXP757EC - AA9S236WANLVB2047', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BIG BOY SLEEP DIE TRAILERS : INSURANCE', FALSE, 4, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRAILER INSURANCE : JVS439EC - AA9S236KANBVB2490', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRAILER INSURANCE : JVS436EC - AA9S236KANBVB2489', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'CLS PARTNER - INSURANCE OP TROK (KTH131EC)', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'CLS PARTNER - INSURANCE OP TRAILER (KNN964NW & KNR426NW)', FALSE, 8, 'item');
  END IF;
END $$;

-- SFT: SFT - OBHI Intsimbi Loads
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - OBHI Intsimbi Loads') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='OBHI PTY LTD' LIMIT 1),
      'SFT - OBHI Intsimbi Loads',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'INTSIMBI LOADS FOR [MONTH YEAR]', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADMIN FEE - [MONTH YEAR]', FALSE, 1, 'item');
  END IF;
END $$;

-- SFT: SFT - OBHI Rental
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - OBHI Rental') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='OBHI PTY LTD' LIMIT 1),
      'SFT - OBHI Rental',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '16 LOWER VALLEY, SOUTHEND', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OFFICE RENTAL - MONTHLY', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WIFI - MONTHLY', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BUSINESS ONLINE RECOVERIES - MONTHLY', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADOBE', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KONICA MINOLTA', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KONDURA', FALSE, 6, 'item');
  END IF;
END $$;

-- SFT: SFT - OBHI Trailer Instalments
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - OBHI Trailer Instalments') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='OBHI PTY LTD' LIMIT 1),
      'SFT - OBHI Trailer Instalments',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRAILOR MONTHLY DEBIT ORDER CLAIM FROM OBHI TO BE PAID TO SAFETEC', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JLX484EC SLEEP TRAILERS', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JXP754EC - AA9S236WANLVB2046', FALSE, 2, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JXP757EC - AA9S236WANLVB2047', FALSE, 3, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DDM652NC SLEEP TRAILERS', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JVS439EC - AA9S236KANBVB2490', FALSE, 5, 'note');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JVS436EC - AA9S236KANBVB2489', FALSE, 6, 'note');
  END IF;
END $$;

-- SFT: SFT - OBHI on Safetec Accounts
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - OBHI on Safetec Accounts') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='OBHI PTY LTD' LIMIT 1),
      'SFT - OBHI on Safetec Accounts',
      'invoice',
      TRUE,
      0,
      'DBL CHECK ELKE MAAND OP DEBIT ORDERS',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OBHI INVOICE ON SAFETEC ACCOUNTS', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRAILER - SAFETEC STOCK USED FOR OBHI', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TYRES - JLX484EC', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ICAM (RE AMA) - DCF980NC / DCB942NC CAMERA SYSTEM', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'LEADER TRAILER (DIESEL - KTH131EC)', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'LISENSIE CLS PARTNERS TRAILERS', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ROADWORTHIES TRAILERS CLS', FALSE, 7, 'item');
  END IF;
END $$;

-- SFT: SFT - Thembis Insurance Bakkies
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Thembis Insurance Bakkies') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='THEMBIS PEOPLE' LIMIT 1),
      'SFT - Thembis Insurance Bakkies',
      'invoice',
      FALSE,
      0.15,
      'CHECK INSURANCE SKEDULE ELKE MAAND VIR VERANDERINGE',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TOYOTA VERSO INSURANCE MONTHLY', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'THEMBI FORTUNER 2.8 GD-6 R/B A/T INSURANCE MONTHLY (KGM491EC)', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2023 : ISUZU D-MAX 1.9 DdI HR LS A/T E-CAB (KDR315EC)', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2023 : ISUZU D-MAX 250C FLEETSIDE S/C P/U (KDR321EC)', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2024 : FORD RANGER 2.0D BI-TURBO WILDRACT 4X2 (THEMBI)', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2026 : AMAROK 3.0TDI V6 (JOHAN)', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'QUANTUM / HIACE 2.5 D-4D - KHG337EC', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TOYOTA LAND CRUISER - KMN678EC', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JOHAN - LAND CRUISER PICK UP INSTALMENT - KJK880EC (SAFETEC)', FALSE, 9, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'LAND CRUISER - KJK880EC', FALSE, 10, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2025 : TOYOTA LAND CRUISER (JOHAN)', FALSE, 11, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2026 : HYUNDAI H100', FALSE, 12, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2026 MECHANICAL BROOM', FALSE, 13, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2026 : HYUNDAI H100', FALSE, 14, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '2026 : LAND CRUISER', FALSE, 15, 'item');
  END IF;
END $$;

-- SFT: SFT - Thembis Intercompany (ICAM)
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Thembis Intercompany (ICAM)') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='THEMBIS PEOPLE' LIMIT 1),
      'SFT - Thembis Intercompany (ICAM)',
      'invoice',
      FALSE,
      0.15,
      'WAG VIR DIE SASFIN EN ICAM DEBIT ORDERS OM BEWERKING TE MAAK',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ICAM MONTHLY SUBSCRIPTION (KDR315EC & KDR321EC & QUANTUM & H100) - [MONTH YEAR]', FALSE, 0, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SOUTHBAY INV--- h100 - TYRES', FALSE, 1, 'item');
  END IF;
END $$;

-- SFT: SFT - Thembis Rental
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Thembis Rental') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='THEMBIS PEOPLE' LIMIT 1),
      'SFT - Thembis Rental',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '16 LOWER VALLEY, SOUTHEND', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'OFFICE RENTAL - MONTHLY', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WIFI - MONTHLY', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BUSINESS ONLINE RECOVERIES - MONTHLY', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ADOBE', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KONICA MINOLTA', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'KONDURA', FALSE, 6, 'item');
  END IF;
END $$;

-- SFT: SFT - Thembis V Oberholzer Commission
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Thembis V Oberholzer Commission') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='THEMBIS PEOPLE' LIMIT 1),
      'SFT - Thembis V Oberholzer Commission',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'V OBERHOLZER WAGES FROM THEMBIS PEOPLE', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'THEMBIS TRADEKOR', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'THEMBIS FPT', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'MEDICAL AID', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'INCREASE', FALSE, 4, 'item');
  END IF;
END $$;

-- SFT: SFT - Tradekor FPT Supervisors
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Tradekor FPT Supervisors') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'SFT - Tradekor FPT Supervisors',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPT SUPERVISORS - [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ZACHARIAS JOHANNES OLEWAGEN - SAF002', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ZACHARIAS JOHANNES OLEWAGEN - SAF002 - RELIEVING ALLOWANCE', FALSE, 2, 'item');
  END IF;
END $$;

-- SFT: SFT - Tradekor Johan Oberholzer Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Tradekor Johan Oberholzer Wages') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'SFT - Tradekor Johan Oberholzer Wages',
      'invoice',
      FALSE,
      0.15,
      'INCREASE JAN 2026 (4%)',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JOHAN OBERHOLZER - OPERATIONS MANAGER - [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPT SITE', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'MARKMAN SOUTH SITE', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'MARKMAN NORTH SITE', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TAT SITE', FALSE, 4, 'item');
  END IF;
END $$;

-- SFT: SFT - Tradekor Safetec Refunds
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Tradekor Safetec Refunds') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'SFT - Tradekor Safetec Refunds',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SAFETEC REFUNDS : [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'Tradekor road repairs Markman South roadworks', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'NEASA', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'COUNCIL LUNCH', FALSE, 3, 'item');
  END IF;
END $$;

-- SFT: SFT - Tradekor Sanitech Toilets
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Tradekor Sanitech Toilets') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='TRADEKOR PE (PTY) LTD' LIMIT 1),
      'SFT - Tradekor Sanitech Toilets',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SAFETEC REFUNDS [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SANITECH CHEVROLET MARKMAN NORTH', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SANITECH CHEVROLET MARKMAN SOUTH', FALSE, 2, 'item');
  END IF;
END $$;

-- SFT: SFT - Truck Mech Workshop Rent
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'SFT';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='SFT - Truck Mech Workshop Rent') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='SFT' AND c.name='TRUCK MECH (PTY) LTD' LIMIT 1),
      'SFT - Truck Mech Workshop Rent',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'MARKMAN WORKSHOP RENT - [MONTH YEAR]', FALSE, 0, 'item');
  END IF;
END $$;

-- TP: TP - BOKAMOSHO Driver Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - BOKAMOSHO Driver Wages') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='BOKAMOSHO TRADING PTY LTD' LIMIT 1),
      'TP - BOKAMOSHO Driver Wages',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'RECOVERIES FOR EXPENSES PAID OUT OF THEMBIS', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES GIEL', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES GODFREY', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TRANSFER FROM THEMBIS (000) - BOKAMOSHO (000)', FALSE, 3, 'item');
  END IF;
END $$;

-- TP: TP - BTP Work Done
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - BTP Work Done') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='BORDER TRADE POST (PTY) LTD' LIMIT 1),
      'TP - BTP Work Done',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE FPT [DATE]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BTP--- FPT RECOVERIES FOR MONTHLY INSURANCE COSTS', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BTP--- FPT [JOB DESCRIPTION]', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BTP--- FPT [JOB DESCRIPTION]', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'BTP--- FPT [JOB DESCRIPTION]', FALSE, 4, 'item');
  END IF;
END $$;

-- TP: TP - Narrow Path Recoveries
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Narrow Path Recoveries') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='NARROW PATH TRADING PTY LTD' LIMIT 1),
      'TP - Narrow Path Recoveries',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'RECOVERIES- [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE WAGES  (R8568 / 4)', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE BREAKDOWNS', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ELIAS WAGES', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ELIAS BREAKDOWNS', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE AFTER HOURS JUSTICE', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE AFTER HOURS ELIAS', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 206 NOMONDE GOGOTYA CLEANER', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 208 SIPHOKAZI ZWAYI CLEANER', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 159 PINYANA LUWEZO SECURITY', FALSE, 9, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM-212 SIKHONA NGXELEWE SECURITY', FALSE, 10, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 193 LUBABALO MBANGEZELI SECURITY', FALSE, 11, 'item');
  END IF;
END $$;

-- TP: TP - OBHI Driver Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - OBHI Driver Wages') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='OBHI PTY LTD' LIMIT 1),
      'TP - OBHI Driver Wages',
      'invoice',
      FALSE,
      0.15,
      'ONTHOU OM NET UIT OBHI KOSGELD HIER OP TE SIT (MINUS)',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES- ZAMANI', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES- AMOS', FALSE, 2, 'item');
  END IF;
END $$;

-- TP: TP - OBHI Recoveries
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - OBHI Recoveries') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='OBHI PTY LTD' LIMIT 1),
      'TP - OBHI Recoveries',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'RECOVERIES- [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE WAGES  (R8568 / 4)', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE BREAKDOWNS', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ELIAS WAGES', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ELIAS BREAKDOWNS', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE AFTER HOURS JUSTICE', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE AFTER HOURS ELIAS', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 206 NOMONDE GOGOTYA CLEANER', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 208 SIPHOKAZI ZWAYI CLEANER', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 159 PINYANA LUWEZO SECURITY', FALSE, 9, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM-212 SIKHONA NGXELEWE SECURITY', FALSE, 10, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 193 LUBABALO MBANGEZELI SECURITY', FALSE, 11, 'item');
  END IF;
END $$;

-- TP: TP - OBHI Tyre Maintenance
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - OBHI Tyre Maintenance') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='OBHI PTY LTD' LIMIT 1),
      'TP - OBHI Tyre Maintenance',
      'invoice',
      FALSE,
      0.15,
      'breakdowns kom nie meer hier nie- thembis invoice obhi apart vir dit !',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'TYRE MAINTENANCE [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'VENESSA REPAYMENTS', FALSE, 1, 'item');
  END IF;
END $$;

-- TP: TP - Polyacres Recoveries
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Polyacres Recoveries') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='POLY ACRES PTY LTD' LIMIT 1),
      'TP - Polyacres Recoveries',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'CLEANER AND SECURITY CHARGES :', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FOR [MONTH] RECOVERIES', FALSE, 1, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 206 NOMONDE GOGOTYA CLEANER', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 208 SIPHOKAZI ZWAYI CLEANER', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 159 PINYANA LUWEZO SECURITY', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM-212 SIKHONA NGXELEWE SECURITY', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 193 LUBABALO MBANGEZELI SECURITY', FALSE, 6, 'item');
  END IF;
END $$;

-- TP: TP - Safetec One Insurance
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Safetec One Insurance') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='Safetec (PTY) Ltd' LIMIT 1),
      'TP - Safetec One Insurance',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ONE INSURANCE DEBIT ORDER', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
  END IF;
END $$;

-- TP: TP - Safetec Recoveries
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Safetec Recoveries') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='Safetec (PTY) Ltd' LIMIT 1),
      'TP - Safetec Recoveries',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'RECOVERIES- [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE WAGES  (R8568 / 4)', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE BREAKDOWNS', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ELIAS WAGES', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ELIAS BREAKDOWNS', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE AFTER HOURS JUSTICE', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE AFTER HOURS ELIAS', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 206 NOMONDE GOGOTYA CLEANER', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 208 SIPHOKAZI ZWAYI CLEANER', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 159 PINYANA LUWEZO SECURITY', FALSE, 9, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM-212 SIKHONA NGXELEWE SECURITY', FALSE, 10, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 193 LUBABALO MBANGEZELI SECURITY', FALSE, 11, 'item');
  END IF;
END $$;

-- TP: TP - Safetec Repayments
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Safetec Repayments') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='Safetec (PTY) Ltd' LIMIT 1),
      'TP - Safetec Repayments',
      'invoice',
      TRUE,
      0,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'SAFETEC REPAYMENTS', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, '[DATE]', FALSE, 1, 'item');
  END IF;
END $$;

-- TP: TP - Silver Falls Recoveries
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP - Silver Falls Recoveries') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='SILVER FALLS TRADING' LIMIT 1),
      'TP - Silver Falls Recoveries',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'RECOVERIES- [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE WAGES  (R8568 / 4)', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'JUSTICE BREAKDOWNS', FALSE, 2, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ELIAS WAGES', FALSE, 3, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'ELIAS BREAKDOWNS', FALSE, 4, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE AFTER HOURS JUSTICE', FALSE, 5, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'WORK DONE AFTER HOURS ELIAS', FALSE, 6, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 206 NOMONDE GOGOTYA CLEANER', FALSE, 7, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 208 SIPHOKAZI ZWAYI CLEANER', FALSE, 8, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 159 PINYANA LUWEZO SECURITY', FALSE, 9, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM-212 SIKHONA NGXELEWE SECURITY', FALSE, 10, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'FPTM- 193 LUBABALO MBANGEZELI SECURITY', FALSE, 11, 'item');
  END IF;
END $$;

-- TP: TP → OBHI Driver Wages
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'TP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='TP → OBHI Driver Wages') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='TP' AND c.name='OBHI PTY LTD' LIMIT 1),
      'TP → OBHI Driver Wages',
      'invoice',
      FALSE,
      0.15,
      'ONTHOU OM NET UIT OBHI KOSGELD HIER OP TE SIT (MINUS)',
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES [MONTH YEAR]', FALSE, 0, 'header');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES- ZAMANI', FALSE, 1, 'item');
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type)
    VALUES (_tmpl_id, 'DRIVERS WAGES- AMOS', FALSE, 2, 'item');
  END IF;
END $$;
