import { format, parseISO, isValid } from 'date-fns'

// Month-name arrays in the two indexing conventions used across pages.
// The *_1 lists have a deliberate blank at index 0 so LIST[monthNumber] works
// for 1-based month numbers; the *_0 lists are plain 0-indexed. Never mix.
export const MONTHS_LONG_0 = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const MONTHS_LONG_1 = ['', ...MONTHS_LONG_0]
export const MONTHS_SHORT_0 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_SHORT_1 = ['', ...MONTHS_SHORT_0]

// Fixed per-supplier diesel tag: Merino & Oukop are always 'topup',
// everything else (e.g. WBG Diesel) is 'fillup'. Mirrors the backend rule in
// diesel_service.diesel_type_for_supplier. Accepts a supplier object or a name.
export const dieselTypeForSupplier = (supplier) => {
  const name = (typeof supplier === 'string'
    ? supplier
    : `${supplier?.name || ''} ${supplier?.short_name || ''}`).toLowerCase()
  return (name.includes('merino') || name.includes('oukop')) ? 'topup' : 'fillup'
}

// Amounts use a non-breaking space (U+00A0) after R so the symbol never wraps onto its own line in narrow
// table columns; en-ZA grouping separators are already non-breaking.
export const formatCurrency = (amount) => {
  const n = parseFloat(amount)
  if (!Number.isFinite(n)) return 'R 0.00'
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const formatDate = (dateStr) => {
  if (!dateStr) return '—'
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr
    return isValid(d) ? format(d, 'dd MMM yyyy') : '—'
  } catch { return '—' }
}

export const formatDateTime = (dateStr) => {
  if (!dateStr) return '—'
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr
    return isValid(d) ? format(d, 'dd MMM yyyy HH:mm') : '—'
  } catch { return '—' }
}

// Single source for the invoice/quote/PO status vocabulary (mirrors the
// backend InvoiceStatus enum in models.py). Order matters: it is the order
// statuses appear in pickers.
export const INVOICE_STATUS_LABELS = {
  draft: 'Draft', ready: 'Ready to Send', sent: 'Sent', accepted: 'Accepted',
  paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled',
}
export const INVOICE_STATUSES = Object.keys(INVOICE_STATUS_LABELS)

export const statusBadgeClass = (status) =>
  `badge badge-${INVOICE_STATUSES.includes(status) ? status : 'draft'}`

export const statusLabel = (status) => INVOICE_STATUS_LABELS[status] || status

export const docTypeBadgeClass = (type) => `badge badge-${type}`

// Extract a human-readable string from any API error shape.
// Handles axios errors (err.response.data.detail), raw-fetch rejects (err.detail),
// FastAPI 422 arrays of {loc, msg, type}, plain objects, and strings.
// ALWAYS returns a string, so the result is safe to pass to toast()/JSX —
// rendering a raw object/array as a React child throws (React error #31).
export const errorMessage = (err, fallback = 'An error occurred') => {
  if (typeof err === 'string') return err
  const detail = err?.response?.data?.detail ?? err?.detail
  const coerce = (d) => {
    if (d == null) return null
    if (typeof d === 'string') return d
    if (Array.isArray(d))
      return d.map(e => (typeof e === 'string' ? e : e?.msg)).filter(Boolean).join(', ') || null
    if (typeof d === 'object') return d.msg || d.message || d.detail || null
    return String(d)
  }
  return coerce(detail) || err?.message || fallback
}

// VAT rate from the entity's SAVED vat_rate (mirrors backend services/vat.py) —
// never hardcode 0.15/1.15 in rand maths; 0.15 here is only the fallback for a
// missing entity or NULL rate. Multiply by (1 + entityVatRate(...)) for incl-VAT.
export const entityVatRate = (entities, entityId) => {
  const e = (entities || []).find(x => String(x.id) === String(entityId))
  return e?.vat_rate != null ? parseFloat(e.vat_rate) : 0.15
}

// Entities that don't operate trucks — Border Tradepost (BTP) & Thembis People (TP).
// Truck/driver/diesel modules are hidden and their routes blocked for these.
export const NO_TRUCK_ENTITY_CODES = ['BTP', 'TP']
export const TRUCK_MODULES = ['fleet', 'drivers', 'truck_loads', 'diesel']
export const isNoTruckEntity = (entity) => NO_TRUCK_ENTITY_CODES.includes(entity?.code)

export const toISODate = (dateStr) => {
  if (!dateStr) return null
  try { return new Date(dateStr).toISOString() } catch { return null }
}
