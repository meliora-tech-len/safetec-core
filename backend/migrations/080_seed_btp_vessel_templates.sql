-- =================================================================
-- BTP vessel invoice templates (FPT Group) — Supabase/PostgreSQL
-- Run this entire script in the Supabase SQL editor.
-- Safe to re-run: each template is skipped if it already exists.
-- Adds: Grey Fox, New Destiny, Shun Fu (x2), Yuang Fu.
-- (African Dove / Frambo Prospect / DSI Altair already seeded.)
-- =================================================================

-- BTP: BTP - FPT MV Grey Fox - Steel Coils
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT MV Grey Fox - Steel Coils') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT MV Grey Fox - Steel Coils',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'M.V. Grey Fox - 100536 - Commenced - 18H23 - 16/01/2026 - Completed - 18H35 - 17/01/2026.', FALSE, 0, 'note', NULL, NULL, NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'STEEL COILS', FALSE, 1, 'item', 3712.127, 33.33, 123725.19);
  END IF;
END $$;

-- BTP: BTP - FPT MV New Destiny - Sebilo Manganese
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT MV New Destiny - Sebilo Manganese') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT MV New Destiny - Sebilo Manganese',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'M.V. New Destiny - 100533 - Commenced - 04H02 - 13/01/2026 - Completed - 21H25 - 18/01/2026 - 49 057 tons Manganese - Sebilo.', FALSE, 0, 'note', NULL, NULL, NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'SEBILO MANGANESE - PE', FALSE, 1, 'item', 49057, 4.49, 220265.93);
  END IF;
END $$;

-- BTP: BTP - FPT MV Shun Fu - WMA Manganese
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT MV Shun Fu - WMA Manganese') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT MV Shun Fu - WMA Manganese',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'M.V. Shun Fu - 100535 - Commenced - 22H58 - 13/01/2026 - Completed - 13H06 - 22/01/2026 - 43 525 tons Manganese - WMA - Coega.', FALSE, 0, 'note', NULL, NULL, NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'WMA MANGANESE - COEGA', FALSE, 1, 'item', 43525, 4.49, 195427.25);
  END IF;
END $$;

-- BTP: BTP - FPT MV Shun Fu - Site Kanteen & Toilets
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT MV Shun Fu - Site Kanteen & Toilets') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT MV Shun Fu - Site Kanteen & Toilets',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'M.V. Shun Fu - 100535 - Commenced - 22H58 - 13/01/2026 - Completed - 13H06 - 22/01/2026 - 43 525 tons Manganese - WMA - Coega.', FALSE, 0, 'note', NULL, NULL, NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'SITE OFFICE/KANTEEN TRAILOR', FALSE, 1, 'item', NULL, NULL, 9842);
  END IF;
END $$;

-- BTP: BTP - FPT MV Yuang Fu - Glencore Manganese
DO $$
DECLARE
  _tmpl_id INTEGER;
  _entity_id INTEGER;
BEGIN
  SELECT id INTO _entity_id FROM business_entities WHERE code = 'BTP';
  IF NOT EXISTS (SELECT 1 FROM invoice_templates WHERE entity_id=_entity_id AND name='BTP - FPT MV Yuang Fu - Glencore Manganese') THEN
    INSERT INTO invoice_templates (entity_id, supplier_id, customer_id, name, document_type, is_vat_exempt, vat_rate, notes, print_note, terms)
    VALUES (
      _entity_id,
      NULL,
      (SELECT c.id FROM customers c JOIN business_entities be ON be.id=c.entity_id WHERE be.code='BTP' AND c.name='FPT GROUP (PTY) LTD' LIMIT 1),
      'BTP - FPT MV Yuang Fu - Glencore Manganese',
      'invoice',
      FALSE,
      0.15,
      NULL,
      FALSE,
      NULL
    )
    RETURNING id INTO _tmpl_id;
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'M.V. Yuang Fu - 100538 - Commenced - 18H20 - 25/01/2026 - Completed - 23H22 - 31/01/2026 - 42 700 tons Manganese - P.E. - Glencore.', FALSE, 0, 'note', NULL, NULL, NULL);
    INSERT INTO invoice_template_line_items (template_id, description, is_vat_exempt, sort_order, line_type, quantity, unit_price, amount)
    VALUES (_tmpl_id, 'GLENCORE MANGANESE - PE', FALSE, 1, 'item', 42700, 4.49, 191723);
  END IF;
END $$;
