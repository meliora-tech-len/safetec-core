import { useState, useEffect, useMemo } from 'react'
import { getAuditLogs, getEntities } from '../services/api'
import { formatDateTime } from '../utils/helpers'
import { Shield, RefreshCw, Search } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import { useAuth } from '../hooks/useAuth'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

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
  // red
  'invoice.cancelled': 'var(--danger)',
  'supplier.deleted': 'var(--danger)',
  'user.deactivated': 'var(--danger)',
  'entity.archived': 'var(--danger)',
  'role.deleted': 'var(--danger)',
  'setting.deleted': 'var(--danger)',
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
}

const ACTION_GROUPS = [
  { label: 'All Actions', value: '' },
  { label: 'Logins', value: 'auth' },
  { label: 'Invoices & Quotes', value: 'invoice' },
  { label: 'Suppliers', value: 'supplier' },
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

export default function AuditPage() {
  const { activeEntity, isAdmin } = useAuth()
  const [logs, setLogs] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterEntity, setFilterEntity] = useState(activeEntity?.id?.toString() || '')
  const [filterResource, setFilterResource] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [search, setSearch] = useState('')

  const entityMap = Object.fromEntries(entities.map(e => [e.id, e.name]))

  const load = () => {
    setLoading(true)
    const params = { limit: 200 }
    if (filterEntity) params.entity_id = filterEntity
    if (filterResource) params.resource_type = filterResource
    getAuditLogs(params).then(r => setLogs(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])
  useEffect(() => { load() }, [filterEntity, filterResource])

  const { sort, onSort } = useSort('created_at', 'desc')

  const filtered = useMemo(() => {
    const base = logs.filter(log => {
      if (filterAction && !log.action.startsWith(filterAction)) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          (log.description || '').toLowerCase().includes(q) ||
          (log.user?.full_name || '').toLowerCase().includes(q) ||
          (log.action || '').toLowerCase().includes(q)
        )
      }
      return true
    })
    return applySort(base, sort, (item, col) => {
      if (col === 'user_name') return item.user?.full_name || ''
      return item[col]
    })
  }, [logs, filterAction, search, sort])

  const actionLabel = (action) => ACTION_LABELS[action] || action
  const actionColor = (action) => ACTION_COLORS[action] || 'var(--text-secondary)'

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Complete activity trail — who changed what and when</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title="Audit Log Report"
            filename="audit-log"
            data={filtered}
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
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 180 }}>
            <option value="">All Entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)} style={{ width: 180 }}>
          {ACTION_GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <select value={filterResource} onChange={e => setFilterResource(e.target.value)} style={{ width: 150 }}>
          {RESOURCE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <SortableHeader label="Timestamp" col="created_at" sort={sort} onSort={onSort} />
              <SortableHeader label="User" col="user_name" sort={sort} onSort={onSort} />
              <SortableHeader label="Action" col="action" sort={sort} onSort={onSort} />
              <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={onSort} />
              <th>Description</th>
              <th>IP Address</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6}><div className="empty-state"><Shield size={32} /><p>No audit logs found</p></div></td></tr>
            ) : filtered.map(log => (
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
                <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 380 }}>{log.description || '—'}</td>
                <td className="text-muted" style={{ fontSize: 11 }}>{log.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          Showing {filtered.length} of {logs.length} entries
        </p>
      )}
    </div>
  )
}

const styles = {
  page: { padding: 'var(--page-pad)', flex: 1 },
  filters: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' },
  searchWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute', left: 9, color: 'var(--text-muted)', pointerEvents: 'none' },
  searchInput: { paddingLeft: 28, width: 260, height: 32, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input, var(--bg-hover))', color: 'var(--text-primary)', fontSize: 12 },
}
