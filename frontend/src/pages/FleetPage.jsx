import { useState, useEffect, useCallback, useRef } from 'react'
import { Truck, Plus, Search, X, ChevronDown, ChevronUp, Edit2, Trash2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import ExportButton from '../components/ExportButton'
import DeleteModal from '../components/DeleteModal'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const STATUS_COLOURS = {
  active:      { badge: 'badge-paid',     label: 'Active' },
  inactive:    { badge: 'badge-cancelled', label: 'Inactive' },
  maintenance: { badge: 'badge-quote',    label: 'Maintenance' },
}

const MAKES = ['SCANIA', 'DAF', 'FAW', 'MERC', 'FOTON AUMAN', 'OTHER']

// ── API helpers ───────────────────────────────────────────────────────────────

function useFleetApi() {
  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  })

  const get = (path) =>
    fetch(`${API}${path}`, { headers: headers() }).then(r => r.ok ? r.json() : Promise.reject(r))

  const post = (path, body) =>
    fetch(`${API}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))

  const put = (path, body) =>
    fetch(`${API}${path}`, { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))

  const del = (path) =>
    fetch(`${API}${path}`, { method: 'DELETE', headers: headers() })
      .then(r => { if (!r.ok) return r.json().then(e => Promise.reject(e)) })

  return { get, post, put, del }
}

// ── Stat cards ────────────────────────────────────────────────────────────────

function StatCards({ stats }) {
  if (!stats) return null
  const cards = [
    { label: 'Total Trucks',  value: stats.total_trucks,  colour: 'var(--accent)' },
    { label: 'Active',        value: stats.active,         colour: 'var(--success)' },
    { label: 'Maintenance',   value: stats.maintenance,    colour: 'var(--warning)' },
    { label: 'Total Trailers',value: stats.total_trailers, colour: 'var(--text-secondary)' },
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
                onChange={e => update(t.slot, 'registration', e.target.value)}
                placeholder="e.g. KKN187EC"
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
          <div className="form-group" style={{ marginTop: 8 }}>
            <label>Status</label>
            <select value={t.status} onChange={e => update(t.slot, 'status', e.target.value)}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Combobox (styled datalist replacement) ────────────────────────────────────

function ComboBox({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const containerRef = useRef(null)

  // Keep local query in sync when value changes externally
  useEffect(() => { setQuery(value) }, [value])

  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options

  const select = (opt) => {
    setQuery(opt)
    onChange(opt)
    setOpen(false)
  }

  const handleInput = (e) => {
    setQuery(e.target.value)
    onChange(e.target.value)
    setOpen(true)
  }

  const handleBlur = (e) => {
    // Delay close so clicks on options register first
    if (!containerRef.current?.contains(e.relatedTarget)) {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }} onBlur={handleBlur}>
      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={handleInput}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          style={{ paddingRight: 32 }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen(o => !o)}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <ul style={{
          position: 'absolute', zIndex: 200, top: 'calc(100% + 4px)', left: 0, right: 0,
          margin: 0, padding: '4px 0', listStyle: 'none',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.map(opt => (
            <li
              key={opt}
              tabIndex={0}
              onMouseDown={() => select(opt)}
              onKeyDown={e => e.key === 'Enter' && select(opt)}
              style={{
                padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                color: opt === value ? 'var(--accent)' : 'var(--text-primary)',
                fontWeight: opt === value ? 600 : 400,
                background: 'transparent',
                transition: 'background 0.1s',
              }}
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
  status: 'active',
  notes: '',
  trailers: [
    { slot: 1, registration: '', vin: '', status: 'active' },
    { slot: 2, registration: '', vin: '', status: 'active' },
  ],
}

function TruckModal({ truck, entities, allDrivers, onSave, onClose }) {
  const isEdit = !!truck?.id
  const api = useFleetApi()

  // Find driver currently assigned to this truck (FK is on driver.truck_id)
  const currentDriverId = isEdit
    ? (allDrivers.find(d => d.truck_id === truck.id)?.id ?? '')
    : ''

  const [form, setForm] = useState(() => {
    if (!truck) return { ...BLANK_TRUCK }
    const trailers = [1, 2].map(slot => {
      const t = (truck.trailers || []).find(x => x.slot === slot)
      return t
        ? { slot, registration: t.registration || '', vin: t.vin || '', status: t.status }
        : { slot, registration: '', vin: '', status: 'active' }
    })
    return {
      entity_id: truck.entity_id,
      fleet_number: truck.fleet_number || '',
      make: truck.make || '',
      model: truck.model || '',
      registration: truck.registration || '',
      vin: truck.vin || '',
      driver_name: truck.driver_name || '',
      licence_number: truck.licence_number || '',
      licence_expiry: truck.licence_expiry ? truck.licence_expiry.slice(0, 10) : '',
      finance_institution: truck.finance_institution || '',
      is_subcontractor: truck.is_subcontractor || false,
      status: truck.status || 'active',
      notes: truck.notes || '',
      trailers,
    }
  })

  // Selected driver ID (separate from form — handled via driver API)
  const [selectedDriverId, setSelectedDriverId] = useState(currentDriverId)

  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Drivers for this entity only
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
        trailers: form.trailers.filter(t => t.registration.trim()),
      }
      let savedTruck
      if (isEdit) {
        savedTruck = await api.put(`/api/fleet/trucks/${truck.id}`, payload)
        toast.success('Truck updated')
      } else {
        savedTruck = await api.post('/api/fleet/trucks', payload)
        toast.success('Truck added')
      }

      // Handle driver assignment via the driver API (FK is on driver.truck_id)
      const newDriverId = selectedDriverId ? Number(selectedDriverId) : null
      const oldDriverId = currentDriverId ? Number(currentDriverId) : null

      if (newDriverId !== oldDriverId) {
        // Unassign previous driver
        if (oldDriverId) {
          await api.put(`/api/drivers/${oldDriverId}`, { truck_id: null })
        }
        // Assign new driver
        if (newDriverId) {
          await api.put(`/api/drivers/${newDriverId}`, { truck_id: savedTruck.id })
        }
      }

      onSave()
    } catch (err) {
      toast.error(err?.detail || 'Failed to save truck')
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

            {/* Entity */}
            <div className="form-group">
              <label>Entity *</label>
              <select value={form.entity_id} onChange={e => { set('entity_id', Number(e.target.value)); setSelectedDriverId('') }} disabled={isEdit}>
                <option value="">Select entity…</option>
                {entities.map(en => (
                  <option key={en.id} value={en.id}>{en.name} ({en.code})</option>
                ))}
              </select>
            </div>

            {/* Identity */}
            <div className="form-row-3">
              <div className="form-group">
                <label>Fleet #</label>
                <input value={form.fleet_number} onChange={e => set('fleet_number', e.target.value)} placeholder="e.g. 1" />
              </div>
              <div className="form-group">
                <label>Make *</label>
                <select value={form.make} onChange={e => set('make', e.target.value)}>
                  <option value="">Select make…</option>
                  {MAKES.map(m => <option key={m}>{m}</option>)}
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
                <input
                  value={form.registration}
                  onChange={e => set('registration', e.target.value.toUpperCase())}
                  placeholder="e.g. KXH514MP"
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
              <div className="form-group">
                <label>VIN / Chassis</label>
                <input
                  value={form.vin}
                  onChange={e => set('vin', e.target.value.toUpperCase())}
                  placeholder="e.g. 9BSG6X40004042164"
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Assigned Driver</label>
                <select
                  value={selectedDriverId}
                  onChange={e => setSelectedDriverId(e.target.value)}
                  disabled={!form.entity_id}
                >
                  <option value="">— No driver —</option>
                  {entityDrivers.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.first_name} {d.last_name}{d.employee_number ? ` (#${d.employee_number})` : ''}
                    </option>
                  ))}
                </select>
                {form.entity_id && entityDrivers.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    No active drivers found for this entity.
                  </div>
                )}
                {!form.entity_id && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Select an entity first.
                  </div>
                )}
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

            {/* Subcontractor flag */}
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                id="is_subcontractor"
                checked={form.is_subcontractor}
                onChange={e => set('is_subcontractor', e.target.checked)}
              />
              <label htmlFor="is_subcontractor" style={{ margin: 0, cursor: 'pointer' }}>
                Subcontractor (Subbie) — this truck belongs to an external party
              </label>
            </div>

            {/* Licence */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Licence
              </div>
              <div style={{ padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Licence Number</label>
                    <input
                      value={form.licence_number}
                      onChange={e => set('licence_number', e.target.value.toUpperCase())}
                      placeholder="e.g. LIC123456"
                      style={{ fontFamily: 'monospace' }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Licence Expiry Date</label>
                    <input
                      type="date"
                      value={form.licence_expiry}
                      onChange={e => set('licence_expiry', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Financial Institution */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Financial Institution
              </div>
              <div style={{ padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="form-group">
                  <label>Institution Name</label>
                  <ComboBox
                    value={form.finance_institution}
                    onChange={v => set('finance_institution', v)}
                    placeholder="Select or type institution…"
                    options={[
                      'WesBank (FNB)',
                      'MFC (Nedbank)',
                      'ABSA Vehicle Finance',
                      'Standard Bank Vehicle Finance',
                      'Nedbank Vehicle Finance',
                      'FNB Vehicle Finance',
                      'Capitec Bank',
                      'Investec',
                      'Bidvest Bank',
                      'African Bank',
                      'Discovery Bank',
                      'Mercantile Bank',
                      'Old Mutual Finance',
                      'Sasfin Bank',
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Trailers */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Trailers
              </div>
              <TrailerFields
                trailers={form.trailers}
                onChange={trailers => set('trailers', trailers)}
              />
            </div>

            {/* Notes */}
            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
            </div>

          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
                : isEdit ? 'Save Changes' : 'Add Truck'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Licence expiry helpers ─────────────────────────────────────────────────

const WARN_DAYS = 30

function isLicenceExpired(expiry) {
  return expiry && new Date(expiry) < new Date()
}

function isLicenceExpiringSoon(expiry) {
  if (!expiry) return false
  const diff = new Date(expiry) - new Date()
  return diff > 0 && diff < WARN_DAYS * 86400 * 1000
}

// ── Expandable row ────────────────────────────────────────────────────────────

function TruckRow({ truck, onEdit, onDelete, isAdmin, linkedDriver }) {
  const [open, setOpen] = useState(false)
  const s = STATUS_COLOURS[truck.status] || STATUS_COLOURS.active

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <td>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
            {truck.fleet_number || '—'}
          </span>
        </td>
        <td>
          <div style={{ fontWeight: 600 }}>{truck.make}</div>
          {truck.model && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{truck.model}</div>}
        </td>
        <td>
          <span style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: 0.5 }}>
            {truck.registration}
          </span>
        </td>
        <td>
          {truck.licence_expiry ? (
            <span style={{
              fontSize: 11, fontFamily: 'monospace',
              color: isLicenceExpired(truck.licence_expiry)
                ? 'var(--danger)'
                : isLicenceExpiringSoon(truck.licence_expiry)
                  ? 'var(--warning)'
                  : 'var(--text-secondary)',
              fontWeight: (isLicenceExpired(truck.licence_expiry) || isLicenceExpiringSoon(truck.licence_expiry)) ? 700 : 400,
            }}>
              {new Date(truck.licence_expiry).toLocaleDateString('en-ZA')}
            </span>
          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </td>
        <td>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(truck.trailers || []).map(t => (
              <span key={t.id} style={{ fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', color: 'var(--text-secondary)' }}>
                {t.registration || '—'}
              </span>
            ))}
            {!(truck.trailers?.length) && <span style={{ color: 'var(--text-muted)' }}>—</span>}
          </div>
        </td>
        <td>
          {truck.is_subcontractor
            ? <span className="badge badge-quote" style={{ fontSize: 11 }}>Yes</span>
            : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
        </td>
        <td><span className={`badge ${s.badge}`}>{s.label}</span></td>
        <td>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <button className="btn-icon btn-ghost btn-sm" onClick={() => onEdit(truck)} title="Edit">
              <Edit2 size={13} />
            </button>
            {isAdmin && (
              <button className="btn-icon btn-ghost btn-sm" onClick={() => onDelete(truck)} title="Delete" style={{ color: 'var(--danger)' }}>
                <Trash2 size={13} />
              </button>
            )}
            <button className="btn-icon btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>
              {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr style={{ background: 'var(--bg-base)' }}>
          <td colSpan={8} style={{ padding: '12px 16px' }}>

            {/* ── Driver assignment ── */}
            <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', minWidth: 52 }}>Driver</div>
              {linkedDriver ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                    {linkedDriver.first_name} {linkedDriver.last_name}
                  </span>
                  {linkedDriver.employee_number && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>#{linkedDriver.employee_number}</span>
                  )}
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)', letterSpacing: 0.4 }}>Permanent</span>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No permanent driver assigned</span>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                Casual drivers may also operate this vehicle
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {truck.vin && (
                <div>
                  <div style={labelStyle}>Truck VIN</div>
                  <div style={valueStyle}>{truck.vin}</div>
                </div>
              )}
              {truck.licence_number && (
                <div>
                  <div style={labelStyle}>Licence No.</div>
                  <div style={valueStyle}>{truck.licence_number}</div>
                </div>
              )}
              {truck.licence_expiry && (
                <div>
                  <div style={labelStyle}>Licence Expiry</div>
                  <div style={{ ...valueStyle, color: isLicenceExpiringSoon(truck.licence_expiry) ? 'var(--warning)' : isLicenceExpired(truck.licence_expiry) ? 'var(--danger)' : 'var(--text-primary)' }}>
                    {new Date(truck.licence_expiry).toLocaleDateString('en-ZA')}
                    {isLicenceExpired(truck.licence_expiry) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700 }}>EXPIRED</span>}
                    {!isLicenceExpired(truck.licence_expiry) && isLicenceExpiringSoon(truck.licence_expiry) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700 }}>EXPIRING SOON</span>}
                  </div>
                </div>
              )}
              {truck.finance_institution && (
                <div>
                  <div style={labelStyle}>Financier</div>
                  <div style={valueStyle}>{truck.finance_institution}</div>
                </div>
              )}

              {(truck.trailers || []).map(t => (
                <div key={t.id}>
                  <div style={labelStyle}>Trailer {t.slot} VIN</div>
                  <div style={valueStyle}>{t.vin || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span className={`badge ${STATUS_COLOURS[t.status]?.badge || 'badge-draft'}`} style={{ fontSize: 10 }}>
                      {STATUS_COLOURS[t.status]?.label || t.status}
                    </span>
                  </div>
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

const labelStyle = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 2 }
const valueStyle = { fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)' }


// ── Main page ─────────────────────────────────────────────────────────────────

export default function FleetPage() {
  const { user, activeEntity, isAdmin } = useAuth()
  const api = useFleetApi()

  const [trucks, setTrucks]       = useState([])
  const [stats, setStats]         = useState(null)
  const [entities, setEntities]   = useState([])
  const [allDrivers, setAllDrivers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterEntity, setFilterEntity] = useState(activeEntity?.id?.toString() || '')
  const [filterStatus, setFilterStatus]           = useState('')
  const [filterSubcontractor, setFilterSubcontractor] = useState('false')
  const [modal, setModal]         = useState(null)
  const [selected, setSelected]   = useState(null)
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
      if (filterEntity) params.set('entity_id', filterEntity)
      if (filterStatus) params.set('status', filterStatus)
      if (filterSubcontractor !== '') params.set('is_subcontractor', filterSubcontractor)
      if (debouncedSearch) params.set('search', debouncedSearch)

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

  useEffect(() => {
    let ignore = false
    api.get('/api/entities/').then(e => { if (!ignore) setEntities(e) }).catch(() => {})
    return () => { ignore = true }
  }, [])
  useEffect(() => {
    let ignore = false
    api.get('/api/drivers?limit=500&is_active=true').then(d => { if (!ignore) setAllDrivers(d) }).catch(() => {})
    return () => { ignore = true }
  }, [])
  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])

  const handleDelete = async () => {
    try {
      await api.del(`/api/fleet/trucks/${selected.id}`)
      toast.success('Truck deleted')
      setModal(null)
      setSelected(null)
      load()
    } catch (err) {
      toast.error(err?.detail || 'Delete failed')
    }
  }

  const entityMap = Object.fromEntries(entities.map(e => [e.id, e]))

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Truck size={22} style={{ color: 'var(--accent)' }} />
            Fleet Management
          </div>
          <div className="page-subtitle">Trucks and trailers across all entities</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title="Fleet Report"
            filename="fleet"
            data={trucks}
            columns={[
              { header: 'Fleet #',         key: 'fleet_number' },
              { header: 'Make',            key: 'make' },
              { header: 'Model',           key: 'model' },
              { header: 'Registration',    key: 'registration' },
              { header: 'VIN',             key: 'vin' },
              { header: 'Driver',          key: 'driver_name' },
              { header: 'Licence No.',     key: 'licence_number' },
              { header: 'Licence Expiry',  value: r => r.licence_expiry ? new Date(r.licence_expiry).toLocaleDateString('en-ZA') : '' },
              { header: 'Financier',       key: 'finance_institution' },
              { header: 'Trailer 1',       value: r => (r.trailers || []).find(t => t.slot === 1)?.registration || '' },
              { header: 'Trailer 2',       value: r => (r.trailers || []).find(t => t.slot === 2)?.registration || '' },
              { header: 'Status',          key: 'status' },
            ]}
          />
          <button className="btn-primary" onClick={() => { setSelected(null); setModal('create') }}>
            <Plus size={15} /> Add Truck
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatCards stats={stats} />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: '1 1 220px', minWidth: 180 }}>
          <Search size={14} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reg, make, driver…"
          />
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
          {[['false', 'Own Fleet'], ['true', 'Subcontractors']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilterSubcontractor(f => f === val ? '' : val)}
              style={{
                padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: filterSubcontractor === val ? 'var(--accent)' : 'transparent',
                color: filterSubcontractor === val ? '#fff' : 'var(--text-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : trucks.length === 0 ? (
        <div className="empty-state">
          <Truck size={40} />
          <p>No trucks found{search ? ` for "${search}"` : ''}</p>
          {!search && <button className="btn-primary" onClick={() => setModal('create')}><Plus size={14} /> Add first truck</button>}
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Make / Model</th>
                <th>Registration</th>
                <th>Licence Expiry</th>
                <th>Trailers</th>
                <th>Subbie</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trucks.map((truck, i) => {
                const prev = i > 0 ? trucks[i - 1] : null
                const showDivider = prev && prev.entity_id !== truck.entity_id
                const entity = entityMap[truck.entity_id]
                return (
                  <>
                    {(i === 0 || showDivider) && (
                      <tr key={`entity-${truck.entity_id}`} style={{ background: 'var(--bg-surface)' }}>
                        <td colSpan={8} style={{ padding: '8px 14px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--accent)' }}>
                            {entity?.name || `Entity ${truck.entity_id}`}
                            <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontWeight: 500 }}>({entity?.code})</span>
                          </span>
                        </td>
                      </tr>
                    )}
                    <TruckRow
                      key={truck.id}
                      truck={truck}
                      isAdmin={isAdmin}
                      linkedDriver={allDrivers.find(d => d.truck_id === truck.id) || null}
                      onEdit={t => { setSelected(t); setModal('edit') }}
                      onDelete={t => { setSelected(t); setModal('delete') }}
                    />
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {(modal === 'create' || modal === 'edit') && (
        <TruckModal
          truck={modal === 'edit' ? selected : null}
          entities={entities}
          allDrivers={allDrivers}
          onSave={() => {
            setModal(null)
            setSelected(null)
            load()
            // Refresh drivers so updated truck_id is reflected
            api.get('/api/drivers?limit=500&is_active=true').then(setAllDrivers).catch(() => {})
          }}
          onClose={() => { setModal(null); setSelected(null) }}
        />
      )}
      <DeleteModal
        isOpen={modal === 'delete' && !!selected}
        onClose={() => { setModal(null); setSelected(null) }}
        title={`Delete Truck ${selected?.registration || ''}`}
        description={selected ? `This will also delete all trailers linked to ${selected.registration}. This action cannot be undone.` : ''}
        onDelete={async () => {
          await handleDelete()
        }}
      />
    </div>
  )
}
