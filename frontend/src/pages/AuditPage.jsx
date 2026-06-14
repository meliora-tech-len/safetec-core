import { useState, useEffect, useRef } from 'react'
import { getAuditLogs, getAuditLogMonths, exportAuditLogs, getEntities } from '../services/api'
import { formatDateTime } from '../utils/helpers'
import { Shield, RefreshCw, Search, Calendar } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import Pagination from '../components/Pagination'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import SortableHeader, { useSort } from '../components/SortableHeader'

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const monthKey = (year, month) => `${year}-${month}`
const monthLabel = (year, month) => `${MONTH_NAMES[month]} ${year}`

const ACTION_LABELS = {
  // Auth
  'auth.login': 'Login',
  // Invoices
  'invoice.created': 'Invoice Created',
  'quote.created': 'Quote Created',
  'invoice.updated': 'Invoice Updated',
  'invoice.cancelled': 'Invoice Cancelled',
  'invoice.emailed': 'Invoice Emailed',
  // Suppliers
  'supplier.created': 'Supplier Added',
  'supplier.updated': 'Supplier Updated',
  'supplier.deleted': 'Supplier Removed',
  // Supplier invoices
  'supplier_invoice.created': 'Supp. Invoice Created',
  'supplier_invoice.updated': 'Supp. Invoice Updated',
  'supplier_invoice.deleted': 'Supp. Invoice Deleted',
  'supplier_invoice.archived': 'Supp. Invoice Archived',
  'supplier_invoice.auto_created': 'Supp. Invoice Auto-Created',
  'supplier_invoice.statement_paid': 'Statement Paid',
  'supplier_invoice.verified': 'Invoice Verified',
  'supplier_invoice.unverified': 'Verification Removed',
  'supplier_invoice.finalized': 'Final Lock Applied',
  'supplier_invoice.unfinalized': 'Final Lock Removed',
  'supplier_invoice.line_added': 'Invoice Line Added',
  'supplier_invoice.line_updated': 'Invoice Line Updated',
  'supplier_invoice.line_deleted': 'Invoice Line Deleted',
  // Value verifications (costing-page ticks)
  'value.verified': 'Value Verified',
  'value.unverified': 'Value Verification Removed',
  'value.finalized': 'Value Final Lock',
  'value.unfinalized': 'Value Lock Removed',
  // Users
  'user.created': 'User Created',
  'user.updated': 'User Updated',
  'user.deactivated': 'User Deactivated',
  'user.reactivated': 'User Reactivated',
  'user.password_reset': 'Password Reset',
  'user.permissions_updated': 'Permissions Updated',
  // Entities
  'entity.created': 'Entity Created',
  'entity.updated': 'Entity Updated',
  'entity.archived': 'Entity Archived',
  'entity.restored': 'Entity Restored',
  'entity.logo_uploaded': 'Logo Uploaded',
  // Settings / Roles
  'setting.created': 'Setting Added',
  'setting.updated': 'Setting Updated',
  'setting.deleted': 'Setting Removed',
  'role.created': 'Role Created',
  'role.deleted': 'Role Deleted',
}

const ACTION_COLORS = {
  // green
  'invoice.created': 'var(--success)',
  'quote.created': 'var(--success)',
  'supplier.created': 'var(--success)',
  'user.created': 'var(--success)',
  'entity.created': 'var(--success)',
  'entity.restored': 'var(--success)',
  'user.reactivated': 'var(--success)',
  'role.created': 'var(--success)',
  'setting.created': 'var(--success)',
  'supplier_invoice.created': 'var(--success)',
  'supplier_invoice.line_added': 'var(--success)',
  // red
  'invoice.cancelled': 'var(--danger)',
  'supplier.deleted': 'var(--danger)',
  'user.deactivated': 'var(--danger)',
  'entity.archived': 'var(--danger)',
  'role.deleted': 'var(--danger)',
  'setting.deleted': 'var(--danger)',
  'supplier_invoice.deleted': 'var(--danger)',
  'supplier_invoice.line_deleted': 'var(--danger)',
  'supplier_invoice.unverified': 'var(--danger)',
  'supplier_invoice.unfinalized': 'var(--danger)',
  'value.unverified': 'var(--danger)',
  'value.unfinalized': 'var(--danger)',
  // accent / blue
  'auth.login': 'var(--accent)',
  'invoice.emailed': 'var(--accent)',
  // amber / warning
  'invoice.updated': '#f59e0b',
  'supplier.updated': '#f59e0b',
  'user.updated': '#f59e0b',
  'entity.updated': '#f59e0b',
  'user.password_reset': '#f59e0b',
  'user.permissions_updated': '#f59e0b',
  'setting.updated': '#f59e0b',
  'entity.logo_uploaded': '#f59e0b',
  'supplier_invoice.updated': '#f59e0b',
  'supplier_invoice.line_updated': '#f59e0b',
  // green-ish locks
  'supplier_invoice.verified': 'var(--success)',
  'supplier_invoice.finalized': 'var(--success)',
  'value.verified': 'var(--success)',
  'value.finalized': 'var(--success)',
}

const ACTION_GROUPS = [
  { label: 'All Actions', value: '' },
  { label: 'Logins', value: 'auth' },
  { label: 'Invoices & Quotes', value: 'invoice' },
  { label: 'Supplier Invoices', value: 'supplier_invoice' },
  { label: 'Suppliers', value: 'supplier' },
  { label: 'Value Verifications', value: 'value' },
  { label: 'Users', value: 'user' },
  { label: 'Entities', value: 'entity' },
  { label: 'Settings & Roles', value: 'setting' },
]

const RESOURCE_TYPES = [
  { label: 'All Resources', value: '' },
  { label: 'Invoices', value: 'invoice' },
  { label: 'Suppliers', value: 'supplier' },
  { label: 'Users', value: 'user' },
  { label: 'Entities', value: 'entity' },
]

const fmtDiffVal = (v) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v)
}

/** Compact field-level old → new view for logs that carry value diffs. */
function DiffView({ oldV, newV }) {
  const keys = [...new Set([...Object.keys(oldV || {}), ...Object.keys(newV || {})])]
  if (keys.length === 0) return null
  return (
    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {keys.map(k => {
        const o = oldV ? oldV[k] : undefined
        const n = newV ? newV[k] : undefined
        return (
          <div key={k} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 600 }}>{k}</span>:{' '}
            {o !== undefined && <span style={{ color: 'var(--danger)' }}>{fmtDiffVal(o)}</span>}
            {o !== undefined && n !== undefined && ' → '}
            {n !== undefined && <span style={{ color: 'var(--success)' }}>{fmtDiffVal(n)}</span>}
          </div>
        )
      })}
    </div>
  )
}

export default function AuditPage() {
  const { isAdmin } = useAuth()
  const PAGE_SIZE = 50

  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [entities, setEntities] = useState([])
  const [months, setMonths] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterEntity, setFilterEntity] = useEntityFilter()
  const [filterResource, setFilterResource] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterMonth, setFilterMonth] = useState('') // 'YYYY-M' of the month being viewed
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const { sort, onSort } = useSort('created_at', 'desc')
  const reqRef = useRef(0)

  const entityMap = Object.fromEntries(entities.map(e => [e.id, e.name]))

  // Shared filter params for both the paged list and the export.
  const queryParams = () => {
    if (!filterMonth) return null
    const [year, month] = filterMonth.split('-')
    const params = { year, month }
    if (filterEntity) params.entity_id = filterEntity
    if (filterResource) params.resource_type = filterResource
    if (filterAction) params.action_group = filterAction
    if (debouncedSearch) params.q = debouncedSearch
    return params
  }

  const load = () => {
    const params = queryParams()
    if (!params) { setLogs([]); setTotal(0); setLoading(false); return }
    setLoading(true)
    const myReq = ++reqRef.current
    getAuditLogs({ ...params, page, page_size: PAGE_SIZE, sort: sort.col, dir: sort.dir })
      .then(r => {
        if (myReq !== reqRef.current) return // a newer request superseded this one
        setLogs(r.data.items)
        setTotal(r.data.total)
      })
      .finally(() => { if (myReq === reqRef.current) setLoading(false) })
  }

  // Changing a filter/search/sort resets to page 1; page changes keep the filters.
  const resetTo = (setter) => (value) => { setter(value); setPage(1) }
  const handleSort = (col) => { onSort(col); setPage(1) }

  // Debounce the free-text search so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])
  useEffect(() => {
    const params = filterEntity ? { entity_id: filterEntity } : {}
    getAuditLogMonths(params).then(r => {
      const data = r.data || []
      setMonths(data)
      const keys = data.map(mo => monthKey(mo.year, mo.month))
      // Keep the current month if it still exists for this entity, else jump to
      // the most recent month available. No months → nothing to show.
      setFilterMonth(prev => (prev && keys.includes(prev)) ? prev : (keys[0] || ''))
      setPage(1)
      if (data.length === 0) { setLogs([]); setTotal(0); setLoading(false) }
    }).catch(() => { setMonths([]); setFilterMonth(''); setLogs([]); setTotal(0); setLoading(false) })
  }, [filterEntity])

  useEffect(() => { load() }, [
    filterMonth, filterEntity, filterResource, filterAction, debouncedSearch,
    sort.col, sort.dir, page,
  ])

  const actionLabel = (action) => ACTION_LABELS[action] || action
  const actionColor = (action) => ACTION_COLORS[action] || 'var(--text-secondary)'

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Complete activity trail — who changed what and when. Pick a month to view earlier history.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title="Audit Log Report"
            filename="audit-log"
            data={logs}
            fetchData={async () => {
              const params = queryParams()
              if (!params) return []
              const r = await exportAuditLogs(params)
              return r.data
            }}
            columns={[
              { header: 'Timestamp',   value: r => formatDateTime(r.created_at) },
              { header: 'User',        value: r => r.user?.full_name || 'System' },
              { header: 'Action',      key: 'action' },
              { header: 'Entity',      value: r => r.entity_id ? (entityMap[r.entity_id] || `#${r.entity_id}`) : '' },
              { header: 'Description', key: 'description' },
              { header: 'IP Address',  key: 'ip_address' },
            ]}
          />
          <button className="btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      <div style={styles.filters}>
        <div style={styles.searchWrap}>
          <Search size={13} style={styles.searchIcon} />
          <input
            style={styles.searchInput}
            placeholder="Search by user, action or description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={styles.monthWrap}>
          <Calendar size={13} style={styles.searchIcon} />
          <select value={filterMonth} onChange={e => resetTo(setFilterMonth)(e.target.value)} style={{ ...styles.monthSelect }}>
            {months.length === 0 && <option value="">No activity yet</option>}
            {months.map(mo => (
              <option key={monthKey(mo.year, mo.month)} value={monthKey(mo.year, mo.month)}>
                {monthLabel(mo.year, mo.month)}
              </option>
            ))}
          </select>
        </div>
        {isAdmin && (
          <select value={filterEntity} onChange={e => resetTo(setFilterEntity)(e.target.value)} style={{ width: 180 }}>
            <option value="">All Entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <select value={filterAction} onChange={e => resetTo(setFilterAction)(e.target.value)} style={{ width: 180 }}>
          {ACTION_GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <select value={filterResource} onChange={e => resetTo(setFilterResource)(e.target.value)} style={{ width: 150 }}>
          {RESOURCE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <SortableHeader label="Timestamp" col="created_at" sort={sort} onSort={handleSort} />
              <SortableHeader label="User" col="user_name" sort={sort} onSort={handleSort} />
              <SortableHeader label="Action" col="action" sort={sort} onSort={handleSort} />
              <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={handleSort} />
              <th>Description</th>
              <th>IP Address</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6}><div className="empty-state"><Shield size={32} /><p>No audit logs found</p></div></td></tr>
            ) : logs.map(log => (
              <tr key={log.id}>
                <td className="font-mono text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at)}</td>
                <td style={{ fontSize: 12, fontWeight: 500 }}>{log.user?.full_name || 'System'}</td>
                <td>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: actionColor(log.action),
                    background: `${actionColor(log.action)}18`,
                    padding: '2px 8px', borderRadius: 4,
                    whiteSpace: 'nowrap',
                  }}>
                    {actionLabel(log.action)}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {log.entity_id ? (entityMap[log.entity_id] || `#${log.entity_id}`) : '—'}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 380 }}>
                  {log.description || '—'}
                  {(log.old_values || log.new_values) && (
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--accent)', userSelect: 'none' }}>
                        Field changes
                      </summary>
                      <DiffView oldV={log.old_values} newV={log.new_values} />
                    </details>
                  )}
                </td>
                <td className="text-muted" style={{ fontSize: 11 }}>{log.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />}
    </div>
  )
}

const styles = {
  page: { padding: 'var(--page-pad)', flex: 1 },
  filters: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' },
  searchWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' },
  searchInput: { paddingLeft: 32, width: 180 },
  monthWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  monthSelect: { paddingLeft: 32, width: 180 },
}
