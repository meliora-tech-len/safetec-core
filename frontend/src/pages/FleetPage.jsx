import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Truck, Car, Plus, Search, X, ChevronDown, ChevronUp, Edit2, Trash2, AlertTriangle, AlertCircle, Clock, ChevronsUpDown, Check } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import toast from 'react-hot-toast'
import ExportButton from '../components/ExportButton'
import DeleteModal from '../components/DeleteModal'
import DateInput from '../components/DateInput'
import { errorMessage } from '../utils/helpers'

const API = import.meta.env.VITE_API_URL || ''

const ALERT_DAYS  = 365  // fetch window — catch all expired + expiring soon

const STATUS_COLOURS = {
  active:      { badge: 'badge-paid',     label: 'Active' },
  inactive:    { badge: 'badge-cancelled', label: 'Inactive' },
  maintenance: { badge: 'badge-quote',    label: 'Maintenance' },
}

const PV_STATUS_COLOURS = {
  active:      { badge: 'badge-paid',     label: 'Active' },
  sold:        { badge: 'badge-cancelled', label: 'Sold' },
  written_off: { badge: 'badge-quote',    label: 'Written Off' },
}

const MAKES = ['SCANIA', 'DAF', 'FAW', 'MERC', 'FOTON AUMAN', 'OTHER']
const PV_OWNERS = ['SAFETEC', 'THEMBIS', 'OBHI', 'OTHER']
const FINANCE_INSTITUTIONS = [
  'WesBank (FNB)', 'MFC (Nedbank)', 'ABSA Vehicle Finance',
  'Standard Bank Vehicle Finance', 'Nedbank Vehicle Finance', 'FNB Vehicle Finance',
  'Capitec Bank', 'Investec', 'Bidvest Bank', 'African Bank',
  'Discovery Bank', 'Mercantile Bank', 'Old Mutual Finance', 'Sasfin Bank',
]

// ── API helpers ───────────────────────────────────────────────────────────────

function useFleetApi() {
  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  })

  const get  = (path) =>
    fetch(`${API}${path}`, { headers: headers() }).then(r => r.ok ? r.json() : Promise.reject(r))

  const post = (path, body) =>
    fetch(`${API}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))

  const put  = (path, body) =>
    fetch(`${API}${path}`, { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))

  const del  = (path) =>
    fetch(`${API}${path}`, { method: 'DELETE', headers: headers() })
      .then(r => { if (!r.ok) return r.json().then(e => Promise.reject(e)) })

  return { get, post, put, del }
}

// ── Licence expiry helpers ────────────────────────────────────────────────────

function isExpired(expiry) {
  return expiry && new Date(expiry) < new Date()
}

function isExpiringSoon(expiry, warnDays = 30) {
  if (!expiry) return false
  const diff = new Date(expiry) - new Date()
  return diff > 0 && diff < warnDays * 86400 * 1000
}

function daysUntil(expiry) {
  if (!expiry) return null
  return Math.ceil((new Date(expiry) - new Date()) / 86400000)
}

function ExpiryBadge({ expiry }) {
  if (!expiry) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const expired = isExpired(expiry)
  const soon    = isExpiringSoon(expiry)
  const days    = daysUntil(expiry)
  return (
    <span style={{
      fontSize: 11, fontFamily: 'monospace',
      color: expired ? 'var(--danger)' : soon ? 'var(--warning)' : 'var(--text-secondary)',
      fontWeight: (expired || soon) ? 700 : 400,
      display: 'flex', alignItems: 'center', gap: 4,
    }}>
      {expired && <AlertTriangle size={11} />}
      {new Date(expiry).toLocaleDateString('en-ZA')}
      {expired && <span style={{ fontSize: 10 }}>EXPIRED</span>}
      {!expired && soon && <span style={{ fontSize: 10 }}>{days}d</span>}
    </span>
  )
}

// ── Drivers cell (compact, for non-SFT trucks) ───────────────────────────────

function DriversCell({ drivers }) {
  if (!drivers.length) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
  const sorted = [...drivers].sort((a, b) => (a.driver_slot ?? 99) - (b.driver_slot ?? 99))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {sorted.map(d => (
        <span key={d.id} style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          {d.first_name} {d.last_name}
          {d.driver_type === 'casual' && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>C</span>
          )}
        </span>
      ))}
    </div>
  )
}

// ── Stat cards ────────────────────────────────────────────────────────────────

function StatCards({ stats, alertCount }) {
  if (!stats) return null
  const cards = [
    { label: 'Total Trucks',    value: stats.total_trucks,            colour: 'var(--accent)' },
    { label: 'Active',          value: stats.active,                   colour: 'var(--success)' },
    { label: 'Maintenance',     value: stats.maintenance,              colour: 'var(--warning)' },
    { label: 'Total Trailers',  value: stats.total_trailers,          colour: 'var(--text-secondary)' },
    { label: 'Personal Vehicles', value: stats.total_personal_vehicles, colour: 'var(--accent)' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
      {cards.map(c => (
        <div key={c.label} className="stat-card">
          <div className="stat-card-label">{c.label}</div>
          <div className="stat-card-value" style={{ color: c.colour, fontSize: 26 }}>{c.value}</div>
        </div>
      ))}
      {alertCount > 0 && (
        <div className="stat-card" style={{ border: '1px solid var(--warning)', background: 'var(--warning-dim, rgba(234,179,8,0.08))' }}>
          <div className="stat-card-label" style={{ color: 'var(--warning)' }}>Expiring Soon</div>
          <div className="stat-card-value" style={{ color: 'var(--warning)', fontSize: 26 }}>{alertCount}</div>
        </div>
      )}
    </div>
  )
}

// ── Licence alert banner ──────────────────────────────────────────────────────

const TYPE_LABEL = { truck: 'Truck', trailer: 'Trailer', personal_vehicle: 'Personal' }

function LicencePopover({ items, title, color, icon: Icon, onClose, onAcknowledge }) {
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 10px)', left: 0, zIndex: 400,
      width: 310, maxHeight: 420, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-card)', border: `1.5px solid ${color}`,
      borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <Icon size={14} style={{ color }} />
        <span style={{ fontWeight: 700, fontSize: 12, color, flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, background: color, color: '#fff',
          borderRadius: 10, padding: '1px 7px',
        }}>{items.length}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, marginLeft: 4 }}>
          <X size={13} />
        </button>
      </div>
      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {items.map((a, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 14px', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>
                {a.registration || '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 3, padding: '1px 5px', color: 'var(--text-secondary)',
                }}>
                  {TYPE_LABEL[a.type] || a.type}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.description}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0, textAlign: 'right' }}>
              {a.expired
                ? <span>{new Date(a.licence_expiry).toLocaleDateString('en-ZA')}</span>
                : <span>{a.days_until_expiry}d</span>
              }
            </div>
            {onAcknowledge && (
              <button
                onClick={() => onAcknowledge(a)}
                title="Mark as handled"
                style={{
                  background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
                  borderRadius: 4, padding: '2px 5px', color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', flexShrink: 0,
                  transition: 'color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--success)'; e.currentTarget.style.borderColor = 'var(--success)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
              >
                <Check size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Trailer mini-form ─────────────────────────────────────────────────────────

function TrailerFields({ trailers, onChange }) {
  const update = (slot, field, value) => {
    const next = trailers.map(t => t.slot === slot ? { ...t, [field]: value } : t)
    onChange(next)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {trailers.map(t => (
        <div key={t.slot} style={{ padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 8 }}>
            Trailer {t.slot}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Registration</label>
              <input
                value={t.registration}
                onChange={e => update(t.slot, 'registration', e.target.value.toUpperCase())}
                placeholder="e.g. KKN187EC"
                style={{ fontFamily: 'monospace' }}
              />
            </div>
            <div className="form-group">
              <label>VIN (optional)</label>
              <input
                value={t.vin}
                onChange={e => update(t.slot, 'vin', e.target.value)}
                placeholder="Chassis number"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Licence Expiry</label>
              <DateInput
                className="form-input"
                value={t.licence_expiry}
                onChange={e => update(t.slot, 'licence_expiry', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={t.status} onChange={e => update(t.slot, 'status', e.target.value)}>
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Finance Institution</label>
              <ComboBox
                value={t.finance_institution}
                onChange={v => update(t.slot, 'finance_institution', v)}
                placeholder="Select or type institution…"
                options={FINANCE_INSTITUTIONS}
              />
            </div>
            <div className="form-group">
              <label>Account Number</label>
              <input
                value={t.finance_account_number}
                onChange={e => update(t.slot, 'finance_account_number', e.target.value)}
                placeholder="e.g. 1234567890"
                style={{ fontFamily: 'monospace' }}
              />
            </div>
            <div className="form-group">
              <label>Contract End Date</label>
              <DateInput
                className="form-input"
                value={t.finance_contract_end}
                onChange={e => update(t.slot, 'finance_contract_end', e.target.value)}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Combobox ──────────────────────────────────────────────────────────────────

function ComboBox({ value, onChange, options, placeholder }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState(value)
  const containerRef      = useRef(null)

  useEffect(() => { setQuery(value) }, [value])

  const filtered  = query ? options.filter(o => o.toLowerCase().includes(query.toLowerCase())) : options
  const select    = (opt) => { setQuery(opt); onChange(opt); setOpen(false) }
  const handleInput = (e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }
  const handleBlur  = (e) => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false) }

  return (
    <div ref={containerRef} style={{ position: 'relative' }} onBlur={handleBlur}>
      <div style={{ position: 'relative' }}>
        <input value={query} onChange={handleInput} onFocus={() => setOpen(true)} placeholder={placeholder} autoComplete="off" style={{ paddingRight: 32 }} />
        <button type="button" tabIndex={-1} onClick={() => setOpen(o => !o)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <ChevronDown size={14} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <ul style={{ position: 'absolute', zIndex: 200, top: 'calc(100% + 4px)', left: 0, right: 0, margin: 0, padding: '4px 0', listStyle: 'none', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', maxHeight: 220, overflowY: 'auto' }}>
          {filtered.map(opt => (
            <li key={opt} tabIndex={0} onMouseDown={() => select(opt)} onKeyDown={e => e.key === 'Enter' && select(opt)}
              style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: opt === value ? 'var(--accent)' : 'var(--text-primary)', fontWeight: opt === value ? 600 : 400, background: 'transparent', transition: 'background 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Truck form modal ──────────────────────────────────────────────────────────

const BLANK_TRUCK = {
  entity_id: '',
  fleet_number: '',
  make: '',
  model: '',
  registration: '',
  vin: '',
  driver_name: '',
  licence_number: '',
  licence_expiry: '',
  finance_institution: '',
  is_subcontractor: false,
  subcontractor_name: '',
  subcontractor_id: null,
  is_temp_registration: false,
  temp_registration: '',
  status: 'active',
  notes: '',
  finance_account_number: '',
  finance_contract_end:   '',
  trailers: [
    { slot: 1, registration: '', vin: '', licence_expiry: '', finance_institution: '', finance_account_number: '', finance_contract_end: '', status: 'active' },
    { slot: 2, registration: '', vin: '', licence_expiry: '', finance_institution: '', finance_account_number: '', finance_contract_end: '', status: 'active' },
  ],
}

function TruckModal({ truck: initialTruck, entities, allDrivers, existingTrucks, onSave, onClose }) {
  const isEdit = !!initialTruck?.id
  const api    = useFleetApi()

  const currentDriverId = isEdit
    ? (allDrivers.find(d => d.truck_id === initialTruck.id)?.id ?? '')
    : ''

  // Build controlled form state from a truck object (used both for initial state and after re-fetch)
  function buildForm(t) {
    if (!t) return { ...BLANK_TRUCK }
    const trailers = [1, 2].map(slot => {
      const tr = (t.trailers || []).find(x => x.slot === slot)
      return tr
        ? {
            slot,
            registration:           tr.registration || '',
            vin:                    tr.vin || '',
            licence_expiry:         tr.licence_expiry ? tr.licence_expiry.slice(0, 10) : '',
            finance_institution:    tr.finance_institution || '',
            finance_account_number: tr.finance_account_number || '',
            finance_contract_end:   tr.finance_contract_end ? tr.finance_contract_end.slice(0, 10) : '',
            status: tr.status,
          }
        : { slot, registration: '', vin: '', licence_expiry: '', finance_institution: '', finance_account_number: '', finance_contract_end: '', status: 'active' }
    })
    return {
      entity_id:           t.entity_id,
      fleet_number:        (t.fleet_number || '').replace(/^#+/, ''),
      make:                t.make || '',
      model:               t.model || '',
      registration:        t.registration || '',
      vin:                 t.vin || '',
      driver_name:         t.driver_name || '',
      licence_number:      t.licence_number || '',
      licence_expiry:      t.licence_expiry ? t.licence_expiry.slice(0, 10) : '',
      finance_institution:    t.finance_institution || '',
      finance_account_number: t.finance_account_number || '',
      finance_contract_end:   t.finance_contract_end ? t.finance_contract_end.slice(0, 10) : '',
      is_subcontractor:     t.is_subcontractor || false,
      subcontractor_name:   t.subcontractor_name || '',
      subcontractor_id:     t.subcontractor_id || null,
      is_temp_registration: t.is_temp_registration || false,
      temp_registration:    t.temp_registration || '',
      status:               t.status || 'active',
      notes:                t.notes || '',
      trailers,
    }
  }

  const [form, setForm] = useState(() => buildForm(initialTruck))
  const [selectedDriverId, setSelectedDriverId] = useState(currentDriverId)
  const [saving, setSaving] = useState(false)
  const [subcontractors, setSubcontractors] = useState([])

  // Re-fetch the full truck record in edit mode — the list response may omit nullable fields
  // that were never set, causing the form to appear under-populated on open.
  useEffect(() => {
    if (!isEdit) return
    api.get(`/api/fleet/trucks/${initialTruck.id}`)
      .then(data => setForm(buildForm(data)))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-assign next fleet number when entity is selected for a new (own) truck.
  // Only fires when the entity already has at least one own truck with a numeric
  // fleet number — entities that use codes (or none) are left blank.
  useEffect(() => {
    if (isEdit || !form.entity_id || form.is_subcontractor) return
    const ownTrucks = (existingTrucks || []).filter(
      t => t.entity_id === Number(form.entity_id) && !t.is_subcontractor
    )
    const toNum = (fn) => {
      const n = parseInt((fn || '').replace(/^#+/, ''))
      return Number.isFinite(n) && n > 0 ? n : null
    }
    const numericTrucks = ownTrucks.filter(t => toNum(t.fleet_number) !== null)
    if (numericTrucks.length === 0) return   // entity uses codes or no numbers — don't auto-fill
    const maxNum = numericTrucks.reduce((m, t) => Math.max(m, toNum(t.fleet_number)), 0)
    setForm(f => ({ ...f, fleet_number: String(maxNum + 1) }))
  }, [form.entity_id, form.is_subcontractor, isEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.entity_id || !form.is_subcontractor) { setSubcontractors([]); return }
    const token = localStorage.getItem('token')
    fetch(`${API}/api/subcontractors/?entity_id=${form.entity_id}&limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then(setSubcontractors)
      .catch(() => setSubcontractors([]))
  }, [form.entity_id, form.is_subcontractor])

  const entityDrivers = allDrivers.filter(
    d => String(d.entity_id) === String(form.entity_id) && d.is_active
  )

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.entity_id) { toast.error('Please select an entity'); return }
    if (!form.make.trim()) { toast.error('Make is required'); return }
    if (!form.registration.trim()) { toast.error('Registration is required'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        temp_registration:    form.temp_registration?.trim() || null,
        licence_expiry:       form.licence_expiry || null,
        finance_contract_end: form.finance_contract_end || null,
        trailers: form.trailers
          .filter(t => t.registration.trim())
          .map(t => ({
            ...t,
            licence_expiry:       t.licence_expiry || null,
            finance_contract_end: t.finance_contract_end || null,
          })),
      }
      let savedTruck
      if (isEdit) {
        savedTruck = await api.put(`/api/fleet/trucks/${initialTruck.id}`, payload)
        toast.success('Truck updated')
      } else {
        savedTruck = await api.post('/api/fleet/trucks', payload)
        toast.success('Truck added')
      }
      const newDriverId = selectedDriverId ? Number(selectedDriverId) : null
      const oldDriverId = currentDriverId  ? Number(currentDriverId)  : null
      if (newDriverId !== oldDriverId) {
        if (oldDriverId) await api.put(`/api/drivers/${oldDriverId}`, { truck_id: null, driver_slot: null })
        if (newDriverId) await api.put(`/api/drivers/${newDriverId}`, { truck_id: savedTruck.id, driver_slot: 1 })
      }
      onSave()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save truck'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Truck' : 'Add Truck'}</h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Entity *</label>
              <select value={form.entity_id} onChange={e => { set('entity_id', Number(e.target.value)); setSelectedDriverId('') }} disabled={isEdit}>
                <option value="">Select entity…</option>
                {entities.map(en => <option key={en.id} value={en.id}>{en.name} ({en.code})</option>)}
              </select>
            </div>

            <div className="form-row-3">
              <div className="form-group">
                <label>Fleet #</label>
                <input value={form.fleet_number} onChange={e => set('fleet_number', e.target.value)} placeholder="e.g. 1" />
              </div>
              <div className="form-group">
                <label>Make *</label>
                <select value={form.make} onChange={e => set('make', e.target.value)}>
                  <option value="">Select make…</option>
                  {MAKES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Model</label>
                <input value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. G460" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Registration *</label>
                <input value={form.registration} onChange={e => set('registration', e.target.value.toUpperCase())} placeholder="e.g. KXH514MP" style={{ fontFamily: 'monospace' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, cursor: 'pointer', userSelect: 'none', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={form.is_temp_registration}
                    onChange={e => set('is_temp_registration', e.target.checked)}
                    style={{ width: 14, height: 14, cursor: 'pointer' }}
                  />
                  Registration above is temporary (no real plate yet)
                </label>
              </div>
              <div className="form-group">
                <label>Temp / Old Registration</label>
                <input value={form.temp_registration} onChange={e => set('temp_registration', e.target.value.toUpperCase())} placeholder="e.g. KXH519MP" style={{ fontFamily: 'monospace' }} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Old/temporary plate for the same vehicle. Diesel &amp; loads on this plate link to this truck.
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>VIN / Chassis</label>
                <input value={form.vin} onChange={e => set('vin', e.target.value.toUpperCase())} placeholder="e.g. 9BSG6X40004042164" style={{ fontFamily: 'monospace' }} />
              </div>
              <div className="form-group" />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Assigned Driver</label>
                <select value={selectedDriverId} onChange={e => setSelectedDriverId(e.target.value)} disabled={!form.entity_id}>
                  <option value="">— No driver —</option>
                  {entityDrivers.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.first_name} {d.last_name}{d.employee_number ? ` (#${d.employee_number})` : ''}
                    </option>
                  ))}
                </select>
                {form.entity_id && entityDrivers.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>No active drivers found for this entity.</div>}
                {!form.entity_id && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Select an entity first.</div>}
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="is_subcontractor" checked={form.is_subcontractor} onChange={e => set('is_subcontractor', e.target.checked)} />
              <label htmlFor="is_subcontractor" style={{ margin: 0, cursor: 'pointer' }}>
                Subcontractor (Subbie) — this truck belongs to an external party
              </label>
            </div>

            {form.is_subcontractor && (
              <div className="form-group">
                <label>Subcontractor</label>
                <select
                  value={form.subcontractor_id ?? ''}
                  onChange={e => set('subcontractor_id', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— Select subcontractor —</option>
                  {subcontractors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {subcontractors.length === 0 && form.entity_id && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    No subcontractors for this entity. <a href="/subcontractors">Add one first.</a>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div style={sectionLabel}>Truck Licence</div>
              <div style={{ padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Licence Number</label>
                    <input value={form.licence_number} onChange={e => set('licence_number', e.target.value.toUpperCase())} placeholder="e.g. LIC123456" style={{ fontFamily: 'monospace' }} />
                  </div>
                  <div className="form-group">
                    <label>Licence Expiry Date</label>
                    <DateInput className="form-input" value={form.licence_expiry} onChange={e => set('licence_expiry', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={sectionLabel}>Financial Institution</div>
              <div style={{ padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="form-group">
                  <label>Institution Name</label>
                  <ComboBox
                    value={form.finance_institution}
                    onChange={v => set('finance_institution', v)}
                    placeholder="Select or type institution…"
                    options={FINANCE_INSTITUTIONS}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Account Number</label>
                    <input
                      value={form.finance_account_number}
                      onChange={e => set('finance_account_number', e.target.value)}
                      placeholder="e.g. 1234567890"
                      style={{ fontFamily: 'monospace' }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Contract End Date</label>
                    <DateInput
                      className="form-input"
                      value={form.finance_contract_end}
                      onChange={e => set('finance_contract_end', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={sectionLabel}>Trailers</div>
              <TrailerFields trailers={form.trailers} onChange={trailers => set('trailers', trailers)} />
            </div>

            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : isEdit ? 'Save Changes' : 'Add Truck'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Personal vehicle modal ────────────────────────────────────────────────────

const BLANK_PV = {
  entity_id: 3,
  owner: '',
  vehicle_type: '',
  year: '',
  registration: '',
  licence_number: '',
  licence_expiry: '',
  status: 'active',
  notes: '',
}

function PersonalVehicleModal({ pv, entities, onSave, onClose }) {
  const isEdit = !!pv?.id
  const api    = useFleetApi()
  const [form, setForm] = useState(() => {
    if (!pv) return { ...BLANK_PV }
    return {
      entity_id:      pv.entity_id,
      owner:          pv.owner || '',
      vehicle_type:   pv.vehicle_type || '',
      year:           pv.year || '',
      registration:   pv.registration || '',
      licence_number: pv.licence_number || '',
      licence_expiry: pv.licence_expiry ? pv.licence_expiry.slice(0, 10) : '',
      status:         pv.status || 'active',
      notes:          pv.notes || '',
    }
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.vehicle_type.trim()) { toast.error('Vehicle type is required'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        year: form.year ? Number(form.year) : null,
        licence_expiry: form.licence_expiry || null,
      }
      if (isEdit) {
        await api.put(`/api/fleet/personal-vehicles/${pv.id}`, payload)
        toast.success('Vehicle updated')
      } else {
        await api.post('/api/fleet/personal-vehicles', payload)
        toast.success('Vehicle added')
      }
      onSave()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save vehicle'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Personal Vehicle' : 'Add Personal Vehicle'}</h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label>Owner *</label>
                <ComboBox
                  value={form.owner}
                  onChange={v => set('owner', v)}
                  placeholder="e.g. THEMBIS, SAFETEC…"
                  options={PV_OWNERS}
                />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="sold">Sold</option>
                  <option value="written_off">Written Off</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>Vehicle Type / Description *</label>
                <input value={form.vehicle_type} onChange={e => set('vehicle_type', e.target.value)} placeholder="e.g. Toyota Land Cruiser Pickup" />
              </div>
              <div className="form-group">
                <label>Year</label>
                <input type="number" value={form.year} onChange={e => set('year', e.target.value)} placeholder="e.g. 2024" min={1990} max={2030} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Registration</label>
                <input value={form.registration} onChange={e => set('registration', e.target.value.toUpperCase())} placeholder="e.g. KJK880EC" style={{ fontFamily: 'monospace' }} />
              </div>
              <div className="form-group">
                <label>Licence Number</label>
                <input value={form.licence_number} onChange={e => set('licence_number', e.target.value.toUpperCase())} placeholder="e.g. LIC123456" style={{ fontFamily: 'monospace' }} />
              </div>
            </div>

            <div className="form-group">
              <label>Licence Expiry Date</label>
              <DateInput className="form-input" value={form.licence_expiry} onChange={e => set('licence_expiry', e.target.value)} />
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="e.g. Johan — KYK OP NATIS" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : isEdit ? 'Save Changes' : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Expandable truck row ──────────────────────────────────────────────────────

function TruckRow({ truck, onEdit, onDelete, isAdmin, truckDrivers = [], showLicenceExpiry = false }) {
  const [open, setOpen] = useState(false)
  const s = STATUS_COLOURS[truck.status] || STATUS_COLOURS.active

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
            {truck.fleet_number ? truck.fleet_number.replace(/^#+/, '') : '—'}
          </span>
        </td>
        <td>
          <div style={{ fontWeight: 600 }}>{truck.make}</div>
          {truck.model && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{truck.model}</div>}
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: 0.5 }}>{truck.registration}</span>
            {truck.is_temp_registration && (
              <span style={{
                fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
                background: 'var(--warning-dim, rgba(234,179,8,0.12))', color: 'var(--warning)',
                border: '1px solid var(--warning)', borderRadius: 3, padding: '1px 5px',
              }}>TEMP</span>
            )}
          </div>
        </td>
        <td>{showLicenceExpiry ? <ExpiryBadge expiry={truck.licence_expiry} /> : <DriversCell drivers={truckDrivers} />}</td>
        <td>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(truck.trailers || []).map(t => (
              <span key={t.id} style={{
                fontFamily: 'monospace', fontSize: 11,
                background: isExpired(t.licence_expiry) ? 'var(--danger-dim, rgba(239,68,68,0.12))' : isExpiringSoon(t.licence_expiry) ? 'var(--warning-dim, rgba(234,179,8,0.08))' : 'var(--bg-surface)',
                border: `1px solid ${isExpired(t.licence_expiry) ? 'var(--danger)' : isExpiringSoon(t.licence_expiry) ? 'var(--warning)' : 'var(--border)'}`,
                borderRadius: 4, padding: '1px 6px', color: 'var(--text-secondary)',
              }}>
                {t.registration || '—'}
              </span>
            ))}
            {!(truck.trailers?.length) && <span style={{ color: 'var(--text-muted)' }}>—</span>}
          </div>
        </td>
        <td>
          {truck.is_subcontractor
            ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {truck.subcontractor_display_name || <span className="badge badge-quote" style={{ fontSize: 11 }}>Subbie</span>}
              </span>
            : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
        </td>
        <td><span className={`badge ${s.badge}`}>{s.label}</span></td>
        <td>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <button className="btn-icon btn-ghost btn-sm" onClick={() => onEdit(truck)} title="Edit"><Edit2 size={13} /></button>
            <button className="btn-icon btn-ghost btn-sm" onClick={() => onDelete(truck)} title="Delete" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
            <button className="btn-icon btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>
              {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr style={{ background: 'var(--bg-base)' }}>
          <td colSpan={8} style={{ padding: '12px 16px' }}>
            <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', minWidth: 52, paddingTop: 2 }}>Drivers</div>
              {truckDrivers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[...truckDrivers]
                    .sort((a, b) => (a.driver_slot ?? 9) - (b.driver_slot ?? 9))
                    .map(d => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{d.first_name} {d.last_name}</span>
                        {d.employee_number && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>#{d.employee_number}</span>}
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.4,
                          background: d.driver_type === 'permanent' ? 'var(--accent-dim)' : 'var(--bg-surface)',
                          color: d.driver_type === 'permanent' ? 'var(--accent)' : 'var(--text-secondary)',
                          border: d.driver_type === 'permanent' ? 'none' : '1px solid var(--border)',
                        }}>
                          {d.driver_type === 'permanent' ? 'Permanent' : 'Casual'}
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No drivers assigned</span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {truck.vin && <Detail label="Truck VIN" value={truck.vin} mono />}
              {truck.licence_number && <Detail label="Licence No." value={truck.licence_number} mono />}
              {truck.licence_expiry && (
                <div>
                  <div style={labelStyle}>Licence Expiry</div>
                  <ExpiryBadge expiry={truck.licence_expiry} />
                </div>
              )}
              {truck.finance_institution && <Detail label="Financier" value={truck.finance_institution} />}
              {truck.finance_account_number && <Detail label="Account No." value={truck.finance_account_number} mono />}
              {truck.finance_contract_end && (
                <div>
                  <div style={labelStyle}>Finance Contract End</div>
                  <ExpiryBadge expiry={truck.finance_contract_end} />
                </div>
              )}
              {(truck.trailers || []).map(t => (
                <div key={t.id}>
                  <div style={labelStyle}>Trailer {t.slot} — {t.registration || '—'}</div>
                  {t.vin && <div style={valueStyle}>{t.vin}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span className={`badge ${STATUS_COLOURS[t.status]?.badge || 'badge-draft'}`} style={{ fontSize: 10 }}>
                      {STATUS_COLOURS[t.status]?.label || t.status}
                    </span>
                    {t.licence_expiry && <ExpiryBadge expiry={t.licence_expiry} />}
                  </div>
                  {t.finance_institution && <div style={{ ...valueStyle, fontFamily: 'inherit', marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>{t.finance_institution}{t.finance_account_number ? ` · ${t.finance_account_number}` : ''}</div>}
                  {t.finance_contract_end && (
                    <div style={{ marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Contract end: </span>
                      <ExpiryBadge expiry={t.finance_contract_end} />
                    </div>
                  )}
                </div>
              ))}
              {truck.notes && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={labelStyle}>Notes</div>
                  <div style={{ ...valueStyle, color: 'var(--text-secondary)' }}>{truck.notes}</div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Personal vehicle row ──────────────────────────────────────────────────────

function PersonalVehicleRow({ pv, onEdit, onDelete, isAdmin }) {
  const s = PV_STATUS_COLOURS[pv.status] || PV_STATUS_COLOURS.active
  return (
    <tr>
      <td>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          {pv.owner || '—'}
        </span>
      </td>
      <td>
        <div style={{ fontWeight: 600 }}>{pv.vehicle_type}</div>
        {pv.year && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pv.year}</div>}
      </td>
      <td>
        {pv.registration
          ? <span style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: 0.5 }}>{pv.registration}</span>
          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
      <td><ExpiryBadge expiry={pv.licence_expiry} /></td>
      <td><span className={`badge ${s.badge}`}>{s.label}</span></td>
      <td>
        {pv.notes
          ? <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{pv.notes}</span>
          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-icon btn-ghost btn-sm" onClick={() => onEdit(pv)} title="Edit"><Edit2 size={13} /></button>
          <button className="btn-icon btn-ghost btn-sm" onClick={() => onDelete(pv)} title="Delete" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
        </div>
      </td>
    </tr>
  )
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ ...valueStyle, ...(mono ? {} : { fontFamily: 'inherit' }) }}>{value}</div>
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 2 }
const valueStyle = { fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)' }
const sectionLabel = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-secondary)', marginBottom: 10 }

// ── Sortable table header ─────────────────────────────────────────────────────

function SortableHeader({ label, col, sort, onSort }) {
  const active = sort.col === col
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => onSort(col)}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}
        <span style={{ display: 'inline-flex', color: active ? 'var(--accent)' : 'var(--text-muted)', opacity: active ? 1 : 0.45 }}>
          {active
            ? (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
            : <ChevronsUpDown size={11} />}
        </span>
      </div>
    </th>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FleetPage() {
  const { isAdmin, activeEntity } = useAuth()
  const api = useFleetApi()
  const [searchParams] = useSearchParams()
  const urlEntityId = searchParams.get('entity_id') || ''

  const [warnDays, setWarnDays] = useState(30)
  const [tab, setTab]           = useState('trucks')
  const [trucks, setTrucks]     = useState([])
  const [pvList, setPvList]     = useState([])
  const [stats, setStats]       = useState(null)
  const [entities, setEntities] = useState([])
  const [allDrivers, setAllDrivers]   = useState([])
  const [alerts, setAlerts]     = useState([])
  const [openPopover, setOpenPopover] = useState(null) // null | 'expired' | 'soon'
  const [loading, setLoading]   = useState(true)
  const [pvLoading, setPvLoading] = useState(false)
  const [search, setSearch]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterEntity, setFilterEntity] = useEntityFilter(urlEntityId)
  const [filterStatus, setFilterStatus]                 = useState('')
  const isObhi = activeEntity?.code === 'OBHI'
  const [filterSubcontractor, setFilterSubcontractor]   = useState(isObhi ? 'true' : 'false')
  const [pvFilterStatus, setPvFilterStatus]             = useState('active')
  const [modal, setModal]       = useState(null)
  const [selected, setSelected] = useState(null)
  const [truckSort, setTruckSort]       = useState({ col: null, dir: 'asc' })
  const [pvSort, setPvSort]             = useState({ col: null, dir: 'asc' })
  const [truckGroupBy, setTruckGroupBy] = useState('entity')
  const loadSeqRef = useRef(0)
  const alertsShownRef = useRef(false)

  useEffect(() => {
    if (urlEntityId) return
    setFilterSubcontractor(activeEntity?.code === 'OBHI' ? 'true' : 'false')
  }, [activeEntity, urlEntityId])
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterEntity)       params.set('entity_id', filterEntity)
      if (filterStatus)       params.set('status', filterStatus)
      if (filterSubcontractor !== '') params.set('is_subcontractor', filterSubcontractor)
      if (debouncedSearch)    params.set('search', debouncedSearch)

      const [truckData, statsData] = await Promise.all([
        api.get(`/api/fleet/trucks?${params}`),
        api.get(`/api/fleet/stats${filterEntity ? `?entity_id=${filterEntity}` : ''}`),
      ])
      if (loadSeqRef.current === seq) {
        setTrucks(truckData)
        setStats(statsData)
      }
    } catch {
      if (loadSeqRef.current === seq) toast.error('Failed to load fleet data')
    } finally {
      if (loadSeqRef.current === seq) setLoading(false)
    }
  }, [filterEntity, filterStatus, filterSubcontractor, debouncedSearch])

  const loadPV = useCallback(async () => {
    setPvLoading(true)
    try {
      const params = new URLSearchParams()
      if (pvFilterStatus) params.set('status', pvFilterStatus)
      const data = await api.get(`/api/fleet/personal-vehicles?${params}`)
      setPvList(data)
    } catch {
      toast.error('Failed to load personal vehicles')
    } finally {
      setPvLoading(false)
    }
  }, [pvFilterStatus])

  const loadAlerts = useCallback(async () => {
    if (activeEntity?.code !== 'SFT') {
      setAlerts([])
      return
    }
    try {
      const data = await api.get(`/api/fleet/licence-alerts?days=${ALERT_DAYS}`)
      setAlerts(data.items || [])
      if (!alertsShownRef.current && data.items?.length > 0) {
        alertsShownRef.current = true
        const expired = data.items.filter(a => a.expired)
        const soon    = data.items.filter(a => !a.expired)
        if (expired.length > 0) toast.error(`${expired.length} licence${expired.length !== 1 ? 's' : ''} expired!`, { duration: 2000 })
        if (soon.length   > 0) toast(`${soon.length} licence${soon.length !== 1 ? 's' : ''} expiring within ${warnDays} days`, { icon: '⚠️', duration: 2000 })
      }
    } catch {
      // silent — alerts are non-critical
    }
  }, [warnDays, activeEntity])

  const handleAcknowledge = useCallback(async (item) => {
    try {
      await api.post('/api/fleet/licence-alerts/acknowledge', {
        resource_type: item.type,
        resource_id: item.id,
        acknowledged_expiry: item.licence_expiry,
      })
      setAlerts(prev => prev.filter(a => !(a.type === item.type && a.id === item.id && a.licence_expiry === item.licence_expiry)))
    } catch {
      toast.error('Failed to mark alert as handled')
    }
  }, [api])

  useEffect(() => {
    let ignore = false
    api.get('/api/entities/').then(e => { if (!ignore) setEntities(e) }).catch(() => {})
    // Load licence warning window setting
    api.get('/api/settings/fleet_licence_warn_days')
      .then(d => { if (!ignore) setWarnDays(parseInt(d.value) || 30) })
      .catch(() => {})
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    let ignore = false
    api.get('/api/drivers?limit=500&is_active=true').then(d => { if (!ignore) setAllDrivers(d) }).catch(() => {})
    return () => { ignore = true }
  }, [])

  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])
  useEffect(() => { loadPV() }, [loadPV])
  useEffect(() => { loadAlerts() }, [loadAlerts])

  const handleDeleteTruck = async () => {
    try {
      await api.del(`/api/fleet/trucks/${selected.id}`)
      toast.success('Truck deleted')
      setModal(null); setSelected(null); load()
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'))
    }
  }

  const handleDeletePV = async () => {
    try {
      await api.del(`/api/fleet/personal-vehicles/${selected.id}`)
      toast.success('Vehicle deleted')
      setModal(null); setSelected(null); loadPV()
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'))
    }
  }

  const entityMap    = Object.fromEntries(entities.map(e => [e.id, e]))
  const sftEntityId  = entities.find(e => e.code === 'SFT')?.id

  // Split alerts into two groups
  const expiredAlerts = alerts
    .filter(a => a.expired)
    .sort((a, b) => new Date(b.licence_expiry) - new Date(a.licence_expiry)) // most recently expired first

  const soonAlerts = alerts
    .filter(a => !a.expired && a.days_until_expiry <= warnDays)
    .sort((a, b) => a.days_until_expiry - b.days_until_expiry) // soonest first

  const handleTruckSort = (col) =>
    setTruckSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }))

  const handlePvSort = (col) =>
    setPvSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }))

  const sortedTrucks = useMemo(() => {
    if (!truckSort.col) return trucks
    const val = (t) => {
      if (truckSort.col === 'fleet_number')   return parseInt((t.fleet_number || '').replace(/^#+/, '')) || 0
      if (truckSort.col === 'licence_expiry') return t.licence_expiry ? new Date(t.licence_expiry).getTime() : Infinity
      if (truckSort.col === 'subcontractor')  return (t.subcontractor_display_name || '').toLowerCase()
      return (t[truckSort.col] || '').toString().toLowerCase()
    }
    return [...trucks].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av < bv) return truckSort.dir === 'asc' ? -1 : 1
      if (av > bv) return truckSort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [trucks, truckSort])

  const groupedTrucks = useMemo(() => {
    const map = {}
    const order = []
    if (truckGroupBy === 'subcontractor') {
      sortedTrucks.forEach(t => {
        const key = t.is_subcontractor
          ? (t.subcontractor_display_name || `Sub #${t.subcontractor_id}` || 'Unknown Subcontractor')
          : '__own__'
        if (!map[key]) { map[key] = []; order.push(key) }
        map[key].push(t)
      })
      return order
        .sort((a, b) => a === '__own__' ? -1 : b === '__own__' ? 1 : a.localeCompare(b))
        .map(key => ({ key, label: key === '__own__' ? 'Own Fleet' : key, labelSub: null, trucks: map[key] }))
    }
    // Default: group by entity (preserve order trucks arrive in)
    sortedTrucks.forEach(t => {
      if (!map[t.entity_id]) { map[t.entity_id] = []; order.push(t.entity_id) }
      map[t.entity_id].push(t)
    })
    return order.map(id => ({
      key: id,
      label: entityMap[id]?.name || '',
      labelSub: entityMap[id]?.code || '',
      trucks: map[id],
    }))
  }, [sortedTrucks, truckGroupBy, entityMap])

  const sortedPvList = useMemo(() => {
    if (!pvSort.col) return pvList
    const val = (p) => {
      if (pvSort.col === 'licence_expiry') return p.licence_expiry ? new Date(p.licence_expiry).getTime() : Infinity
      return (p[pvSort.col] || '').toString().toLowerCase()
    }
    return [...pvList].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av < bv) return pvSort.dir === 'asc' ? -1 : 1
      if (av > bv) return pvSort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [pvList, pvSort])

  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Truck size={22} style={{ color: 'var(--accent)' }} />
            Fleet Management
            {/* Expired licences icon */}
            {expiredAlerts.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setOpenPopover(p => p === 'expired' ? null : 'expired')}
                  style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--danger)', display: 'flex' }}
                  title={`${expiredAlerts.length} expired licence${expiredAlerts.length !== 1 ? 's' : ''}`}
                >
                  <AlertCircle size={18} />
                  <span style={{
                    position: 'absolute', top: 0, right: 0,
                    background: 'var(--danger)', color: '#fff',
                    borderRadius: '50%', fontSize: 9, fontWeight: 700,
                    width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {expiredAlerts.length}
                  </span>
                </button>
                {openPopover === 'expired' && (
                  <LicencePopover
                    items={expiredAlerts}
                    title="Expired Licences"
                    color="var(--danger)"
                    icon={AlertCircle}
                    onClose={() => setOpenPopover(null)}
                    onAcknowledge={handleAcknowledge}
                  />
                )}
              </div>
            )}
            {/* Expiring soon icon */}
            {soonAlerts.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setOpenPopover(p => p === 'soon' ? null : 'soon')}
                  style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--warning)', display: 'flex' }}
                  title={`${soonAlerts.length} licence${soonAlerts.length !== 1 ? 's' : ''} expiring within ${warnDays} days`}
                >
                  <Clock size={18} />
                  <span style={{
                    position: 'absolute', top: 0, right: 0,
                    background: 'var(--warning)', color: '#fff',
                    borderRadius: '50%', fontSize: 9, fontWeight: 700,
                    width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {soonAlerts.length}
                  </span>
                </button>
                {openPopover === 'soon' && (
                  <LicencePopover
                    items={soonAlerts}
                    title={`Expiring Within ${warnDays} Days`}
                    color="var(--warning)"
                    icon={Clock}
                    onClose={() => setOpenPopover(null)}
                    onAcknowledge={handleAcknowledge}
                  />
                )}
              </div>
            )}
          </div>
          <div className="page-subtitle">Trucks, trailers and personal vehicles</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'trucks' ? (
            <>
              <ExportButton
                title="Fleet Report"
                filename="fleet"
                data={trucks}
                columns={[
                  { header: 'Fleet #',        key: 'fleet_number' },
                  { header: 'Make',           key: 'make' },
                  { header: 'Model',          key: 'model' },
                  { header: 'Registration',   key: 'registration' },
                  { header: 'VIN',            key: 'vin' },
                  { header: 'Licence No.',    key: 'licence_number' },
                  { header: 'Licence Expiry', value: r => r.licence_expiry ? new Date(r.licence_expiry).toLocaleDateString('en-ZA') : '' },
                  { header: 'Financier',      key: 'finance_institution' },
                  { header: 'Trailer 1',      value: r => (r.trailers || []).find(t => t.slot === 1)?.registration || '' },
                  { header: 'Trailer 1 Expiry', value: r => { const t = (r.trailers || []).find(x => x.slot === 1); return t?.licence_expiry ? new Date(t.licence_expiry).toLocaleDateString('en-ZA') : '' } },
                  { header: 'Trailer 2',      value: r => (r.trailers || []).find(t => t.slot === 2)?.registration || '' },
                  { header: 'Trailer 2 Expiry', value: r => { const t = (r.trailers || []).find(x => x.slot === 2); return t?.licence_expiry ? new Date(t.licence_expiry).toLocaleDateString('en-ZA') : '' } },
                  { header: 'Status',         key: 'status' },
                ]}
              />
              <button className="btn-primary" onClick={() => { setSelected(null); setModal('create-truck') }}>
                <Plus size={15} /> Add Truck
              </button>
            </>
          ) : (
            <>
              <ExportButton
                title="Personal Vehicles"
                filename="personal-vehicles"
                data={pvList}
                columns={[
                  { header: 'Owner',          key: 'owner' },
                  { header: 'Vehicle',        key: 'vehicle_type' },
                  { header: 'Year',           key: 'year' },
                  { header: 'Registration',   key: 'registration' },
                  { header: 'Licence Expiry', value: r => r.licence_expiry ? new Date(r.licence_expiry).toLocaleDateString('en-ZA') : '' },
                  { header: 'Status',         key: 'status' },
                  { header: 'Notes',          key: 'notes' },
                ]}
              />
              <button className="btn-primary" onClick={() => { setSelected(null); setModal('create-pv') }}>
                <Plus size={15} /> Add Vehicle
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <StatCards stats={stats} alertCount={expiredAlerts.length + soonAlerts.length} />

      {/* Tabs — Personal Vehicles hidden for OBHI (subcontractor-only entity) */}
      {!isObhi && (
        <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2, marginBottom: 16, width: 'fit-content' }}>
          {[['trucks', 'Fleet Trucks', Truck], ['personal', 'Personal Vehicles', Car]].map(([val, label, Icon]) => (
            <button
              key={val}
              onClick={() => setTab(val)}
              style={{
                padding: '5px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: tab === val ? 'var(--accent)' : 'transparent',
                color: tab === val ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Trucks tab ── */}
      {tab === 'trucks' && (
        <>
          {/* Truck filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="search-bar" style={{ flex: '1 1 220px', minWidth: 180 }}>
              <Search size={14} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reg, make, driver…" />
              {search && <button className="btn-icon" onClick={() => setSearch('')} style={{ padding: 0, background: 'none' }}><X size={13} /></button>}
            </div>
            {isAdmin && (
              <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
                <option value="">All entities</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="inactive">Inactive</option>
            </select>
            <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
              {[['false', 'Own Fleet'], ['true', 'Subcontractors']]
                .filter(([val]) => !isObhi || val === 'true')
                .map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setFilterSubcontractor(f => f === val ? (isObhi ? val : '') : val)}
                    style={{
                      padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                      background: filterSubcontractor === val ? 'var(--accent)' : 'transparent',
                      color: filterSubcontractor === val ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {label}
                  </button>
                ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Group</span>
              <div style={{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
                {[['entity', 'Entity'], ['subcontractor', 'Subcontractor']].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setTruckGroupBy(val)}
                    style={{
                      padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                      background: truckGroupBy === val ? 'var(--accent)' : 'transparent',
                      color: truckGroupBy === val ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : trucks.length === 0 ? (
            <div className="empty-state">
              <Truck size={40} />
              <p>No trucks found{search ? ` for "${search}"` : ''}</p>
              {!search && <button className="btn-primary" onClick={() => setModal('create-truck')}><Plus size={14} /> Add first truck</button>}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <SortableHeader label="#"              col="fleet_number"   sort={truckSort} onSort={handleTruckSort} />
                    <SortableHeader label="Make / Model"   col="make"           sort={truckSort} onSort={handleTruckSort} />
                    <SortableHeader label="Registration"   col="registration"   sort={truckSort} onSort={handleTruckSort} />
                    {filterEntity && Number(filterEntity) === sftEntityId
                      ? <SortableHeader label="Licence Expiry" col="licence_expiry" sort={truckSort} onSort={handleTruckSort} />
                      : <th>Driver/s</th>
                    }
                    <th>Trailers</th>
                    <SortableHeader label="Subcontractor"  col="subcontractor"  sort={truckSort} onSort={handleTruckSort} />
                    <SortableHeader label="Status"         col="status"         sort={truckSort} onSort={handleTruckSort} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {groupedTrucks.map(group => (
                    <Fragment key={group.key ?? 'ungrouped'}>
                      {group.label && <tr style={{ background: 'var(--bg-surface)' }}>
                        <td colSpan={8} style={{ padding: '8px 14px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--accent)' }}>
                            {group.label}
                            {group.labelSub && <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontWeight: 500 }}>({group.labelSub})</span>}
                          </span>
                        </td>
                      </tr>}
                      {group.trucks.map(truck => (
                        <TruckRow
                          key={truck.id}
                          truck={truck}
                          isAdmin={isAdmin}
                          showLicenceExpiry={truck.entity_id === sftEntityId}
                          truckDrivers={allDrivers.filter(d =>
                            d.truck_id === truck.id ||
                            (d.driver_type === 'casual' && (d.casual_assignments || []).some(a => a.truck_id === truck.id))
                          )}
                          onEdit={t => { setSelected(t); setModal('edit-truck') }}
                          onDelete={t => { setSelected(t); setModal('delete-truck') }}
                        />
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Personal vehicles tab ── */}
      {tab === 'personal' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Show:</div>
            {[['active', 'Active'], ['sold', 'Sold'], ['written_off', 'Written Off'], ['', 'All']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPvFilterStatus(val)}
                style={{
                  padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                  border: '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.15s',
                  background: pvFilterStatus === val ? 'var(--accent)' : 'var(--bg-surface)',
                  color: pvFilterStatus === val ? '#fff' : 'var(--text-muted)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {pvLoading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : pvList.length === 0 ? (
            <div className="empty-state">
              <Car size={40} />
              <p>No personal vehicles found</p>
              <button className="btn-primary" onClick={() => setModal('create-pv')}><Plus size={14} /> Add first vehicle</button>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <SortableHeader label="Owner"          col="owner"          sort={pvSort} onSort={handlePvSort} />
                    <SortableHeader label="Vehicle"        col="vehicle_type"   sort={pvSort} onSort={handlePvSort} />
                    <SortableHeader label="Registration"   col="registration"   sort={pvSort} onSort={handlePvSort} />
                    <SortableHeader label="Licence Expiry" col="licence_expiry" sort={pvSort} onSort={handlePvSort} />
                    <SortableHeader label="Status"         col="status"         sort={pvSort} onSort={handlePvSort} />
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPvList.map(pv => (
                    <PersonalVehicleRow
                      key={pv.id}
                      pv={pv}
                      isAdmin={isAdmin}
                      onEdit={p => { setSelected(p); setModal('edit-pv') }}
                      onDelete={p => { setSelected(p); setModal('delete-pv') }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {(modal === 'create-truck' || modal === 'edit-truck') && (
        <TruckModal
          truck={modal === 'edit-truck' ? selected : null}
          entities={entities}
          allDrivers={allDrivers}
          existingTrucks={trucks}
          onSave={() => {
            setModal(null); setSelected(null); load()
            api.get('/api/drivers?limit=500&is_active=true').then(setAllDrivers).catch(() => {})
          }}
          onClose={() => { setModal(null); setSelected(null) }}
        />
      )}

      {(modal === 'create-pv' || modal === 'edit-pv') && (
        <PersonalVehicleModal
          pv={modal === 'edit-pv' ? selected : null}
          entities={entities}
          onSave={() => { setModal(null); setSelected(null); loadPV(); loadAlerts() }}
          onClose={() => { setModal(null); setSelected(null) }}
        />
      )}

      <DeleteModal
        isOpen={modal === 'delete-truck' && !!selected}
        onClose={() => { setModal(null); setSelected(null) }}
        title={`Delete Truck ${selected?.registration || ''}`}
        description={selected ? `This will also delete all trailers linked to ${selected.registration}. This action cannot be undone.` : ''}
        onDelete={handleDeleteTruck}
      />

      <DeleteModal
        isOpen={modal === 'delete-pv' && !!selected}
        onClose={() => { setModal(null); setSelected(null) }}
        title={`Delete ${selected?.vehicle_type || 'Vehicle'}`}
        description="This will permanently remove this personal vehicle record."
        onDelete={handleDeletePV}
      />
    </div>
  )
}
