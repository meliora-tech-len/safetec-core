import { useState, useEffect, useMemo } from 'react'
import { Link2 } from 'lucide-react'
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DriverAssignmentsPage() {
  const { entities, activeEntity } = useAuth()
  const api = useApi()

  const [filterEntity, setFilterEntity] = useState(activeEntity?.id?.toString() || '')
  const [trucks, setTrucks]   = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)

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

  // Map truck.id → permanent driver
  const driverByTruckId = useMemo(() => {
    const m = {}
    drivers.filter(d => d.driver_type === 'permanent' && d.truck_id)
           .forEach(d => { m[d.truck_id] = d })
    return m
  }, [drivers])

  // Own fleet only (non-subcontractor), sorted by fleet number
  const ownTrucks = useMemo(() =>
    trucks
      .filter(t => !t.is_subcontractor)
      .sort((a, b) => {
        const fa = parseInt(a.fleet_number) || 9999
        const fb = parseInt(b.fleet_number) || 9999
        return fa - fb || a.registration.localeCompare(b.registration)
      }),
  [trucks])

  const assignedTrucks   = ownTrucks.filter(t =>  driverByTruckId[t.id])
  const unassignedTrucks = ownTrucks.filter(t => !driverByTruckId[t.id])

  // Permanent drivers with no truck
  const orphanedDrivers = drivers.filter(d => d.driver_type === 'permanent' && !d.truck_id)

  // Casual pool
  const casualPool = drivers.filter(d => d.driver_type === 'casual')

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
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <Stat label="Trucks assigned"   value={assignedTrucks.length}   colour="var(--success)" />
        <Stat label="Trucks unassigned" value={unassignedTrucks.length} colour={unassignedTrucks.length ? 'var(--warning)' : 'var(--text-muted)'} />
        <Stat label="Permanent drivers" value={drivers.filter(d => d.driver_type === 'permanent').length} colour="var(--accent)" />
        <Stat label="Casual pool"       value={casualPool.length}       colour="var(--text-secondary)" />
      </div>

      {/* ── Section 1: Permanent Assignments ───────────────────────────────── */}
      <div style={S.sectionHeader}>
        <span style={S.sectionTitle}>Permanent Assignments</span>
        <span style={S.sectionSub}>{assignedTrucks.length} assigned · {unassignedTrucks.length} unassigned</span>
      </div>

      <div className="card" style={{ overflow: 'auto', marginBottom: 28 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th>Registration</th>
              <th>Make / Model</th>
              <th>Entity</th>
              <th>Permanent Driver</th>
              <th>Emp #</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {/* Assigned trucks */}
            {assignedTrucks.map(truck => {
              const driver = driverByTruckId[truck.id]
              const sc = STATUS_COLOURS[truck.status] || STATUS_COLOURS.active
              return (
                <tr key={truck.id}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
                    {truck.fleet_number || '—'}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{truck.registration}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {truck.make}{truck.model ? ` ${truck.model}` : ''}
                  </td>
                  <td>
                    <span style={S.entityChip}>{entityName(truck.entity_id)}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {driver.first_name} {driver.last_name}
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    {driver.employee_number || '—'}
                  </td>
                  <td><span className={`badge ${sc.badge}`}>{sc.label}</span></td>
                </tr>
              )
            })}

            {/* Divider before unassigned */}
            {unassignedTrucks.length > 0 && assignedTrucks.length > 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '6px 14px', background: 'var(--bg-surface)', fontSize: 11, fontWeight: 700, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Unassigned — no permanent driver linked
                </td>
              </tr>
            )}

            {/* Unassigned trucks */}
            {unassignedTrucks.map(truck => {
              const sc = STATUS_COLOURS[truck.status] || STATUS_COLOURS.active
              return (
                <tr key={truck.id} style={{ background: 'rgba(234,179,8,0.04)' }}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
                    {truck.fleet_number || '—'}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{truck.registration}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {truck.make}{truck.model ? ` ${truck.model}` : ''}
                  </td>
                  <td>
                    <span style={S.entityChip}>{entityName(truck.entity_id)}</span>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)' }}>Unassigned</span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>—</td>
                  <td><span className={`badge ${sc.badge}`}>{sc.label}</span></td>
                </tr>
              )
            })}

            {ownTrucks.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No own-fleet trucks found for this entity.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Section 2: Orphaned permanent drivers ──────────────────────────── */}
      {orphanedDrivers.length > 0 && (
        <>
          <div style={S.sectionHeader}>
            <span style={S.sectionTitle}>Permanent Drivers Without a Truck</span>
            <span style={{ ...S.sectionSub, color: 'var(--warning)' }}>{orphanedDrivers.length} driver{orphanedDrivers.length !== 1 ? 's' : ''} unlinked</span>
          </div>
          <div className="card" style={{ overflow: 'auto', marginBottom: 28 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Emp #</th>
                  <th>Entity</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {orphanedDrivers.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.first_name} {d.last_name}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {d.employee_number || '—'}
                    </td>
                    <td><span style={S.entityChip}>{entityName(d.entity_id)}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Section 3: Casual pool ─────────────────────────────────────────── */}
      <div style={S.sectionHeader}>
        <span style={S.sectionTitle}>Casual Pool</span>
        <span style={S.sectionSub}>{casualPool.length} drivers · not fixed to a truck</span>
      </div>

      {casualPool.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No casual drivers found.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {casualPool.map(d => (
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
      )}
    </div>
  )
}

const S = {
  sectionHeader: {
    display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
  },
  sectionSub: {
    fontSize: 12, color: 'var(--text-muted)',
  },
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
