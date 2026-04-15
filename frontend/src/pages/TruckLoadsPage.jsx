import { useState, useEffect, useCallback } from 'react'
import { Plus, Edit2, Trash2, X, Loader } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import ExportButton from '../components/ExportButton'
import {
  getTruckLoads, getTruckLoadSummary, createTruckLoad,
  updateTruckLoad, deleteTruckLoad, getMines, getSettings,
} from '../services/api'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const fmt = (n, dec = 2) =>
  n == null ? '—' : `R ${parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
const fmtNum = (n, dec = 3) =>
  n == null ? '—' : parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA') : '—'

function useFleetApi() {
  const h = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  })
  const get = (path) =>
    fetch(`${API}${path}`, { headers: h() }).then(r => r.ok ? r.json() : Promise.reject(r))
  return { get }
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({ summary, loading }) {
  const cards = [
    { label: 'Total Loads',       value: summary?.total_loads ?? '—',   colour: 'var(--accent)' },
    { label: 'Total Tonnes',      value: summary ? fmtNum(summary.total_tonnes) : '—', colour: 'var(--text-secondary)' },
    { label: 'Revenue (incl VAT)',value: summary ? fmt(summary.total_incl_vat) : '—',  colour: 'var(--success)' },
    { label: 'Diesel Litres',     value: summary ? fmtNum(summary.total_diesel_litres) : '—', colour: 'var(--warning)' },
  ]
  return (
    <div className="grid-4" style={{ marginBottom: 24 }}>
      {cards.map(c => (
        <div key={c.label} className="stat-card">
          <div className="stat-card-label">{c.label}</div>
          <div className="stat-card-value" style={{ color: c.colour, fontSize: 22 }}>
            {loading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : c.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Load form modal ───────────────────────────────────────────────────────────

const EMPTY_FORM = {
  entity_id: '',
  truck_id: '',
  mine_id: '',
  load_date: new Date().toISOString().slice(0, 10),
  slip_number: '',
  po_number: '',
  driver_name: '',
  tonnes: '',
  rate_per_ton: '',
  diesel_litres: '',
  diesel_invoice: '',
  diesel_rate: '',
  date_paid: '',
  is_paid: false,
  notes: '',
  checked_by: '',
}

function LoadModal({ load, entities, mines, vatRate, onClose, onSaved }) {
  const isEdit = !!load?.id
  const [form, setForm] = useState(isEdit ? {
    ...EMPTY_FORM,
    ...load,
    load_date: load.load_date ? load.load_date.slice(0, 10) : '',
    date_paid: load.date_paid ? load.date_paid.slice(0, 10) : '',
    tonnes: load.tonnes ?? '',
    rate_per_ton: load.rate_per_ton ?? '',
    diesel_litres: load.diesel_litres ?? '',
    diesel_rate: load.diesel_rate ?? '',
  } : { ...EMPTY_FORM })

  const [saving, setSaving] = useState(false)
  const [rateSource, setRateSource] = useState(null) // 'mine' | 'manual'
  const [modalTrucks, setModalTrucks] = useState([])
  const { get } = useFleetApi()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Fetch trucks whenever entity changes inside the modal
  useEffect(() => {
    if (!form.entity_id) { setModalTrucks([]); return }
    get(`/api/fleet/trucks?entity_id=${form.entity_id}&limit=200`)
      .then(data => setModalTrucks(Array.isArray(data) ? data : []))
      .catch(() => setModalTrucks([]))
  }, [form.entity_id])

  // Auto-fill rate when mine or entity changes (new loads only)
  useEffect(() => {
    if (isEdit) return
    if (!form.mine_id || !form.entity_id) return

    const mine = mines.find(m => m.id === parseInt(form.mine_id))
    if (!mine) return

    const activeRate = mine.rates?.find(
      r => r.entity_id === parseInt(form.entity_id) && !r.effective_to
    )
    if (activeRate) {
      setForm(f => ({ ...f, rate_per_ton: String(activeRate.rate_per_ton) }))
      setRateSource('mine')
    } else {
      setRateSource(null)
    }
  }, [form.mine_id, form.entity_id, isEdit, mines])

  // Live calculated values
  const exclVat = form.tonnes && form.rate_per_ton
    ? (parseFloat(form.tonnes) * parseFloat(form.rate_per_ton)).toFixed(2)
    : null
  const inclVat = exclVat ? (parseFloat(exclVat) * (1 + vatRate)).toFixed(2) : null

  const fmtCalc = (n) => n
    ? `R ${parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : ''

  const entityTrucks = modalTrucks

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        entity_id: parseInt(form.entity_id),
        truck_id: parseInt(form.truck_id),
        mine_id: parseInt(form.mine_id),
        load_date: new Date(form.load_date).toISOString(),
        slip_number: form.slip_number || null,
        po_number: form.po_number || null,
        driver_name: form.driver_name || null,
        tonnes: parseFloat(form.tonnes),
        rate_per_ton: form.rate_per_ton ? parseFloat(form.rate_per_ton) : null,
        diesel_litres: form.diesel_litres ? parseFloat(form.diesel_litres) : null,
        diesel_invoice: form.diesel_invoice || null,
        diesel_rate: form.diesel_rate ? parseFloat(form.diesel_rate) : null,
        date_paid: form.date_paid ? new Date(form.date_paid).toISOString() : null,
        is_paid: form.is_paid,
        notes: form.notes || null,
        checked_by: form.checked_by || null,
      }
      if (isEdit) {
        await updateTruckLoad(load.id, payload)
        toast.success('Load updated')
      } else {
        await createTruckLoad(payload)
        toast.success('Load created')
      }
      onSaved()
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Failed to save load'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <span style={{ fontWeight: 700 }}>{isEdit ? 'Edit Load' : 'Add Load'}</span>
          <button onClick={onClose} style={styles.closeBtn}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} style={styles.modalBody}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Entity *</label>
              <select className="form-control" value={form.entity_id} onChange={e => set('entity_id', e.target.value)} required>
                <option value="">Select entity…</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Truck *</label>
              <select className="form-control" value={form.truck_id} onChange={e => set('truck_id', e.target.value)} required disabled={!form.entity_id}>
                <option value="">Select truck…</option>
                {entityTrucks.map(t => <option key={t.id} value={t.id}>{t.registration}{t.fleet_number ? ` (${t.fleet_number})` : ''}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Mine *</label>
              <select className="form-control" value={form.mine_id} onChange={e => set('mine_id', e.target.value)} required>
                <option value="">Select mine…</option>
                {mines.filter(m => m.is_active).map(m => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Load Date *</label>
              <input type="date" className="form-control" value={form.load_date} onChange={e => set('load_date', e.target.value)} required />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Slip Number</label>
              <input className="form-control" value={form.slip_number} onChange={e => set('slip_number', e.target.value)} placeholder="DN0152858" />
            </div>
            <div className="form-group">
              <label className="form-label">PO Number</label>
              <input className="form-control" value={form.po_number} onChange={e => set('po_number', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Driver Name</label>
              <input className="form-control" value={form.driver_name} onChange={e => set('driver_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Tonnes *</label>
              <input type="number" step="0.001" className="form-control" value={form.tonnes} onChange={e => set('tonnes', e.target.value)} required placeholder="38.520" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Rate per Ton (excl VAT)
                {rateSource === 'mine' && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 4, padding: '1px 5px' }}>
                    auto-filled
                  </span>
                )}
              </label>
              <input
                type="number" step="0.01" className="form-control"
                value={form.rate_per_ton}
                onChange={e => { set('rate_per_ton', e.target.value); setRateSource('manual') }}
                placeholder="Auto from mine rate"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Excl VAT (calc)</label>
              <input className="form-control" value={fmtCalc(exclVat)} readOnly style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Incl VAT @ {(vatRate * 100).toFixed(0)}% (calc)</label>
              <input className="form-control" value={fmtCalc(inclVat)} readOnly style={{ background: 'var(--bg-base)', fontWeight: 600 }} />
            </div>
            <div className="form-group">
              <label className="form-label">Diesel Litres</label>
              <input type="number" step="0.001" className="form-control" value={form.diesel_litres} onChange={e => set('diesel_litres', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Diesel Invoice #</label>
              <input className="form-control" value={form.diesel_invoice} onChange={e => set('diesel_invoice', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Diesel Rate (per litre)</label>
              <input type="number" step="0.0001" className="form-control" value={form.diesel_rate} onChange={e => set('diesel_rate', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Date Paid</label>
              <input type="date" className="form-control" value={form.date_paid} onChange={e => set('date_paid', e.target.value)} />
            </div>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="form-label">Paid?</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 6 }}>
                <input type="checkbox" checked={form.is_paid} onChange={e => set('is_paid', e.target.checked)} />
                <span style={{ fontSize: 13 }}>Mark as paid</span>
              </label>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Checked By</label>
              <input className="form-control" value={form.checked_by} onChange={e => set('checked_by', e.target.value)} placeholder="e.g. B" maxLength={50} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. NOT PAID, ANDAL" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Load'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TruckLoadsPage() {
  const { user, isAdmin, entities, activeEntity } = useAuth()
  const { get } = useFleetApi()

  const now = new Date()
  const [filterEntity, setFilterEntity] = useState(activeEntity?.id || '')
  const [filterYear, setFilterYear] = useState(now.getFullYear())
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1)
  const [filterTruck, setFilterTruck] = useState('')
  const [filterMine, setFilterMine] = useState('')
  const [filterPaid, setFilterPaid] = useState('all')

  const [loads, setLoads] = useState([])
  const [summary, setSummary] = useState(null)
  const [trucks, setTrucks] = useState([])
  const [mines, setMines] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editLoad, setEditLoad] = useState(null)
  const [vatRate, setVatRate] = useState(0.15) // default fallback

  const accessibleEntities = isAdmin
    ? entities
    : entities.filter(e => user?.entity_access?.some(a => a.entity_id === e.id))

  // Fetch global VAT rate from settings once on mount
  useEffect(() => {
    getSettings()
      .then(r => {
        const setting = r.data.find(s => s.key === 'vat_rate')
        if (setting) setVatRate(parseFloat(setting.value))
      })
      .catch(() => {}) // keep default 0.15 on failure
  }, [])

  // Load trucks and mines once
  useEffect(() => {
    const eid = filterEntity || (accessibleEntities[0]?.id)
    if (eid) {
      get(`/api/fleet/trucks?entity_id=${eid}&limit=200`).then(setTrucks).catch(() => {})
    }
    getMines({ active_only: false }).then(r => setMines(r.data)).catch(() => {})
  }, [filterEntity])

  const buildParams = useCallback(() => {
    const dateFrom = new Date(filterYear, filterMonth - 1, 1).toISOString()
    const dateTo = new Date(filterYear, filterMonth, 0, 23, 59, 59).toISOString()
    const p = { date_from: dateFrom, date_to: dateTo, limit: 500 }
    if (filterEntity) p.entity_id = filterEntity
    if (filterTruck) p.truck_id = filterTruck
    if (filterMine) p.mine_id = filterMine
    if (filterPaid === 'paid') p.is_paid = true
    if (filterPaid === 'unpaid') p.is_paid = false
    return p
  }, [filterEntity, filterYear, filterMonth, filterTruck, filterMine, filterPaid])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = buildParams()
      const [loadsRes, summaryRes] = await Promise.all([
        getTruckLoads(params),
        getTruckLoadSummary(params),
      ])
      setLoads(loadsRes.data)
      setSummary(summaryRes.data)
    } catch {
      toast.error('Failed to load truck loads')
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  useEffect(() => { fetchData() }, [fetchData])

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this load record?')) return
    try {
      await deleteTruckLoad(id)
      toast.success('Load deleted')
      fetchData()
    } catch {
      toast.error('Failed to delete')
    }
  }

  const openAdd = () => { setEditLoad(null); setShowModal(true) }
  const openEdit = (load) => { setEditLoad(load); setShowModal(true) }
  const handleSaved = () => { setShowModal(false); fetchData() }

  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ]

  const filterTrucks = filterEntity
    ? trucks.filter(t => String(t.entity_id) === String(filterEntity))
    : trucks

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Truck Loads</h1>
          <p className="page-subtitle">Track per-truck load revenue by mine</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title="Truck Loads Report"
            filename="truck-loads"
            data={loads}
            columns={[
              { header: 'Date',           value: r => fmtDate(r.load_date) },
              { header: 'Truck',          key: 'truck_registration' },
              { header: 'Driver',         key: 'driver_name' },
              { header: 'Mine',           key: 'mine_name' },
              { header: 'Slip #',         key: 'slip_number' },
              { header: 'PO #',           key: 'po_number' },
              { header: 'Tonnes',         key: 'tonnes' },
              { header: 'Rate / ton',     key: 'rate_per_ton' },
              { header: 'Excl VAT',       key: 'amount_excl_vat' },
              { header: 'Incl VAT',       key: 'amount_incl_vat' },
              { header: 'Diesel ℓ',       key: 'diesel_litres' },
              { header: 'Diesel Inv #',   key: 'diesel_invoice' },
              { header: 'Diesel Rate',    key: 'diesel_rate' },
              { header: 'Paid',           value: r => r.is_paid ? 'Yes' : 'No' },
              { header: 'Date Paid',      value: r => fmtDate(r.date_paid) },
              { header: 'Checked By',     key: 'checked_by' },
              { header: 'Notes',          key: 'notes' },
            ]}
          />
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={15} /> Add Load
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
          <label className="form-label">Entity</label>
          <select className="form-control" value={filterEntity} onChange={e => { setFilterEntity(e.target.value); setFilterTruck('') }}>
            {isAdmin && <option value="">All Entities</option>}
            {accessibleEntities.map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0, minWidth: 110 }}>
          <label className="form-label">Month</label>
          <select className="form-control" value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}>
            {months.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0, minWidth: 80 }}>
          <label className="form-label">Year</label>
          <select className="form-control" value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0, minWidth: 130 }}>
          <label className="form-label">Truck</label>
          <select className="form-control" value={filterTruck} onChange={e => setFilterTruck(e.target.value)}>
            <option value="">All Trucks</option>
            {filterTrucks.map(t => <option key={t.id} value={t.id}>{t.registration}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0, minWidth: 130 }}>
          <label className="form-label">Mine</label>
          <select className="form-control" value={filterMine} onChange={e => setFilterMine(e.target.value)}>
            <option value="">All Mines</option>
            {mines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Payment Status</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {['all', 'paid', 'unpaid'].map(s => (
              <button
                key={s}
                className={`btn btn-sm ${filterPaid === s ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilterPaid(s)}
                style={{ textTransform: 'capitalize', fontSize: 12 }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SummaryCards summary={summary} loading={loading} />

      {/* Loads table */}
      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : loads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No loads found for this period.</div>
        ) : (
          <table className="data-table" style={{ minWidth: 1100 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Truck</th>
                <th>Driver</th>
                <th>Mine</th>
                <th>Slip #</th>
                <th style={{ textAlign: 'right' }}>Tonnes</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Excl VAT</th>
                <th style={{ textAlign: 'right' }}>Incl VAT</th>
                <th style={{ textAlign: 'right' }}>Diesel ℓ</th>
                <th>Paid</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loads.map(l => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.load_date)}</td>
                  <td><span style={{ fontWeight: 600 }}>{l.truck_registration || `#${l.truck_id}`}</span></td>
                  <td style={{ color: 'var(--text-muted)' }}>{l.driver_name || '—'}</td>
                  <td>{l.mine_name || `Mine ${l.mine_id}`}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{l.slip_number || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(l.tonnes)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.rate_per_ton)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.amount_excl_vat)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(l.amount_incl_vat)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.diesel_litres ? fmtNum(l.diesel_litres) : '—'}</td>
                  <td>
                    {l.is_paid
                      ? <span className="badge badge-paid">Paid</span>
                      : <span className="badge badge-draft">Unpaid</span>
                    }
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[l.notes, l.checked_by ? `[${l.checked_by}]` : null].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => openEdit(l)}>
                        <Edit2 size={13} />
                      </button>
                      {isAdmin && (
                        <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => handleDelete(l.id)} style={{ color: 'var(--danger)' }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <LoadModal
          load={editLoad}
          entities={accessibleEntities}

          mines={mines}
          vatRate={vatRate}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  },
  modal: {
    background: 'var(--bg-card)', borderRadius: 12,
    width: '100%', maxWidth: 640, maxHeight: '90vh',
    overflow: 'hidden', display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)',
  },
  modalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
    fontSize: 15,
  },
  modalBody: {
    padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4,
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', padding: 4, display: 'flex', borderRadius: 6,
  },
}
