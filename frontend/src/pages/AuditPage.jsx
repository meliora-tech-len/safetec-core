import { useState, useEffect } from 'react'
import { getAuditLogs, getEntities } from '../services/api'
import { formatDateTime } from '../utils/helpers'
import { Shield, RefreshCw } from 'lucide-react'

export default function AuditPage() {
  const [logs, setLogs] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterEntity, setFilterEntity] = useState('')
  const [filterResource, setFilterResource] = useState('')

  const load = () => {
    setLoading(true)
    const params = { limit: 100 }
    if (filterEntity) params.entity_id = filterEntity
    if (filterResource) params.resource_type = filterResource
    getAuditLogs(params).then(r => setLogs(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])
  useEffect(() => { load() }, [filterEntity, filterResource])

  const actionColor = (action) => {
    if (action.includes('deleted') || action.includes('cancelled')) return 'var(--danger)'
    if (action.includes('created')) return 'var(--success)'
    if (action.includes('login')) return 'var(--accent)'
    return 'var(--text-secondary)'
  }

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Complete activity trail — who changed what and when</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div style={styles.filters}>
        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 200 }}>
          <option value="">All Entities</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={filterResource} onChange={e => setFilterResource(e.target.value)} style={{ width: 160 }}>
          <option value="">All Resources</option>
          <option value="invoice">Invoices</option>
          <option value="client">Suppliers</option>
          <option value="user">Users</option>
          <option value="entity">Entities</option>
        </select>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Description</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6}><div className="empty-state"><Shield size={32} /><p>No audit logs</p></div></td></tr>
            ) : logs.map(log => (
              <tr key={log.id}>
                <td className="font-mono text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at)}</td>
                <td style={{ fontSize: 12 }}>{log.user?.full_name || `#${log.user_id}` || 'System'}</td>
                <td>
                  <span style={{ fontSize: 11, fontWeight: 700, color: actionColor(log.action), fontFamily: 'monospace' }}>
                    {log.action}
                  </span>
                </td>
                <td style={{ fontSize: 11 }}>
                  {log.resource_type && (
                    <span style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                      {log.resource_type} {log.resource_id ? `#${log.resource_id}` : ''}
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{log.description || '—'}</td>
                <td className="text-muted" style={{ fontSize: 11 }}>{log.ip_address || '—'}</td>
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
  filters: { display: 'flex', gap: 12, marginBottom: 16 },
}
