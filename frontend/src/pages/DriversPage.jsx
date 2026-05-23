import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Plus, Search, X, Trash2, Edit2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import ExportButton from '../components/ExportButton'
import DeleteModal from '../components/DeleteModal'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

const API = import.meta.env.VITE_API_URL || ''

function useApi() {
  const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` })
  const get  = (p)    => fetch(`${API}${p}`, { headers: h() }).then(r => r.ok ? r.json() : Promise.reject(r))
  const post = (p, b) => fetch(`${API}${p}`, { method: 'POST', headers: h(), body: JSON.stringify(b) }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  const put  = (p, b) => fetch(`${API}${p}`, { method: 'PUT',  headers: h(), body: JSON.stringify(b) }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  const del  = (p)    => fetch(`${API}${p}`, { method: 'DELETE', headers: h() }).then(r => { if (!r.ok) return r.json().then(e => Promise.reject(e)) })
  return { get, post, put, del }
}

const TYPE_BADGE = {
  permanent: { label: 'Permanent', cls: 'badge-paid' },
  casual:    { label: 'Casual',    cls: 'badge-quote' },
}

const formatCurrency = (n) =>
  `R ${parseFloat(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Stat cards ────────────────────────────────────────────────────────────────
function StatCards({ stats }) {
  if (!stats) return null
  const cards = [
    { label: 'Total Drivers',      value: stats.total_drivers,         colour: 'var(--accent)' },
    { label: 'Permanent',          value: stats.permanent,             colour: 'var(--text-secondary)' },
    { label: 'Casual',             value: stats.casual,                colour: 'var(--warning)' },
    { label: 'Active',             value: stats.active,                colour: 'var(--success)' },
  ]
  return (
    <div className="grid-4" style={{ marginBottom: 24 }}>
      {cards.map(c => (
        <div key={c.label} className="stat-card">
          <div className="stat-card-label">{c.label}</div>
          <div className="stat-card-value" style={{ color: c.colour, fontSize: 26 }}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────
const BLANK = {
  entity_id: '', employee_number: '',
  first_name: '', last_name: '', driver_type: 'casual',
  id_number: '', tax_number: '', bank_name: '', bank_account_number: '', notes: '',
}

function DriverModal({ driver, entities, onSave, onClose }) {
  const isEdit = !!driver?.id
  const api = useApi()
  const [form, setForm] = useState(() => driver ? {
    entity_id:          driver.entity_id,
    employee_number:    driver.employee_number || '',
    first_name:         driver.first_name,
    last_name:          driver.last_name,
    driver_type:        driver.driver_type,
    id_number:          driver.id_number || '',
    tax_number:         driver.tax_number || '',
    bank_name:          driver.bank_name || '',
    bank_account_number:driver.bank_account_number || '',
    notes:              driver.notes || '',
  } : { ...BLANK })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.entity_id) { toast.error('Select an entity'); return }
    if (!form.first_name.trim() || !form.last_name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        entity_id: Number(form.entity_id),
      }
      if (isEdit) {
        await api.put(`/api/drivers/${driver.id}`, payload)
        toast.success('Driver updated')
      } else {
        await api.post('/api/drivers', payload)
        toast.success('Driver added')
      }
      onSave()
    } catch (err) {
      toast.error(err?.detail || 'Failed to save driver')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Driver' : 'Add Driver'}</h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            <div className="form-row">
              <div className="form-group">
                <label>Entity *</label>
                <select value={form.entity_id} onChange={e => setForm(f => ({ ...f, entity_id: e.target.value }))} disabled={isEdit} required>
                  <option value="">Select entity…</option>
                  {entities.map(en => <option key={en.id} value={en.id}>{en.name} ({en.code})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Driver Type *</label>
                <select value={form.driver_type} onChange={e => set('driver_type', e.target.value)}>
                  <option value="casual">Casual</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>First Name *</label>
                <input value={form.first_name} onChange={e => set('first_name', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Last Name *</label>
                <input value={form.last_name} onChange={e => set('last_name', e.target.value)} required />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Employee Number</label>
                <input value={form.employee_number} onChange={e => set('employee_number', e.target.value)} placeholder="e.g. THEM002" style={{ fontFamily: 'monospace' }} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>ID Number</label>
                <input value={form.id_number} onChange={e => set('id_number', e.target.value)} style={{ fontFamily: 'monospace' }} />
              </div>
              <div className="form-group">
                <label>Tax Number</label>
                <input value={form.tax_number} onChange={e => set('tax_number', e.target.value)} style={{ fontFamily: 'monospace' }} />
              </div>
            </div>

            <div>
              <div style={sectionLabel}>Banking</div>
              <div style={{ padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Bank Name</label>
                    <input value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Account Number</label>
                    <input value={form.bank_account_number} onChange={e => set('bank_account_number', e.target.value)} style={{ fontFamily: 'monospace' }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
            </div>

          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : isEdit ? 'Save Changes' : 'Add Driver'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const sectionLabel = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-secondary)', marginBottom: 8 }

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DriversPage() {
  const { activeEntity, isAdmin } = useAuth()
  const api = useApi()
  const navigate = useNavigate()

  const [drivers, setDrivers]   = useState([])
  const [stats, setStats]       = useState(null)
  const [entities, setEntities] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterEntity, setFilterEntity] = useState(activeEntity?.id?.toString() || '')
  const [filterType, setFilterType]     = useState('permanent')
  const [showInactive, setShowInactive] = useState(false)
  const [modal, setModal]       = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const loadSeqRef = useRef(0)

  // Sync with sidebar entity switcher
  useEffect(() => {
    setFilterEntity(activeEntity?.id?.toString() || '')
  }, [activeEntity])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterEntity)      params.set('entity_id', filterEntity)
      if (filterType)        params.set('driver_type', filterType)
      if (debouncedSearch)   params.set('search', debouncedSearch)
      if (showInactive) params.set('is_active', 'false')
      // when showing inactive, don't filter by is_active at all — pass nothing to get all
      const isActiveParam = showInactive ? '' : 'true'
      if (isActiveParam) params.set('is_active', isActiveParam)

      const [driverData, statsData] = await Promise.all([
        api.get(`/api/drivers?${params}`),
        api.get(`/api/drivers/stats${filterEntity ? `?entity_id=${filterEntity}` : ''}`),
      ])
      if (loadSeqRef.current === seq) {
        setDrivers(driverData)
        setStats(statsData)
      }
    } catch {
      if (loadSeqRef.current === seq) toast.error('Failed to load drivers')
    } finally {
      if (loadSeqRef.current === seq) setLoading(false)
    }
  }, [filterEntity, filterType, debouncedSearch, showInactive])

  useEffect(() => {
    let ignore = false
    api.get('/api/entities/').then(e => { if (!ignore) setEntities(e) }).catch(() => {})
    return () => { ignore = true }
  }, [])

  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])

  const entityCode = (id) => entities.find(e => e.id === id)?.code || ''

  const { sort, onSort } = useSort('last_name', 'asc')
  const sortedDrivers = useMemo(() =>
    applySort(drivers, sort, (d, col) => {
      if (col === 'name') return `${d.last_name} ${d.first_name}`
      if (col === 'entity_code') return entityCode(d.entity_id)
      return d[col]
    }),
    [drivers, sort, entities]
  )

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Users size={22} style={{ color: 'var(--accent)' }} />
            Driver Management
          </div>
          <div className="page-subtitle">Permanent and casual drivers across all entities</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title="Drivers Report"
            filename="drivers"
            data={drivers}
            columns={[
              { header: 'Employee #',   key: 'employee_number' },
              { header: 'First Name',   key: 'first_name' },
              { header: 'Last Name',    key: 'last_name' },
              { header: 'Type',         key: 'driver_type' },
              { header: 'Entity',       value: r => entityCode(r.entity_id) },
              { header: 'Truck',        key: 'truck_registration' },
              { header: 'Loads (month)',    key: 'load_count_this_month' },
              { header: 'Payments (month)', value: r => parseFloat(r.total_payments_this_month || 0).toFixed(2) },
              { header: 'Status',       value: r => r.is_active ? 'Active' : 'Inactive' },
            ]}
          />
          <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={15} /> Add Driver
          </button>
        </div>
      </div>

      <StatCards stats={stats} />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: '1 1 200px', minWidth: 180 }}>
          <Search size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or employee #…" />
          {search && <button className="btn-icon" onClick={() => setSearch('')} style={{ padding: 0, background: 'none' }}><X size={13} /></button>}
        </div>
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
            <option value="">All entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
          {[['permanent', 'Permanent'], ['casual', 'Casual']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilterType(f => f === val ? '' : val)}
              style={{
                padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: filterType === val ? 'var(--accent)' : 'transparent',
                color: filterType === val ? '#fff' : 'var(--text-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="btn-ghost btn-sm"
          style={{ color: showInactive ? 'var(--accent)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}
          onClick={() => setShowInactive(v => !v)}
        >
          {showInactive ? 'Active only' : 'Show inactive'}
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : drivers.length === 0 ? (
        <div className="empty-state">
          <Users size={40} />
          <p>No drivers found{search ? ` for "${search}"` : ''}</p>
          {!search && <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}><Plus size={14} /> Add first driver</button>}
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <SortableHeader label="Employee #" col="employee_number" sort={sort} onSort={onSort} />
                <SortableHeader label="Name" col="last_name" sort={sort} onSort={onSort} />
                <SortableHeader label="Type" col="driver_type" sort={sort} onSort={onSort} />
                <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={onSort} />
                <SortableHeader label="Truck" col="truck_registration" sort={sort} onSort={onSort} />
                <th className="text-right">Loads (month)</th>
                <th className="text-right">Payments (month)</th>
                <SortableHeader label="Status" col="is_active" sort={sort} onSort={onSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedDrivers.map(d => (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/drivers/${d.id}`)}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                    {d.employee_number || '—'}
                  </td>
                  <td style={{ fontWeight: 600 }}>{d.first_name} {d.last_name}</td>
                  <td>
                    <span className={`badge ${TYPE_BADGE[d.driver_type]?.cls || 'badge-draft'}`}>
                      {TYPE_BADGE[d.driver_type]?.label || d.driver_type}
                    </span>
                  </td>
                  <td>
                    <span style={chipStyle}>{entityCode(d.entity_id)}</span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.truck_registration || '—'}</td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{d.load_count_this_month}</td>
                  <td className="text-right" style={{ fontSize: 12 }}>{formatCurrency(d.total_payments_this_month)}</td>
                  <td>
                    <span className={`badge ${d.is_active ? 'badge-paid' : 'badge-cancelled'}`}>
                      {d.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button className="btn-icon btn-ghost btn-sm" onClick={() => setModal({ mode: 'edit', driver: d })} title="Edit driver">
                        <Edit2 size={13} />
                      </button>
                      <button
                        className="btn-icon btn-ghost btn-sm"
                        onClick={() => setDeleteTarget(d)}
                        title="Delete driver"
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <DriverModal
          driver={modal.driver || null}
          entities={entities}
          onSave={() => { setModal(null); load() }}
          onClose={() => setModal(null)}
        />
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Driver"
        description={deleteTarget
          ? `${deleteTarget.first_name} ${deleteTarget.last_name} and all their payroll history, pay cycles, and load records will be permanently removed from the database.`
          : ''}
        onDelete={async () => {
          try {
            await api.del(`/api/drivers/${deleteTarget.id}`)
            toast.success(`${deleteTarget.first_name} ${deleteTarget.last_name} deleted`)
            setDeleteTarget(null)
            load()
          } catch (err) {
            toast.error(err?.detail || 'Failed to delete driver')
          }
        }}
      />
    </div>
  )
}

const chipStyle = {
  background: 'var(--accent-dim)', color: 'var(--accent)',
  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.5,
}
