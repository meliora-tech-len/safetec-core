import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInvoices, getEntities, downloadInvoicePdf } from '../services/api'
import { formatCurrency, formatDate, statusBadgeClass } from '../utils/helpers'
import { Plus, Search, X, FileText, Download } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import toast from 'react-hot-toast'

export default function InvoicesPage({ docType = 'invoice' }) {
  const [invoices, setInvoices] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const navigate = useNavigate()

  const { theme } = useTheme()

  const load = useCallback(() => {
    setLoading(true)
    const params = { document_type: docType, limit: 100 }
    if (filterEntity) params.entity_id = filterEntity
    if (filterStatus) params.status = filterStatus
    if (search) params.search = search
    getInvoices(params).then(r => setInvoices(r.data)).finally(() => setLoading(false))
  }, [docType, filterEntity, filterStatus, search])

  useEffect(() => { load() }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  const handlePdf = async (e, inv) => {
    e.stopPropagation()
    try {
      await downloadInvoicePdf(inv.id, inv.invoice_number, theme)
    } catch { toast.error('Failed to generate PDF') }
  }

  const isInvoice = docType === 'invoice'
  const title = isInvoice ? 'Invoices' : 'Quotes'

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{invoices.length} {title.toLowerCase()}</p>
        </div>
        <button className="btn-primary" onClick={() => navigate(`/${isInvoice ? 'invoices' : 'quotes'}/new`)}>
          <Plus size={15} /> New {isInvoice ? 'Invoice' : 'Quote'}
        </button>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <div className="search-bar" style={{ flex: 1, maxWidth: 300 }}>
          <Search size={14} />
          <input placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="btn-icon" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 180 }}>
          <option value="">All Entities</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 140 }}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Client</th>
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
            ) : invoices.length === 0 ? (
              <tr><td colSpan={8}>
                <div className="empty-state"><FileText size={32} /><p>No {title.toLowerCase()} found</p></div>
              </td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id} onClick={() => navigate(`/${isInvoice ? 'invoices' : 'quotes'}/${inv.id}`)} style={{ cursor: 'pointer' }}>
                <td className="font-mono text-accent" style={{ fontSize: 12 }}>{inv.invoice_number}</td>
                <td style={{ fontWeight: 500 }}>{inv.client?.name || '—'}</td>
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

const styles = {
  page: { padding: '28px 32px', flex: 1 },
  filters: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' },
  chip: {
    background: 'var(--accent-dim)', color: 'var(--accent)',
    fontSize: 10, fontWeight: 700, padding: '2px 7px',
    borderRadius: 4, letterSpacing: 0.5,
  },
}
