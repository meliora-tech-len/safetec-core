import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link2, ChevronDown, ChevronUp, AlertTriangle, Search, X, UserCheck } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { getFleetTrucks, getDrivers, updateDriver } from '../services/api'

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

// ── Assignment popover ────────────────────────────────────────────────────────
function AssignmentPopover({ slot, currentDriver, unassignedDrivers, saving, onAssign, onUnassign, onClose }) {
  const [search, setSearch] = useState('')
  const filtered = unassignedDrivers.filter(d =>
    `${d.first_name} ${d.last_name} ${d.employee_number || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div
      style={{
        position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 200,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.25)', padding: 12,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Slot heading */}
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>
        Driver {slot} slot
      </div>

      {currentDriver && (
        <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Currently assigned
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {currentDriver.first_name} {currentDriver.last_name}
              </span>
              <span style={currentDriver.driver_type === 'permanent' ? S.typeBadgePermanent : S.typeBadgeCasual}>
                {currentDriver.driver_type === 'permanent' ? 'P' : 'C'}
              </span>
              {currentDriver.employee_number && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  #{currentDriver.employee_number}
                </span>
              )}
            </div>
            <button
              className="btn-ghost btn-sm"
              style={{ color: 'var(--danger)', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}
              disabled={saving}
              onClick={onUnassign}
            >
              {saving ? 'Saving…' : 'Unassign'}
            </button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {currentDriver ? 'Reassign to' : 'Assign driver'}
      </div>

      <input
        autoFocus
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search drivers…"
        style={{
          width: '100%', marginBottom: 6, padding: '5px 8px', fontSize: 12,
          borderRadius: 6, border: '1px solid var(--border)',
          background: 'var(--bg-surface)', color: 'var(--text-primary)',
          outline: 'none', boxSizing: 'border-box',
        }}
      />

      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0', textAlign: 'center' }}>
            {unassignedDrivers.length === 0 ? 'All drivers are assigned' : 'No match'}
          </div>
        ) : filtered.map(d => (
          <button
            key={d.id}
            disabled={saving}
            onClick={() => onAssign(d)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 8px', borderRadius: 6, border: 'none',
              background: 'transparent', cursor: saving ? 'default' : 'pointer', textAlign: 'left',
            }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.background = 'var(--bg-surface)' }}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                {d.first_name} {d.last_name}
              </span>
              <span style={d.driver_type === 'permanent' ? S.typeBadgePermanent : S.typeBadgeCasual}>
                {d.driver_type === 'permanent' ? 'P' : 'C'}
              </span>
            </div>
            {d.employee_number && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                #{d.employee_number}
              </span>
            )}
          </button>
        ))}
      </div>

      <button
        className="btn-ghost btn-sm"
        style={{ marginTop: 10, width: '100%', fontSize: 11 }}
        onClick={onClose}
      >
        Cancel
      </button>
    </div>
  )
}

// ── Driver slot row (inside TruckCard) ───────────────────────────────────────
function DriverSlotRow({ slot, driver, isActive, onToggle }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
        background: isActive ? 'var(--accent-subtle)' : 'transparent',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-surface)' }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 0.5, flexShrink: 0,
        background: isActive ? 'var(--accent)' : 'var(--bg-surface)',
        color: isActive ? '#fff' : 'var(--text-muted)',
        padding: '1px 5px', borderRadius: 3, minWidth: 18, textAlign: 'center',
      }}>
        D{slot}
      </span>
      {driver ? (
        <>
          <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {driver.first_name} {driver.last_name}
          </span>
          <span style={driver.driver_type === 'permanent' ? S.typeBadgePermanent : S.typeBadgeCasual}>
            {driver.driver_type === 'permanent' ? 'P' : 'C'}
          </span>
          {driver.employee_number && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
              #{driver.employee_number}
            </span>
          )}
        </>
      ) : (
        <span style={{ fontSize: 11, color: slot === 1 ? 'var(--warning)' : 'var(--text-muted)', fontStyle: 'italic', flex: 1 }}>
          {slot === 1 ? 'No driver — click to assign' : slot === 2 ? 'Casual driver 1 — click to assign' : 'Casual driver 2 — click to assign'}
        </span>
      )}
    </div>
  )
}

// ── Truck card ────────────────────────────────────────────────────────────────
function TruckCard({ truck, driver1, driver2, driver3, entityName, activeSlot, onToggleSlot, popoverProps }) {
  const hasAny = !!(driver1 || driver2 || driver3)
  const sc = STATUS_COLOURS[truck.status] || STATUS_COLOURS.active

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'relative',
        background: hasAny ? 'var(--bg-card)' : 'rgba(245,158,11,0.03)',
        border: activeSlot ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderLeft: hasAny
          ? (activeSlot ? '1px solid var(--accent)' : '1px solid var(--border)')
          : '3px solid var(--warning)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'border-color 0.15s',
      }}
    >
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

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0 2px' }} />

      {/* Driver slot rows */}
      <DriverSlotRow slot={1} driver={driver1} isActive={activeSlot === 1} onToggle={() => onToggleSlot(1)} />
      <DriverSlotRow slot={2} driver={driver2} isActive={activeSlot === 2} onToggle={() => onToggleSlot(2)} />
      <DriverSlotRow slot={3} driver={driver3} isActive={activeSlot === 3} onToggle={() => onToggleSlot(3)} />

      {/* Bottom row: entity chip + hint */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <UserCheck size={10} /> Click a driver row to assign
        </span>
        <span style={S.entityChip}>{entityName(truck.entity_id)}</span>
      </div>

      {activeSlot && (
        <AssignmentPopover
          {...popoverProps}
          slot={activeSlot}
          currentDriver={activeSlot === 1 ? driver1 : activeSlot === 2 ? driver2 : driver3}
          onUnassign={() => popoverProps.onUnassign(activeSlot === 1 ? driver1 : activeSlot === 2 ? driver2 : driver3)}
          onClose={() => onToggleSlot(null)}
        />
      )}
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
          {drivers.length} driver{drivers.length !== 1 ? 's' : ''} · unassigned
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

  const [filterEntity, setFilterEntity]     = useState(activeEntity?.id?.toString() || '')
  const [trucks, setTrucks]                 = useState([])
  const [drivers, setDrivers]               = useState([])
  const [loading, setLoading]               = useState(true)
  const [search, setSearch]                 = useState('')
  const [filterStatus, setFilterStatus]     = useState('')
  const [filterAssigned, setFilterAssigned] = useState('')
  const [casualOpen, setCasualOpen]         = useState(false)
  const [orphanOpen, setOrphanOpen]         = useState(false)
  // {truckId, slot} or null
  const [activePopover, setActivePopover]   = useState(null)
  const [saving, setSaving]                 = useState(false)

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])

  const load = useCallback(() => {
    setLoading(true)
    const params = filterEntity ? { entity_id: filterEntity, limit: 500 } : { limit: 500 }
    Promise.all([
      getFleetTrucks(params).then(r => r.data),
      getDrivers(params).then(r => r.data),
    ])
      .then(([t, d]) => { setTrucks(t); setDrivers(d) })
      .catch(() => toast.error('Failed to load assignments'))
      .finally(() => setLoading(false))
  }, [filterEntity])

  useEffect(() => { load() }, [load])

  // Close popover on outside click
  useEffect(() => {
    if (!activePopover) return
    const close = () => setActivePopover(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [activePopover])

  // ── Assign / unassign ───────────────────────────────────────────────────────

  const handleAssign = useCallback(async (truckId, slot, driver) => {
    setSaving(true)
    try {
      await updateDriver(driver.id, { truck_id: truckId, driver_slot: slot })
      toast.success(`${driver.first_name} ${driver.last_name} assigned as Driver ${slot}`)
      setActivePopover(null)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Assignment failed')
    } finally { setSaving(false) }
  }, [load])

  const handleUnassign = useCallback(async (driver) => {
    if (!driver) return
    setSaving(true)
    try {
      await updateDriver(driver.id, { truck_id: null, driver_slot: null })
      toast.success(`${driver.first_name} ${driver.last_name} unassigned`)
      setActivePopover(null)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Unassign failed')
    } finally { setSaving(false) }
  }, [load])

  // ── Derived data ─────────────────────────────────────────────────────────────

  const driver1ByTruckId = useMemo(() => {
    const m = {}
    drivers.filter(d => d.driver_slot === 1 && d.truck_id).forEach(d => { m[d.truck_id] = d })
    return m
  }, [drivers])

  const driver2ByTruckId = useMemo(() => {
    const m = {}
    drivers.filter(d => d.driver_slot === 2 && d.truck_id).forEach(d => { m[d.truck_id] = d })
    return m
  }, [drivers])

  const driver3ByTruckId = useMemo(() => {
    const m = {}
    drivers.filter(d => d.driver_slot === 3 && d.truck_id).forEach(d => { m[d.truck_id] = d })
    return m
  }, [drivers])

  const ownTrucks = useMemo(() =>
    trucks
      .sort((a, b) => {
        const fa = parseInt(a.fleet_number) || 9999
        const fb = parseInt(b.fleet_number) || 9999
        return fa - fb || a.registration.localeCompare(b.registration)
      }),
  [trucks])

  const filteredTrucks = useMemo(() => {
    let list = ownTrucks
    if (filterStatus) list = list.filter(t => t.status === filterStatus)
    if (filterAssigned === 'assigned')   list = list.filter(t => driver1ByTruckId[t.id] || driver2ByTruckId[t.id] || driver3ByTruckId[t.id])
    if (filterAssigned === 'unassigned') list = list.filter(t => !driver1ByTruckId[t.id] && !driver2ByTruckId[t.id] && !driver3ByTruckId[t.id])
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.registration.toLowerCase().includes(q) ||
        t.make.toLowerCase().includes(q) ||
        (t.fleet_number || '').toLowerCase().includes(q) ||
        [driver1ByTruckId[t.id], driver2ByTruckId[t.id], driver3ByTruckId[t.id]].some(d =>
          d && `${d.first_name} ${d.last_name}`.toLowerCase().includes(q)
        )
      )
    }
    return list
  }, [ownTrucks, filterStatus, filterAssigned, search, driver1ByTruckId, driver2ByTruckId, driver3ByTruckId])

  const assignedTrucks   = ownTrucks.filter(t => driver1ByTruckId[t.id] || driver2ByTruckId[t.id] || driver3ByTruckId[t.id])
  const unassignedTrucks = ownTrucks.filter(t => !driver1ByTruckId[t.id] && !driver2ByTruckId[t.id] && !driver3ByTruckId[t.id])
  const fullyStaffed     = ownTrucks.filter(t => driver1ByTruckId[t.id] && driver2ByTruckId[t.id] && driver3ByTruckId[t.id])
  const orphanedDrivers  = drivers.filter(d => d.driver_type === 'permanent' && !d.truck_id)
  const casualPool       = drivers.filter(d => d.driver_type === 'casual' && !d.truck_id)
  const unassignedDrivers = useMemo(
    () => drivers.filter(d => !d.truck_id && d.is_active),
    [drivers]
  )

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
          <div className="page-subtitle">Click a driver row on a truck card to assign Driver 1, 2 or 3</div>
        </div>
        <select
          value={filterEntity}
          onChange={e => setFilterEntity(e.target.value)}
          style={{ width: 'auto', minWidth: 160 }}
        >
          <option value="">All entities</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <Stat label="Trucks with D1"         value={assignedTrucks.length}  colour="var(--success)" />
        <Stat label="Fully staffed (D1+D2+D3)" value={fullyStaffed.length} colour="var(--accent)" />
        <Stat label="No drivers"          value={unassignedTrucks.length} colour={unassignedTrucks.length ? 'var(--warning)' : 'var(--text-muted)'} />
        <Stat label="Casual pool"         value={casualPool.length}       colour="var(--text-secondary)" />
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
          options={[['assigned', 'Has Driver'], ['unassigned', 'No Drivers']]}
          value={filterAssigned}
          onChange={setFilterAssigned}
        />
      </div>

      {/* ── Truck card grid ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 24 }}>
        {filteredTrucks.map(truck => {
          const popoverTruckId = activePopover?.truckId
          const popoverSlot    = activePopover?.slot
          return (
            <TruckCard
              key={truck.id}
              truck={truck}
              driver1={driver1ByTruckId[truck.id] || null}
              driver2={driver2ByTruckId[truck.id] || null}
              driver3={driver3ByTruckId[truck.id] || null}
              entityName={entityName}
              activeSlot={popoverTruckId === truck.id ? popoverSlot : null}
              onToggleSlot={(slot) => {
                if (slot === null || (popoverTruckId === truck.id && popoverSlot === slot)) {
                  setActivePopover(null)
                } else {
                  setActivePopover({ truckId: truck.id, slot })
                }
              }}
              popoverProps={{
                unassignedDrivers,
                saving,
                onAssign: (d) => handleAssign(truck.id, activePopover?.slot, d),
                onUnassign: handleUnassign,
              }}
            />
          )
        })}
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
  typeBadgePermanent: {
    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
    background: 'rgba(22,163,74,0.12)', color: '#15803d', letterSpacing: 0.3,
  },
  typeBadgeCasual: {
    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
    background: 'rgba(234,179,8,0.12)', color: '#92400e', letterSpacing: 0.3,
  },
}
