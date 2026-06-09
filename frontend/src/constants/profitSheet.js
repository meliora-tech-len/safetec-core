// Profit Sheet default expenses
// ─────────────────────────────────────────────────────────────────────────────
// Standard, recurring Profit Sheet expense lines whose default amounts are set
// once in Settings and pulled through to every NEW Safetec profit sheet. They are
// matched to profit-sheet rows by description (case-insensitive). Wages
// (Driver's Salary / Casual Wages) are intentionally excluded — those are entered
// per truck each month.
//
// Keep these descriptions identical to the labels seeded in the profit sheet
// (EXPENSE_ROWS + DEFAULT_PRESET_LINES in TruckLoadProfilePage) so the defaults
// land on the right rows.

export const PROFIT_SHEET_DEFAULTS_KEY = 'profit_sheet_defaults'

export const PROFIT_SHEET_DEFAULT_FIELDS = [
  'Insurance Trailer',
  '3rd Party Liability',
  'Goods in Transit',
  'Loss of Use',
  'Personal Accident',
  'Communication Device',
  'SASRIA',
  'Diesel',
  'Tyre Maintenance',
  'Other Suppliers',
  'Insurance Truck',
  'Contract',
  'Theft Truck',
  'Theft Trailer',
  '5% of Sum Insured',
  'Trailer Maintenance',
  'Truck Monthly Payment',
  'Trailers Monthly Payment',
  'Sasfin',
]

// Parse the stored JSON setting value into a { description: number } map.
export function parseProfitSheetDefaults(value) {
  if (!value) return {}
  try {
    const obj = JSON.parse(value)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}
