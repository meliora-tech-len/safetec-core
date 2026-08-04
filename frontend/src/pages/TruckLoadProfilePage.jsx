import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Save, X, Trash2,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader, Fuel, UtensilsCrossed, BarChart3,
  Banknote, CalendarClock, Search, Check, Flag, Upload, Pencil,
} from 'lucide-react'
import ImportDieselModal from '../components/ImportDieselModal'
import { useAuth } from '../hooks/useAuth'
import { useSessionState } from '../hooks/useSessionState'
import SearchableSelect from '../components/SearchableSelect'
import {
  getTruck, getTruckLoads, getTruckLoadSummary, getFleetTrucks,
  createTruckLoad, createSplitLoad, updateTruckLoad, deleteTruckLoad, archiveTruckLoad,
  getMines, getDrivers, getSettings, getSuppliers,
  getDieselFillUps, createDieselFillUp, updateDieselFillUp, deleteDieselFillUp, archiveDieselFillUp, getCurrentDieselRate,
  addDriverAdditionalLoad, updateDriverAdditionalLoad, deleteDriverAdditionalLoad, archiveDriverAdditionalLoad,
  getAdditionalLoadRates,
  addDriverFoodPayment, getTruckAdditionalLoads, getTruckFoodPayments,
  updateDriverFoodPayment, deleteDriverFoodPayment,
  getTruckWashes, addTruckWash, updateTruckWash, deleteTruckWash,
  getTruckMonthlyExpenses, upsertTruckMonthlyExpenses,
  getSupplierInvoicesByVehicle,
  verifyDieselFillUp, finalizeDieselFillUp,
  verifyFoodPayment, finalizeFoodPayment,
  getVerifications, verifyValue, finalizeValue,
} from '../services/api'
import toast from 'react-hot-toast'
import { errorMessage, dieselTypeForSupplier } from '../utils/helpers'
import DeleteModal from '../components/DeleteModal'
import VerifyBadge from '../components/VerifyBadge'
import VerifiableAmount from '../components/VerifiableAmount'
import BulkUnlockButton from '../components/BulkUnlockButton'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'
import DateInput from '../components/DateInput'

const fmt    = (n) => n == null ? '—' : `R ${parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtNum = (n) => n == null ? '—' : parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA') : '—'
// Effective loads: splits land on halves, so show 4.5 but keep whole numbers clean.
const fmtLoads = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1)
const today = new Date().toISOString().slice(0, 10)

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// In-header truck switcher: click the registration to open a grouped, searchable
// list of trucks and jump straight to another one (keeps the current month/tab).
function TruckSwitcher({ trucks, currentId, currentLabel, entities, onSelect }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()) }, [open])

  const current = trucks.find(t => String(t.id) === String(currentId))
  const entityCode = (id) => entities.find(e => e.id === id)?.code
  const groupOf = (t) => t.is_subcontractor
    ? (t.subcontractor_display_name || t.contract_context || 'Subcontractor')
    : (entityCode(t.entity_id) || 'Own Fleet')

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const filtered = q
      ? trucks.filter(t =>
          t.registration?.toLowerCase().includes(q) ||
          String(t.fleet_number || '').toLowerCase().includes(q) ||
          t.make?.toLowerCase().includes(q))
      : trucks
    const m = {}
    for (const t of filtered) { const g = groupOf(t); (m[g] = m[g] || []).push(t) }
    Object.values(m).forEach(arr => arr.sort((a, b) =>
      (parseInt(a.fleet_number) || 9999) - (parseInt(b.fleet_number) || 9999) ||
      (a.registration || '').localeCompare(b.registration || '')))
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
  }, [trucks, q, entities])

  const pick = (t) => { setOpen(false); setQuery(''); if (String(t.id) !== String(currentId)) onSelect(t.id) }

  // First truck in the (sorted, grouped) result list — what Enter should select.
  const firstMatch = groups[0]?.[1]?.[0]
  const onSearchKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (firstMatch) pick(firstMatch) }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Switch truck"
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-primary)' }}
      >
        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'monospace', letterSpacing: 1 }}>
          {current ? current.registration : (currentLabel || '—')}
        </span>
        <ChevronDown size={20} style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 200,
          width: 280, maxHeight: 360, display: 'flex', flexDirection: 'column',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: 'var(--shadow)', overflow: 'hidden',
        }}>
          <div className="search-bar" style={{ margin: 8 }}>
            <Search size={14} />
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder="Search reg, fleet #, make…" />
          </div>
          <div style={{ overflowY: 'auto', padding: '0 4px 6px' }}>
            {groups.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>No trucks found</div>
            )}
            {groups.map(([group, list]) => (
              <div key={group}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '8px 8px 4px' }}>{group}</div>
                {list.map(t => {
                  const isCurrent = String(t.id) === String(currentId)
                  return (
                    <button key={t.id} onClick={() => pick(t)}
                      onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent' }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '7px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: isCurrent ? 'var(--accent-subtle)' : 'transparent',
                        color: isCurrent ? 'var(--accent)' : 'var(--text-primary)',
                      }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{t.registration}</span>
                      {t.fleet_number && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{t.fleet_number}</span>}
                      <span style={{ flex: 1 }} />
                      {isCurrent && <Check size={14} />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const EMPTY_LOAD = {
  load_date: '', slip_number: '', po_number: '',
  driver_id: null, driver_name: '',
  mine_id: '', supplier_id: '', tonnes: '', rate_per_ton: '', is_paid: false,
  is_projection: false, driver_already_paid: false,
  notes: '', checked_by: '',
}

const EMPTY_PROJ = {
  load_date: '',
  driver_id: null, driver_name: '',
  mine_id: '',
  notes: '',
  statement_month: null, statement_year: null,
}
const EMPTY_DIESEL = {
  fillup_date: '', supplier_id: '', invoice_number: '', slip_number: '', litres: '', rate_per_litre: '', notes: '', diesel_type: 'fillup', rate_pending: false,
}
const EMPTY_FOOD = { driver_id: '', amount: '', payment_date: '', notes: '' }


// ── Shared load form (card-style flex-wrap, used for both new and inline edit) ──
function LoadForm({ editForm, setEditForm, mines, drivers, vatRate, rateSource, setRateSource,
  saving, onSave, onCancel, firstInputRef, showPo, isSubcontractorEntity, fmt, MONTHS, isSplit }) {
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 3 }
  const inp = { padding: '5px 8px', fontSize: 12, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none' }
  const isProj = !!editForm.is_projection
  const cardExcl = !isProj && editForm.tonnes && editForm.rate_per_ton ? (parseFloat(editForm.tonnes) * parseFloat(editForm.rate_per_ton)).toFixed(2) : null
  const cardIncl = cardExcl ? (parseFloat(cardExcl) * (1 + vatRate)).toFixed(2) : null
  const vatRegistered = vatRate > 0
  const formRef = useRef(null)
  const focusNext = (e) => {
    if (e.key !== 'ArrowRight') return
    e.preventDefault()
    if (!formRef.current) return
    const els = Array.from(formRef.current.querySelectorAll(
      'input:not([disabled]):not([type=checkbox]), select:not([disabled])'
    )).filter(el => el.offsetParent !== null)
    const idx = els.indexOf(document.activeElement)
    if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus()
  }
  const onKey = (e) => { focusNext(e); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave() } if (e.key === 'Escape') onCancel() }
  const set = (k, v) => setEditForm(f => ({ ...f, [k]: v }))
  return (
    <div ref={formRef}>
      {isProj && (
        <div style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 11, background: '#f59e0b', color: '#fff', padding: '1px 6px', borderRadius: 3 }}>PROJECTION</span>
          Fill in Tonnes to convert this to a real load, then uncheck below.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px', alignItems: 'flex-end' }}>
        <div>
          <div style={lbl}>Date</div>
          <DateInput ref={firstInputRef} value={editForm.load_date} onChange={e => set('load_date', e.target.value)} onKeyDown={onKey} style={{ ...inp, width: 112 }} />
        </div>
        <div>
          <div style={lbl}>Period</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <select value={editForm.statement_month || ''} onChange={e => set('statement_month', parseInt(e.target.value))} style={{ ...inp, width: 60, padding: '5px 4px' }}>
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m.slice(0, 3)}</option>)}
            </select>
            <input type="number" min="2020" max="2099" value={editForm.statement_year || ''} onChange={e => set('statement_year', parseInt(e.target.value))} onKeyDown={onKey} style={{ ...inp, width: 64 }} />
          </div>
        </div>
        <div>
          <div style={lbl}>Slip #</div>
          <input value={editForm.slip_number || ''} placeholder="Slip #" onChange={e => set('slip_number', e.target.value)} onKeyDown={onKey} style={{ ...inp, width: 80 }} />
        </div>
        {showPo && <div>
          <div style={lbl}>PO #</div>
          <input value={editForm.po_number || ''} placeholder="PO #" onChange={e => set('po_number', e.target.value)} onKeyDown={onKey} style={{ ...inp, width: 80 }} />
        </div>}
        {!isSubcontractorEntity && !isSplit && <div>
          <div style={lbl}>Driver</div>
          <SearchableSelect
            value={editForm.driver_id != null ? String(editForm.driver_id) : ''}
            onChange={v => { const d = drivers.find(x => String(x.id) === v); set('driver_id', v || null); set('driver_name', d ? `${d.first_name} ${d.last_name}`.trim() : (editForm.driver_name || '')) }}
            options={drivers} getValue={d => String(d.id)}
            getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`}
            placeholder="Driver…" style={{ minWidth: 140 }} />
        </div>}
        <div>
          <div style={lbl}>Mine</div>
          <SearchableSelect value={String(editForm.mine_id)} onChange={v => { set('mine_id', v); setRateSource(null) }}
            options={mines.filter(m => m.is_active)} getValue={m => String(m.id)} getLabel={m => m.name}
            placeholder="Mine…" style={{ minWidth: 120 }} />
        </div>
        {!isProj && <>
          <div>
            <div style={lbl}>Tonnes</div>
            <input type="number" step="0.001" min="0" placeholder="0.000" value={editForm.tonnes || ''} onChange={e => set('tonnes', e.target.value)} onKeyDown={onKey} style={{ ...inp, width: 80, textAlign: 'right' }} />
          </div>
          <div>
            <div style={lbl}>Rate/t {rateSource === 'mine' && <span style={{ fontSize: 9, color: 'var(--accent)', marginLeft: 3 }}>auto</span>}</div>
            <input type="number" step="0.01" min="0" placeholder="Rate" value={editForm.rate_per_ton || ''} onChange={e => { set('rate_per_ton', e.target.value); setRateSource('manual') }} onKeyDown={onKey} style={{ ...inp, width: 75, textAlign: 'right' }} />
          </div>
          <div>
            <div style={lbl}>Excl VAT</div>
            <div style={{ ...inp, width: 110, textAlign: 'right', background: 'var(--bg-surface)', color: cardExcl ? 'var(--text-primary)' : 'var(--text-muted)' }}>{cardExcl ? fmt(cardExcl) : '—'}</div>
          </div>
          {vatRegistered && <div>
            <div style={lbl}>Incl VAT</div>
            <div style={{ ...inp, width: 110, textAlign: 'right', background: 'var(--bg-surface)', color: 'var(--accent)', fontWeight: 700 }}>{cardIncl ? fmt(cardIncl) : '—'}</div>
          </div>}
        </>}
        <div style={{ flex: 1, minWidth: 100 }}>
          <div style={lbl}>Notes</div>
          <input value={editForm.notes || ''} placeholder="Notes" onChange={e => set('notes', e.target.value)} onKeyDown={onKey} style={{ ...inp, width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: isProj ? '#d97706' : 'var(--text-muted)', userSelect: 'none', padding: '5px 0' }}>
            <input type="checkbox" checked={isProj} onChange={e => set('is_projection', e.target.checked)} style={{ accentColor: '#f59e0b', width: 13, height: 13 }} />
            Projection
          </label>
          <button onClick={onSave} disabled={saving} className="btn btn-primary btn-sm"><Save size={13} /> Save</button>
          <button onClick={onCancel} className="btn btn-ghost btn-sm"><X size={13} /> Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Inline edit row (Loads tab) ────────────────────────────────────────────────
function EditRow({ form, setForm, mines, drivers, haulageSuppliers, vatRate, rateSource, setRateSource,
  saving, onSave, onCancel, firstInputRef, showPo, showSub, isSubcontractorEntity }) {

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const exclVat = form.tonnes && form.rate_per_ton
    ? (parseFloat(form.tonnes) * parseFloat(form.rate_per_ton)).toFixed(2) : null
  const inclVat = exclVat ? (parseFloat(exclVat) * (1 + vatRate)).toFixed(2) : null

  const rowRef = useRef(null)
  const focusNext = (e) => {
    if (e.key !== 'ArrowRight') return
    e.preventDefault()
    if (!rowRef.current) return
    const els = Array.from(rowRef.current.querySelectorAll(
      'input:not([disabled]):not([type=checkbox]), select:not([disabled])'
    )).filter(el => el.offsetParent !== null)
    const idx = els.indexOf(document.activeElement)
    if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus()
  }
  const handleKey = (e) => {
    focusNext(e)
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave() }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <tr ref={rowRef} style={{ background: 'var(--accent-subtle)', outline: '2px solid var(--accent)', outlineOffset: -1 }}
      onClick={e => e.stopPropagation()}>
      <td style={S.td}>
        <DateInput ref={firstInputRef} value={form.load_date}
          onChange={e => set('load_date', e.target.value)} onKeyDown={handleKey} style={S.input} />
      </td>
      <td style={S.td}>
        <div style={{ display: 'flex', gap: 3 }}>
          <select value={form.statement_month || ''} onChange={e => set('statement_month', parseInt(e.target.value))}
            style={{ ...S.input, width: 56, padding: '2px 4px' }}>
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m.slice(0, 3)}</option>
            ))}
          </select>
          <input type="number" min="2020" max="2099"
            value={form.statement_year || ''}
            onChange={e => set('statement_year', parseInt(e.target.value))} onKeyDown={handleKey}
            style={{ ...S.input, width: 44 }} />
        </div>
      </td>
      <td style={S.td}>
        <input value={form.slip_number} placeholder="Slip #"
          onChange={e => set('slip_number', e.target.value)} onKeyDown={handleKey}
          style={{ ...S.input, width: 68 }} />
      </td>
      <td style={S.td}>—</td>
      {showPo && (
        <td style={S.td}>
          <input value={form.po_number} placeholder="PO #"
            onChange={e => set('po_number', e.target.value)} onKeyDown={handleKey}
            style={{ ...S.input, width: 80 }} />
        </td>
      )}
      {!isSubcontractorEntity && <td style={S.td}>
        <SearchableSelect
          value={form.driver_id != null ? String(form.driver_id) : ''}
          onChange={v => {
            const d = drivers.find(x => String(x.id) === v)
            set('driver_id', v || null)
            set('driver_name', d ? `${d.first_name} ${d.last_name}`.trim() : (form.driver_name || ''))
          }}
          options={drivers}
          getValue={d => String(d.id)}
          getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`}
          placeholder="Driver…"
          style={{ minWidth: 95 }} />
      </td>}
      {!isSubcontractorEntity && <td style={S.td}>—</td>}
      <td style={S.td}>
        <SearchableSelect value={String(form.mine_id)} onChange={v => { set('mine_id', v); setRateSource(null) }}
          options={mines.filter(m => m.is_active)} getValue={m => String(m.id)}
          getLabel={m => m.name} placeholder="Mine…" style={{ minWidth: 85 }} />
      </td>
      {/* <td style={S.td}>
        <SearchableSelect value={String(form.supplier_id)} onChange={v => set('supplier_id', v)}
          options={haulageSuppliers} getValue={s => String(s.id)}
          getLabel={s => s.name} placeholder="Supplier…" style={{ minWidth: 120 }} />
      </td> */}
      <td style={S.td}>
        <input type="number" step="0.001" min="0" placeholder="0.000" value={form.tonnes}
          onChange={e => set('tonnes', e.target.value)} onKeyDown={handleKey}
          style={{ ...S.input, width: 65, textAlign: 'right' }} />
      </td>
      <td style={S.td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input type="number" step="0.01" min="0" placeholder="Rate" value={form.rate_per_ton}
            onChange={e => { set('rate_per_ton', e.target.value); setRateSource('manual') }} onKeyDown={handleKey}
            style={{ ...S.input, width: 60, textAlign: 'right' }} />
          {rateSource === 'mine' && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>auto</span>
          )}
        </div>
      </td>
      <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>
        {exclVat ? `R ${parseFloat(exclVat).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}` : '—'}
      </td>
      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontSize: 12 }}>
        {inclVat ? `R ${parseFloat(inclVat).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}` : '—'}
      </td>
      {showSub && <><td /><td /><td /></>}
      <td style={S.td}>
        <input value={form.notes} placeholder="Notes"
          onChange={e => set('notes', e.target.value)} onKeyDown={handleKey}
          style={{ ...S.input, minWidth: 70 }} />
      </td>
      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
        <button onClick={onSave} disabled={saving} className="btn btn-icon btn-primary" style={{ marginRight: 4 }} title="Save (Enter)">
          <Save size={14} />
        </button>
        <button onClick={onCancel} className="btn btn-icon btn-ghost" title="Cancel (Esc)">
          <X size={14} />
        </button>
      </td>
    </tr>
  )
}


// Inline-edit cell/input styling for the diesel table — horizontal padding matches
// the 14px header/cell padding so each field lines up under its column header.
const dEditCell  = { padding: '6px 14px', verticalAlign: 'middle' }
const dEditInput = { width: '100%' }

// ── Diesel section ─────────────────────────────────────────────────────────────
function DieselSection({ truck, year, month, suppliers, isBokamosho }) {
  const [fillups, setFillups]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [addingNew, setAddingNew] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm]           = useState({ ...EMPTY_DIESEL })
  const [autoRate, setAutoRate]   = useState(null)
  const [rateEdited, setRateEdited] = useState(false)
  const [dSort, setDSort]         = useState({ col: 'fillup_date', dir: 'asc' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const [editingFillupId, setEditingFillupId] = useState(null)
  const [editFillupForm, setEditFillupForm]   = useState({})
  const [editSaving, setEditSaving]           = useState(false)
  const setEF = (k, v) => setEditFillupForm(f => ({ ...f, [k]: v }))

  const startEditFillup = (f) => {
    if (editingFillupId !== null) return
    setEditFillupForm({
      fillup_date:    f.fillup_date ? f.fillup_date.slice(0, 10) : today,
      diesel_type:    f.diesel_type || 'fillup',
      slip_number:    f.slip_number || '',
      invoice_number: f.invoice_number || '',
      litres:         f.litres != null ? String(f.litres) : '',
      rate_per_litre: f.rate_per_litre != null ? String(f.rate_per_litre) : '',
      notes:          f.notes || '',
    })
    setEditingFillupId(f.id)
  }

  const doUpdateFillup = async () => {
    setEditSaving(true)
    try {
      await updateDieselFillUp(editingFillupId, {
        fillup_date:    editFillupForm.fillup_date,
        diesel_type:    editFillupForm.diesel_type,
        slip_number:    editFillupForm.slip_number || null,
        invoice_number: editFillupForm.invoice_number || null,
        litres:         parseFloat(editFillupForm.litres),
        rate_per_litre: parseFloat(editFillupForm.rate_per_litre),
        notes:          editFillupForm.notes || null,
      })
      toast.success('Entry updated')
      setEditingFillupId(null)
      fetchFillups()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update'))
    } finally { setEditSaving(false) }
  }

  const handleDSort = (col) => setDSort(s => ({
    col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc'
  }))
  const dArrow = (col) => dSort.col === col ? (dSort.dir === 'asc' ? ' ↑' : ' ↓') : ''
  const sortEntries = (arr) => [...arr].sort((a, b) => {
    let av, bv
    switch (dSort.col) {
      case 'fillup_date':   av = a.fillup_date || '';  bv = b.fillup_date || '';  break
      case 'slip_number':   av = (a.slip_number || '').toLowerCase(); bv = (b.slip_number || '').toLowerCase(); break
      case 'invoice_number': av = (a.supplier_invoice_number || a.invoice_number || '').toLowerCase(); bv = (b.supplier_invoice_number || b.invoice_number || '').toLowerCase(); break
      case 'litres':        av = parseFloat(a.litres) || 0; bv = parseFloat(b.litres) || 0; break
      case 'total_amount':  av = parseFloat(a.total_amount) || 0; bv = parseFloat(b.total_amount) || 0; break
      default: av = ''; bv = ''
    }
    if (av < bv) return dSort.dir === 'asc' ? -1 : 1
    if (av > bv) return dSort.dir === 'asc' ? 1 : -1
    return 0
  })

  const litresNum = parseFloat(form.litres) || 0
  const rateNum   = parseFloat(form.rate_per_litre) || 0

  useEffect(() => {
    if (!form.supplier_id || !form.fillup_date) return
    getCurrentDieselRate(form.supplier_id, {
      entity_id: truck.entity_id,
      on_date: form.fillup_date,
    }).then(r => {
      const rate = r.data
      if (rate && !rateEdited) {
        setAutoRate(rate.rate_per_litre)
        setForm(f => ({ ...f, rate_per_litre: parseFloat(rate.rate_per_litre).toFixed(2) }))
      }
      if (!rate) setAutoRate(null)
    }).catch(() => {})
  }, [form.supplier_id, form.fillup_date, truck.entity_id, rateEdited])
  const calcAmt   = litresNum > 0 && rateNum > 0 ? (litresNum * rateNum).toFixed(2) : null

  const fetchFillups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getDieselFillUps({ truck_id: truck.id, year, month, limit: 200 })
      setFillups(res.data)
    } catch { toast.error('Failed to load diesel entries') }
    finally { setLoading(false) }
  }, [truck.id, year, month])

  useEffect(() => { fetchFillups() }, [fetchFillups])

  // Per-line verification — native DieselFillUp verification, shared with the
  // standalone Diesel module (verify once, reflected in both views).
  const { user: dieselUser, isAdmin: dieselIsAdmin } = useAuth()
  const patchFillup = (data) => setFillups(prev => prev.map(x => x.id === data.id ? { ...x, ...data } : x))
  const handleVerifyFillup   = async (f, intent) => { try { const { data } = await verifyDieselFillUp(f.id, intent); patchFillup(data) } catch (e) { toast.error(errorMessage(e, 'Verification failed')) } }
  const handleFinalizeFillup = async (f, intent) => { try { const { data } = await finalizeDieselFillUp(f.id, intent); patchFillup(data) } catch (e) { toast.error(errorMessage(e, 'Lock failed')) } }

  const doAdd = async () => {
    setSaving(true)
    try {
      await createDieselFillUp({
        entity_id:      truck.entity_id,
        truck_id:       truck.id,
        supplier_id:    parseInt(form.supplier_id),
        fillup_date:    form.fillup_date,
        litres:         litresNum,
        rate_per_litre: form.rate_pending ? 0 : rateNum,
        rate_pending:   !!form.rate_pending,
        invoice_number: form.invoice_number || null,
        slip_number:    form.slip_number || null,
        notes:          form.notes || null,
        diesel_type:    form.diesel_type || 'fillup',
      })
      toast.success('Diesel entry added')
      setForm({ ...EMPTY_DIESEL })
      setAddingNew(false)
      fetchFillups()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save diesel entry'))
    } finally { setSaving(false) }
  }

  const handleAdd = async () => {
    if (!form.supplier_id)  return toast.error('Select a supplier')
    if (!form.fillup_date)  return toast.error('Date required')
    if (litresNum <= 0)     return toast.error('Enter litres')
    if (!form.rate_pending && rateNum <= 0) return toast.error('Enter rate per litre')
    doAdd()
  }

  const dieselFormRef = useRef(null)
  const dieselFocusNext = (e) => {
    if (e.key !== 'ArrowRight') return
    e.preventDefault()
    if (!dieselFormRef.current) return
    const els = Array.from(dieselFormRef.current.querySelectorAll(
      'input:not([disabled]):not([type=checkbox]), select:not([disabled])'
    )).filter(el => el.offsetParent !== null)
    const idx = els.indexOf(document.activeElement)
    if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus()
  }
  const dieselKey = (e) => {
    dieselFocusNext(e)
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd() }
    if (e.key === 'Escape') setAddingNew(false)
  }

  const handleDelete = (f) => setDeleteTarget(f)

  // Group by supplier name
  const bySupplier = fillups.reduce((acc, f) => {
    const key = f.supplier_name || 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(f)
    return acc
  }, {})

  const totalLitres = fillups.reduce((s, f) => s + parseFloat(f.litres || 0), 0)
  const totalAmt    = fillups.reduce((s, f) => s + parseFloat(f.total_amount || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {/* Undo a bad batch of final locks on this truck's diesel lines. */}
        <BulkUnlockButton
          items={fillups}
          currentUserId={dieselUser?.id} isAdmin={dieselIsAdmin} noun="entry" nounPlural="entries"
          onUnlock={async (item) => {
            const { data } = await finalizeDieselFillUp(item.id, 'remove')
            patchFillup(data)
          }}
        />
        {isBokamosho && (
          <button className="btn btn-ghost" onClick={() => setShowImport(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Upload size={14} /> Import
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setAddingNew(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Log Diesel
        </button>
      </div>

      {showImport && isBokamosho && (
        <ImportDieselModal
          entityId={truck.entity_id}
          onClose={() => setShowImport(false)}
          onImported={fetchFillups}
        />
      )}

      {addingNew && (
        <div ref={dieselFormRef} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>New Diesel Entry</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <div>
              <label className="form-label">Date *</label>
              <DateInput className="form-input" value={form.fillup_date} onChange={e => set('fillup_date', e.target.value)} onKeyDown={dieselKey} />
            </div>
            <div>
              <label className="form-label">Supplier *</label>
              <SearchableSelect value={String(form.supplier_id)} onChange={v => { set('supplier_id', v); setRateEdited(false); setAutoRate(null); set('diesel_type', dieselTypeForSupplier(suppliers.find(s => String(s.id) === String(v)))) }}
                options={suppliers} getValue={s => String(s.id)} getLabel={s => s.name} placeholder="Supplier…" formInput />
            </div>
            <div>
              <label className="form-label">Invoice #</label>
              <input className="form-input" value={form.invoice_number} onChange={e => set('invoice_number', e.target.value)} placeholder="INV-001" onKeyDown={dieselKey} />
            </div>
            <div>
              <label className="form-label">Slip #</label>
              <input className="form-input" value={form.slip_number} onChange={e => set('slip_number', e.target.value)} placeholder="SLP-001" onKeyDown={dieselKey} />
            </div>
            <div>
              <label className="form-label">Type</label>
              <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                {[['fillup', 'Fill-up'], ['topup', 'Top-up']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => set('diesel_type', val)}
                    style={{
                      padding: '6px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                      background: form.diesel_type === val ? 'var(--accent)' : 'transparent',
                      color: form.diesel_type === val ? '#fff' : 'var(--text-secondary)',
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Litres *</label>
              <input className="form-input" type="number" step="0.01" min="0" value={form.litres} onChange={e => set('litres', e.target.value)} placeholder="0.00" onKeyDown={dieselKey} />
            </div>
            <div>
              <label className="form-label">
                Rate/L {form.rate_pending ? '' : '*'}{autoRate && !form.rate_pending && (
                  <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700,
                    color: rateEdited ? '#d97706' : '#16a34a' }}>
                    {rateEdited ? 'manual' : 'auto'}
                  </span>
                )}
              </label>
              <input className="form-input" type="number" step="0.01" min="0"
                value={form.rate_pending ? '' : form.rate_per_litre}
                disabled={form.rate_pending}
                onChange={e => { set('rate_per_litre', e.target.value); setRateEdited(true) }}
                placeholder={form.rate_pending ? 'On import' : '0.00'} onKeyDown={dieselKey} />
            </div>
            <div>
              <label className="form-label">Amount</label>
              <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 6, fontSize: 13, fontWeight: 700 }}>
                {form.rate_pending ? 'Pending' : (calcAmt ? fmt(calcAmt) : '—')}
              </div>
            </div>
          </div>
          {isBokamosho && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form.rate_pending}
                  onChange={e => { set('rate_pending', e.target.checked); if (e.target.checked) { set('rate_per_litre', ''); setRateEdited(false) } }} />
                Rate unknown — fill in on Tradekor import (matched by slip; import litres win)
              </label>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <label className="form-label">Mine / Notes</label>
            <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" onKeyDown={dieselKey} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => { setAddingNew(false); setForm({ ...EMPTY_DIESEL }) }}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : fillups.length === 0 ? (
        <div className="empty-state" style={{ padding: 48 }}>
          <Fuel size={36} />
          <p>No diesel entries for {MONTHS[month - 1]} {year}</p>
        </div>
      ) : (
        <div>
          {Object.entries(bySupplier).map(([supplierName, entries]) => {
            const subLitres = entries.reduce((s, f) => s + parseFloat(f.litres || 0), 0)
            const subAmount = entries.reduce((s, f) => s + parseFloat(f.amount || 0), 0)
            const subAdmin  = entries.reduce((s, f) => s + parseFloat(f.admin_fee_amount || 0), 0)
            const subAdminVat  = entries.reduce((s, f) => s + parseFloat(f.admin_fee_vat || 0), 0)
            const subAdminIncl = subAdmin + subAdminVat
            const subTotal  = entries.reduce((s, f) => s + parseFloat(f.total_amount || 0), 0)
            return (
              <div key={supplierName} className="card" style={{ marginBottom: 16, overflow: 'auto' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--accent)' }}>{supplierName}</span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>
                    {subLitres.toFixed(1)} L &nbsp;·&nbsp; {fmt(subTotal)}
                  </span>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleDSort('fillup_date')}>Date{dArrow('fillup_date')}</th>
                      <th>Type</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleDSort('slip_number')}>Slip #{dArrow('slip_number')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleDSort('invoice_number')}>Invoice #{dArrow('invoice_number')}</th>
                      <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleDSort('litres')}>Litres{dArrow('litres')}</th>
                      <th style={{ textAlign: 'right' }}>Rate/L</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Admin Fee (excl)</th>
                      <th style={{ textAlign: 'right' }}>Admin Fee (incl)</th>
                      <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleDSort('total_amount')}>Total{dArrow('total_amount')}</th>
                      <th>Notes</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortEntries(entries).map(f => (
                      editingFillupId === f.id ? (
                        <tr key={f.id} onClick={e => e.stopPropagation()}
                          style={{ background: 'var(--accent-subtle)', outline: '2px solid var(--accent)', outlineOffset: -1 }}>
                          <td style={dEditCell}>
                            <DateInput className="form-input" value={editFillupForm.fillup_date}
                              onChange={e => setEF('fillup_date', e.target.value)} style={dEditInput} />
                          </td>
                          <td style={dEditCell}>
                            <select className="form-input" value={editFillupForm.diesel_type}
                              onChange={e => setEF('diesel_type', e.target.value)} style={{ ...dEditInput, fontSize: 12 }}>
                              <option value="fillup">Fill-up</option>
                              <option value="topup">Top-up</option>
                            </select>
                          </td>
                          <td style={dEditCell}>
                            <input className="form-input" value={editFillupForm.slip_number}
                              onChange={e => setEF('slip_number', e.target.value)} placeholder="SLP-001"
                              style={dEditInput} />
                          </td>
                          <td style={dEditCell}>
                            <input className="form-input" value={editFillupForm.invoice_number}
                              onChange={e => setEF('invoice_number', e.target.value)} placeholder="INV-001"
                              style={dEditInput} />
                          </td>
                          <td style={dEditCell}>
                            <input className="form-input" type="number" step="0.01" value={editFillupForm.litres}
                              onChange={e => setEF('litres', e.target.value)} placeholder="0.00"
                              style={{ ...dEditInput, textAlign: 'right' }} />
                          </td>
                          <td style={dEditCell}>
                            <input className="form-input" type="number" step="0.001" value={editFillupForm.rate_per_litre}
                              onChange={e => setEF('rate_per_litre', e.target.value)} placeholder="0.00"
                              style={{ ...dEditInput, textAlign: 'right' }} />
                          </td>
                          <td /><td /><td /><td />
                          <td style={dEditCell}>
                            <input className="form-input" value={editFillupForm.notes}
                              onChange={e => setEF('notes', e.target.value)} placeholder="Notes"
                              style={dEditInput} />
                          </td>
                          <td style={{ whiteSpace: 'nowrap', padding: '6px 8px', textAlign: 'right' }}>
                            <button className="btn btn-icon btn-primary" onClick={doUpdateFillup}
                              disabled={editSaving} title="Save" style={{ marginRight: 4 }}>
                              <Save size={13} />
                            </button>
                            <button className="btn btn-icon btn-ghost" onClick={() => setEditingFillupId(null)}
                              title="Cancel">
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      ) : (
                        <tr key={f.id} style={{ height: 48, cursor: 'pointer' }} onClick={() => startEditFillup(f)}>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(f.fillup_date)}</td>
                          <td>
                            <span style={{
                              padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                              background: f.diesel_type === 'topup' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
                              color: f.diesel_type === 'topup' ? '#d97706' : '#16a34a',
                            }}>
                              {f.diesel_type === 'topup' ? 'Top-up' : 'Fill-up'}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12, color: f.slip_number ? 'var(--text-primary)' : 'var(--danger)', fontWeight: f.slip_number ? 400 : 600 }}>
                            {f.slip_number || '⚠ missing'}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12, color: (f.supplier_invoice_number || f.invoice_number) ? 'var(--text-muted)' : 'var(--danger)', fontWeight: (f.supplier_invoice_number || f.invoice_number) ? 400 : 600 }}>
                            {f.supplier_invoice_number || f.invoice_number || '⚠ missing'}
                          </td>
                          <td style={{ textAlign: 'right' }}>{parseFloat(f.litres).toFixed(1)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>
                            {f.rate_pending ? (
                              <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                                background: 'rgba(245,158,11,0.15)', color: '#d97706' }}>Rate pending</span>
                            ) : <>R&nbsp;{parseFloat(f.rate_per_litre).toFixed(2)}</>}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{f.rate_pending ? '—' : fmt(f.amount)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{fmt(f.admin_fee_amount)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
                            {parseFloat(f.admin_fee_amount || 0) > 0
                              ? fmt(parseFloat(f.admin_fee_amount || 0) + parseFloat(f.admin_fee_vat || 0))
                              : fmt(f.admin_fee_amount)}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(f.total_amount)}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.notes || '—'}</td>
                          <td onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                              <VerifyBadge item={f} onVerify={handleVerifyFillup} onFinalize={handleFinalizeFillup}
                                currentUserId={dieselUser?.id} isAdmin={dieselIsAdmin} adminFinalizeAnytime />
                              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(f)}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-surface)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                      <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>Total</td>
                      <td style={{ textAlign: 'right', padding: '8px 12px' }}>{subLitres.toFixed(1)} L</td>
                      <td />
                      <td style={{ textAlign: 'right', padding: '8px 12px' }}>{fmt(subAmount)}</td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)' }}>{fmt(subAdmin)}</td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)' }}>{fmt(subAdminIncl)}</td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--accent)' }}>{fmt(subTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          })}
          {Object.keys(bySupplier).length > 1 && (
            <div style={{ textAlign: 'right', padding: '10px 4px', fontWeight: 700, fontSize: 14 }}>
              Grand total: {totalLitres.toFixed(1)} L &nbsp;·&nbsp; {fmt(totalAmt)}
            </div>
          )}
        </div>
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Diesel Entry"
        description={deleteTarget ? `${parseFloat(deleteTarget.litres).toFixed(1)} L on ${fmtDate(deleteTarget.fillup_date)}${deleteTarget.supplier_name ? ` — ${deleteTarget.supplier_name}` : ''}` : ''}
        onArchive={async () => {
          try { await archiveDieselFillUp(deleteTarget.id); toast.success('Entry archived'); fetchFillups() }
          catch { toast.error('Failed to archive') }
          setDeleteTarget(null)
        }}
        onDelete={async () => {
          try { await deleteDieselFillUp(deleteTarget.id); toast.success('Entry deleted'); fetchFillups() }
          catch { toast.error('Failed to delete') }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}


// ── Additional Loads section (shown below main loads) ─────────────────────────
function AdditionalLoadsSection({ truck, year, month, drivers, selectedDriverId, isSafetec }) {
  const EMPTY_AL = { driver_id: '', customer_id: '', route_name: '', delivery_note: '', tons: '', amount: '', load_date: '', waiting_for_slips: false, is_paid: false, notes: '' }
  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [addingNew, setAddingNew] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [rates, setRates]       = useState([])
  const [form, setForm]         = useState({ ...EMPTY_AL })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Selecting a customer auto-fills the amount only; the description is left for
  // the user to fill in.
  const pickCustomer = (rateId) => {
    const rate = rates.find(r => String(r.id) === String(rateId))
    setForm(f => ({
      ...f,
      customer_id: rateId,
      amount:      rate ? String(parseFloat(rate.amount)) : f.amount,
    }))
  }

  const [editingEntryId, setEditingEntryId] = useState(null)
  const [editEntryForm, setEditEntryForm]   = useState({})
  const [editEntrySaving, setEditEntrySaving] = useState(false)
  const setEE = (k, v) => setEditEntryForm(f => ({ ...f, [k]: v }))

  const startEditEntry = (e) => {
    if (editingEntryId !== null) return
    setEditEntryForm({
      driver_id:     String(e.driver_id || ''),
      route_name:    e.route_name || '',
      delivery_note: e.delivery_note || '',
      tons:          e.tons != null ? String(e.tons) : '',
      load_date:     e.load_date ? e.load_date.slice(0, 10) : today,
      amount:        e.amount != null ? String(e.amount) : '',
      waiting_for_slips: !!e.waiting_for_slips,
      is_paid:       !!e.is_paid,
      notes:         e.notes || '',
    })
    setEditingEntryId(e.id)
  }

  const doUpdateEntry = async () => {
    const entry = entries.find(e => e.id === editingEntryId)
    if (!entry) return
    setEditEntrySaving(true)
    try {
      await updateDriverAdditionalLoad(entry.driver_id, year, month, editingEntryId, {
        driver_id:          parseInt(editEntryForm.driver_id) || entry.driver_id,
        load_date:          new Date(editEntryForm.load_date + 'T12:00:00').toISOString(),
        route_name:         editEntryForm.route_name,
        truck_registration: truck.registration,
        amount:             parseFloat(editEntryForm.amount) || 0,
        delivery_note:      editEntryForm.delivery_note || null,
        tons:               editEntryForm.tons !== '' ? parseFloat(editEntryForm.tons) : null,
        waiting_for_slips:  !!editEntryForm.waiting_for_slips,
        is_paid:            !!editEntryForm.is_paid,
        notes:              editEntryForm.notes || null,
      })
      toast.success('Entry updated')
      setEditingEntryId(null)
      fetchEntries()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update'))
    } finally { setEditEntrySaving(false) }
  }

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTruckAdditionalLoads(truck.id, { year, month })
      setEntries(res.data)
    } catch { /* silently ignore */ }
    finally { setLoading(false) }
  }, [truck.id, year, month])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  // Per-line verification overlay (additional loads)
  const { user: alUser, isAdmin: alIsAdmin } = useAuth()
  const [alVerif, setAlVerif] = useState({})
  const alPrefix = `truckloads:${truck.id}:${year}-${String(month).padStart(2, '0')}`
  const alTarget = (id) => `${alPrefix}:addload:${id}`
  const fetchAlVerif = useCallback(() => {
    getVerifications(alPrefix)
      .then(r => { const m = {}; for (const v of r.data) m[v.target] = v; setAlVerif(m) })
      .catch(() => setAlVerif({}))
  }, [alPrefix])
  useEffect(() => { fetchAlVerif() }, [fetchAlVerif])
  const handleVerifyAl   = async (t, intent) => { try { const { data } = await verifyValue(t, truck?.entity_id, intent); setAlVerif(prev => ({ ...prev, [data.target]: data })) } catch (e) { toast.error(errorMessage(e, 'Verification failed')) } }
  const handleFinalizeAl = async (t, intent) => { try { const { data } = await finalizeValue(t, truck?.entity_id, intent); setAlVerif(prev => ({ ...prev, [data.target]: data })) } catch (e) { toast.error(errorMessage(e, 'Lock failed')) } }

  useEffect(() => {
    if (!isSafetec) { setRates([]); return }
    getAdditionalLoadRates({ entity_id: truck.entity_id })
      .then(r => setRates((r.data || []).filter(x => x.is_active)))
      .catch(() => {})
  }, [isSafetec, truck.entity_id])

  const handleAdd = async () => {
    if (!form.driver_id)  return toast.error('Select a driver')
    if (!form.route_name) return toast.error('Enter a description')
    const amount = parseFloat(form.amount) || 0
    if (amount <= 0)      return toast.error('Enter an amount')
    setSaving(true)
    try {
      await addDriverAdditionalLoad(form.driver_id, year, month, {
        load_date:          new Date(form.load_date + 'T12:00:00').toISOString(),
        route_name:         form.route_name,
        truck_registration: truck.registration,
        amount,
        delivery_note:      form.delivery_note || null,
        tons:               form.tons !== '' ? parseFloat(form.tons) : null,
        waiting_for_slips:  !!form.waiting_for_slips,
        is_paid:            !!form.is_paid,
        notes: form.notes || null,
      })
      toast.success('Additional load added')
      setForm({ ...EMPTY_AL, driver_id: selectedDriverId || '' })
      setAddingNew(false)
      fetchEntries()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save'))
    } finally { setSaving(false) }
  }

  const handleDelete = (entry) => setDeleteTarget(entry)

  const total = entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const driverTypeByName = drivers.reduce((acc, d) => {
    acc[`${d.first_name} ${d.last_name}`.trim()] = d.driver_type
    return acc
  }, {})

  const { sort: addSort, onSort: onAddSort } = useSort('load_date', 'asc', 'truck.additional')
  const sortedAdditional = useMemo(() => applySort(entries, addSort), [entries, addSort])

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Additional Loads</span>
          {entries.length > 0 && (
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              {entries.length} entries · {fmt(total)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Undo a bad batch of final locks on these additional-load values. The
              overlay prefix is shared with the main Loads table, so filter to the
              :addload: targets — the Loads table has its own button. */}
          <BulkUnlockButton
            items={Object.values(alVerif).filter(v => v.target?.includes(':addload:'))}
            currentUserId={alUser?.id} isAdmin={alIsAdmin} noun="value"
            onUnlock={async (item) => {
              const { data } = await finalizeValue(item.target, truck?.entity_id, 'remove')
              setAlVerif(prev => ({ ...prev, [data.target]: data }))
            }}
          />
          <button className="btn btn-ghost btn-sm"
            onClick={() => {
              setForm({ ...EMPTY_AL, driver_id: selectedDriverId || '' })
              setAddingNew(v => !v)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {addingNew && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <div>
              <label className="form-label">Driver *</label>
              <SearchableSelect formInput value={String(form.driver_id)} onChange={v => set('driver_id', v)}
                options={drivers} getValue={d => String(d.id)}
                getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`} placeholder="Driver…" />
            </div>
            {isSafetec && rates.length > 0 && (
              <div>
                <label className="form-label">Customer</label>
                <SearchableSelect formInput value={String(form.customer_id)} onChange={pickCustomer}
                  options={rates} getValue={r => String(r.id)}
                  getLabel={r => `${r.name} — ${fmt(r.amount)}`} placeholder="Select customer…" />
              </div>
            )}
            <div>
              <label className="form-label">Description *</label>
              <input className="form-input" value={form.route_name} onChange={e => set('route_name', e.target.value)} placeholder="e.g. Sand loads" />
            </div>
            {isSafetec && (
              <div>
                <label className="form-label">Delivery Note</label>
                <input className="form-input" value={form.delivery_note} onChange={e => set('delivery_note', e.target.value)} placeholder="DN no." />
              </div>
            )}
            <div>
              <label className="form-label">Date</label>
              <DateInput className="form-input" value={form.load_date} onChange={e => set('load_date', e.target.value)} />
            </div>
            {isSafetec && (
              <div>
                <label className="form-label">Tons</label>
                <input className="form-input" type="number" step="0.01" min="0" value={form.tons} onChange={e => set('tons', e.target.value)} placeholder="0.00" />
              </div>
            )}
            <div>
              <label className="form-label">Amount (R) *</label>
              <input className="form-input" type="number" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="form-label">Note</label>
              <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 12, alignItems: 'center' }}>
            {isSafetec && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.waiting_for_slips} onChange={e => set('waiting_for_slips', e.target.checked)} />
                  <Flag size={13} style={{ color: form.waiting_for_slips ? '#d97706' : 'var(--text-muted)' }} /> Waiting for slips
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_paid} onChange={e => set('is_paid', e.target.checked)} />
                  Paid
                </label>
              </>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={() => setAddingNew(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {loading ? null : entries.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>No additional loads recorded.</div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <SortableHeader label="Driver" col="driver_name" sort={addSort} onSort={onAddSort} />
                <SortableHeader label="Description" col="route_name" sort={addSort} onSort={onAddSort} />
                {isSafetec && <th>Delivery Note</th>}
                <SortableHeader label="Date" col="load_date" sort={addSort} onSort={onAddSort} />
                {isSafetec && <SortableHeader label="Tons" col="tons" sort={addSort} onSort={onAddSort} style={{ textAlign: 'right' }} />}
                <SortableHeader label="Amount" col="amount" sort={addSort} onSort={onAddSort} style={{ textAlign: 'right' }} />
                {isSafetec && <th>Status</th>}
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedAdditional.map(e => (
                editingEntryId === e.id ? (
                  <tr key={e.id} onClick={ev => ev.stopPropagation()}
                    style={{ background: 'var(--accent-subtle)', outline: '2px solid var(--accent)', outlineOffset: -1 }}>
                    <td style={{ padding: '4px 6px', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                      {e.driver_name}
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input className="form-input" value={editEntryForm.route_name}
                        onChange={ev => setEE('route_name', ev.target.value)} placeholder="Description"
                        style={{ minWidth: 120 }} />
                    </td>
                    {isSafetec && (
                      <td style={{ padding: '4px 6px' }}>
                        <input className="form-input" value={editEntryForm.delivery_note}
                          onChange={ev => setEE('delivery_note', ev.target.value)} placeholder="DN no."
                          style={{ width: 100 }} />
                      </td>
                    )}
                    <td style={{ padding: '4px 6px' }}>
                      <DateInput className="form-input" value={editEntryForm.load_date}
                        onChange={ev => setEE('load_date', ev.target.value)} style={{ width: 105 }} />
                    </td>
                    {isSafetec && (
                      <td style={{ padding: '4px 6px' }}>
                        <input className="form-input" type="number" step="0.01" value={editEntryForm.tons}
                          onChange={ev => setEE('tons', ev.target.value)} placeholder="0.00"
                          style={{ width: 70, textAlign: 'right' }} />
                      </td>
                    )}
                    <td style={{ padding: '4px 6px' }}>
                      <input className="form-input" type="number" step="0.01" value={editEntryForm.amount}
                        onChange={ev => setEE('amount', ev.target.value)} placeholder="0.00"
                        style={{ width: 90, textAlign: 'right' }} />
                    </td>
                    {isSafetec && (
                      <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', marginBottom: 3 }}>
                          <input type="checkbox" checked={editEntryForm.waiting_for_slips}
                            onChange={ev => setEE('waiting_for_slips', ev.target.checked)} /> Slips
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                          <input type="checkbox" checked={editEntryForm.is_paid}
                            onChange={ev => setEE('is_paid', ev.target.checked)} /> Paid
                        </label>
                      </td>
                    )}
                    <td style={{ padding: '4px 6px' }}>
                      <input className="form-input" value={editEntryForm.notes}
                        onChange={ev => setEE('notes', ev.target.value)} placeholder="Note"
                        style={{ minWidth: 80 }} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', padding: '4px 6px' }}>
                      <button className="btn btn-icon btn-primary" onClick={doUpdateEntry}
                        disabled={editEntrySaving} title="Save" style={{ marginRight: 4 }}>
                        <Save size={13} />
                      </button>
                      <button className="btn btn-icon btn-ghost" onClick={() => setEditingEntryId(null)}
                        title="Cancel">
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} style={{
                    cursor: 'pointer',
                    background: e.waiting_for_slips ? 'rgba(217,119,6,0.07)' : undefined,
                    boxShadow: e.waiting_for_slips ? 'inset 3px 0 0 #d97706' : undefined,
                  }} onClick={() => startEditEntry(e)}>
                    <td style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {e.driver_name}
                        {driverTypeByName[e.driver_name] && (
                          <span className={`badge ${driverTypeByName[e.driver_name] === 'permanent' ? 'badge-paid' : 'badge-quote'}`}
                            style={{ fontSize: 9, padding: '1px 5px' }}>
                            {driverTypeByName[e.driver_name] === 'permanent' ? 'P' : 'C'}
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ fontSize: 13 }}>{e.route_name}</td>
                    {isSafetec && <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{e.delivery_note || '—'}</td>}
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(e.load_date)}</td>
                    {isSafetec && <td style={{ textAlign: 'right', fontSize: 12 }}>{e.tons != null ? fmt(e.tons) : '—'}</td>}
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(e.amount)}</td>
                    {isSafetec && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {e.waiting_for_slips && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700,
                            color: '#b45309', background: 'rgba(217,119,6,0.14)', padding: '2px 6px', borderRadius: 10, marginRight: 4 }}>
                            <Flag size={10} /> Awaiting slips
                          </span>
                        )}
                        {e.is_paid && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: 'rgba(34,197,94,0.14)', padding: '2px 6px', borderRadius: 10 }}>
                            Paid
                          </span>
                        )}
                        {!e.waiting_for_slips && !e.is_paid && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    )}
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.notes || '—'}</td>
                    <td onClick={ev => ev.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <VerifyBadge item={alVerif[alTarget(e.id)] || {}}
                          onVerify={(_i, intent) => handleVerifyAl(alTarget(e.id), intent)}
                          onFinalize={(_i, intent) => handleFinalizeAl(alTarget(e.id), intent)}
                          currentUserId={alUser?.id} isAdmin={alIsAdmin} adminFinalizeAnytime />
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDeleteTarget(e)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg-surface)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={isSafetec ? 5 : 3} style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>Total</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--accent)' }}>{fmt(total)}</td>
                  <td colSpan={isSafetec ? 3 : 2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Additional Load"
        description={deleteTarget ? `${deleteTarget.route_name} — ${fmt(deleteTarget.amount)}${deleteTarget.driver_name ? ` · ${deleteTarget.driver_name}` : ''}` : ''}
        onArchive={async () => {
          try { await archiveDriverAdditionalLoad(deleteTarget.driver_id, year, month, deleteTarget.id); toast.success('Entry archived'); fetchEntries() }
          catch { toast.error('Failed to archive') }
          setDeleteTarget(null)
        }}
        onDelete={async () => {
          try { await deleteDriverAdditionalLoad(deleteTarget.driver_id, year, month, deleteTarget.id); toast.success('Entry deleted'); fetchEntries() }
          catch { toast.error('Failed to delete') }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}


// ── Washes section (basic capture: description + registration + amount) ───────
function WashesSection({ truck, year, month }) {
  const EMPTY_WASH = { description: '', vehicle_registration: truck.registration || '', notes: '' }
  const [entries, setEntries]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [addingNew, setAddingNew] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm]           = useState({ ...EMPTY_WASH })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const [editingId, setEditingId]   = useState(null)
  const [editForm, setEditForm]     = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const setEF = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTruckWashes(truck.id, { year, month })
      setEntries(res.data)
    } catch { /* silently ignore */ }
    finally { setLoading(false) }
  }, [truck.id, year, month])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  const handleAdd = async () => {
    if (!form.description) return toast.error('Enter a description')
    setSaving(true)
    try {
      await addTruckWash(truck.id, {
        description:          form.description,
        vehicle_registration: form.vehicle_registration || truck.registration || null,
        period_month:         month,
        period_year:          year,
        notes:                form.notes || null,
      })
      toast.success('Wash added')
      setForm({ ...EMPTY_WASH })
      setAddingNew(false)
      fetchEntries()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save'))
    } finally { setSaving(false) }
  }

  const startEdit = (e) => {
    if (editingId !== null) return
    setEditForm({
      description:          e.description || '',
      vehicle_registration: e.vehicle_registration || '',
      notes:               e.notes || '',
    })
    setEditingId(e.id)
  }

  const doUpdate = async () => {
    setEditSaving(true)
    try {
      await updateTruckWash(truck.id, editingId, {
        description:          editForm.description,
        vehicle_registration: editForm.vehicle_registration || null,
        notes:               editForm.notes || null,
      })
      toast.success('Wash updated')
      setEditingId(null)
      fetchEntries()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update'))
    } finally { setEditSaving(false) }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Washes</span>
          {entries.length > 0 && (
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              {entries.length} entries
            </span>
          )}
        </div>
        <button className="btn btn-ghost btn-sm"
          onClick={() => { setForm({ ...EMPTY_WASH }); setAddingNew(v => !v) }}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> Add
        </button>
      </div>

      {addingNew && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div>
              <label className="form-label">Description *</label>
              <input className="form-input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Truck & trailer wash" />
            </div>
            <div>
              <label className="form-label">Registration</label>
              <input className="form-input" value={form.vehicle_registration} onChange={e => set('vehicle_registration', e.target.value)} placeholder="Reg" />
            </div>
            <div>
              <label className="form-label">Note</label>
              <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAddingNew(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {loading ? null : entries.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>No washes recorded.</div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Registration</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                editingId === e.id ? (
                  <tr key={e.id} onClick={ev => ev.stopPropagation()}
                    style={{ background: 'var(--accent-subtle)', outline: '2px solid var(--accent)', outlineOffset: -1 }}>
                    <td style={{ padding: '4px 6px' }}>
                      <input className="form-input" value={editForm.description}
                        onChange={ev => setEF('description', ev.target.value)} placeholder="Description"
                        style={{ minWidth: 140 }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input className="form-input" value={editForm.vehicle_registration}
                        onChange={ev => setEF('vehicle_registration', ev.target.value)} placeholder="Reg"
                        style={{ width: 110 }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input className="form-input" value={editForm.notes}
                        onChange={ev => setEF('notes', ev.target.value)} placeholder="Note"
                        style={{ minWidth: 80 }} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', padding: '4px 6px' }}>
                      <button className="btn btn-icon btn-primary" onClick={doUpdate}
                        disabled={editSaving} title="Save" style={{ marginRight: 4 }}>
                        <Save size={13} />
                      </button>
                      <button className="btn btn-icon btn-ghost" onClick={() => setEditingId(null)} title="Cancel">
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => startEdit(e)}>
                    <td style={{ fontSize: 13 }}>{e.description}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{e.vehicle_registration || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.notes || '—'}</td>
                    <td onClick={ev => ev.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDeleteTarget(e)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Wash"
        description={deleteTarget ? deleteTarget.description : ''}
        onDelete={async () => {
          try { await deleteTruckWash(truck.id, deleteTarget.id); toast.success('Wash deleted'); fetchEntries() }
          catch { toast.error('Failed to delete') }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}


// ── Food Allowance section ─────────────────────────────────────────────────────
function FoodAllowanceSection({ truck, year, month, drivers, selectedDriverId, allTrucks, onEntriesLoaded }) {
  const { user: foodUser, isAdmin: foodIsAdmin } = useAuth()
  const [entries, setEntries]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [form, setForm]           = useState({ ...EMPTY_FOOD })
  const [saving, setSaving]       = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Inline row editing (date / truck / amount / notes). Driver can't be reassigned
  // here — the update endpoint doesn't move a payment between pay cycles.
  const [editingId, setEditingId]   = useState(null)
  const [editForm, setEditForm]     = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const setEF = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  const formDriver = drivers.find(d => String(d.id) === String(form.driver_id))

  const foodFormRef = useRef(null)
  const foodFocusNext = (e) => {
    if (e.key !== 'ArrowRight') return
    e.preventDefault()
    if (!foodFormRef.current) return
    const els = Array.from(foodFormRef.current.querySelectorAll(
      'input:not([disabled]):not([type=checkbox]), select:not([disabled])'
    )).filter(el => el.offsetParent !== null)
    const idx = els.indexOf(document.activeElement)
    if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus()
  }
  const foodKey = (e) => {
    foodFocusNext(e)
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd() }
  }

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTruckFoodPayments(truck.id, { year, month })
      setEntries(res.data)
      // Keep the header's per-driver totals in step with edits made in this tab.
      onEntriesLoaded?.(res.data)
    } catch { /* silently ignore */ }
    finally { setLoading(false) }
  }, [truck.id, year, month, onEntriesLoaded])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  // 3-step verification, mirroring the driver payslip page. The verify/finalize
  // endpoints return the full row (incl. initials/dates) — merge it into the entry,
  // preserving the list-only fields (driver_name/pay_year/pay_month) not in the response.
  const patchEntry = (data) => setEntries(prev => prev.map(x => x.id === data.id ? { ...x, ...data } : x))
  const handleVerifyFood = async (item, intent) => {
    try { const { data } = await verifyFoodPayment(item.driver_id, item.pay_year, item.pay_month, item.id, intent); patchEntry(data) }
    catch (e) { toast.error(errorMessage(e, 'Verification failed')) }
  }
  const handleFinalizeFood = async (item, intent) => {
    try { const { data } = await finalizeFoodPayment(item.driver_id, item.pay_year, item.pay_month, item.id, intent); patchEntry(data) }
    catch (e) { toast.error(errorMessage(e, 'Lock failed')) }
  }

  const handleOpenAdd = () => {
    setForm({ ...EMPTY_FOOD, driver_id: selectedDriverId || '' })
    setEditingId(null)
    setAddingNew(true)
  }

  const handleCancel = () => {
    setAddingNew(false)
    setForm({ ...EMPTY_FOOD })
  }

  const handleAdd = async () => {
    if (!form.driver_id) return toast.error('Select a driver')
    if (!form.payment_date) return toast.error('Date required')
    const amount = parseFloat(form.amount) || 0
    if (amount <= 0) return toast.error('Enter an amount')
    setSaving(true)
    try {
      await addDriverFoodPayment(form.driver_id, year, month, {
        payment_date: new Date(form.payment_date + 'T12:00:00').toISOString(),
        amount,
        notes: form.notes || null,
        truck_id: truck.id,
      })
      const driverName = formDriver ? `${formDriver.first_name} ${formDriver.last_name}` : 'Driver'
      toast.success(`Food allowance saved for ${driverName}`)
      setAddingNew(false)
      setForm({ ...EMPTY_FOOD })
      fetchEntries()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save food allowance'))
    } finally { setSaving(false) }
  }

  const startEdit = (e) => {
    if (editingId !== null || addingNew) return
    setEditForm({
      payment_date: e.payment_date ? e.payment_date.slice(0, 10) : today,
      amount:       e.amount != null ? String(e.amount) : '',
      notes:        e.notes || '',
      // Legacy rows have no truck and only surface here through the driver-link
      // fallback — default them to this truck so saving claims the row.
      truck_id:     String(e.truck_id ?? truck.id),
      locked:       !!e.verified3_by,
    })
    setEditingId(e.id)
  }

  const doUpdate = async () => {
    const entry = entries.find(x => x.id === editingId)
    if (!entry) return
    if (!editForm.truck_id) return toast.error('Select the truck this food allowance belongs to')
    // Final verification lock: the note and the truck are the only fields the backend
    // still accepts — anything else in the payload gets the whole update rejected.
    // Truck stays editable so a row filed under the wrong registration can be moved
    // to the right one without unlocking.
    let payload
    if (editForm.locked) {
      payload = { notes: editForm.notes.trim(), truck_id: parseInt(editForm.truck_id, 10) }
    } else {
      if (!editForm.payment_date) return toast.error('Date required')
      const amount = parseFloat(editForm.amount) || 0
      if (amount <= 0) return toast.error('Enter an amount')
      payload = {
        payment_date: new Date(editForm.payment_date + 'T12:00:00').toISOString(),
        amount,
        notes: editForm.notes.trim(),
        truck_id: parseInt(editForm.truck_id, 10),
      }
    }
    setEditSaving(true)
    try {
      await updateDriverFoodPayment(entry.driver_id, entry.pay_year, entry.pay_month, entry.id, payload)
      // Re-pointed at another truck: the row leaves this tab, so say where it went.
      toast.success(payload.truck_id !== truck.id
        ? `Moved to ${regFor(payload.truck_id) || 'the selected truck'}`
        : 'Food allowance updated')
      setEditingId(null)
      fetchEntries()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update food allowance'))
    } finally { setEditSaving(false) }
  }

  const editKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doUpdate() }
    if (e.key === 'Escape') { e.preventDefault(); setEditingId(null) }
  }

  const total = entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0)

  // This tab is truck-scoped, so the Truck cell is there to *correct* a row filed
  // under the wrong registration rather than to vary. Legacy truck-less rows (which
  // only surface here via the driver link) read as this truck until they're saved.
  const truckOptions = useMemo(() => (
    (allTrucks || []).some(t => t.id === truck.id) ? allTrucks : [truck, ...(allTrucks || [])]
  ), [allTrucks, truck])
  const truckLabel = (t) => `${t.registration}${t.fleet_number ? ` (${t.fleet_number})` : ''}`
  const regFor = (id) => truckOptions.find(t => String(t.id) === String(id))?.registration

  const { sort: foodSort, onSort: onFoodSort } = useSort('payment_date', 'asc', 'truck.food')
  const sortedFood = useMemo(() => applySort(entries, foodSort, (row, col) => {
    if (col === 'amount') return parseFloat(row.amount || 0)
    if (col === 'truck_id') return regFor(row.truck_id ?? truck.id) || ''   // sort by registration, not id
    // Verification sorts by how far the row has progressed through the 3 steps
    if (col === 'verification') return ((row.verified || row.is_verified) ? 1 : 0) + (row.verified2_by ? 1 : 0) + (row.verified3_by ? 1 : 0)
    return row[col]
  }), [entries, foodSort, truckOptions])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        {entries.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {fmt(total)}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* Undo a bad batch of final locks on these food allowance lines. */}
          <BulkUnlockButton
            items={entries}
            currentUserId={foodUser?.id} isAdmin={foodIsAdmin} noun="entry" nounPlural="entries"
            onUnlock={async (item) => {
              const { data } = await finalizeFoodPayment(item.driver_id, item.pay_year, item.pay_month, item.id, 'remove')
              patchEntry(data)
            }}
          />
          <button className="btn btn-primary" onClick={handleOpenAdd} disabled={addingNew}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> Add Food Allowance
          </button>
        </div>
      </div>

      {addingNew && (
        <div ref={foodFormRef} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>New Food Allowance Entry</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, background: 'var(--accent-subtle)', borderRadius: 6, padding: '8px 10px' }}>
            Saved to the driver's Food Allowance (Kosgelde) section on their payslip.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div>
              <label className="form-label">Driver *</label>
              <SearchableSelect value={String(form.driver_id)} onChange={v => set('driver_id', v)}
                options={drivers} getValue={d => String(d.id)}
                getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`}
                placeholder="Driver…" formInput />
            </div>
            <div>
              <label className="form-label">Date</label>
              <DateInput className="form-input" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} onKeyDown={foodKey} />
            </div>
            <div>
              <label className="form-label">Amount (R) *</label>
              <input className="form-input" type="number" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00"
                onKeyDown={foodKey} />
            </div>
            <div>
              <label className="form-label">Notes</label>
              <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional"
                onKeyDown={foodKey} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}

      {loading ? null : entries.length === 0 ? (
        !addingNew && (
          <div className="empty-state" style={{ padding: 40 }}>
            <UtensilsCrossed size={32} />
            <p>No food allowance entries recorded this month</p>
          </div>
        )
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <SortableHeader label="Driver" col="driver_name" sort={foodSort} onSort={onFoodSort} />
                <SortableHeader label="Truck" col="truck_id" sort={foodSort} onSort={onFoodSort} />
                <SortableHeader label="Date" col="payment_date" sort={foodSort} onSort={onFoodSort} />
                <SortableHeader label="Notes" col="notes" sort={foodSort} onSort={onFoodSort} />
                <SortableHeader label="Amount" col="amount" sort={foodSort} onSort={onFoodSort} style={{ textAlign: 'right' }} />
                <SortableHeader label="Verification" col="verification" sort={foodSort} onSort={onFoodSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedFood.map(e => (
                editingId === e.id ? (
                  <tr key={e.id} onClick={ev => ev.stopPropagation()}
                    style={{ background: 'var(--accent-subtle)', outline: '2px solid var(--accent)', outlineOffset: -1 }}>
                    <td style={{ fontWeight: 600 }}>
                      {e.driver_name}
                      {editForm.locked && (
                        <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                          Locked by final verification — note and truck only
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '4px 6px', minWidth: 170 }}>
                      {/* Editable even when locked — moves the row to the right truck's tab. */}
                      <SearchableSelect formInput value={editForm.truck_id}
                        onChange={v => setEF('truck_id', v)}
                        options={truckOptions} getValue={t => String(t.id)} getLabel={truckLabel}
                        placeholder="Registration…" />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <DateInput className="form-input" value={editForm.payment_date}
                        onChange={ev => setEF('payment_date', ev.target.value)} onKeyDown={editKey}
                        disabled={editForm.locked} style={{ width: 130 }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input className="form-input" value={editForm.notes}
                        onChange={ev => setEF('notes', ev.target.value)} onKeyDown={editKey}
                        placeholder="Notes" style={{ minWidth: 100 }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input className="form-input" type="number" step="0.01" min="0" value={editForm.amount}
                        onChange={ev => setEF('amount', ev.target.value)} onKeyDown={editKey}
                        placeholder="0.00" disabled={editForm.locked}
                        style={{ width: 100, textAlign: 'right' }} />
                    </td>
                    <td />
                    <td style={{ whiteSpace: 'nowrap', padding: '4px 6px' }}>
                      <button className="btn btn-icon btn-primary" onClick={doUpdate}
                        disabled={editSaving} title="Save" style={{ marginRight: 4 }}>
                        <Save size={13} />
                      </button>
                      <button className="btn btn-icon btn-ghost" onClick={() => setEditingId(null)} title="Cancel">
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => startEdit(e)}
                    title={e.verified3_by ? 'Locked — click to edit the note or truck' : 'Click to edit'}>
                    <td style={{ fontWeight: 600 }}>{e.driver_name}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {e.truck_id
                        ? (regFor(e.truck_id) || `#${e.truck_id}`)
                        : <span style={{ color: 'var(--warning, #d97706)' }} title="Not linked to a truck — shows under every truck this driver is linked to. Edit to claim it for this truck.">Unassigned</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(e.payment_date)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.notes || '—'}</td>
                    <td style={{
                      textAlign: 'right', fontWeight: 700, color: 'var(--accent)',
                      ...(e.verified2_by ? { background: 'rgba(253,224,71,0.55)' } : {}),
                    }}>{fmt(e.amount)}</td>
                    <td onClick={ev => ev.stopPropagation()}>
                      <VerifyBadge item={e} onVerify={handleVerifyFood} onFinalize={handleFinalizeFood}
                        currentUserId={foodUser?.id} isAdmin={foodIsAdmin} adminFinalizeAnytime />
                    </td>
                    <td onClick={ev => ev.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => startEdit(e)} title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                        onClick={() => setDeleteTarget(e)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg-surface)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>Total</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--accent)' }}>{fmt(total)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Food Allowance"
        description={deleteTarget ? `${deleteTarget.driver_name} — ${fmt(deleteTarget.amount)} on ${fmtDate(deleteTarget.payment_date)}` : ''}
        onDelete={async () => {
          try {
            await deleteDriverFoodPayment(deleteTarget.driver_id, deleteTarget.pay_year, deleteTarget.pay_month, deleteTarget.id)
            toast.success('Entry deleted')
            fetchEntries()
          } catch { toast.error('Failed to delete') }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}


const EXPENSE_ROWS = [
  { key: 'drivers_salary',       label: "Driver's Salary" },
  { key: 'insurance_trailer',    label: 'Insurance Trailer' },
  { key: 'liability_3rd_party',  label: '3rd Party Liability' },
  { key: 'goods_in_transit',     label: 'Goods in Transit' },
  { key: 'loss_of_use',          label: 'Loss of Use' },
  { key: 'personal_accident',    label: 'Personal Accident' },
  { key: 'communication_device', label: 'Communication Device' },
  { key: 'sauma',                label: 'SASRIA' },
  { key: 'diesel',               label: 'Diesel' },
  { key: 'tyre_maintenance',     label: 'Tyre Maintenance' },
  { key: 'other_suppliers',      label: 'Other Suppliers' },
]

const psInput = {
  width: '100%', textAlign: 'right', padding: '4px 8px',
  borderRadius: 4, border: '1px solid var(--border)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
}

const psRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 16px', borderBottom: '1px solid var(--border)' }
const psLabel = { fontSize: 13, color: 'var(--text-secondary)' }
const psAmt = { fontWeight: 600, fontSize: 13, minWidth: 130, textAlign: 'right' }

// ── Profit Sheet (SFT only) ───────────────────────────────────────────────────
function ProfitSheetSection({ truck, year, month, summary }) {
  const [data, setData]         = useState({})
  const [supplierInvs, setSupplierInvs] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)
  const [dieselOpen, setDieselOpen] = useState(false)

  const setField = (k, v) => { setData(d => ({ ...d, [k]: v })); setDirty(true) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [expRes, invRes] = await Promise.all([
        getTruckMonthlyExpenses(truck.id, { year, month }),
        truck.registration ? getSupplierInvoicesByVehicle({ vehicle_reg: truck.registration, month, year }) : Promise.resolve({ data: [] }),
      ])
      const expData = expRes.data
      // Everything lives in the unified custom_lines list. The server decides which
      // lines a fresh month opens with — it duplicates the previous month's list in
      // full, blanking the amount on diesel/wages lines only. We show exactly what
      // it returns and inject nothing extra.
      const existing = expData.custom_lines || []
      const existingDescs = new Set(existing.map(l => (l.description || '').trim().toLowerCase()))
      // Legacy support only: fold any named-column value that still holds an amount
      // into a row. New-format records store everything in custom_lines (columns
      // null), so this adds nothing and no blank standard rows are injected.
      const stdRows = EXPENSE_ROWS
        .filter(r => expData[r.key] != null && !existingDescs.has(r.label.toLowerCase()))
        .map(r => ({ id: crypto.randomUUID(), description: r.label, amount: expData[r.key] }))
      const lines = [...stdRows, ...existing]
      // Clear the named columns locally so totals come solely from the unified list.
      const cleared = {}
      EXPENSE_ROWS.forEach(r => { cleared[r.key] = null })
      setData({ ...expData, ...cleared, custom_lines: lines })
      setSupplierInvs(invRes.data)
      setDirty(false)
    } catch { toast.error('Failed to load profit sheet') }
    finally { setLoading(false) }
  }, [truck.id, truck.registration, year, month])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Per-value verification overlay (profit sheet) — optional on every value ──
  const { user: pvUser, isAdmin: pvIsAdmin } = useAuth()
  const [pVerif, setPVerif] = useState({})
  const profitPrefix = `profit:${truck.id}:${year}-${String(month).padStart(2, '0')}`
  const fetchPVerif = useCallback(() => {
    getVerifications(profitPrefix)
      .then(r => { const m = {}; for (const v of r.data) m[v.target] = v; setPVerif(m) })
      .catch(() => setPVerif({}))
  }, [profitPrefix])
  useEffect(() => { fetchPVerif() }, [fetchPVerif])
  const pVerify   = useCallback(async (t, intent) => { try { const { data } = await verifyValue(t, truck?.entity_id, intent); setPVerif(prev => ({ ...prev, [data.target]: data })) } catch (e) { toast.error(errorMessage(e, 'Verification failed')) } }, [truck?.entity_id])
  const pFinalize = useCallback(async (t, intent) => { try { const { data } = await finalizeValue(t, truck?.entity_id, intent); setPVerif(prev => ({ ...prev, [data.target]: data })) } catch (e) { toast.error(errorMessage(e, 'Lock failed')) } }, [truck?.entity_id])
  // Wrap any profit-sheet value; `field` is the stable sub-key. Memoised so its
  // identity is stable across keystrokes — otherwise every edit remounts the
  // wrapped <input>, dropping focus after a single character.
  const PV = useCallback(({ field, align = 'right', inline = false, children }) => {
    const t = `${profitPrefix}:${field}`
    return (
      <VerifiableAmount target={t} state={pVerif[t]} onVerify={pVerify} onFinalize={pFinalize}
        currentUserId={pvUser?.id} isAdmin={pvIsAdmin} align={align} inline={inline}>
        {children}
      </VerifiableAmount>
    )
  }, [profitPrefix, pVerif, pVerify, pFinalize, pvUser, pvIsAdmin])

  const handleSave = async () => {
    setSaving(true)
    try {
      // Everything lives in custom_lines now — persist the named columns as null
      // so the unified list is the single source of truth (no double-counting).
      const payload = { ...data }
      EXPENSE_ROWS.forEach(r => { payload[r.key] = null })
      await upsertTruckMonthlyExpenses(truck.id, { year, month }, payload)
      toast.success('Profit sheet saved')
      setDirty(false)
    } catch { toast.error('Failed to save profit sheet') }
    finally { setSaving(false) }
  }

  const updateCustomLine = (id, field, value) => {
    setField('custom_lines', (data.custom_lines || []).map(l => l.id === id ? { ...l, [field]: value } : l))
  }

  const removeCustomLine = (id) => {
    setField('custom_lines', (data.custom_lines || []).filter(l => l.id !== id))
  }

  const addBlankLine = () => {
    setField('custom_lines', [...(data.custom_lines || []), { id: crypto.randomUUID(), description: '', amount: null }])
  }

  const addCasualWagesLine = () => {
    setField('custom_lines', [...(data.custom_lines || []), { id: crypto.randomUUID(), description: 'Casual Wages', amount: null }])
  }

  // Income: use manual override if saved, otherwise fall back to the loads.
  // For subcontractor trucks that's the payout (after the R5/ton admin fee);
  // for Safetec-owned trucks the subcontractor totals are zero, so fall back to
  // the truck's own invoiced income instead.
  const subExcl  = parseFloat(summary?.total_subcontractor_excl_vat) || 0
  const subIncl  = parseFloat(summary?.total_subcontractor_incl_vat) || 0
  const autoIncomeExcl = subExcl > 0 ? subExcl : (parseFloat(summary?.total_excl_vat) || 0)
  const autoIncomeIncl = subIncl > 0 ? subIncl : (parseFloat(summary?.total_incl_vat) || 0)
  const incomeExcl = data.income_excl_vat != null ? parseFloat(data.income_excl_vat) : autoIncomeExcl
  const incomeIncl = data.income_incl_vat != null ? parseFloat(data.income_incl_vat) : autoIncomeIncl

  // Fixed expenses
  const fixedTotal = EXPENSE_ROWS.reduce((s, r) => s + (parseFloat(data[r.key]) || 0), 0)

  // Supplier invoices total — diesel invoices are grouped into one expandable row.
  const supplierTotal = supplierInvs.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
  const dieselInvs    = supplierInvs.filter(i => i.is_diesel_supplier)
  const otherInvs     = supplierInvs.filter(i => !i.is_diesel_supplier)
  const dieselTotal   = dieselInvs.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)

  // Custom lines total
  const customTotal = (data.custom_lines || []).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)

  const totalExpenses = fixedTotal + supplierTotal + customTotal
  const netProfit = incomeIncl - totalExpenses

  const SectionHead = ({ children }) => (
    <div style={{ padding: '8px 16px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', background: 'var(--bg-surface)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
      {children}
    </div>
  )

  const hasData = incomeIncl > 0 || totalExpenses > 0

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      {/* ── Top bar: save + summary stats ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 0, borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {/* Income Excl VAT — editable */}
          <div style={{ padding: '10px 20px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 4 }}>Income Excl VAT</div>
            <PV field="income_excl" align="left">
              <input
                type="number" step="0.01" min="0"
                value={data.income_excl_vat ?? (autoIncomeExcl || '')}
                placeholder={fmt(autoIncomeExcl)}
                onChange={e => setField('income_excl_vat', e.target.value === '' ? null : e.target.value)}
                style={{ width: 120, fontWeight: 700, fontSize: 15, color: 'var(--text-muted)', background: 'transparent', border: 'none', outline: 'none', padding: 0, textAlign: 'left' }}
              />
            </PV>
          </div>
          {/* Income Incl VAT — editable */}
          <div style={{ padding: '10px 20px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 4 }}>Income Incl VAT</div>
            <PV field="income_incl" align="left">
              <input
                type="number" step="0.01" min="0"
                value={data.income_incl_vat ?? (autoIncomeIncl || '')}
                placeholder={fmt(autoIncomeIncl)}
                onChange={e => setField('income_incl_vat', e.target.value === '' ? null : e.target.value)}
                style={{ width: 120, fontWeight: 700, fontSize: 15, color: 'var(--accent)', background: 'transparent', border: 'none', outline: 'none', padding: 0, textAlign: 'left' }}
              />
            </PV>
          </div>
          {/* Total Expenses — calculated, read-only */}
          <div style={{ padding: '10px 20px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 4 }}>Total Expenses</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--danger)' }}><PV field="total_expenses" align="left">{fmt(totalExpenses)}</PV></div>
          </div>
          {/* Net Profit — calculated, read-only */}
          <div style={{ padding: '10px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 4 }}>Net Profit</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: !hasData ? 'var(--text-muted)' : netProfit >= 0 ? '#16a34a' : 'var(--danger)' }}>
              {hasData ? <PV field="net_profit" align="left">{fmt(netProfit)}</PV> : '—'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {dirty && <span style={{ fontSize: 12, color: '#d97706' }}>Unsaved changes</span>}
          {/* Undo a bad batch of final locks across the whole profit sheet. */}
          <BulkUnlockButton
            items={Object.values(pVerif)}
            currentUserId={pvUser?.id} isAdmin={pvIsAdmin} noun="value"
            onUnlock={async (item) => {
              const { data: row } = await finalizeValue(item.target, truck?.entity_id, 'remove')
              setPVerif(prev => ({ ...prev, [row.target]: row }))
            }}
          />
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: 20, alignItems: 'start' }}>

        {/* Left: one combined, fully-editable expense list */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <SectionHead>Expenses</SectionHead>
          {(data.custom_lines || []).map(l => (
            <div key={l.id} style={{ ...psRow, gap: 8 }}>
              <input
                style={{ ...psInput, flex: '1 1 90px', textAlign: 'left', minWidth: 70 }}
                value={l.description}
                placeholder="Description"
                onChange={e => updateCustomLine(l.id, 'description', e.target.value)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <PV field={`expense:${l.id}`} inline>
                  <input
                    type="number" step="0.01" min="0"
                    style={{ ...psInput, width: 110 }}
                    value={l.amount ?? ''}
                    placeholder="—"
                    onChange={e => updateCustomLine(l.id, 'amount', e.target.value === '' ? null : e.target.value)}
                  />
                </PV>
                <button onClick={() => removeCustomLine(l.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '6px 4px', lineHeight: 1 }}>
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={addBlankLine}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <Plus size={12} /> Add Row
            </button>
            <button className="btn btn-ghost btn-sm" onClick={addCasualWagesLine}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <Plus size={12} /> Add Casual Wages
            </button>
          </div>

          <div style={{ ...psRow, borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
            <span style={{ ...psLabel, fontWeight: 700 }}>Sub-total</span>
            <span style={{ ...psAmt, color: 'var(--danger)' }}><PV field="expenses_subtotal">{fmt(customTotal)}</PV></span>
          </div>
        </div>

        {/* Right: Supplier invoices (auto-fetched) — diesel grouped into one row */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <SectionHead>Supplier Invoices</SectionHead>
          {supplierInvs.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
              No supplier invoices linked to {truck.registration} for this month
            </div>
          ) : (
            <>
              {/* Diesel — single total that expands to show every diesel invoice */}
              {dieselInvs.length > 0 && (
                <>
                  <div
                    style={{ ...psRow, cursor: 'pointer' }}
                    onClick={() => setDieselOpen(o => !o)}
                  >
                    <span style={{ ...psLabel, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                      {dieselOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Fuel size={13} style={{ color: 'var(--accent)' }} /> Diesel
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--accent-subtle)', color: 'var(--accent)', borderRadius: 10, padding: '1px 7px' }}>
                        {dieselInvs.length}
                      </span>
                    </span>
                    <span style={psAmt}><PV field="diesel_total">{fmt(dieselTotal)}</PV></span>
                  </div>
                  {dieselOpen && dieselInvs.map(inv => (
                    <div key={inv.id} style={{ ...psRow, paddingLeft: 34, background: 'var(--bg-surface)' }}>
                      <span style={{ ...psLabel, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontWeight: 500 }}>{inv.supplier_name || '—'}</span>
                        {inv.invoice_number && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{inv.invoice_number}</span>
                        )}
                      </span>
                      <span style={psAmt}><PV field={`invoice:${inv.id}`}>{fmt(inv.amount)}</PV></span>
                    </div>
                  ))}
                </>
              )}

              {/* Non-diesel invoices, listed individually */}
              {otherInvs.map(inv => (
                <div key={inv.id} style={psRow}>
                  <span style={{ ...psLabel, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontWeight: 500 }}>{inv.supplier_name || '—'}</span>
                    {inv.invoice_number && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{inv.invoice_number}</span>
                    )}
                  </span>
                  <span style={psAmt}><PV field={`invoice:${inv.id}`}>{fmt(inv.amount)}</PV></span>
                </div>
              ))}

              <div style={{ ...psRow, borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
                <span style={{ ...psLabel, fontWeight: 700 }}>Sub-total</span>
                <span style={{ ...psAmt, color: 'var(--danger)' }}><PV field="supplier_subtotal">{fmt(supplierTotal)}</PV></span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


// ── Main page ───────────────────────────────────────────────────────────────────
export default function TruckLoadProfilePage() {
  const { truckId } = useParams()
  const navigate = useNavigate()
  const { isAdmin, entities, user } = useAuth()

  const now = new Date()
  const [year, setYear]   = useSessionState('period:truck-loads:year', now.getFullYear())
  const [month, setMonth] = useSessionState('period:truck-loads:month', now.getMonth() + 1)

  const [activeTab, setActiveTab] = useState('loads')
  const [truck, setTruck]                   = useState(null)
  const [loads, setLoads]                   = useState([])
  const [summary, setSummary]               = useState(null)
  const [mines, setMines]                   = useState([])
  const [drivers, setDrivers]               = useState([])
  const [suppliers, setSuppliers]             = useState([])
  const [haulageSuppliers, setHaulageSuppliers] = useState([])
  const [linkedSupplier, setLinkedSupplier]   = useState(null)
  const [vatRate, setVatRate]               = useState(0.15)
  const [loading, setLoading]               = useState(true)

  // Central driver selection (shared across all tabs)
  const [selectedDriverId, setSelectedDriverId] = useState('')
  const [deleteTarget, setDeleteTarget]         = useState(null)

  // Load edit state
  const [editingId, setEditingId]   = useState(null)
  const [editForm, setEditForm]     = useState({ ...EMPTY_LOAD })
  const [rateSource, setRateSource] = useState(null)
  const [saving, setSaving]         = useState(false)
  const [dupWarning, setDupWarning] = useState(null)
  const firstInputRef = useRef(null)
  const newDriverBackfilled = useRef(false)
  const projDriverBackfilled = useRef(false)
  const splitDriverBackfilled = useRef(false)

  // Projection form
  const [addingProjection, setAddingProjection] = useState(false)
  const [projForm, setProjForm]                 = useState({ ...EMPTY_PROJ })
  const [projSaving, setProjSaving]             = useState(false)

  // Add Load prompt + split modal
  const [addPromptOpen, setAddPromptOpen]   = useState(false)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [splitForm, setSplitForm] = useState({ ...EMPTY_LOAD })
  const [splitDrivers, setSplitDrivers] = useState([
    { driver_id: null, mine_id: '' },
    { driver_id: null, mine_id: '' },
  ])
  const [splitSaving, setSplitSaving] = useState(false)
  const [openSplitGroups, setOpenSplitGroups] = useState(new Set())

  // Trucks for the in-header truck switcher — scoped to the current truck's
  // entity so you only switch between trucks of the same entity.
  const [allTrucks, setAllTrucks] = useState([])
  useEffect(() => {
    if (!truck?.entity_id) return
    getFleetTrucks({ entity_id: truck.entity_id, limit: 500 })
      .then(r => setAllTrucks(r.data || []))
      .catch(() => {})
  }, [truck?.entity_id])

  // ── Load truck meta ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Reset truck-specific selection so a switch doesn't carry a stale driver over.
    setSelectedDriverId('')
    getTruck(truckId)
      .then(r => setTruck(r.data))
      .catch(() => toast.error('Truck not found'))
  }, [truckId])

  // ── Load reference data once truck is known ─────────────────────────────────
  useEffect(() => {
    if (!truck) return
    Promise.all([
      getMines({ active_only: false }),
      getDrivers({ entity_id: truck.entity_id, is_active: true, limit: 200 }),
      getSettings(),
      getSuppliers({ is_diesel_supplier: true, entity_id: truck.entity_id, limit: 500 }),
      getSuppliers({ entity_id: truck.entity_id, limit: 500 }),
    ]).then(([minesRes, driversRes, settingsRes, suppliersRes, haulageRes]) => {
      setMines(minesRes.data)
      setDrivers(driversRes.data)
      setSuppliers(suppliersRes.data)
      setHaulageSuppliers(haulageRes.data)
      const vat = settingsRes.data.find(s => s.key === 'vat_rate')
      if (vat) setVatRate(parseFloat(vat.value))
    }).catch(() => {})

    // Look up the subcontractor supplier linked to this truck via registration_number
    getSuppliers({ truck_registration: truck.registration, include_inactive: true, limit: 1 })
      .then(r => setLinkedSupplier(r.data?.[0] || null))
      .catch(() => {})
  }, [truck])

  // ── Default central driver to Driver 1 (slot 1) then Driver 2 (slot 2) ─────
  useEffect(() => {
    if (!truck || drivers.length === 0) return
    const assigned =
      drivers.find(d => d.truck_id === truck.id && d.driver_slot === 1) ||
      drivers.find(d => d.truck_id === truck.id && d.driver_slot === 2) ||
      drivers.find(d => d.truck_id === truck.id)  // legacy: no slot set
    if (assigned) setSelectedDriverId(prev => prev || String(assigned.id))
  }, [drivers, truck])

  // ── Load loads for current statement period ──────────────────────────────────
  const fetchLoads = useCallback(async () => {
    if (!truck) return
    setLoading(true)
    const params = { truck_id: truck.id, statement_month: month, statement_year: year, limit: 500 }
    try {
      const [loadsRes, summaryRes] = await Promise.all([
        getTruckLoads(params),
        getTruckLoadSummary(params),
      ])
      setLoads(loadsRes.data)
      setSummary(summaryRes.data)
    } catch { toast.error('Failed to load records') }
    finally { setLoading(false) }
  }, [truck, year, month])

  useEffect(() => { fetchLoads() }, [fetchLoads])

  const isSubcontractorEntity = truck?.entity_is_subcontractor || false

  // ── Food allowances for the header totals ───────────────────────────────────
  // Fetched here (not only in the Food tab) so the per-driver totals are there
  // before the tab is ever opened; the tab hands its fresh list back on save.
  const [foodEntries, setFoodEntries] = useState([])
  useEffect(() => {
    if (!truck || isSubcontractorEntity) { setFoodEntries([]); return }
    let stale = false
    getTruckFoodPayments(truck.id, { year, month })
      .then(r => { if (!stale) setFoodEntries(r.data || []) })
      .catch(() => { if (!stale) setFoodEntries([]) })
    return () => { stale = true }
  }, [truck, year, month, isSubcontractorEntity])

  // ── Per-line verification overlay (Loads) ───────────────────────────────────
  const [loadVerif, setLoadVerif] = useState({})
  const loadsVerifPrefix = truck ? `truckloads:${truck.id}:${year}-${String(month).padStart(2, '0')}` : null
  const loadVerifTarget = (loadId) => `${loadsVerifPrefix}:load:${loadId}`
  const fetchLoadVerif = useCallback(() => {
    if (!loadsVerifPrefix) return
    getVerifications(loadsVerifPrefix)
      .then(r => { const m = {}; for (const v of r.data) m[v.target] = v; setLoadVerif(m) })
      .catch(() => setLoadVerif({}))
  }, [loadsVerifPrefix])
  useEffect(() => { fetchLoadVerif() }, [fetchLoadVerif])
  const handleVerifyLoad   = async (target, intent) => { try { const { data } = await verifyValue(target, truck?.entity_id, intent); setLoadVerif(prev => ({ ...prev, [data.target]: data })) } catch (e) { toast.error(errorMessage(e, 'Verification failed')) } }
  const handleFinalizeLoad = async (target, intent) => { try { const { data } = await finalizeValue(target, truck?.entity_id, intent); setLoadVerif(prev => ({ ...prev, [data.target]: data })) } catch (e) { toast.error(errorMessage(e, 'Lock failed')) } }

  useEffect(() => {
    if (editingId && firstInputRef.current) firstInputRef.current.focus()
  }, [editingId])

  // ── Backfill new-load driver once the central driver resolves ────────────────
  // On slow connections the Add-Load form can open before the drivers list (and
  // therefore selectedDriverId) is ready, leaving the form's Driver box empty
  // even though the header populates a moment later. Fill it once, only while
  // still empty, so we never override a driver the user picked or cleared.
  useEffect(() => {
    if (editingId !== 'new') { newDriverBackfilled.current = false; return }
    if (newDriverBackfilled.current) return
    if (editForm.driver_id) { newDriverBackfilled.current = true; return }
    if (!selectedDriverId) return
    const d = drivers.find(x => String(x.id) === selectedDriverId)
    if (!d) return
    newDriverBackfilled.current = true
    setEditForm(f => ({
      ...f,
      driver_id: selectedDriverId,
      driver_name: `${d.first_name} ${d.last_name}`.trim(),
    }))
  }, [editingId, selectedDriverId, drivers, editForm.driver_id])

  // Same backfill for the Projection form (snapshots selectedDriverId on open).
  useEffect(() => {
    if (!addingProjection) { projDriverBackfilled.current = false; return }
    if (projDriverBackfilled.current) return
    if (projForm.driver_id) { projDriverBackfilled.current = true; return }
    if (!selectedDriverId) return
    const d = drivers.find(x => String(x.id) === selectedDriverId)
    if (!d) return
    projDriverBackfilled.current = true
    setProjForm(f => ({
      ...f,
      driver_id: selectedDriverId,
      driver_name: `${d.first_name} ${d.last_name}`.trim(),
    }))
  }, [addingProjection, selectedDriverId, drivers, projForm.driver_id])

  // Same backfill for the Split modal's first driver line (defaults to the
  // header driver; the second line is filled in by hand).
  useEffect(() => {
    if (!splitModalOpen) { splitDriverBackfilled.current = false; return }
    if (splitDriverBackfilled.current) return
    if (splitDrivers[0]?.driver_id) { splitDriverBackfilled.current = true; return }
    if (!selectedDriverId) return
    const d = drivers.find(x => String(x.id) === selectedDriverId)
    if (!d) return
    splitDriverBackfilled.current = true
    setSplitDrivers(prev => prev.map((x, idx) =>
      idx === 0 ? { ...x, driver_id: parseInt(selectedDriverId) } : x))
  }, [splitModalOpen, selectedDriverId, drivers, splitDrivers])

  // ── Auto-fill rate from mine ─────────────────────────────────────────────────
  useEffect(() => {
    if (!editForm.mine_id || !truck || rateSource === 'manual') return
    const mine = mines.find(m => m.id === parseInt(editForm.mine_id))
    if (!mine) return
    const rate = mine.rates?.find(r => r.entity_id === truck.entity_id && !r.effective_to)
    if (rate) {
      setEditForm(f => ({ ...f, rate_per_ton: String(rate.rate_per_ton) }))
      setRateSource('mine')
    }
  }, [editForm.mine_id, mines, truck])

  // ── Month navigation ─────────────────────────────────────────────────────────
  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }

  // ── Load edit helpers ────────────────────────────────────────────────────────
  const startNew  = () => {
    const d = drivers.find(x => String(x.id) === selectedDriverId)
    const driverName = d ? `${d.first_name} ${d.last_name}`.trim() : ''
    setEditForm({
      ...EMPTY_LOAD,
      driver_id: selectedDriverId || null,
      driver_name: driverName,
      statement_month: month,
      statement_year: year,
    })
    setRateSource(null)
    setEditingId('new')
  }
  const cancelEdit = () => { setEditingId(null); setEditForm({ ...EMPTY_LOAD }); setDupWarning(null) }

  const startEdit = (load) => {
    if (editingId !== null) return
    setEditForm({
      load_date:    load.load_date ? load.load_date.slice(0, 10) : today,
      slip_number:  load.slip_number  || '',
      po_number:    load.po_number    || '',
      driver_id:    load.driver_id    ?? null,
      driver_name:  load.driver_name  || '',
      mine_id:      String(load.mine_id || ''),
      supplier_id:  load.supplier_id ? String(load.supplier_id) : '',
      tonnes:       load.is_projection ? '' : (load.tonnes != null ? String(load.tonnes) : ''),
      rate_per_ton: load.rate_per_ton != null ? String(load.rate_per_ton) : '',
      is_paid:            !!load.is_paid,
      is_projection:      !!load.is_projection,
      driver_already_paid: !!load.driver_already_paid,
      notes:           load.notes      || '',
      checked_by:      load.checked_by || '',
      statement_month: load.statement_month || month,
      statement_year:  load.statement_year  || year,
    })
    setRateSource('manual')
    setEditingId(load.id)
  }

  const buildPayload = (form) => ({
    entity_id:    truck.entity_id,
    truck_id:     truck.id,
    mine_id:      parseInt(form.mine_id),
    supplier_id:  form.supplier_id ? parseInt(form.supplier_id) : null,
    load_date:    new Date(form.load_date + 'T12:00:00').toISOString(),
    slip_number:  form.slip_number || null,
    po_number:    form.po_number   || null,
    driver_id:    form.driver_id   ? parseInt(form.driver_id) : null,
    driver_name:  form.driver_name || null,
    tonnes:       form.is_projection ? 0 : parseFloat(form.tonnes),
    rate_per_ton: form.rate_per_ton ? parseFloat(form.rate_per_ton) : null,
    is_paid:            form.is_paid,
    is_projection:      !!form.is_projection,
    driver_already_paid: !!form.driver_already_paid,
    notes:           form.notes      || null,
    checked_by:      form.checked_by || null,
    statement_month: form.statement_month || null,
    statement_year:  form.statement_year  || null,
  })

  const doSave = async () => {
    setSaving(true)
    try {
      if (editingId === 'new') {
        await createTruckLoad(buildPayload(editForm))
        toast.success('Load added')
      } else {
        await updateTruckLoad(editingId, buildPayload(editForm))
        toast.success('Load updated')
      }
      setEditingId(null)
      setDupWarning(null)
      fetchLoads()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save'))
    } finally { setSaving(false) }
  }

  const handleSave = async () => {
    if (!editForm.mine_id)  return toast.error('Select a mine')
    if (!editForm.load_date) return toast.error('Load date required')
    if (!editForm.is_projection && (!editForm.tonnes || isNaN(editForm.tonnes))) return toast.error('Valid tonnes required')
    if (editingId === 'new' && editForm.slip_number?.trim()) {
      const slip = editForm.slip_number.trim().toLowerCase()
      const dup = loads.find(l =>
        l.slip_number?.trim().toLowerCase() === slip &&
        l.load_date?.slice(0, 10) === editForm.load_date
      )
      if (dup) {
        setDupWarning({ slip_number: editForm.slip_number.trim(), load_date: editForm.load_date })
        return
      }
    }
    setDupWarning(null)
    doSave()
  }

  const handleTogglePaid = async (load, e) => {
    e.stopPropagation()
    try {
      await updateTruckLoad(load.id, { ...load, is_paid: !load.is_paid, date_paid: load.is_paid ? null : new Date().toISOString() })
      fetchLoads()
    } catch { toast.error('Failed to update') }
  }

  const handleToggleDriverPaid = async (load, e) => {
    e.stopPropagation()
    try {
      await updateTruckLoad(load.id, { driver_already_paid: !load.driver_already_paid })
      fetchLoads()
      toast.success(load.driver_already_paid ? 'Driver payment flag removed' : 'Marked: driver already paid')
    } catch { toast.error('Failed to update') }
  }

  const handleTogglePayDeferred = async (load, e) => {
    e.stopPropagation()
    try {
      await updateTruckLoad(load.id, { pay_deferred: !load.pay_deferred })
      fetchLoads()
      toast.success(load.pay_deferred ? 'Pay deferral removed — paid in load month' : 'Marked: pay in next month (load stays in this month)')
    } catch { toast.error('Failed to update') }
  }

  const handleSaveProjection = async () => {
    if (!projForm.mine_id) return toast.error('Select a mine')
    if (!projForm.load_date) return toast.error('Load date required')
    const d = drivers.find(x => String(x.id) === String(projForm.driver_id))
    const driverName = d ? `${d.first_name} ${d.last_name}`.trim() : projForm.driver_name
    setProjSaving(true)
    try {
      await createTruckLoad({
        entity_id:    truck.entity_id,
        truck_id:     truck.id,
        mine_id:      parseInt(projForm.mine_id),
        load_date:    new Date(projForm.load_date + 'T12:00:00').toISOString(),
        driver_id:    projForm.driver_id ? parseInt(projForm.driver_id) : null,
        driver_name:  driverName || null,
        tonnes:       0,
        is_projection: true,
        notes:        projForm.notes || null,
        statement_month: projForm.statement_month || month,
        statement_year:  projForm.statement_year  || year,
      })
      toast.success('Projection added')
      setAddingProjection(false)
      setProjForm({ ...EMPTY_PROJ })
      fetchLoads()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save projection'))
    } finally { setProjSaving(false) }
  }

  const handleDelete = (load, e) => {
    e.stopPropagation()
    setDeleteTarget(load)
  }

  const handleSaveSplit = async () => {
    if (!splitForm.mine_id) return toast.error('Select a mine for the load')
    if (!splitForm.load_date) return toast.error('Load date required')
    if (!splitForm.is_projection && (!splitForm.tonnes || isNaN(splitForm.tonnes))) return toast.error('Valid tonnes required')
    if (splitDrivers.some(d => !d.driver_id)) return toast.error('Select a driver for both lines')
    setSplitSaving(true)
    try {
      await createSplitLoad({
        load: buildPayload(splitForm),
        splits: splitDrivers.map(d => ({
          driver_id: parseInt(d.driver_id),
          mine_id: parseInt(d.mine_id || splitForm.mine_id),
        })),
      })
      toast.success(splitForm.is_projection ? 'Split projection saved' : 'Split load saved')
      setSplitModalOpen(false)
      fetchLoads()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save split load'))
    } finally { setSplitSaving(false) }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  // (isSubcontractorEntity is defined further up — the food fetch depends on it.)
  const entityCode = truck ? (entities.find(e => e.id === truck.entity_id)?.code || '') : ''
  const isSafetec  = entityCode === 'SFT'
  const isBokamosho = entityCode === 'BKMO'
  const permanentDriver = drivers.find(d => d.truck_id === truck?.id && d.driver_slot === 1)
    ?? drivers.find(d => d.truck_id === truck?.id)
  const selectedDriver  = drivers.find(d => String(d.id) === selectedDriverId)
  const driverTypeByName = drivers.reduce((acc, d) => {
    acc[`${d.first_name} ${d.last_name}`.trim()] = d.driver_type
    return acc
  }, {})

  // Order for the capture dropdowns: this truck's assigned driver first, then the
  // rest of the permanent drivers, then the casual pool (each group alphabetical).
  // The raw list is last-name sorted, which scatters permanents among casuals and
  // makes them look absent in the short dropdown.
  const driverOptions = useMemo(() => {
    const rank = (d) =>
      (d.truck_id === truck?.id ? 0 : 10) + (d.driver_type === 'permanent' ? 0 : 2)
    return [...drivers].sort((a, b) =>
      rank(a) - rank(b) ||
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
    )
  }, [drivers, truck])
  const showPo  = !isSubcontractorEntity && truck?.notes?.toLowerCase() === 'intsimbi'
  const showSub = !isSubcontractorEntity && (truck?.is_subcontractor || false)
  const vatRegistered = entities.find(e => e.id === truck?.entity_id)?.vat_registered !== false
  const COLS    = isSubcontractorEntity
    ? (showPo ? 9 : 8)
    : (showPo ? 14 : 13) + (showSub ? 3 : 0) - (vatRegistered ? 0 : 1)

  const { sort: loadSort, onSort: onLoadSort } = useSort('load_date', 'asc', 'truck.loads')
  const sortedLoads = useMemo(() => applySort(loads, loadSort), [loads, loadSort])

  const toggleSplitGroup = (gid) => setOpenSplitGroups(s => {
    const n = new Set(s); n.has(gid) ? n.delete(gid) : n.add(gid); return n
  })

  const displayRows = useMemo(() => sortedLoads.map(l => (
    l.is_split_load ? { type: 'split', load: l } : { type: 'single', load: l }
  )), [sortedLoads])

  // ── Per-driver totals for the header (this truck, this period) ───────────────
  // Loads count effective, not raw: a split load is 0.5 to each of its two drivers,
  // matching what payroll credits them. Loads with no driver are grouped so the
  // rows still add up to the period's load count.
  const driverTotals = useMemo(() => {
    const map = new Map()
    // Prefer the live driver record's type over whatever the row was saved with.
    const typeOf = (id, fallback) =>
      drivers.find(d => String(d.id) === String(id))?.driver_type || fallback || null

    const add = (id, name, type, loads, food) => {
      const key = id ?? 'none'
      if (!map.has(key)) map.set(key, { id: id ?? null, name: '', type: null, loads: 0, food: 0 })
      const r = map.get(key)
      if (name && !r.name) r.name = name
      if (type && !r.type) r.type = type
      r.loads += loads
      r.food  += food
    }

    for (const l of loads) {
      if (l.is_split_load) {
        for (const s of (l.driver_splits || [])) {
          add(s.driver_id, s.driver_name, typeOf(s.driver_id, s.driver_type), Number(s.share ?? 0.5), 0)
        }
      } else {
        add(l.driver_id, l.driver_name, typeOf(l.driver_id, l.driver_type), 1, 0)
      }
    }
    for (const f of foodEntries) {
      add(f.driver_id, f.driver_name, typeOf(f.driver_id, f.driver_type), 0, parseFloat(f.amount || 0))
    }
    for (const r of map.values()) if (!r.name) r.name = 'No driver'
    return [...map.values()].sort((a, b) =>
      (a.id === null) - (b.id === null) || b.loads - a.loads || a.name.localeCompare(b.name)
    )
  }, [loads, foodEntries, drivers])

  const TABS = isSubcontractorEntity
    ? [{ key: 'loads', label: 'Loads' }, { key: 'diesel', label: 'Diesel' }]
    : [
        { key: 'loads',  label: 'Loads'         },
        { key: 'diesel', label: 'Diesel'         },
        { key: 'food',   label: 'Food Allowance' },
        ...(isSafetec ? [{ key: 'profit', label: 'Profit Sheet' }] : []),
      ]

  const editRowProps = {
    form: editForm, setForm: setEditForm, mines, drivers, haulageSuppliers, vatRate,
    rateSource, setRateSource, saving, onSave: handleSave,
    onCancel: cancelEdit, firstInputRef, showPo, showSub, isSubcontractorEntity,
  }

  if (!truck) return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>
      <div className="loading-center"><div className="spinner" /></div>
    </div>
  )

  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>

      {/* Breadcrumb */}
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/truck-loads')}
        style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={14} /> Truck Loads
      </button>

      {/* Truck header card */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 24, display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <TruckSwitcher
            trucks={allTrucks}
            currentId={truck.id}
            currentLabel={truck.registration}
            entities={entities}
            onSelect={(id) => navigate(`/truck-loads/${id}`)}
          />
          {truck.temp_registration && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
              prev. reg: {truck.temp_registration}
            </div>
          )}
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
            {truck.make}{truck.model ? ` ${truck.model}` : ''}
            {truck.fleet_number && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>Fleet #{truck.fleet_number}</span>}
          </div>
        </div>

        {!isSubcontractorEntity && <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            Active Driver
            {permanentDriver && selectedDriverId === String(permanentDriver.id) && (
              <span style={{ fontSize: 9, color: '#16a34a', background: 'rgba(22,163,74,0.1)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>
                {permanentDriver.driver_slot === 1 ? 'D1' : permanentDriver.driver_slot === 2 ? 'D2' : 'ASSIGNED'}
              </span>
            )}
            {selectedDriver && permanentDriver && selectedDriverId !== String(permanentDriver.id) && (
              <span style={{ fontSize: 9, color: '#d97706', background: 'rgba(217,119,6,0.1)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>
                {selectedDriver.driver_slot === 2 ? 'D2' : 'OTHER'}
              </span>
            )}
          </div>
          <SearchableSelect
            value={selectedDriverId}
            onChange={setSelectedDriverId}
            options={driverOptions}
            getValue={d => String(d.id)}
            getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`}
            placeholder="Select driver…"
            style={{ minWidth: 180 }}
          />
          {permanentDriver && selectedDriverId && selectedDriverId !== String(permanentDriver.id) && (
            <button
              onClick={() => setSelectedDriverId(String(permanentDriver.id))}
              style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: 3, textDecoration: 'underline' }}
            >
              Reset to Driver 1: {permanentDriver.first_name} {permanentDriver.last_name}
            </button>
          )}
          {!permanentDriver && !selectedDriverId && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>No driver assigned</div>
          )}
        </div>}

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 4 }}>Entity</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 5 }}>
              {entityCode}
            </span>
            {truck.contract_context && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{truck.contract_context}</span>
            )}
            {truck.operator && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {truck.operator}</span>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 4 }}>Status</div>
          <span className={`badge ${truck.status === 'active' ? 'badge-paid' : truck.status === 'maintenance' ? 'badge-quote' : 'badge-cancelled'}`}>
            {truck.status}
          </span>
        </div>

        {/* Per-driver loads + food for the period selected below. Splits count 0.5
            per driver, so these add up to the period's effective load count. */}
        {!isSubcontractorEntity && driverTotals.length > 0 && (
          <div style={{ minWidth: 240 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 4 }}>
              Driver Totals · {MONTHS[month - 1].slice(0, 3)} {year}
            </div>
            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>
                  <th style={{ textAlign: 'left',  padding: '0 14px 3px 0' }}>Driver</th>
                  <th style={{ textAlign: 'right', padding: '0 14px 3px 0' }}>Loads</th>
                  <th style={{ textAlign: 'right', padding: '0 0 3px 0' }}>Food</th>
                </tr>
              </thead>
              <tbody>
                {driverTotals.map(d => {
                  const perm = d.type === 'permanent'
                  return (
                    <tr key={d.id ?? 'none'}>
                      <td style={{ padding: '2px 14px 2px 0', whiteSpace: 'nowrap' }}>
                        <span style={{ color: d.id ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: d.id ? undefined : 'italic' }}>{d.name}</span>
                        {d.type && (
                          <span style={{
                            marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            color: perm ? '#16a34a' : '#d97706',
                            background: perm ? 'rgba(22,163,74,0.1)' : 'rgba(217,119,6,0.1)',
                          }}>
                            {perm ? 'PERM' : 'CASUAL'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '2px 14px 2px 0', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtLoads(d.loads)}
                      </td>
                      <td style={{ padding: '2px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: d.food ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {d.food ? fmt(d.food) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {driverTotals.length > 1 && (
                <tfoot>
                  <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                    <td style={{ padding: '3px 14px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>Total</td>
                    <td style={{ padding: '3px 14px 0 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtLoads(driverTotals.reduce((s, d) => s + d.loads, 0))}
                    </td>
                    <td style={{ padding: '3px 0 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(driverTotals.reduce((s, d) => s + d.food, 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {linkedSupplier && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 4 }}>Subcontractor</div>
            <button
              onClick={() => navigate(`/suppliers/${linkedSupplier.id}`)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'underline' }}>
                {linkedSupplier.name}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Month navigator + summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={prevMonth}><ChevronLeft size={15} /></button>
          <span style={{ fontSize: 16, fontWeight: 700, minWidth: 160, textAlign: 'center' }}>
            {MONTHS[month - 1]} {year}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={nextMonth}><ChevronRight size={15} /></button>
        </div>

        {summary && activeTab === 'loads' && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Loads',    value: summary.total_loads },
              { label: 'Tonnes',   value: fmtNum(summary.total_tonnes) },
              { label: 'Excl VAT', value: fmt(summary.total_excl_vat) },
              vatRegistered && { label: 'Incl VAT', value: fmt(summary.total_incl_vat), accent: true },
            ].filter(Boolean).map(c => (
              <div key={c.label} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{c.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: c.accent ? 'var(--accent)' : 'var(--text-primary)' }}>{c.value}</div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'loads' && (
          /* Undo a bad batch of final locks on this month's load values. The
             overlay prefix is shared with Additional Loads, so filter to the
             :load: targets — that section has its own button. */
          <BulkUnlockButton
            items={Object.values(loadVerif).filter(v => v.target?.includes(':load:'))}
            currentUserId={user?.id} isAdmin={isAdmin} noun="value"
            onUnlock={async (item) => {
              const { data } = await finalizeValue(item.target, truck?.entity_id, 'remove')
              setLoadVerif(prev => ({ ...prev, [data.target]: data }))
            }}
          />
        )}

        {activeTab === 'loads' && (
          isSubcontractorEntity ? (
            <button className="btn btn-primary" disabled={editingId === 'new'} onClick={startNew}>
              <Plus size={14} /> Add Load
            </button>
          ) : (
            <div style={{ position: 'relative' }}>
              <button className="btn btn-primary" disabled={editingId === 'new'}
                onClick={() => setAddPromptOpen(v => !v)}>
                <Plus size={14} /> Add Load
              </button>
              {addPromptOpen && (
                <div style={{
                  position: 'absolute', top: '110%', right: 0, zIndex: 60,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column',
                  gap: 4, minWidth: 148, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}>
                  <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }}
                    onClick={() => { setAddPromptOpen(false); startNew() }}>
                    Single load
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }}
                    onClick={() => {
                      setAddPromptOpen(false)
                      setSplitForm({ ...EMPTY_LOAD, statement_month: month, statement_year: year })
                      setSplitDrivers([
                        { driver_id: null, mine_id: '' },
                        { driver_id: null, mine_id: '' },
                      ])
                      setSplitModalOpen(true)
                    }}>
                    Split load
                  </button>
                  <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                  <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start', color: '#d97706' }}
                    onClick={() => {
                      setAddPromptOpen(false)
                      const d = drivers.find(x => String(x.id) === selectedDriverId)
                      setProjForm({
                        ...EMPTY_PROJ,
                        driver_id: selectedDriverId || null,
                        driver_name: d ? `${d.first_name} ${d.last_name}`.trim() : '',
                        statement_month: month,
                        statement_year: year,
                      })
                      setAddingProjection(true)
                    }}>
                    Projection
                  </button>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 18px',
              fontWeight: activeTab === tab.key ? 700 : 500,
              fontSize: 13,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -2,
              borderRadius: 0,
              transition: 'color 0.15s',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Loads tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'loads' && dupWarning && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginBottom: 12, padding: '10px 16px', borderRadius: 8,
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)',
        }}>
          <span style={{ fontSize: 13, color: '#d97706' }}>
            ⚠ A load with slip <strong>{dupWarning.slip_number}</strong> on <strong>{dupWarning.load_date}</strong> has already been captured for this truck. Save anyway?
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn-ghost btn-sm" onClick={() => setDupWarning(null)}>Dismiss</button>
            <button className="btn-primary btn-sm" onClick={doSave} disabled={saving}>Save Anyway</button>
          </div>
        </div>
      )}

      {/* ── Add Projection form ──────────────────────────────────────────────────── */}
      {activeTab === 'loads' && addingProjection && (() => {
        const lbl = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 3 }
        const inp = { padding: '5px 8px', fontSize: 12, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none' }
        const set = (k, v) => setProjForm(f => ({ ...f, [k]: v }))
        const pDriver = drivers.find(x => String(x.id) === String(projForm.driver_id))
        return (
          <div className="card" style={{ marginBottom: 16, padding: '14px 16px', borderLeft: '3px solid #f59e0b' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#d97706', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#f59e0b', color: '#fff', fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 800 }}>PROJECTION</span>
              Placeholder load — driver confirmed upcoming loads, details TBC
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px', alignItems: 'flex-end' }}>
              <div>
                <div style={lbl}>Date</div>
                <DateInput value={projForm.load_date} onChange={e => set('load_date', e.target.value)} style={{ ...inp, width: 112 }} />
              </div>
              <div>
                <div style={lbl}>Period</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select value={projForm.statement_month || ''} onChange={e => set('statement_month', parseInt(e.target.value))} style={{ ...inp, width: 60, padding: '5px 4px' }}>
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m.slice(0, 3)}</option>)}
                  </select>
                  <input type="number" min="2020" max="2099" value={projForm.statement_year || ''} onChange={e => set('statement_year', parseInt(e.target.value))} style={{ ...inp, width: 64 }} />
                </div>
              </div>
              {!isSubcontractorEntity && <div>
                <div style={lbl}>Driver</div>
                <SearchableSelect
                  value={projForm.driver_id != null ? String(projForm.driver_id) : ''}
                  onChange={v => { const d = drivers.find(x => String(x.id) === v); set('driver_id', v || null); set('driver_name', d ? `${d.first_name} ${d.last_name}`.trim() : '') }}
                  options={driverOptions} getValue={d => String(d.id)}
                  getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`}
                  placeholder="Driver…" style={{ minWidth: 140 }} />
              </div>}
              <div>
                <div style={lbl}>Mine *</div>
                <SearchableSelect value={String(projForm.mine_id)} onChange={v => set('mine_id', v)}
                  options={mines.filter(m => m.is_active)} getValue={m => String(m.id)} getLabel={m => m.name}
                  placeholder="Mine…" style={{ minWidth: 120 }} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={lbl}>Notes</div>
                <input value={projForm.notes || ''} placeholder={pDriver ? `Projection — ${pDriver.first_name} ${pDriver.last_name}` : 'e.g. Projection — Piet'} onChange={e => set('notes', e.target.value)} style={{ ...inp, width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={handleSaveProjection} disabled={projSaving} className="btn btn-sm" style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Save size={13} /> {projSaving ? 'Saving…' : 'Save Projection'}
                </button>
                <button onClick={() => setAddingProjection(false)} className="btn btn-ghost btn-sm"><X size={13} /> Cancel</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Add Load card form (new loads only, at top) ────────────────────────── */}
      {activeTab === 'loads' && editingId === 'new' && (
        <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <LoadForm editForm={editForm} setEditForm={setEditForm} mines={mines} drivers={driverOptions}
            vatRate={vatRate} rateSource={rateSource} setRateSource={setRateSource}
            saving={saving} onSave={handleSave} onCancel={cancelEdit} firstInputRef={firstInputRef}
            showPo={showPo} isSubcontractorEntity={isSubcontractorEntity} fmt={fmt} MONTHS={MONTHS} />
        </div>
      )}

      {activeTab === 'loads' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table compact-table" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <SortableHeader label="Date" col="load_date" sort={loadSort} onSort={onLoadSort} />
                <th style={{ whiteSpace: 'nowrap' }}>Period</th>
                <SortableHeader label="Slip #" col="slip_number" sort={loadSort} onSort={onLoadSort} />
                <th style={{ whiteSpace: 'nowrap' }}>Invoice #</th>
                {showPo && <th>PO #</th>}
                {!isSubcontractorEntity && <SortableHeader label="Driver" col="driver_name" sort={loadSort} onSort={onLoadSort} />}
                {!isSubcontractorEntity && <th style={{ whiteSpace: 'nowrap' }}>Split</th>}
                <SortableHeader label="Mine" col="mine_name" sort={loadSort} onSort={onLoadSort} />
                <SortableHeader label="Tonnes" col="tonnes" sort={loadSort} onSort={onLoadSort} />
                <SortableHeader label="Rate/t" col="rate_per_ton" sort={loadSort} onSort={onLoadSort} />
                <SortableHeader label="Excl VAT" col="amount_excl_vat" sort={loadSort} onSort={onLoadSort} style={{ textAlign: 'right' }} />
                {vatRegistered && <SortableHeader label="Incl VAT" col="amount_incl_vat" sort={loadSort} onSort={onLoadSort} style={{ textAlign: 'right' }} />}
                {showSub && <>
                  <th style={{ textAlign: 'right', color: 'var(--accent)', whiteSpace: 'nowrap' }}>Sub Rate/t</th>
                  <th style={{ textAlign: 'right', color: 'var(--accent)', whiteSpace: 'nowrap' }}>Sub Excl VAT</th>
                  <th style={{ textAlign: 'right', color: 'var(--accent)', whiteSpace: 'nowrap' }}>Sub Incl VAT</th>
                </>}
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={COLS} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
                </td></tr>
              )}
              {!loading && loads.length === 0 && editingId === null && (
                <tr><td colSpan={COLS} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No loads for {MONTHS[month - 1]} {year} — click "Add Load" to start
                </td></tr>
              )}
              {!loading && displayRows.map(row => {
                if (row.type === 'single') {
                  const l = row.load
                  const isEditing = editingId === l.id
                  if (isEditing) return (
                    <tr key={l.id}>
                      <td colSpan={COLS} style={{ padding: '12px 16px', background: 'var(--accent-subtle)', borderTop: '2px solid var(--accent)', borderBottom: '2px solid var(--accent)' }}>
                        <LoadForm editForm={editForm} setEditForm={setEditForm} mines={mines} drivers={driverOptions}
                          vatRate={vatRate} rateSource={rateSource} setRateSource={setRateSource}
                          saving={saving} onSave={handleSave} onCancel={cancelEdit} firstInputRef={firstInputRef}
                          showPo={showPo} isSubcontractorEntity={isSubcontractorEntity} fmt={fmt} MONTHS={MONTHS} />
                      </td>
                    </tr>
                  )
                  return (
                    <tr key={l.id} onClick={() => startEdit(l)}
                      style={{
                        cursor: 'pointer',
                        opacity: l.is_paid ? 0.7 : 1,
                        background: l.is_projection ? 'rgba(245,158,11,0.05)' : undefined,
                        fontStyle: l.is_projection ? 'italic' : undefined,
                      }}
                      className="hoverable-row">
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.load_date)}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {l.statement_month ? `${MONTHS[l.statement_month - 1]?.slice(0, 3)} ${l.statement_year}` : '—'}
                      </td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {l.is_projection
                          ? <span style={{ background: '#f59e0b', color: '#fff', fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 800, fontStyle: 'normal' }}>PROJ</span>
                          : (l.slip_number || '—')}
                      </td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{l.diesel_invoice || '—'}</td>
                      {showPo && <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.po_number || '—'}</td>}
                      {!isSubcontractorEntity && <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {l.driver_name ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontStyle: 'normal' }}>
                            {l.driver_name}
                            {driverTypeByName[l.driver_name] && (
                              <span className={`badge ${driverTypeByName[l.driver_name] === 'permanent' ? 'badge-paid' : 'badge-quote'}`}
                                style={{ fontSize: 9, padding: '1px 5px' }}>
                                {driverTypeByName[l.driver_name] === 'permanent' ? 'P' : 'C'}
                              </span>
                            )}
                            {l.driver_already_paid && (
                              <span title="Driver already paid for this load" style={{ background: '#16a34a', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 700, fontStyle: 'normal', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                <Banknote size={9} /> paid
                              </span>
                            )}
                            {l.pay_deferred && (
                              <span title="Done this month, paid in next month's payroll" style={{ background: '#d97706', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 700, fontStyle: 'normal', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                <CalendarClock size={9} /> next month
                              </span>
                            )}
                          </span>
                        ) : '—'}
                      </td>}
                      {!isSubcontractorEntity && <td style={{ fontSize: 12 }}>—</td>}
                      <td style={{ fontSize: 13 }}>{l.mine_name || '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: l.is_projection ? 'var(--text-muted)' : undefined }}>
                        {l.is_projection ? '—' : fmtNum(l.tonnes)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{l.is_projection ? '—' : fmt(l.rate_per_ton)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{l.is_projection ? '—' : fmt(l.amount_excl_vat)}</td>
                      {vatRegistered && <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{l.is_projection ? '—' : fmt(l.amount_incl_vat)}</td>}
                      {showSub && <>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--accent)' }}>{fmt(l.subcontractor_rate)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--accent)' }}>{fmt(l.subcontractor_amount_excl_vat)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--accent)' }}>{fmt(l.subcontractor_amount_incl_vat)}</td>
                      </>}
                      <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.notes || '—'}
                      </td>
                      <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          title={l.driver_already_paid ? 'Driver already paid — click to remove flag' : 'Mark: driver already paid (paid in prior period)'}
                          style={{ color: l.driver_already_paid ? '#16a34a' : 'var(--text-muted)', marginRight: 2 }}
                          onClick={e => handleToggleDriverPaid(l, e)}>
                          <Banknote size={13} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title={l.pay_deferred ? "Pay deferred to next month — click to pay in this month" : "Pay in next month's payroll (load stays in this month)"}
                          style={{ color: l.pay_deferred ? '#d97706' : 'var(--text-muted)', marginRight: 2 }}
                          onClick={e => handleTogglePayDeferred(l, e)}>
                          <CalendarClock size={13} />
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                          onClick={e => handleDelete(l, e)}><Trash2 size={13} /></button>
                        <div style={{ marginTop: 4 }}>
                          <VerifyBadge item={loadVerif[loadVerifTarget(l.id)] || {}}
                            onVerify={(_i, intent) => handleVerifyLoad(loadVerifTarget(l.id), intent)}
                            onFinalize={(_i, intent) => handleFinalizeLoad(loadVerifTarget(l.id), intent)}
                            currentUserId={user?.id} isAdmin={isAdmin} adminFinalizeAnytime />
                        </div>
                      </td>
                    </tr>
                  )
                }

                // Split load: one main load (full tonnes/amount) + driver lines (0.5 each)
                const l = row.load
                const splits = l.driver_splits || []
                const isOpen = openSplitGroups.has(l.id)
                if (editingId === l.id) return (
                  <tr key={l.id}>
                    <td colSpan={COLS} style={{ padding: '12px 16px', background: 'var(--accent-subtle)', borderTop: '2px solid var(--accent)', borderBottom: '2px solid var(--accent)' }}>
                      <LoadForm editForm={editForm} setEditForm={setEditForm} mines={mines} drivers={driverOptions}
                        vatRate={vatRate} rateSource={rateSource} setRateSource={setRateSource}
                        saving={saving} onSave={handleSave} onCancel={cancelEdit} firstInputRef={firstInputRef}
                        showPo={showPo} isSubcontractorEntity={isSubcontractorEntity} fmt={fmt} MONTHS={MONTHS} isSplit />
                    </td>
                  </tr>
                )
                return [
                  <tr key={`split-${l.id}`} style={{ background: l.is_projection ? 'rgba(245,158,11,0.05)' : 'var(--bg-surface)', cursor: 'pointer', opacity: l.is_paid ? 0.7 : 1, fontStyle: l.is_projection ? 'italic' : undefined }}
                    onClick={() => toggleSplitGroup(l.id)} className="hoverable-row">
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {l.is_projection && <span style={{ background: '#f59e0b', color: '#fff', fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 800, fontStyle: 'normal' }}>PROJ</span>}
                        {fmtDate(l.load_date)}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {l.statement_month ? `${MONTHS[l.statement_month - 1]?.slice(0, 3)} ${l.statement_year}` : '—'}
                    </td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.slip_number || '—'}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{l.diesel_invoice || '—'}</td>
                    {showPo && <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.po_number || '—'}</td>}
                    {!isSubcontractorEntity && <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Split — {splits.length} drivers
                        <button onClick={e => { e.stopPropagation(); toggleSplitGroup(l.id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--text-muted)', verticalAlign: 'middle' }}>
                          {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </span>
                    </td>}
                    {!isSubcontractorEntity && <td style={{ fontSize: 12 }}>
                      <span className="badge badge-quote" style={{ fontSize: 9, padding: '1px 5px' }}>½ split</span>
                    </td>}
                    <td style={{ fontSize: 13 }}>{l.mine_name || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: l.is_projection ? 'var(--text-muted)' : undefined }}>{l.is_projection ? '—' : fmtNum(l.tonnes)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{l.is_projection ? '—' : fmt(l.rate_per_ton)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{l.is_projection ? '—' : fmt(l.amount_excl_vat)}</td>
                    {vatRegistered && <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{l.is_projection ? '—' : fmt(l.amount_incl_vat)}</td>}
                    {showSub && <>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--accent)' }}>{fmt(l.subcontractor_rate)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--accent)' }}>{fmt(l.subcontractor_amount_excl_vat)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmt(l.subcontractor_amount_incl_vat)}</td>
                    </>}
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.notes || '—'}
                    </td>
                    <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" title="Edit split load"
                        style={{ color: 'var(--text-muted)', marginRight: 2 }}
                        onClick={e => { e.stopPropagation(); startEdit(l) }}><Pencil size={13} /></button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                        onClick={e => handleDelete(l, e)}><Trash2 size={13} /></button>
                      <div style={{ marginTop: 4 }}>
                        <VerifyBadge item={loadVerif[loadVerifTarget(l.id)] || {}}
                          onVerify={(_i, intent) => handleVerifyLoad(loadVerifTarget(l.id), intent)}
                          onFinalize={(_i, intent) => handleFinalizeLoad(loadVerifTarget(l.id), intent)}
                          currentUserId={user?.id} isAdmin={isAdmin} adminFinalizeAnytime />
                      </div>
                    </td>
                  </tr>,
                  ...(isOpen ? splits.map(sp => (
                    <tr key={`sp-${sp.id}`}
                      style={{ background: 'var(--bg-base)', borderLeft: '3px solid var(--accent)', opacity: l.is_paid ? 0.7 : 1 }}>
                      <td />
                      <td />
                      <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{sp.slip_number || '—'}</td>
                      <td />
                      {showPo && <td />}
                      {!isSubcontractorEntity && <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {sp.driver_name ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {sp.driver_name}
                            {driverTypeByName[sp.driver_name] && (
                              <span className={`badge ${driverTypeByName[sp.driver_name] === 'permanent' ? 'badge-paid' : 'badge-quote'}`}
                                style={{ fontSize: 9, padding: '1px 5px' }}>
                                {driverTypeByName[sp.driver_name] === 'permanent' ? 'P' : 'C'}
                              </span>
                            )}
                          </span>
                        ) : '—'}
                      </td>}
                      {!isSubcontractorEntity && <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>0.5 load</td>}
                      <td style={{ fontSize: 13 }}>{sp.mine_name || '—'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
                      <td />
                      <td />
                      {vatRegistered && <td />}
                      {showSub && <><td /><td /><td /></>}
                      <td />
                      <td />
                    </tr>
                  )) : []),
                ]
              })}
            </tbody>
            {!loading && loads.length > 0 && summary && (
              <tfoot>
                <tr style={{ background: 'var(--bg-surface)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={isSubcontractorEntity ? (showPo ? 6 : 5) : (showPo ? 8 : 7)} style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                    {summary.total_loads} loads
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtNum(summary.total_tonnes)}</td>
                  <td />
                  <td style={{ textAlign: 'right', padding: '10px 14px', whiteSpace: 'nowrap' }}>{fmt(summary.total_excl_vat)}</td>
                  {vatRegistered && <td style={{ textAlign: 'right', padding: '10px 14px', whiteSpace: 'nowrap' }}>{fmt(summary.total_incl_vat)}</td>}
                  {showSub && <td />}
                  {showSub && <td style={{ textAlign: 'right', padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--accent)' }}>{fmt(summary.total_subcontractor_excl_vat)}</td>}
                  {showSub && <td style={{ textAlign: 'right', padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--accent)' }}>{fmt(summary.total_subcontractor_incl_vat)}</td>}
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ── Additional Loads (below main loads, same tab) ─────────────────────── */}
      {activeTab === 'loads' && (
        <AdditionalLoadsSection truck={truck} year={year} month={month} drivers={drivers} selectedDriverId={selectedDriverId} isSafetec={isSafetec} />
      )}

      {/* ── Washes (below additional loads, same tab) ─────────────────────────── */}
      {activeTab === 'loads' && (
        <WashesSection truck={truck} year={year} month={month} />
      )}

      {/* ── Diesel tab ─────────────────────────────────────────────────────────── */}
      {activeTab === 'diesel' && (
        <DieselSection truck={truck} year={year} month={month} suppliers={suppliers} isBokamosho={isBokamosho} />
      )}

      {/* ── Food Allowance tab ─────────────────────────────────────────────────── */}
      {activeTab === 'food' && (
        <FoodAllowanceSection truck={truck} year={year} month={month} drivers={drivers} selectedDriverId={selectedDriverId} allTrucks={allTrucks} onEntriesLoaded={setFoodEntries} />
      )}

      {/* ── Profit Sheet tab (SFT only) ─────────────────────────────────────────── */}
      {activeTab === 'profit' && (
        <ProfitSheetSection truck={truck} year={year} month={month} summary={summary} />
      )}

      {/* ── Split Load Modal ──────────────────────────────────────────────────── */}
      {splitModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setSplitModalOpen(false)}>
          <div style={{
            background: 'var(--bg-card)', borderRadius: 12, padding: 24,
            width: '100%', maxWidth: 820, maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{splitForm.is_projection ? 'Add Split Projection' : 'Add Split Load'}</div>
                  {splitForm.is_projection && <span style={{ background: '#f59e0b', color: '#fff', fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 800 }}>PROJECTION</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {splitForm.is_projection ? 'Placeholder — tonnes unknown. Each driver still gets 0.5 load credit.' : 'Each driver receives 0.5 load credit'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#f59e0b', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!splitForm.is_projection}
                    onChange={e => setSplitForm(p => ({ ...p, is_projection: e.target.checked }))}
                    style={{ accentColor: '#f59e0b', width: 13, height: 13 }} />
                  Projection
                </label>
                <button className="btn btn-ghost btn-sm" onClick={() => setSplitModalOpen(false)}><X size={15} /></button>
              </div>
            </div>
            {/* Main load — the billing record. Counts as ONE load with full tonnes. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Mine</label>
                <SearchableSelect
                  value={String(splitForm.mine_id || '')}
                  onChange={v => {
                    const mine = mines.find(m => String(m.id) === v)
                    const rate = mine?.rates?.find(r => r.entity_id === truck.entity_id && !r.effective_to)
                    setSplitForm(prev => ({ ...prev, mine_id: v, ...(rate ? { rate_per_ton: String(rate.rate_per_ton) } : {}) }))
                    setSplitDrivers(prev => prev.map(d => d.mine_id ? d : { ...d, mine_id: v }))
                  }}
                  options={mines.filter(m => m.is_active)}
                  getValue={m => String(m.id)} getLabel={m => m.name}
                  placeholder="Mine…" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Date</label>
                <DateInput value={splitForm.load_date} onChange={e => setSplitForm(p => ({ ...p, load_date: e.target.value }))}
                  style={{ ...S.input, width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Tonnes</label>
                <input type="number" step="0.001" min="0"
                  value={splitForm.is_projection ? '' : splitForm.tonnes}
                  disabled={splitForm.is_projection}
                  onChange={e => setSplitForm(p => ({ ...p, tonnes: e.target.value }))}
                  placeholder={splitForm.is_projection ? 'TBC' : '0.000'}
                  style={{ ...S.input, width: '100%', textAlign: 'right', ...(splitForm.is_projection ? { background: 'var(--bg-surface)', color: 'var(--text-muted)' } : {}) }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
                  Rate/t
                  {!splitForm.is_projection && splitForm.mine_id && splitForm.rate_per_ton && mines.find(m => String(m.id) === String(splitForm.mine_id))?.rates?.find(r => r.entity_id === truck.entity_id && !r.effective_to && String(r.rate_per_ton) === String(splitForm.rate_per_ton)) && (
                    <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: 'var(--accent)' }}>auto</span>
                  )}
                </label>
                <input type="number" step="0.01" min="0"
                  value={splitForm.is_projection ? '' : splitForm.rate_per_ton}
                  disabled={splitForm.is_projection}
                  onChange={e => setSplitForm(p => ({ ...p, rate_per_ton: e.target.value }))}
                  placeholder={splitForm.is_projection ? 'TBC' : '0.00'}
                  style={{ ...S.input, width: '100%', textAlign: 'right', ...(splitForm.is_projection ? { background: 'var(--bg-surface)', color: 'var(--text-muted)' } : {}) }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Slip #</label>
                <input value={splitForm.slip_number} onChange={e => setSplitForm(p => ({ ...p, slip_number: e.target.value }))}
                  placeholder="Slip #" style={{ ...S.input, width: '100%' }} />
              </div>
              {showPo && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>PO #</label>
                  <input value={splitForm.po_number} onChange={e => setSplitForm(p => ({ ...p, po_number: e.target.value }))}
                    placeholder="PO #" style={{ ...S.input, width: '100%' }} />
                </div>
              )}
            </div>
            {splitForm.tonnes && splitForm.rate_per_ton && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 10 }}>
                Excl VAT: <strong style={{ color: 'var(--text-primary)' }}>R&nbsp;{(parseFloat(splitForm.tonnes) * parseFloat(splitForm.rate_per_ton)).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</strong>
                {vatRegistered && <> · Incl VAT: <strong style={{ color: 'var(--accent)' }}>R&nbsp;{(parseFloat(splitForm.tonnes) * parseFloat(splitForm.rate_per_ton) * (1 + vatRate)).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</strong></>}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Notes</label>
              <input value={splitForm.notes} onChange={e => setSplitForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Notes" style={{ ...S.input, width: '100%' }} />
            </div>

            {/* Driver lines — each credits 0.5 load to that driver's payroll. */}
            <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>Drivers</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                Both drivers were responsible for this load. Each gets 0.5 load on their payroll — tonnes are not split.
              </div>
              {splitDrivers.map((d, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end', marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Driver {i + 1}</label>
                    <SearchableSelect
                      value={d.driver_id ? String(d.driver_id) : ''}
                      onChange={v => setSplitDrivers(prev => prev.map((x, idx) => idx === i ? { ...x, driver_id: v ? parseInt(v) : null } : x))}
                      options={driverOptions} getValue={x => String(x.id)}
                      getLabel={x => `${x.first_name} ${x.last_name} (${x.driver_type === 'permanent' ? 'P' : 'C'})`}
                      placeholder="Driver…" style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Mine</label>
                    <SearchableSelect
                      value={String(d.mine_id || '')}
                      onChange={v => setSplitDrivers(prev => prev.map((x, idx) => idx === i ? { ...x, mine_id: v } : x))}
                      options={mines.filter(m => m.is_active)}
                      getValue={m => String(m.id)} getLabel={m => m.name}
                      placeholder="Mine…" style={{ width: '100%' }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', paddingBottom: 7 }}>0.5</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-ghost" onClick={() => setSplitModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveSplit} disabled={splitSaving}>
                {splitSaving ? 'Saving…' : 'Save Split Load'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteModal
        isOpen={!!deleteTarget && !['diesel', 'additional'].includes(deleteTarget?._type)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Truck Load"
        description={deleteTarget ? `Load on ${fmtDate(deleteTarget.load_date)} · ${fmtNum(deleteTarget.tonnes)} t${deleteTarget.mine_name ? ` from ${deleteTarget.mine_name}` : ''}` : ''}
        onArchive={async () => {
          try { await archiveTruckLoad(deleteTarget.id); toast.success('Load archived'); fetchLoads() }
          catch { toast.error('Failed to archive') }
          setDeleteTarget(null)
        }}
        onDelete={async () => {
          try { await deleteTruckLoad(deleteTarget.id); toast.success('Load deleted'); fetchLoads() }
          catch { toast.error('Failed to delete') }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

const S = {
  td: { padding: '6px 8px', fontSize: 12, verticalAlign: 'middle' },
  input: {
    padding: '4px 7px', fontSize: 12, borderRadius: 5,
    border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)', width: '100%', outline: 'none',
  },
}
