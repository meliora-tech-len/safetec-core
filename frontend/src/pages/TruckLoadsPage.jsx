import { useState, useEffect, useCallback, Fragment, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Search, X, ChevronRight } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { getFleetTrucks } from '../services/api'
import toast from 'react-hot-toast'

const STATUS_COLOURS = {
  active:      { badge: 'badge-paid',      label: 'Active' },
  inactive:    { badge: 'badge-cancelled', label: 'Inactive' },
  maintenance: { badge: 'badge-quote',     label: 'Maint.' },
}

export default function TruckLoadsPage() {
  const { activeEntity, entities, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [trucks, setTrucks]               = useState([])
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState('')
  const [filterEntity, setFilterEntity]   = useState(activeEntity?.id?.toString() || '')
  const [filterSubcontractor, setFilterSubcontractor] = useState('')

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])

  const obhiId = useMemo(() => entities.find(e => e.code === 'OBHI')?.id?.toString(), [entities])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: 500 }
      if (filterEntity)               params.entity_id        = filterEntity
      if (filterSubcontractor !== '') params.is_subcontractor = filterSubcontractor
      // When OBHI is selected, also pull SFT trucks that run on the Intsimbi contract
      if (filterEntity && filterEntity === obhiId) params.extra_context = 'Intsimbi'
      const res = await getFleetTrucks(params)
      setTrucks(res.data)
    } catch {
      toast.error('Failed to load trucks')
    } finally {
      setLoading(false)
    }
  }, [filterEntity, filterSubcontractor, obhiId])

  useEffect(() => { load() }, [load])

  const entityCode = (id) => entities.find(e => e.id === id)?.code || ''
  const entityName = (id) => entities.find(e => e.id === id)?.name || entityCode(id)

  // Julian trucks are displayed under Alex Maintenance
  const displayGroup = (t) => {
    const op = t.operator === 'Julian' ? 'Alex Maintenance' : t.operator
    return op || t.contract_context || 'Unknown'
  }

  const sorted = useMemo(() => {
    const base = search
      ? trucks.filter(t =>
          t.registration.toLowerCase().includes(search.toLowerCase()) ||
          (t.make || '').toLowerCase().includes(search.toLowerCase()) ||
          (t.operator || '').toLowerCase().includes(search.toLowerCase())
        )
      : trucks

    return [...base].sort((a, b) => {
      const ga = displayGroup(a)
      const gb = displayGroup(b)
      if (ga !== gb) return ga.localeCompare(gb)
      const fa = parseInt(a.fleet_number) || 9999
      const fb = parseInt(b.fleet_number) || 9999
      if (fa !== fb) return fa - fb
      return a.registration.localeCompare(b.registration)
    })
  }, [trucks, search])

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Package size={22} style={{ color: 'var(--accent)' }} />
            Truck Loads
          </div>
          <div className="page-subtitle">Select a truck to view and log its loads</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: '1 1 200px', minWidth: 180 }}>
          <Search size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reg, make, sub-fleet…" />
          {search && <button className="btn-icon" onClick={() => setSearch('')} style={{ padding: 0, background: 'none' }}><X size={13} /></button>}
        </div>
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
            <option value="">All entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
       
      </div>

      {/* List */}
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <Package size={40} />
          <p>No trucks found{search ? ` for "${search}"` : ''}</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Registration</th>
                <th>Make / Model</th>
                <th>Status</th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((truck, i) => {
                const prev = i > 0 ? sorted[i - 1] : null
                const sc = STATUS_COLOURS[truck.status] || STATUS_COLOURS.active
                const groupChanged = !prev || displayGroup(prev) !== displayGroup(truck)

                return (
                  <Fragment key={truck.id}>
                    {groupChanged && (
                      <tr style={{ background: 'var(--bg-base)', borderTop: i === 0 ? 'none' : '2px solid var(--border)' }}>
                        <td colSpan={4} style={{
                          padding: '12px 16px 6px',
                          fontSize: 12, fontWeight: 800,
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                          color: 'var(--text-primary)',
                        }}>
                          {displayGroup(truck)}
                        </td>
                      </tr>
                    )}
                    <tr
                      style={{ cursor: 'pointer' }}
                      className="hoverable-row"
                      onClick={() => navigate(`/truck-loads/${truck.id}`)}
                    >
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, paddingLeft: 28 }}>
                        {truck.registration}
                        {truck.contract_context === 'Intsimbi' && (
                          <span style={{
                            marginLeft: 7, fontSize: 10, fontWeight: 700,
                            color: 'var(--accent)', background: 'var(--accent-dim)',
                            padding: '2px 6px', borderRadius: 4,
                            verticalAlign: 'middle', letterSpacing: '0.04em',
                          }}>
                            Intsimbi
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', paddingLeft: 28 }}>
                        {truck.make}{truck.model ? ` ${truck.model}` : ''}
                      </td>
                      <td><span className={`badge ${sc.badge}`}>{sc.label}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        <ChevronRight size={15} />
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
