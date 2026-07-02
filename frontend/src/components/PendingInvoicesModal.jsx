import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { X, AlertCircle, ChevronRight } from 'lucide-react'
import { formatCurrency, errorMessage } from '../utils/helpers'

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function verifyState(inv) {
  if (inv.verified2_by_initials) return { label: `${inv.verified_by_initials} · ${inv.verified2_by_initials}`, color: '#16a34a', note: '2 ticks — awaiting final lock' }
  if (inv.verified_by_initials)  return { label: inv.verified_by_initials, color: '#d97706', note: '1 tick — needs 2nd' }
  return { label: 'Not started', color: 'var(--danger)', note: 'No verification yet' }
}

const periodKey = (inv) => (inv.statement_month ? `${inv.statement_year}-${inv.statement_month}` : '')

/**
 * Lists supplier invoices created recently that aren't final-locked, with
 * client-side entity + statement-period filters (derived from the fetched set).
 * Clicking a row (with a registered supplier) opens that supplier's profile,
 * deep-linked to the invoice so it scrolls into view and highlights.
 */
export default function PendingInvoicesModal({ invoices, loading, onClose, onSkip }) {
  const navigate = useNavigate()
  const [entity, setEntity] = useState('')   // entity_id as string, '' = all
  const [period, setPeriod] = useState('')   // 'year-month', '' = all
  const [skipping, setSkipping] = useState(() => new Set())  // ids being dismissed

  // Dismiss an invoice from the list without final-locking it.
  const skip = (e, inv) => {
    e.stopPropagation()  // don't trigger the row's navigate
    if (!onSkip || skipping.has(inv.id)) return
    setSkipping(prev => new Set(prev).add(inv.id))
    Promise.resolve(onSkip(inv.id))
      .catch(err => {
        toast.error(errorMessage(err, 'Could not skip this invoice'))
        setSkipping(prev => { const n = new Set(prev); n.delete(inv.id); return n })
      })
  }

  // Distinct entities and periods present in the current result set.
  const entityOpts = useMemo(() => {
    const seen = new Map()
    for (const inv of invoices) {
      if (inv.entity_id != null && !seen.has(inv.entity_id)) {
        seen.set(inv.entity_id, inv.entity_code || `Entity ${inv.entity_id}`)
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [invoices])

  const periodOpts = useMemo(() => {
    const seen = new Set()
    for (const inv of invoices) { const k = periodKey(inv); if (k) seen.add(k) }
    return [...seen]
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))  // newest first
      .map(k => {
        const [y, m] = k.split('-')
        return { key: k, label: `${MONTH_NAMES[+m]} ${y}` }
      })
  }, [invoices])

  const filtered = useMemo(() => invoices.filter(inv =>
    (!entity || String(inv.entity_id) === entity) &&
    (!period || periodKey(inv) === period)
  ), [invoices, entity, period])

  // Registered-supplier invoices open the supplier profile (deep-linked to the
  // invoice); one-off expenses open the costing sheet they were captured on.
  const targetFor = (inv) =>
    inv.supplier_id ? `/suppliers/${inv.supplier_id}?invoice=${inv.id}` : (inv.source_url || null)

  const go = (inv) => {
    const target = targetFor(inv)
    if (!target) return
    onClose()
    navigate(target)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 860 }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} color="var(--warning)" />
            Supplier invoices to verify
            {!loading && (
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>
                {filtered.length}{filtered.length !== invoices.length ? ` of ${invoices.length}` : ''}
              </span>
            )}
          </h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            Created in the last 7 days and not yet final-locked. Click one to open it for verification.
          </p>

          {!loading && invoices.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <select value={entity} onChange={e => setEntity(e.target.value)} style={{ width: 170 }}>
                <option value="">All entities</option>
                {entityOpts.map(([id, code]) => <option key={id} value={String(id)}>{code}</option>)}
              </select>
              <select value={period} onChange={e => setPeriod(e.target.value)} style={{ width: 170 }}>
                <option value="">All periods</option>
                {periodOpts.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              {(entity || period) && (
                <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => { setEntity(''); setPeriod('') }}>
                  Clear
                </button>
              )}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : invoices.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}><p>Nothing waiting — all caught up.</p></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}><p>No invoices match these filters.</p></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Type / Source</th>
                  <th>Invoice #</th>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Verified</th>
                  {onSkip && <th style={{ width: 60 }}></th>}
                  <th style={{ width: 24 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const v = verifyState(inv)
                  const target = targetFor(inv)
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => go(inv)}
                      style={{ cursor: target ? 'pointer' : 'default' }}
                      title={
                        inv.supplier_id ? 'Open invoice to verify'
                        : inv.source_url ? `Open costing (${inv.source_module})`
                        : 'One-off expense (no linked costing)'
                      }
                    >
                      <td>
                        <span style={{ fontWeight: 600 }}>{inv.supplier_name}</span>
                        {inv.entity_code && <span style={chip}>{inv.entity_code}</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {inv.is_one_off ? (
                          <>
                            <span style={onceOffBadge}>Once-off</span>
                            <div style={{ fontSize: 11, marginTop: 2, color: inv.source_url ? 'var(--accent)' : 'var(--text-muted)' }}>
                              {inv.entity_code ? `${inv.entity_code} · ` : ''}
                              <span style={inv.source_url ? { textDecoration: 'underline' } : undefined}>
                                {inv.source_module || '—'}
                              </span>
                            </div>
                          </>
                        ) : (
                          <span style={supplierBadge}>Supplier invoice</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{inv.invoice_number || '—'}</td>
                      <td style={{ fontSize: 12 }}>
                        {inv.statement_month ? `${MONTH_NAMES[inv.statement_month]} ${inv.statement_year}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(inv.amount)}</td>
                      <td>
                        <span title={v.note} style={{ fontSize: 11, fontWeight: 700, color: v.color }}>{v.label}</span>
                      </td>
                      {onSkip && (
                        <td>
                          <button
                            className="btn-ghost"
                            style={{ fontSize: 11, padding: '3px 8px', color: 'var(--text-muted)' }}
                            disabled={skipping.has(inv.id)}
                            onClick={e => skip(e, inv)}
                            title="Remove this invoice from the verify list (it won't be deleted)"
                          >
                            {skipping.has(inv.id) ? '…' : 'Skip'}
                          </button>
                        </td>
                      )}
                      <td>{target && <ChevronRight size={14} color="var(--text-muted)" />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const chip = {
  marginLeft: 6, background: 'var(--accent-dim)', color: 'var(--accent)',
  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, letterSpacing: 0.5,
}

const supplierBadge = {
  background: 'rgba(34,197,94,0.15)', color: '#16a34a',
  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: 0.3,
}

const onceOffBadge = {
  background: 'rgba(245,158,11,0.15)', color: '#d97706',
  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: 0.3,
}
