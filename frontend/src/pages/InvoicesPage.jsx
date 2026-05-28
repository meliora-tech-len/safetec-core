import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInvoices, getEntities, downloadInvoicePdf, updateInvoice, deleteInvoice } from '../services/api'
import { formatCurrency, formatDate, statusBadgeClass, statusLabel } from '../utils/helpers'
import { Plus, Search, X, FileText, Download, EyeOff, Send, CheckCircle, Trash2, Upload } from 'lucide-react'
import ImportPOModal from '../components/ImportPOModal'
import ExportButton from '../components/ExportButton'
import DeleteModal from '../components/DeleteModal'
import { useTheme } from '../hooks/useTheme'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

export default function InvoicesPage({ docType = 'invoice' }) {
  const { activeEntity, isAdmin } = useAuth()
  const [allInvoices, setAllInvoices] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const loadSeqRef = useRef(0)
  const [filterEntity, setFilterEntity] = useState(activeEntity?.id?.toString() || '')
  const [filterStatus, setFilterStatus] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showImportPO, setShowImportPO] = useState(false)
  const navigate = useNavigate()
  const { theme } = useTheme()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    const params = { document_type: docType, limit: 500 }
    if (filterEntity) params.entity_id = filterEntity
    if (debouncedSearch) params.search = debouncedSearch
    getInvoices(params)
      .then(r => { if (loadSeqRef.current === seq) setAllInvoices(r.data) })
      .finally(() => { if (loadSeqRef.current === seq) setLoading(false) })
  }, [docType, filterEntity, debouncedSearch])

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])
  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  const stats = useMemo(() => {
    const s = { draft: 0, ready: 0, readyTotal: 0, sent: 0, sentTotal: 0, accepted: 0, acceptedTotal: 0, overdue: 0, overdueTotal: 0, paid: 0, paidTotal: 0, cancelled: 0 }
    for (const inv of allInvoices) {
      const total = parseFloat(inv.total) || 0
      if (inv.status === 'draft') s.draft++
      else if (inv.status === 'ready') { s.ready++; s.readyTotal += total }
      else if (inv.status === 'sent') { s.sent++; s.sentTotal += total }
      else if (inv.status === 'accepted') { s.accepted++; s.acceptedTotal += total }
      else if (inv.status === 'overdue') { s.overdue++; s.overdueTotal += total }
      else if (inv.status === 'paid') { s.paid++; s.paidTotal += total }
      else if (inv.status === 'cancelled') s.cancelled++
    }
    return s
  }, [allInvoices])

  const { sort, onSort } = useSort('issue_date', 'desc')

  const displayedInvoices = useMemo(() => {
    const filtered = allInvoices.filter(inv => {
      if (!showCancelled && inv.status === 'cancelled') return false
      if (filterStatus && inv.status !== filterStatus) return false
      return true
    })
    return applySort(filtered, sort, (item, col) => {
      if (col === 'recipient') return item.supplier?.name || item.customer?.name || ''
      if (col === 'entity_code') return item.entity?.code || ''
      return item[col]
    })
  }, [allInvoices, showCancelled, filterStatus, sort])

  const handlePdf = async (e, inv) => {
    e.stopPropagation()
    try {
      await downloadInvoicePdf(inv.id, inv.invoice_number, theme)
      // PDF download advances draft → ready automatically on the backend; refresh list
      if (inv.status === 'draft') load()
    }
    catch { toast.error('Failed to generate PDF') }
  }

  const handleQuickStatus = async (e, inv, newStatus) => {
    e.stopPropagation()
    try {
      await updateInvoice(inv.id, { status: newStatus })
      toast.success(`Marked as ${statusLabel(newStatus)}`)
      load()
    } catch { toast.error('Failed to update status') }
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
              { header: 'Bill To',     value: r => r.supplier?.name || r.customer?.name || '' },
              { header: 'Entity',      value: r => r.entity?.code || '' },
              { header: 'Status',      key: 'status' },
              { header: 'Issue Date',  value: r => formatDate(r.issue_date) },
              { header: 'Due Date',    value: r => formatDate(r.due_date) },
              { header: 'Subtotal',    value: r => parseFloat(r.subtotal || 0).toFixed(2) },
              { header: 'VAT',         value: r => parseFloat(r.vat_amount || 0).toFixed(2) },
              { header: 'Total',       value: r => parseFloat(r.total || 0).toFixed(2) },
            ]}
          />
          {isInvoice && (
            <button className="btn-ghost btn-sm" onClick={() => setShowImportPO(true)} title="Generate invoice from a PO Excel file">
              <Upload size={14} /> Import PO
            </button>
          )}
          <button className="btn-primary" onClick={() => navigate(`/${docPath}/new`)}>
            <Plus size={15} /> New {title.slice(0, -1)}
          </button>
        </div>
      </div>

      {/* Mini Stats Bar */}
      {!loading && (
        <div style={styles.statsBar}>
          <StatPill label="Draft" count={stats.draft} color="var(--text-muted)" bg="var(--bg-secondary)" />
          <StatPill
            label="Ready to Send"
            count={stats.ready}
            amount={stats.readyTotal}
            color="#a78bfa"
            bg="rgba(139,92,246,0.1)"
            highlight={stats.ready > 0}
            onClick={() => setFilterStatus(filterStatus === 'ready' ? '' : 'ready')}
          />
          <StatPill label="Sent" count={stats.sent} amount={stats.sentTotal} color="var(--accent)" bg="rgba(79,142,247,0.1)" />
          {!isInvoice && stats.accepted > 0 && (
            <StatPill label="Accepted" count={stats.accepted} amount={stats.acceptedTotal} color="#0d9488" bg="rgba(20,184,166,0.1)" />
          )}
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
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 160 }}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="ready">Ready to Send</option>
          <option value="sent">Sent</option>
          {!isInvoice && <option value="accepted">Accepted</option>}
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
              <SortableHeader label="Number" col="invoice_number" sort={sort} onSort={onSort} />
              <SortableHeader label="Supplier / Customer" col="recipient" sort={sort} onSort={onSort} />
              <SortableHeader label="Entity" col="entity_code" sort={sort} onSort={onSort} />
              <SortableHeader label="Issue Date" col="issue_date" sort={sort} onSort={onSort} />
              <SortableHeader label="Due Date" col="due_date" sort={sort} onSort={onSort} />
              <SortableHeader label="Status" col="status" sort={sort} onSort={onSort} />
              <SortableHeader label="Total" col="total" sort={sort} onSort={onSort} className="text-right" />
              <th style={{ width: 90 }}></th>
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
                <td style={{ fontWeight: 500 }}>
                  {inv.supplier?.name || inv.customer?.name || '—'}
                  {inv.customer && <span style={{ fontSize: 10, marginLeft: 5, color: 'var(--accent)', fontWeight: 600 }}>CUST</span>}
                </td>
                <td><span style={styles.chip}>{inv.entity?.code || '—'}</span></td>
                <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(inv.issue_date)}</td>
                <td className="text-muted" style={{ fontSize: 12 }}>
                  <span style={inv.status === 'overdue' ? { color: 'var(--danger)' } : {}}>
                    {formatDate(inv.due_date)}
                  </span>
                </td>
                <td><span className={statusBadgeClass(inv.status)}>{statusLabel(inv.status)}</span></td>
                <td className="text-right font-bold">{formatCurrency(inv.total)}</td>
                <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                    <button className="btn-icon btn-ghost" title="Download PDF" onClick={e => handlePdf(e, inv)}>
                      <Download size={13} />
                    </button>
                    {(inv.status === 'draft' || inv.status === 'ready') && (
                      <button
                        className="btn-icon btn-ghost"
                        title="Mark as Sent"
                        onClick={e => handleQuickStatus(e, inv, 'sent')}
                        style={{ color: 'var(--accent)' }}
                      >
                        <Send size={13} />
                      </button>
                    )}
                    {inv.status === 'sent' && docType === 'quote' && (
                      <button
                        className="btn-icon btn-ghost"
                        title="Mark as Accepted"
                        onClick={e => handleQuickStatus(e, inv, 'accepted')}
                        style={{ color: '#0d9488' }}
                      >
                        <CheckCircle size={13} />
                      </button>
                    )}
                    {inv.status !== 'cancelled' && inv.status !== 'paid' && (
                      <button
                        className="btn-icon btn-ghost"
                        title={`Cancel ${title.slice(0, -1)}`}
                        onClick={e => { e.stopPropagation(); setDeleteTarget(inv) }}
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showImportPO && <ImportPOModal onClose={() => setShowImportPO(false)} entities={entities} />}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`Cancel ${title.slice(0, -1)}`}
        description={deleteTarget
          ? `${deleteTarget.invoice_number} — ${formatCurrency(deleteTarget.total)} will be set to Cancelled status.`
          : ''}
        onDelete={async () => {
          try {
            await deleteInvoice(deleteTarget.id)
            toast.success(`${title.slice(0, -1)} cancelled`)
            setDeleteTarget(null)
            load()
          } catch (err) {
            toast.error(err?.response?.data?.detail || 'Failed to cancel')
          }
        }}
      />
    </div>
  )
}

function StatPill({ label, count, amount, color, bg, highlight, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        ...styles.statPill,
        background: bg,
        borderColor: highlight ? color : color + '40',
        borderWidth: highlight ? 1.5 : 1,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: highlight ? `0 0 0 3px ${color}22` : 'none',
        transition: 'box-shadow 0.15s',
      }}
    >
      <span style={{ fontSize: 11, color: highlight ? color : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
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
