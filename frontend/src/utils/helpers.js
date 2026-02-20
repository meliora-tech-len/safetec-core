import { format, parseISO, isValid } from 'date-fns'

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
  const map = { draft: 'draft', sent: 'sent', paid: 'paid', overdue: 'overdue', cancelled: 'cancelled' }
  return `badge badge-${map[status] || 'draft'}`
}

export const docTypeBadgeClass = (type) => `badge badge-${type}`

export const errorMessage = (err) =>
  err?.response?.data?.detail || err?.message || 'An error occurred'

export const toISODate = (dateStr) => {
  if (!dateStr) return null
  try { return new Date(dateStr).toISOString() } catch { return null }
}
