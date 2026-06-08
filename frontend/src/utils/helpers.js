import { format, parseISO, isValid } from 'date-fns'

// Fixed per-supplier diesel tag: Merino & Oukop are always 'topup',
// everything else (e.g. WBG Diesel) is 'fillup'. Mirrors the backend rule in
// diesel_service.diesel_type_for_supplier. Accepts a supplier object or a name.
export const dieselTypeForSupplier = (supplier) => {
  const name = (typeof supplier === 'string'
    ? supplier
    : `${supplier?.name || ''} ${supplier?.short_name || ''}`).toLowerCase()
  return (name.includes('merino') || name.includes('oukop')) ? 'topup' : 'fillup'
}

export const formatCurrency = (amount) => {
  if (amount == null) return 'R 0.00'
  return `R ${parseFloat(amount).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const formatDate = (dateStr) => {
  if (!dateStr) return '—'
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr
    return isValid(d) ? format(d, 'dd MMM yyyy') : '—'
  } catch { return '—' }
}

export const formatDateTime = (dateStr) => {
  if (!dateStr) return '—'
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr
    return isValid(d) ? format(d, 'dd MMM yyyy HH:mm') : '—'
  } catch { return '—' }
}

export const statusBadgeClass = (status) => {
  const map = { draft: 'draft', ready: 'ready', sent: 'sent', accepted: 'accepted', paid: 'paid', overdue: 'overdue', cancelled: 'cancelled' }
  return `badge badge-${map[status] || 'draft'}`
}

export const statusLabel = (status) => {
  const labels = { draft: 'Draft', ready: 'Ready to Send', sent: 'Sent', accepted: 'Accepted', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled' }
  return labels[status] || status
}

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

// Entities that don't operate trucks — Border Tradepost (BTP) & Thembis People (TP).
// Truck/driver/diesel modules are hidden and their routes blocked for these.
export const NO_TRUCK_ENTITY_CODES = ['BTP', 'TP']
export const TRUCK_MODULES = ['fleet', 'drivers', 'truck_loads', 'diesel']
export const isNoTruckEntity = (entity) => NO_TRUCK_ENTITY_CODES.includes(entity?.code)

export const toISODate = (dateStr) => {
  if (!dateStr) return null
  try { return new Date(dateStr).toISOString() } catch { return null }
}
