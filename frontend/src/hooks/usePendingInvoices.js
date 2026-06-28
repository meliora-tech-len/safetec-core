import { useState, useEffect, useCallback } from 'react'
import { getPendingSupplierInvoices, skipPendingVerification } from '../services/api'

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

  // Dismiss one invoice from the list. Optimistically drops the row; on failure
  // it's restored so the count stays honest.
  const skip = useCallback((id) => {
    let removed
    setInvoices(prev => {
      removed = prev.find(i => i.id === id)
      return prev.filter(i => i.id !== id)
    })
    return skipPendingVerification(id).catch(err => {
      if (removed) setInvoices(prev => [...prev, removed])
      throw err
    })
  }, [])

  return { invoices, count: invoices.length, loading, reload, skip }
}
