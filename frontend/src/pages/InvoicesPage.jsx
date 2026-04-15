import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInvoices, getEntities, downloadInvoicePdf } from '../services/api'
import { formatCurrency, formatDate, statusBadgeClass } from '../utils/helpers'
import { Plus, Search, X, FileText, Download, EyeOff } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import { useTheme } from '../hooks/useTheme'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'

export default function InvoicesPage({ docType = 'invoice' }) {
  const { activeEntity, isAdmin } = useAuth()
  const [allInvoices, setAllInvoices] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEntity, setFilterEntity] = useState(activeEntity?.id?.toString() || '')
  const [filterStatus, setFilterStatus] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const navigate = useNavigate()
  const { theme } = useTheme()

  const load = useCallback(() => {
    setLoading(true)
    const params = { document_type: docType, limit: 500 }
    if (filterEntity) params.entity_id = filterEntity
    if (search) params.search = search
    getInvoices(params).then(r => setAllInvoices(r.data)).finally(() => setLoading(false))
  }, [docType, filterEntity, search])

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])
  useEffect(() => { load() }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  const stats = useMemo(() => {
    const s = { draft: 0, sent: 0, sentTotal: 0, overdue: 0, overdueTotal: 0, paid: 0, paidTotal: 0, cancelled: 0 }
    for (const inv of allInvoices) {
      const total = parseFloat(inv.total) || 0
      if (inv.status === 'draft') s.draft++
      else if (inv.status === 'sent') { s.sent++; s.sentTotal += total }
      else if (inv.status === 'overdue') { s.overdue++; s.overdueTotal += total }
      else if (inv.status === 'paid') { s.paid++; s.paidTotal += total }
      else if (inv.status === 'cancelled') s.cancelled++
    }
    return s
  }, [allInvoices])

  const displayedInvoices = useMemo(() => {
    return allInvoices.filter(inv => {
      if (!showCancelled && inv.status === 'cancelled') return false
      if (filterStatus && inv.status !== filterStatus) return false
      return true
    })
  }, [allInvoices, showCancelled, filterStatus])

  const handlePdf = async (e, inv) => {
    e.stopPropagation()
    try { await downloadInvoicePdf(inv.id, inv.invoice_number, theme) }
    catch { toast.error('Failed to generate PDF') }
  }

  const isInvoice = docType === 'invoice'
  const isPO      = docType === 'purchase_order'
  const title     = isInvoice ? 'Invoices' : isPO ? 'Purchase Orders' : 'Quotes'
  const docPath   = isInvoice ? 'invoices' : isPO ? 'purchase-orders' : 'quotes'

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{displayedInvoices.length} {title.toLowerCase()}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title={`${title} Report`}
            filename={isInvoice ? 'invoices' : 'quotes'}
            data={displayedInvoices}
            columns={[
              { header: 'Number',      key: 'invoice_number' },
              { header: 'Supplier',    value: r => r.supplier?.name || '' },
              { header: 'Entity',      value: r => r.entity?.code || '' },
              { header: 'Status',      key: 'status' },
              { header: 'Issue Date',  value: r => formatDate(r.issue_date) },
              { header: 'Due Date',    value: r => formatDate(r.due_date) },
              { header: 'Subtotal',    value: r => parseFloat(r.subtotal || 0).toFixed(2) },
              { header: 'VAT',         value: r => parseFloat(r.vat_amount || 0).toFixed(2) },
              { header: 'Total',       value: r => parseFloat(r.total || 0).toFixed(2) },
            ]}
          />
          <button className="btn-primary" onClick={() => navigate(`/${docPath}/new`)}>
            <Plus size={15} /> New {title.slice(0, -1)}
          </button>
        </div>
      </div>

      {/* Mini Stats Bar */}
      {!loading && (
        <div style={styles.statsBar}>
          <StatPill label="Draft" count={stats.draft} color="var(--text-muted)" bg="var(--bg-secondary)" />
          <StatPill label="Outstanding" count={stats.sent} amount={stats.sentTotal} color="var(--warning)" bg="rgba(245,158,11,0.1)" />
          <StatPill label="Overdue" count={stats.overdue} amount={stats.overdueTotal} color="var(--danger)" bg="rgba(239,68,68,0.1)" />
          <StatPill label="Paid" count={stats.paid} amount={stats.paidTotal} color="var(--success)" bg="rgba(34,197,94,0.1)" />
        </div>
      )}

      {/* Filters */}
      <div style={styles.filters}>
        <div className="search-bar" style={{ flex: 1, maxWidth: 300 }}>
          <Search size={14} />
          <input placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="btn-icon" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 180 }}>
            <option value="">All Entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 140 }}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          {showCancelled && <option value="cancelled">Cancelled</option>}
        </select>
        {stats.cancelled > 0 && (
          <button
            className={showCancelled ? 'btn-ghost btn-sm' : 'btn-ghost btn-sm'}
            style={{ color: showCancelled ? 'var(--danger)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}
            onClick={() => { setShowCancelled(v => !v); if (filterStatus === 'cancelled') setFilterStatus('') }}
          >
            <EyeOff size={13} />
            {showCancelled ? `Hide Cancelled (${stats.cancelled})` : `Show Cancelled (${stats.cancelled})`}
          </button>
        )}
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Supplier</th>
              <th>Entity</th>
              <th>Issue Date</th>
              <th>Due Date</th>
              <th>Status</th>
              <th className="text-right">Total</th>
              <th style={{ width: 60 }}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : displayedInvoices.length === 0 ? (
              <tr><td colSpan={8}>
                <div className="empty-state"><FileText size={32} /><p>No {title.toLowerCase()} found</p></div>
              </td></tr>
            ) : displayedInvoices.map(inv => (
              <tr key={inv.id} onClick={() => navigate(`/${docPath}/${inv.id}`)} style={{ cursor: 'pointer' }}>
                <td className="font-mono text-accent" style={{ fontSize: 12 }}>{inv.invoice_number}</td>
                <td style={{ fontWeight: 500 }}>{inv.supplier?.name || '—'}</td>
                <td><span style={styles.chip}>{inv.entity?.code || '—'}</span></td>
                <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(inv.issue_date)}</td>
                <td className="text-muted" style={{ fontSize: 12 }}>
                  <span style={inv.status === 'overdue' ? { color: 'var(--danger)' } : {}}>
                    {formatDate(inv.due_date)}
                  </span>
                </td>
                <td><span className={statusBadgeClass(inv.status)}>{inv.status}</span></td>
                <td className="text-right font-bold">{formatCurrency(inv.total)}</td>
                <td onClick={e => handlePdf(e, inv)} style={{ textAlign: 'center' }}>
                  <button className="btn-icon btn-ghost" title="Download PDF">
                    <Download size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatPill({ label, count, amount, color, bg }) {
  return (
    <div style={{ ...styles.statPill, background: bg, borderColor: color + '40' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1.1 }}>{count}</span>
      {amount !== undefined && (
        <span style={{ fontSize: 11, color, fontWeight: 600 }}>{formatCurrency(amount)}</span>
      )}
    </div>
  )
}

const styles = {
  page: { padding: '28px 32px', flex: 1 },
  statsBar: { display: 'flex', gap: 12, marginBottom: 20 },
  statPill: {
    display: 'flex', flexDirection: 'column', gap: 2,
    padding: '10px 16px', borderRadius: 8, border: '1px solid transparent',
    minWidth: 120,
  },
  filters: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' },
  chip: {
    background: 'var(--accent-dim)', color: 'var(--accent)',
    fontSize: 10, fontWeight: 700, padding: '2px 7px',
    borderRadius: 4, letterSpacing: 0.5,
  },
}
