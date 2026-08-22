# Migrations

Numbered, hand-run scripts (no runner, no tracking table). Python scripts use
SQLAlchemy `text()` and are run from `backend/` with the venv python; `.sql`
files are run in the Supabase SQL editor.

```
cd backend
venv/Scripts/python migrations/134_whatever.py
```

**⚠️ `backend/.env` points at the LIVE production Supabase** — running a
migration locally runs it against production. There is no isolated dev DB.

## Rules

- **Never edit or renumber an applied migration.** They are the historical
  record of what ran against prod. New work always takes the next free number.
- Highest number as of 2026-08-22: **134**
  (`134_supplier_invoice_lock_rename.py`, applied to prod 2026-08-22 at deploy —
  an empty `supplier_invoice_locks` shell left by an earlier create_all run had
  to be dropped first). Next free number: **135**.
- Schema/feature changes get a numbered migration. One-off *data* fixes
  (backfills, restores, deletions for a specific incident) go in `manual/`
  instead — unnumbered, named for what they did, ideally with a paired
  `*_undo.sql`.

## Known numbering quirks (documented, deliberately not "fixed")

- `065_invoice_templates.py` + `065_seed_invoice_templates.sql` — intentional
  pair (schema + its seed).
- `066_seed_thembis_templates.sql` vs `066_template_line_item_amounts.py` —
  accidental collision, both applied.
- `082_additional_load_extras_and_rates.py` vs `082_value_verifications.py` —
  accidental collision, both applied.
- `130_diesel_type_all_suppliers.py` vs `130_supplier_statements.py` —
  accidental collision, both applied.
- `069` was never used (gap between 068 and 070).

## `manual/`

One-off production data fixes, kept as the audit trail of what was run and
when, with undo scripts where reversal was possible. These are spent — do not
re-run them without reading the header comments first; some are destructive
(`delete_bokamosho_diesel.sql`) and some are idempotent remediations
(`cleanup_intsimbi_lump_placeholders.py`, dry-run by default, `--commit` to
apply).
