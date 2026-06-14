import { useNavigate } from 'react-router-dom'
import { X, AlertCircle, ChevronRight } from 'lucide-react'
import { formatCurrency } from '../utils/helpers'

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function verifyState(inv) {
  if (inv.verified2_by_initials) return { label: `${inv.verified_by_initials} · ${inv.verified2_by_initials}`, color: '#16a34a', note: '2 ticks — awaiting final lock' }
  if (inv.verified_by_initials)  return { label: inv.verified_by_initials, color: '#d97706', note: '1 tick — needs 2nd' }
  return { label: 'Not started', color: 'var(--danger)', note: 'No verification yet' }
}

/**
 * Lists supplier invoices created recently that aren't final-locked.
 * Clicking a row (with a registered supplier) opens that supplier's profile,
 * deep-linked to the invoice so it scrolls into view and highlights.
 */
export default function PendingInvoicesModal({ invoices, loading, onClose }) {
  const navigate = useNavigate()

  const go = (inv) => {
    if (!inv.supplier_id) return
    onClose()
    navigate(`/suppliers/${inv.supplier_id}?invoice=${inv.id}`)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} color="var(--warning)" />
            Supplier invoices to verify
            {!loading && <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>{invoices.length}</span>}
          </h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            Created in the last 7 days and not yet final-locked. Click one to open it for verification.
          </p>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : invoices.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}><p>Nothing waiting — all caught up.</p></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Invoice #</th>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Verified</th>
                  <th style={{ width: 24 }}></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const v = verifyState(inv)
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => go(inv)}
                      style={{ cursor: inv.supplier_id ? 'pointer' : 'default' }}
                      title={inv.supplier_id ? 'Open invoice to verify' : 'One-off expense (no supplier profile)'}
                    >
                      <td>
                        <span style={{ fontWeight: 600 }}>{inv.supplier_name}</span>
                        {inv.entity_code && <span style={chip}>{inv.entity_code}</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>{inv.invoice_number || '—'}</td>
                      <td style={{ fontSize: 12 }}>
                        {inv.statement_month ? `${MONTH_NAMES[inv.statement_month]} ${inv.statement_year}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(inv.amount)}</td>
                      <td>
                        <span title={v.note} style={{ fontSize: 11, fontWeight: 700, color: v.color }}>{v.label}</span>
                      </td>
                      <td>{inv.supplier_id && <ChevronRight size={14} color="var(--text-muted)" />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
