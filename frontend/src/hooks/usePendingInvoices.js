import { useState, useEffect, useCallback } from 'react'
import { getPendingSupplierInvoices } from '../services/api'

/**
 * Recently-created supplier invoices not yet final-locked (admin "needs
 * verification" badge/modal). Scoped server-side to the user's entities.
 * Pass `enabled=false` (e.g. non-admins) to skip the fetch entirely.
 */
export function usePendingInvoices(enabled = true) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(() => {
    if (!enabled) { setInvoices([]); return }
    setLoading(true)
    getPendingSupplierInvoices()
      .then(r => setInvoices(r.data || []))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false))
  }, [enabled])

  useEffect(() => { reload() }, [reload])

  return { invoices, count: invoices.length, loading, reload }
}
