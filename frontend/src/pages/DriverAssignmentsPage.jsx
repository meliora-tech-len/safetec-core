import { useState, useEffect, useMemo } from 'react'
import { Link2, ChevronDown, ChevronUp, AlertTriangle, Search, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function useApi() {
  const h = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })
  const get = (p) => fetch(`${API}${p}`, { headers: h() }).then(r => r.ok ? r.json() : Promise.reject(r))
  return { get }
}

const STATUS_COLOURS = {
  active:      { badge: 'badge-paid',      label: 'Active' },
  inactive:    { badge: 'badge-cancelled', label: 'Inactive' },
  maintenance: { badge: 'badge-quote',     label: 'Maint.' },
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function Stat({ label, value, colour }) {
  return (
    <div className="stat-card" style={{ flex: '1 1 160px' }}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={{ color: colour || 'var(--text-primary)', fontSize: 26 }}>
        {value}
      </div>
    </div>
  )
}

// ── Entity pill toggle ────────────────────────────────────────────────────────
function EntityPills({ entities, value, onChange }) {
  return (
    <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2, alignSelf: 'flex-start' }}>
      <button
        onClick={() => onChange('')}
        style={{
          padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
          border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          background: value === '' ? 'var(--accent)' : 'transparent',
          color: value === '' ? '#fff' : 'var(--text-muted)',
        }}
      >
        All
      </button>
      {entities.map(e => (
        <button
          key={e.id}
          onClick={() => onChange(value === String(e.id) ? '' : String(e.id))}
          style={{
            padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            background: value === String(e.id) ? 'var(--accent)' : 'transparent',
            color: value === String(e.id) ? '#fff' : 'var(--text-muted)',
          }}
        >
          {e.code}
        </button>
      ))}
    </div>
  )
}

// ── Generic pill group ────────────────────────────────────────────────────────
function PillGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2, alignSelf: 'flex-start' }}>
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(value === val ? '' : val)}
          style={{
            padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            background: value === val ? 'var(--accent)' : 'transparent',
            color: value === val ? '#fff' : 'var(--text-muted)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Truck card ────────────────────────────────────────────────────────────────
function TruckCard({ truck, driver, entityName }) {
  const isAssigned = !!driver
  const sc = STATUS_COLOURS[truck.status] || STATUS_COLOURS.active

  return (
    <div style={{
      background: isAssigned ? 'var(--bg-card)' : 'rgba(245,158,11,0.03)',
      border: '1px solid var(--border)',
      borderLeft: isAssigned ? '1px solid var(--border)' : '3px solid var(--warning)',
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Top row: fleet# · registration · status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {truck.fleet_number && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', background: 'var(--bg-surface)', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>
            #{truck.fleet_number}
          </span>
        )}
        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, flex: 1, color: 'var(--text-primary)' }}>
          {truck.registration}
        </span>
        <span className={`badge ${sc.badge}`}>{sc.label}</span>
      </div>

      {/* Make / model */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {truck.make}{truck.model ? ` ${truck.model}` : ''}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

      {/* Driver row */}
      {isAssigned ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
            {driver.first_name} {driver.last_name}
          </span>
          {driver.employee_number && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
              #{driver.employee_number}
            </span>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={12} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>No driver assigned</span>
        </div>
      )}

      {/* Entity chip */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span style={S.entityChip}>{entityName(truck.entity_id)}</span>
      </div>
    </div>
  )
}

// ── Orphaned drivers alert ────────────────────────────────────────────────────
function OrphanedAlert({ drivers, entityName, open, onToggle }) {
  if (!drivers.length) return null
  const preview = drivers.slice(0, 3)
    .map(d => `${d.first_name} ${d.last_name}${d.employee_number ? ` (#${d.employee_number})` : ''}`)
    .join('  ·  ')
  const overflow = drivers.length > 3 ? `  +${drivers.length - 3} more` : ''

  return (
    <div style={{ marginBottom: 20, borderRadius: 8, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.06)', overflow: 'hidden' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
        onClick={onToggle}
      >
        <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13, color: 'var(--warning)', fontWeight: 600 }}>
          {drivers.length} permanent driver{drivers.length !== 1 ? 's' : ''} with no truck:
          <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 8 }}>{preview}{overflow}</span>
        </span>
        {open
          ? <ChevronUp size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          : <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        }
      </div>
      {open && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {drivers.map(d => (
            <div key={d.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{d.first_name} {d.last_name}</div>
              {d.employee_number && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>#{d.employee_number}</div>
              )}
              <div style={{ marginTop: 6 }}><span style={S.entityChip}>{entityName(d.entity_id)}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Casual pool collapsible section ──────────────────────────────────────────
function CasualPoolSection({ drivers, entityName, open, onToggle }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', borderRadius: 8,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          cursor: 'pointer', marginBottom: open ? 12 : 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
          Casual Pool
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {drivers.length} driver{drivers.length !== 1 ? 's' : ''} · not fixed to a truck
        </span>
        {open
          ? <ChevronUp size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          : <ChevronDown size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        }
      </button>

      {open && (
        drivers.length === 0
          ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No casual drivers found.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {drivers.map(d => (
                <div key={d.id} style={S.casualCard}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                      {d.first_name} {d.last_name}
                    </span>
                    <span style={S.entityChip}>{entityName(d.entity_id)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: d.notes ? 'normal' : 'italic' }}>
                    {d.notes || 'Casual pool driver'}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <span style={S.casualBadge}>Casual</span>
                  </div>
                </div>
              ))}
            </div>
          )
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DriverAssignmentsPage() {
  const { entities, activeEntity } = useAuth()
  const api = useApi()

  const [filterEntity, setFilterEntity]     = useState(activeEntity?.id?.toString() || '')
  const [trucks, setTrucks]                 = useState([])
  const [drivers, setDrivers]               = useState([])
  const [loading, setLoading]               = useState(true)
  const [search, setSearch]                 = useState('')
  const [filterStatus, setFilterStatus]     = useState('')
  const [filterAssigned, setFilterAssigned] = useState('')
  const [casualOpen, setCasualOpen]         = useState(false)
  const [orphanOpen, setOrphanOpen]         = useState(false)

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])

  useEffect(() => {
    setLoading(true)
    const ep = filterEntity ? `entity_id=${filterEntity}&` : ''
    Promise.all([
      api.get(`/api/fleet/trucks?${ep}limit=500`),
      api.get(`/api/drivers?${ep}limit=500`),
    ])
      .then(([t, d]) => { setTrucks(t); setDrivers(d) })
      .catch(() => toast.error('Failed to load assignments'))
      .finally(() => setLoading(false))
  }, [filterEntity])

  // ── Derived data ─────────────────────────────────────────────────────────────

  const driverByTruckId = useMemo(() => {
    const m = {}
    drivers.filter(d => d.driver_type === 'permanent' && d.truck_id)
           .forEach(d => { m[d.truck_id] = d })
    return m
  }, [drivers])

  const ownTrucks = useMemo(() =>
    trucks
      .filter(t => !t.is_subcontractor)
      .sort((a, b) => {
        const fa = parseInt(a.fleet_number) || 9999
        const fb = parseInt(b.fleet_number) || 9999
        return fa - fb || a.registration.localeCompare(b.registration)
      }),
  [trucks])

  const filteredTrucks = useMemo(() => {
    let list = ownTrucks
    if (filterStatus)                list = list.filter(t => t.status === filterStatus)
    if (filterAssigned === 'assigned')   list = list.filter(t =>  driverByTruckId[t.id])
    if (filterAssigned === 'unassigned') list = list.filter(t => !driverByTruckId[t.id])
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.registration.toLowerCase().includes(q) ||
        t.make.toLowerCase().includes(q) ||
        (t.fleet_number || '').toLowerCase().includes(q) ||
        (driverByTruckId[t.id] &&
          `${driverByTruckId[t.id].first_name} ${driverByTruckId[t.id].last_name}`.toLowerCase().includes(q))
      )
    }
    return list
  }, [ownTrucks, filterStatus, filterAssigned, search, driverByTruckId])

  const assignedTrucks   = ownTrucks.filter(t =>  driverByTruckId[t.id])
  const unassignedTrucks = ownTrucks.filter(t => !driverByTruckId[t.id])
  const orphanedDrivers  = drivers.filter(d => d.driver_type === 'permanent' && !d.truck_id)
  const casualPool       = drivers.filter(d => d.driver_type === 'casual')

  const entityName = (id) => entities.find(e => e.id === id)?.code || ''

  if (loading) return (
    <div style={{ padding: '28px 32px', flex: 1 }}>
      <div className="loading-center"><div className="spinner" /></div>
    </div>
  )

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link2 size={22} style={{ color: 'var(--accent)' }} />
            Driver Assignments
          </div>
          <div className="page-subtitle">Permanent driver–truck links and casual pool</div>
        </div>
        <EntityPills entities={entities} value={filterEntity} onChange={setFilterEntity} />
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <Stat label="Trucks assigned"   value={assignedTrucks.length}   colour="var(--success)" />
        <Stat label="Trucks unassigned" value={unassignedTrucks.length} colour={unassignedTrucks.length ? 'var(--warning)' : 'var(--text-muted)'} />
        <Stat label="Permanent drivers" value={drivers.filter(d => d.driver_type === 'permanent').length} colour="var(--accent)" />
        <Stat label="Casual pool"       value={casualPool.length}       colour="var(--text-secondary)" />
      </div>

      {/* ── Search + filter bar ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 180px', minWidth: 140, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reg, make, driver…"
            style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <X size={13} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
        <PillGroup
          options={[['active', 'Active'], ['maintenance', 'Maint.'], ['inactive', 'Inactive']]}
          value={filterStatus}
          onChange={setFilterStatus}
        />
        <PillGroup
          options={[['assigned', 'Assigned'], ['unassigned', 'Unassigned']]}
          value={filterAssigned}
          onChange={setFilterAssigned}
        />
      </div>

      {/* ── Truck card grid ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 24 }}>
        {filteredTrucks.map(truck => (
          <TruckCard
            key={truck.id}
            truck={truck}
            driver={driverByTruckId[truck.id] || null}
            entityName={entityName}
          />
        ))}
        {filteredTrucks.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No trucks match the current filters.
          </div>
        )}
      </div>

      {/* ── Orphaned permanent drivers ──────────────────────────────────────── */}
      <OrphanedAlert
        drivers={orphanedDrivers}
        entityName={entityName}
        open={orphanOpen}
        onToggle={() => setOrphanOpen(o => !o)}
      />

      {/* ── Casual pool ─────────────────────────────────────────────────────── */}
      <CasualPoolSection
        drivers={casualPool}
        entityName={entityName}
        open={casualOpen}
        onToggle={() => setCasualOpen(o => !o)}
      />

    </div>
  )
}

const S = {
  entityChip: {
    background: 'var(--accent-dim)', color: 'var(--accent)',
    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.5,
  },
  casualCard: {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '14px 16px',
  },
  casualBadge: {
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    background: 'rgba(234,179,8,0.12)', color: '#92400e', letterSpacing: 0.4,
  },
}
