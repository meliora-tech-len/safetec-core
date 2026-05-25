import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Save, X, Trash2,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader, Fuel, UtensilsCrossed, BarChart3,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import SearchableSelect from '../components/SearchableSelect'
import {
  getTruck, getTruckLoads, getTruckLoadSummary,
  createTruckLoad, createSplitLoad, updateTruckLoad, deleteTruckLoad, archiveTruckLoad,
  getMines, getDrivers, getSettings, getSuppliers,
  getDieselFillUps, createDieselFillUp, deleteDieselFillUp, archiveDieselFillUp, getCurrentDieselRate,
  addDriverAdditionalLoad, deleteDriverAdditionalLoad, archiveDriverAdditionalLoad,
  addDriverFoodPayment, getTruckAdditionalLoads, getTruckFoodPayments, deleteDriverFoodPayment,
  getTruckMonthlyExpenses, upsertTruckMonthlyExpenses,
  getSupplierInvoicesByVehicle,
} from '../services/api'
import toast from 'react-hot-toast'
import DeleteModal from '../components/DeleteModal'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'
import DateInput from '../components/DateInput'

const fmt    = (n) => n == null ? '—' : `R ${parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtNum = (n) => n == null ? '—' : parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA') : '—'
const today = new Date().toISOString().slice(0, 10)

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const EMPTY_LOAD = {
  load_date: today, slip_number: '', po_number: '',
  driver_id: null, driver_name: '',
  mine_id: '', supplier_id: '', tonnes: '', rate_per_ton: '', is_paid: false,
  notes: '', checked_by: '',
}
const EMPTY_DIESEL = {
  fillup_date: today, supplier_id: '', slip_number: '', litres: '', rate_per_litre: '', notes: '', diesel_type: 'fillup',
}
const EMPTY_FOOD = { driver_id: '', amount: '', payment_date: today, notes: '' }


// ── Inline edit row (Loads tab) ────────────────────────────────────────────────
function EditRow({ form, setForm, mines, drivers, haulageSuppliers, vatRate, rateSource, setRateSource,
  saving, onSave, onCancel, firstInputRef, showPo, showSub, isSubcontractorEntity }) {

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const exclVat = form.tonnes && form.rate_per_ton
    ? (parseFloat(form.tonnes) * parseFloat(form.rate_per_ton)).toFixed(2) : null
  const inclVat = exclVat ? (parseFloat(exclVat) * (1 + vatRate)).toFixed(2) : null

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave() }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <tr style={{ background: 'var(--accent-subtle)', outline: '2px solid var(--accent)', outlineOffset: -1 }}
      onClick={e => e.stopPropagation()}>
      <td style={S.td}>
        <DateInput ref={firstInputRef} value={form.load_date}
          onChange={e => set('load_date', e.target.value)} onKeyDown={handleKey} style={S.input} />
      </td>
      <td style={S.td}>
        <input value={form.slip_number} placeholder="Slip #"
          onChange={e => set('slip_number', e.target.value)} onKeyDown={handleKey}
          style={{ ...S.input, width: 80 }} />
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
          value={form.driver_id ? String(form.driver_id) : ''}
          onChange={v => {
            const d = drivers.find(x => String(x.id) === v)
            set('driver_id', v ? parseInt(v) : null)
            set('driver_name', d ? `${d.first_name} ${d.last_name}`.trim() : (form.driver_name || ''))
          }}
          options={drivers}
          getValue={d => String(d.id)}
          getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`}
          placeholder="Driver…"
          style={{ minWidth: 110 }} />
      </td>}
      {!isSubcontractorEntity && <td style={S.td}>—</td>}
      <td style={S.td}>
        <SearchableSelect value={String(form.mine_id)} onChange={v => { set('mine_id', v); setRateSource(null) }}
          options={mines.filter(m => m.is_active)} getValue={m => String(m.id)}
          getLabel={m => m.name} placeholder="Mine…" style={{ minWidth: 100 }} />
      </td>
      {/* <td style={S.td}>
        <SearchableSelect value={String(form.supplier_id)} onChange={v => set('supplier_id', v)}
          options={haulageSuppliers} getValue={s => String(s.id)}
          getLabel={s => s.name} placeholder="Supplier…" style={{ minWidth: 120 }} />
      </td> */}
      <td style={S.td}>
        <input type="number" step="0.001" min="0" placeholder="0.000" value={form.tonnes}
          onChange={e => set('tonnes', e.target.value)} onKeyDown={handleKey}
          style={{ ...S.input, width: 75, textAlign: 'right' }} />
      </td>
      <td style={S.td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input type="number" step="0.01" min="0" placeholder="Rate" value={form.rate_per_ton}
            onChange={e => { set('rate_per_ton', e.target.value); setRateSource('manual') }} onKeyDown={handleKey}
            style={{ ...S.input, width: 70, textAlign: 'right' }} />
          {rateSource === 'mine' && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>auto</span>
          )}
        </div>
      </td>
      <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>
        {exclVat ? `R ${parseFloat(exclVat).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}` : '—'}
      </td>
      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontSize: 12 }}>
        {inclVat ? `R ${parseFloat(inclVat).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}` : '—'}
      </td>
      {showSub && <><td /><td /><td /></>}
      <td style={S.td}>
        <input value={form.notes} placeholder="Notes"
          onChange={e => set('notes', e.target.value)} onKeyDown={handleKey}
          style={{ ...S.input, minWidth: 90 }} />
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


// ── Diesel section ─────────────────────────────────────────────────────────────
function DieselSection({ truck, year, month, suppliers }) {
  const [fillups, setFillups]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [addingNew, setAddingNew] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm]           = useState({ ...EMPTY_DIESEL })
  const [autoRate, setAutoRate]   = useState(null)
  const [rateEdited, setRateEdited] = useState(false)
  const [dSort, setDSort]         = useState({ col: 'fillup_date', dir: 'asc' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

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

  const doAdd = async () => {
    setSaving(true)
    try {
      await createDieselFillUp({
        entity_id:      truck.entity_id,
        truck_id:       truck.id,
        supplier_id:    parseInt(form.supplier_id),
        fillup_date:    form.fillup_date,
        litres:         litresNum,
        rate_per_litre: rateNum,
        slip_number:    form.slip_number || null,
        notes:          form.notes || null,
        diesel_type:    form.diesel_type || 'fillup',
      })
      toast.success('Diesel entry added')
      setForm({ ...EMPTY_DIESEL })
      setAddingNew(false)
      fetchFillups()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save diesel entry')
    } finally { setSaving(false) }
  }

  const handleAdd = async () => {
    if (!form.supplier_id)  return toast.error('Select a supplier')
    if (!form.fillup_date)  return toast.error('Date required')
    if (litresNum <= 0)     return toast.error('Enter litres')
    if (rateNum <= 0)       return toast.error('Enter rate per litre')
    doAdd()
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setAddingNew(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Log Diesel
        </button>
      </div>

      {addingNew && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>New Diesel Entry</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <div>
              <label className="form-label">Date *</label>
              <DateInput className="form-input" value={form.fillup_date} onChange={e => set('fillup_date', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Supplier *</label>
              <SearchableSelect value={String(form.supplier_id)} onChange={v => { set('supplier_id', v); setRateEdited(false); setAutoRate(null) }}
                options={suppliers} getValue={s => String(s.id)} getLabel={s => s.name} placeholder="Supplier…" formInput />
            </div>
            <div>
              <label className="form-label">Slip #</label>
              <input className="form-input" value={form.slip_number} onChange={e => set('slip_number', e.target.value)} placeholder="SLP-001" />
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
              <input className="form-input" type="number" step="0.01" min="0" value={form.litres} onChange={e => set('litres', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="form-label">
                Rate/L *{autoRate && (
                  <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700,
                    color: rateEdited ? '#d97706' : '#16a34a' }}>
                    {rateEdited ? 'manual' : 'auto'}
                  </span>
                )}
              </label>
              <input className="form-input" type="number" step="0.01" min="0"
                value={form.rate_per_litre}
                onChange={e => { set('rate_per_litre', e.target.value); setRateEdited(true) }}
                placeholder="0.00" />
            </div>
            <div>
              <label className="form-label">Amount</label>
              <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 6, fontSize: 13, fontWeight: 700 }}>
                {calcAmt ? fmt(calcAmt) : '—'}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="form-label">Mine / Notes</label>
            <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
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
                      <th style={{ textAlign: 'right' }}>Admin</th>
                      <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleDSort('total_amount')}>Total{dArrow('total_amount')}</th>
                      <th>Notes</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortEntries(entries).map(f => (
                      <tr key={f.id} style={{ height: 48 }}>
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
                        <td style={{ textAlign: 'right', fontSize: 12 }}>R {parseFloat(f.rate_per_litre).toFixed(2)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(f.amount)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{fmt(f.admin_fee_amount)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(f.total_amount)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.notes || '—'}</td>
                        <td>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(f)}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-surface)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                      <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>Total</td>
                      <td style={{ textAlign: 'right', padding: '8px 12px' }}>{subLitres.toFixed(1)} L</td>
                      <td colSpan={3} />
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
function AdditionalLoadsSection({ truck, year, month, drivers, selectedDriverId }) {
  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [addingNew, setAddingNew] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm]         = useState({ driver_id: '', route_name: '', amount: '', load_date: today, notes: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTruckAdditionalLoads(truck.id, { year, month })
      setEntries(res.data)
    } catch { /* silently ignore */ }
    finally { setLoading(false) }
  }, [truck.id, year, month])

  useEffect(() => { fetchEntries() }, [fetchEntries])

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
        notes: form.notes || null,
      })
      toast.success('Additional load added')
      setForm({ driver_id: selectedDriverId || '', route_name: '', amount: '', load_date: today, notes: '' })
      setAddingNew(false)
      fetchEntries()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save')
    } finally { setSaving(false) }
  }

  const handleDelete = (entry) => setDeleteTarget(entry)

  const total = entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const driverTypeByName = drivers.reduce((acc, d) => {
    acc[`${d.first_name} ${d.last_name}`.trim()] = d.driver_type
    return acc
  }, {})

  const { sort: addSort, onSort: onAddSort } = useSort('load_date', 'asc')
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
        <button className="btn btn-ghost btn-sm"
          onClick={() => {
            setForm({ driver_id: selectedDriverId || '', route_name: '', amount: '', load_date: today, notes: '' })
            setAddingNew(v => !v)
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> Add
        </button>
      </div>

      {addingNew && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <div>
              <label className="form-label">Driver *</label>
              <SearchableSelect value={String(form.driver_id)} onChange={v => set('driver_id', v)}
                options={drivers} getValue={d => String(d.id)}
                getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`} placeholder="Driver…" />
            </div>
            <div>
              <label className="form-label">Description *</label>
              <input className="form-input" value={form.route_name} onChange={e => set('route_name', e.target.value)} placeholder="e.g. Sand loads" />
            </div>
            <div>
              <label className="form-label">Date</label>
              <DateInput className="form-input" value={form.load_date} onChange={e => set('load_date', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Amount (R) *</label>
              <input className="form-input" type="number" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="form-label">Notes</label>
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
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>No additional loads recorded.</div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <SortableHeader label="Driver" col="driver_name" sort={addSort} onSort={onAddSort} />
                <SortableHeader label="Description" col="route_name" sort={addSort} onSort={onAddSort} />
                <SortableHeader label="Date" col="load_date" sort={addSort} onSort={onAddSort} />
                <SortableHeader label="Amount" col="amount" sort={addSort} onSort={onAddSort} style={{ textAlign: 'right' }} />
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedAdditional.map(e => (
                <tr key={e.id}>
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
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(e.load_date)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(e.amount)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.notes || '—'}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDeleteTarget(e)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg-surface)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={3} style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>Total</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--accent)' }}>{fmt(total)}</td>
                  <td colSpan={2} />
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


// ── Food Allowance section ─────────────────────────────────────────────────────
function FoodAllowanceSection({ truck, year, month, drivers, selectedDriverId }) {
  const [entries, setEntries]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [form, setForm]           = useState({ ...EMPTY_FOOD })
  const [saving, setSaving]       = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const formDriver = drivers.find(d => String(d.id) === String(form.driver_id))

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTruckFoodPayments(truck.id, { year, month })
      setEntries(res.data)
    } catch { /* silently ignore */ }
    finally { setLoading(false) }
  }, [truck.id, year, month])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  const handleOpenAdd = () => {
    setForm({ ...EMPTY_FOOD, driver_id: selectedDriverId || '' })
    setAddingNew(true)
  }

  const handleCancel = () => {
    setAddingNew(false)
    setForm({ ...EMPTY_FOOD })
  }

  const handleAdd = async () => {
    if (!form.driver_id) return toast.error('Select a driver')
    const amount = parseFloat(form.amount) || 0
    if (amount <= 0) return toast.error('Enter an amount')
    setSaving(true)
    try {
      await addDriverFoodPayment(form.driver_id, year, month, {
        payment_date: new Date(form.payment_date + 'T12:00:00').toISOString(),
        amount,
        notes: form.notes || null,
      })
      const driverName = formDriver ? `${formDriver.first_name} ${formDriver.last_name}` : 'Driver'
      toast.success(`Food allowance saved for ${driverName}`)
      setAddingNew(false)
      setForm({ ...EMPTY_FOOD })
      fetchEntries()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save food allowance')
    } finally { setSaving(false) }
  }

  const total = entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0)

  const { sort: foodSort, onSort: onFoodSort } = useSort('payment_date', 'asc')
  const sortedFood = useMemo(() => applySort(entries, foodSort), [entries, foodSort])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        {entries.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {fmt(total)}
          </span>
        )}
        <button className="btn btn-primary" onClick={handleOpenAdd} disabled={addingNew}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <Plus size={14} /> Add Food Allowance
        </button>
      </div>

      {addingNew && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
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
              <DateInput className="form-input" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Amount (R) *</label>
              <input className="form-input" type="number" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="form-label">Notes</label>
              <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
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
                <SortableHeader label="Date" col="payment_date" sort={foodSort} onSort={onFoodSort} />
                <th>Notes</th>
                <SortableHeader label="Amount" col="amount" sort={foodSort} onSort={onFoodSort} style={{ textAlign: 'right' }} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedFood.map(e => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>{e.driver_name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(e.payment_date)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.notes || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmt(e.amount)}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                      onClick={() => setDeleteTarget(e)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg-surface)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={3} style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>Total</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--accent)' }}>{fmt(total)}</td>
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
  { key: 'sauma',                label: 'SAUMA / SASRIA' },
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
  const [addingLine, setAddingLine] = useState(false)
  const [newLine, setNewLine]   = useState({ description: '', amount: '' })

  const setField = (k, v) => { setData(d => ({ ...d, [k]: v })); setDirty(true) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [expRes, invRes] = await Promise.all([
        getTruckMonthlyExpenses(truck.id, { year, month }),
        truck.registration ? getSupplierInvoicesByVehicle({ vehicle_reg: truck.registration, month, year }) : Promise.resolve({ data: [] }),
      ])
      setData(expRes.data)
      setSupplierInvs(invRes.data)
      setDirty(false)
    } catch { toast.error('Failed to load profit sheet') }
    finally { setLoading(false) }
  }, [truck.id, truck.registration, year, month])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSave = async () => {
    setSaving(true)
    try {
      await upsertTruckMonthlyExpenses(truck.id, { year, month }, data)
      toast.success('Profit sheet saved')
      setDirty(false)
    } catch { toast.error('Failed to save profit sheet') }
    finally { setSaving(false) }
  }

  const addCustomLine = () => {
    const amt = parseFloat(newLine.amount) || 0
    if (!newLine.description.trim()) return toast.error('Enter a description')
    if (amt <= 0) return toast.error('Enter an amount')
    const lines = [...(data.custom_lines || []), { id: crypto.randomUUID(), description: newLine.description.trim(), amount: amt }]
    setField('custom_lines', lines)
    setNewLine({ description: '', amount: '' })
    setAddingLine(false)
  }

  const removeCustomLine = (id) => {
    setField('custom_lines', (data.custom_lines || []).filter(l => l.id !== id))
  }

  // Income: use manual override if saved, otherwise fall back to loads summary
  const incomeExcl = data.income_excl_vat != null ? parseFloat(data.income_excl_vat) : (parseFloat(summary?.total_excl_vat) || 0)
  const incomeIncl = data.income_incl_vat != null ? parseFloat(data.income_incl_vat) : (parseFloat(summary?.total_incl_vat) || 0)

  // Fixed expenses
  const fixedTotal = EXPENSE_ROWS.reduce((s, r) => s + (parseFloat(data[r.key]) || 0), 0)

  // Supplier invoices total
  const supplierTotal = supplierInvs.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)

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
            <input
              type="number" step="0.01" min="0"
              value={data.income_excl_vat ?? (summary?.total_excl_vat ?? '')}
              placeholder={fmt(parseFloat(summary?.total_excl_vat) || 0)}
              onChange={e => setField('income_excl_vat', e.target.value === '' ? null : e.target.value)}
              style={{ width: 140, fontWeight: 700, fontSize: 15, color: 'var(--text-muted)', background: 'transparent', border: 'none', outline: 'none', padding: 0, textAlign: 'left' }}
            />
          </div>
          {/* Income Incl VAT — editable */}
          <div style={{ padding: '10px 20px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 4 }}>Income Incl VAT</div>
            <input
              type="number" step="0.01" min="0"
              value={data.income_incl_vat ?? (summary?.total_incl_vat ?? '')}
              placeholder={fmt(parseFloat(summary?.total_incl_vat) || 0)}
              onChange={e => setField('income_incl_vat', e.target.value === '' ? null : e.target.value)}
              style={{ width: 140, fontWeight: 700, fontSize: 15, color: 'var(--accent)', background: 'transparent', border: 'none', outline: 'none', padding: 0, textAlign: 'left' }}
            />
          </div>
          {/* Total Expenses — calculated, read-only */}
          <div style={{ padding: '10px 20px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 4 }}>Total Expenses</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--danger)' }}>{fmt(totalExpenses)}</div>
          </div>
          {/* Net Profit — calculated, read-only */}
          <div style={{ padding: '10px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 4 }}>Net Profit</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: !hasData ? 'var(--text-muted)' : netProfit >= 0 ? '#16a34a' : 'var(--danger)' }}>
              {hasData ? fmt(netProfit) : '—'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {dirty && <span style={{ fontSize: 12, color: '#d97706' }}>Unsaved changes</span>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

        {/* Left: Standard editable expense rows + custom lines */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <SectionHead>Standard Expenses</SectionHead>
          {EXPENSE_ROWS.map(r => (
            <div key={r.key} style={psRow}>
              <span style={psLabel}>{r.label}</span>
              <input type="number" step="0.01" min="0" style={{ ...psInput, width: 150 }}
                value={data[r.key] ?? ''} placeholder="—"
                onChange={e => setField(r.key, e.target.value || null)} />
            </div>
          ))}

          {/* Custom lines under same card */}
          <SectionHead>Additional Expenses</SectionHead>
          {(data.custom_lines || []).map(l => (
            <div key={l.id} style={psRow}>
              <span style={psLabel}>{l.description}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={psAmt}>{fmt(l.amount)}</span>
                <button onClick={() => removeCustomLine(l.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '2px 4px', lineHeight: 1 }}>
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}

          {addingLine && (
            <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
              <input autoFocus style={{ ...psInput, flex: 1, textAlign: 'left' }} placeholder="Description"
                value={newLine.description} onChange={e => setNewLine(l => ({ ...l, description: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addCustomLine(); if (e.key === 'Escape') setAddingLine(false) }} />
              <input type="number" step="0.01" min="0" style={{ ...psInput, width: 120 }} placeholder="Amount"
                value={newLine.amount} onChange={e => setNewLine(l => ({ ...l, amount: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addCustomLine(); if (e.key === 'Escape') setAddingLine(false) }} />
              <button className="btn btn-primary btn-sm" onClick={addCustomLine}><Save size={13} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setAddingLine(false); setNewLine({ description: '', amount: '' }) }}><X size={13} /></button>
            </div>
          )}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAddingLine(true)} disabled={addingLine}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <Plus size={12} /> Add Expense Line
            </button>
          </div>

          {/* Fixed expense sub-total */}
          <div style={{ ...psRow, borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
            <span style={{ ...psLabel, fontWeight: 700 }}>Sub-total</span>
            <span style={{ ...psAmt, color: 'var(--danger)' }}>{fmt(fixedTotal + customTotal)}</span>
          </div>
        </div>

        {/* Right: Supplier invoices (auto-fetched) */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <SectionHead>Supplier Invoices</SectionHead>
          {supplierInvs.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
              No supplier invoices linked to {truck.registration} for this month
            </div>
          ) : (
            <>
              {supplierInvs.map(inv => (
                <div key={inv.id} style={psRow}>
                  <span style={{ ...psLabel, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontWeight: 500 }}>{inv.supplier_name || '—'}</span>
                    {inv.invoice_number && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{inv.invoice_number}</span>
                    )}
                  </span>
                  <span style={psAmt}>{fmt(inv.amount)}</span>
                </div>
              ))}
              <div style={{ ...psRow, borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
                <span style={{ ...psLabel, fontWeight: 700 }}>Sub-total</span>
                <span style={{ ...psAmt, color: 'var(--danger)' }}>{fmt(supplierTotal)}</span>
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
  const { isAdmin, entities } = useAuth()

  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

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

  // Add Load prompt + split modal
  const [addPromptOpen, setAddPromptOpen]   = useState(false)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [splitForms, setSplitForms] = useState({ a: { ...EMPTY_LOAD }, b: { ...EMPTY_LOAD } })
  const [splitSaving, setSplitSaving] = useState(false)
  const [openSplitGroups, setOpenSplitGroups] = useState(new Set())

  // ── Load truck meta ──────────────────────────────────────────────────────────
  useEffect(() => {
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

  // ── Load loads for current month ─────────────────────────────────────────────
  const fetchLoads = useCallback(async () => {
    if (!truck) return
    setLoading(true)
    const dateFrom = new Date(year, month - 1, 1).toISOString()
    const dateTo   = new Date(year, month, 0, 23, 59, 59).toISOString()
    const params   = { truck_id: truck.id, date_from: dateFrom, date_to: dateTo, limit: 500 }
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

  useEffect(() => {
    if (editingId && firstInputRef.current) firstInputRef.current.focus()
  }, [editingId])

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
    setEditForm({ ...EMPTY_LOAD, driver_name: driverName })
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
      tonnes:       load.tonnes    != null ? String(load.tonnes)    : '',
      rate_per_ton: load.rate_per_ton != null ? String(load.rate_per_ton) : '',
      is_paid:      !!load.is_paid,
      notes:        load.notes     || '',
      checked_by:   load.checked_by || '',
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
    tonnes:       parseFloat(form.tonnes),
    rate_per_ton: form.rate_per_ton ? parseFloat(form.rate_per_ton) : null,
    is_paid:      form.is_paid,
    notes:        form.notes       || null,
    checked_by:   form.checked_by  || null,
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
      toast.error(e?.response?.data?.detail || 'Failed to save')
    } finally { setSaving(false) }
  }

  const handleSave = async () => {
    if (!editForm.mine_id)  return toast.error('Select a mine')
    if (!editForm.load_date) return toast.error('Load date required')
    if (!editForm.tonnes || isNaN(editForm.tonnes)) return toast.error('Valid tonnes required')
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

  const handleDelete = (load, e) => {
    e.stopPropagation()
    setDeleteTarget(load)
  }

  const syncBFromA = (key, val) => {
    setSplitForms(f => ({
      ...f,
      a: { ...f.a, [key]: val },
      b: { ...f.b, [key]: f.b[key] === f.a[key] ? val : f.b[key] },
    }))
  }

  const handleSaveSplit = async () => {
    if (!splitForms.a.mine_id || !splitForms.b.mine_id) return toast.error('Select a mine for both loads')
    if (!splitForms.a.load_date || !splitForms.b.load_date) return toast.error('Load date required for both')
    if (!splitForms.a.tonnes || isNaN(splitForms.a.tonnes)) return toast.error('Valid tonnes required for Load A')
    if (!splitForms.b.tonnes || isNaN(splitForms.b.tonnes)) return toast.error('Valid tonnes required for Load B')
    setSplitSaving(true)
    try {
      await createSplitLoad({ load_a: buildPayload(splitForms.a), load_b: buildPayload(splitForms.b) })
      toast.success('Split load saved')
      setSplitModalOpen(false)
      fetchLoads()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save split load')
    } finally { setSplitSaving(false) }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const isSubcontractorEntity = truck?.entity_is_subcontractor || false
  const entityCode = truck ? (entities.find(e => e.id === truck.entity_id)?.code || '') : ''
  const isSafetec  = entityCode === 'SFT'
  const permanentDriver = drivers.find(d => d.truck_id === truck?.id && d.driver_slot === 1)
    ?? drivers.find(d => d.truck_id === truck?.id)
  const selectedDriver  = drivers.find(d => String(d.id) === selectedDriverId)
  const driverTypeByName = drivers.reduce((acc, d) => {
    acc[`${d.first_name} ${d.last_name}`.trim()] = d.driver_type
    return acc
  }, {})
  const showPo  = !isSubcontractorEntity && truck?.notes?.toLowerCase() === 'intsimbi'
  const showSub = !isSubcontractorEntity && (truck?.is_subcontractor || false)
  const vatRegistered = entities.find(e => e.id === truck?.entity_id)?.vat_registered !== false
  const COLS    = isSubcontractorEntity
    ? (showPo ? 8 : 7)
    : (showPo ? 13 : 12) + (showSub ? 3 : 0) - (vatRegistered ? 0 : 1)

  const { sort: loadSort, onSort: onLoadSort } = useSort('load_date', 'asc')
  const sortedLoads = useMemo(() => applySort(loads, loadSort), [loads, loadSort])

  const toggleSplitGroup = (gid) => setOpenSplitGroups(s => {
    const n = new Set(s); n.has(gid) ? n.delete(gid) : n.add(gid); return n
  })

  const displayRows = useMemo(() => {
    const groups = new Map()
    const items = []
    sortedLoads.forEach(l => {
      if (l.is_split_load && l.split_group_id) {
        if (!groups.has(l.split_group_id)) groups.set(l.split_group_id, [])
        groups.get(l.split_group_id).push(l)
      } else {
        items.push({ type: 'single', load: l })
      }
    })
    groups.forEach((pair, gid) => {
      const [first] = pair
      items.push({ type: 'split', loads: pair.sort((a, b) => a.id - b.id), gid, load_date: first.load_date })
    })
    return items.sort((a, b) => {
      const da = a.type === 'single' ? a.load.load_date : a.load_date
      const db2 = b.type === 'single' ? b.load.load_date : b.load_date
      if (loadSort.dir === 'asc') return new Date(da) - new Date(db2)
      return new Date(db2) - new Date(da)
    })
  }, [sortedLoads, loadSort.dir])

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
    <div style={{ padding: '28px 32px', flex: 1 }}>
      <div className="loading-center"><div className="spinner" /></div>
    </div>
  )

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>

      {/* Breadcrumb */}
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/truck-loads')}
        style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={14} /> Truck Loads
      </button>

      {/* Truck header card */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 24, display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'monospace', letterSpacing: 1 }}>
            {truck.registration}
          </div>
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
            options={drivers}
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
                      setSplitForms({ a: { ...EMPTY_LOAD }, b: { ...EMPTY_LOAD } })
                      setSplitModalOpen(true)
                    }}>
                    Split load
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

      {activeTab === 'loads' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <SortableHeader label="Date" col="load_date" sort={loadSort} onSort={onLoadSort} />
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
              {editingId === 'new' && <EditRow {...editRowProps} />}
              {loading && (
                <tr><td colSpan={COLS} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
                </td></tr>
              )}
              {!loading && loads.length === 0 && editingId !== 'new' && (
                <tr><td colSpan={COLS} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No loads for {MONTHS[month - 1]} {year} — click "Add Load" to start
                </td></tr>
              )}
              {!loading && displayRows.map(row => {
                if (row.type === 'single') {
                  const l = row.load
                  const isEditing = editingId === l.id
                  return isEditing ? (
                    <EditRow key={l.id} {...editRowProps} />
                  ) : (
                    <tr key={l.id} onClick={() => startEdit(l)}
                      style={{ cursor: 'pointer', opacity: l.is_paid ? 0.7 : 1 }}
                      className="hoverable-row">
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.load_date)}</td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.slip_number || '—'}</td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace', color: l.diesel_invoice ? 'var(--text-muted)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{l.diesel_invoice || '—'}</td>
                      {showPo && <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.po_number || '—'}</td>}
                      {!isSubcontractorEntity && <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {l.driver_name ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {l.driver_name}
                            {driverTypeByName[l.driver_name] && (
                              <span className={`badge ${driverTypeByName[l.driver_name] === 'permanent' ? 'badge-paid' : 'badge-quote'}`}
                                style={{ fontSize: 9, padding: '1px 5px' }}>
                                {driverTypeByName[l.driver_name] === 'permanent' ? 'P' : 'C'}
                              </span>
                            )}
                          </span>
                        ) : '—'}
                      </td>}
                      {!isSubcontractorEntity && <td style={{ fontSize: 12 }}>—</td>}
                      <td style={{ fontSize: 13 }}>{l.mine_name || '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(l.tonnes)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(l.rate_per_ton)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{fmt(l.amount_excl_vat)}</td>
                      {vatRegistered && <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt(l.amount_incl_vat)}</td>}
                      {showSub && <>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--accent)' }}>{fmt(l.subcontractor_rate)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--accent)' }}>{fmt(l.subcontractor_amount_excl_vat)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--accent)' }}>{fmt(l.subcontractor_amount_incl_vat)}</td>
                      </>}
                      <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.notes || '—'}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                          onClick={e => handleDelete(l, e)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  )
                }

                // Split group row
                const { loads: pair, gid } = row
                const [a, b] = pair
                const isOpen = openSplitGroups.has(gid)
                const sumExcl = ((+a.amount_excl_vat || 0) + (+b.amount_excl_vat || 0))
                const sumIncl = ((+a.amount_incl_vat || 0) + (+b.amount_incl_vat || 0))
                const sumTonnes = ((+a.tonnes || 0) + (+b.tonnes || 0))
                return [
                  <tr key={`sg-${gid}`} style={{ background: 'var(--bg-surface)', cursor: 'pointer' }}
                    onClick={() => toggleSplitGroup(gid)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.load_date)}</td>
                    <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {a.slip_number || '—'} / {b.slip_number || '—'}
                    </td>
                    <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {a.diesel_invoice || b.diesel_invoice || '—'}
                    </td>
                    {showPo && <td>—</td>}
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {a.driver_name || '—'} / {b.driver_name || '—'}
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      <span className="badge badge-quote" style={{ fontSize: 9, padding: '1px 5px' }}>½ split</span>
                      <button onClick={e => { e.stopPropagation(); toggleSplitGroup(gid) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--text-muted)', verticalAlign: 'middle' }}>
                        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </td>
                    <td style={{ fontSize: 13 }}>{a.mine_name || '—'}{a.mine_name !== b.mine_name ? ` / ${b.mine_name || '—'}` : ''}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(sumTonnes)}</td>
                    <td>—</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{fmt(sumExcl)}</td>
                    {vatRegistered && <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt(sumIncl)}</td>}
                    {showSub && <><td /><td /><td /></>}
                    <td />
                    <td />
                  </tr>,
                  ...(isOpen ? pair.map(sl => {
                    const isEditing = editingId === sl.id
                    return isEditing ? (
                      <EditRow key={sl.id} {...editRowProps} />
                    ) : (
                      <tr key={sl.id} onClick={() => startEdit(sl)}
                        style={{ background: 'var(--bg-base)', borderLeft: '3px solid var(--accent)', cursor: 'pointer', opacity: sl.is_paid ? 0.7 : 1 }}
                        className="hoverable-row">
                        <td />
                        <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{sl.slip_number || '—'}</td>
                        <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{sl.diesel_invoice || '—'}</td>
                        {showPo && <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{sl.po_number || '—'}</td>}
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {sl.driver_name ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              {sl.driver_name}
                              {driverTypeByName[sl.driver_name] && (
                                <span className={`badge ${driverTypeByName[sl.driver_name] === 'permanent' ? 'badge-paid' : 'badge-quote'}`}
                                  style={{ fontSize: 9, padding: '1px 5px' }}>
                                  {driverTypeByName[sl.driver_name] === 'permanent' ? 'P' : 'C'}
                                </span>
                              )}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>½</td>
                        <td style={{ fontSize: 13 }}>{sl.mine_name || '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(sl.tonnes)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(sl.rate_per_ton)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{fmt(sl.amount_excl_vat)}</td>
                        {vatRegistered && <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt(sl.amount_incl_vat)}</td>}
                        {showSub && <>
                          <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--accent)' }}>{fmt(sl.subcontractor_rate)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--accent)' }}>{fmt(sl.subcontractor_amount_excl_vat)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmt(sl.subcontractor_amount_incl_vat)}</td>
                        </>}
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sl.notes || '—'}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                            onClick={e => handleDelete(sl, e)}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    )
                  }) : []),
                ]
              })}
            </tbody>
            {!loading && loads.length > 0 && summary && (
              <tfoot>
                <tr style={{ background: 'var(--bg-surface)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={showPo ? 6 : 5} style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                    {summary.total_loads} loads
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 12px' }}>{fmtNum(summary.total_tonnes)}</td>
                  <td />
                  <td style={{ textAlign: 'right', padding: '10px 12px' }}>{fmt(summary.total_excl_vat)}</td>
                  {vatRegistered && <td style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--accent)' }}>{fmt(summary.total_incl_vat)}</td>}
                  <td colSpan={2 + (showSub ? 3 : 0)} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ── Additional Loads (below main loads, same tab) ─────────────────────── */}
      {activeTab === 'loads' && (
        <AdditionalLoadsSection truck={truck} year={year} month={month} drivers={drivers} selectedDriverId={selectedDriverId} />
      )}

      {/* ── Diesel tab ─────────────────────────────────────────────────────────── */}
      {activeTab === 'diesel' && (
        <DieselSection truck={truck} year={year} month={month} suppliers={suppliers} />
      )}

      {/* ── Food Allowance tab ─────────────────────────────────────────────────── */}
      {activeTab === 'food' && (
        <FoodAllowanceSection truck={truck} year={year} month={month} drivers={drivers} selectedDriverId={selectedDriverId} />
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
                <div style={{ fontSize: 16, fontWeight: 700 }}>Add Split Load</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Each driver receives 0.5 load credit</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSplitModalOpen(false)}><X size={15} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {['a', 'b'].map(side => {
                const f = splitForms[side]
                const label = side === 'a' ? 'Driver A' : 'Driver B'
                const setField = (k, v) => {
                  if (k === 'mine_id') {
                    const mine = mines.find(m => String(m.id) === v)
                    const rate = mine?.rates?.find(r => r.entity_id === truck.entity_id && !r.effective_to)
                    if (side === 'a') {
                      setSplitForms(f => {
                        const mineSync  = f.b.mine_id  === f.a.mine_id
                        const rateSync  = !f.b.rate_per_ton || f.b.rate_per_ton === f.a.rate_per_ton
                        return {
                          a: { ...f.a, mine_id: v, ...(rate ? { rate_per_ton: String(rate.rate_per_ton) } : {}) },
                          b: {
                            ...f.b,
                            ...(mineSync ? { mine_id: v } : {}),
                            ...(rate && rateSync ? { rate_per_ton: String(rate.rate_per_ton) } : {}),
                          },
                        }
                      })
                    } else {
                      setSplitForms(prev => ({
                        ...prev,
                        b: { ...prev.b, mine_id: v, ...(rate ? { rate_per_ton: String(rate.rate_per_ton) } : {}) },
                      }))
                    }
                  } else if (side === 'a') {
                    syncBFromA(k, v)
                  } else {
                    setSplitForms(prev => ({ ...prev, b: { ...prev.b, [k]: v } }))
                  }
                }
                const exclVat = f.tonnes && f.rate_per_ton
                  ? (parseFloat(f.tonnes) * parseFloat(f.rate_per_ton)).toFixed(2) : null
                const inclVat = exclVat ? (parseFloat(exclVat) * (1 + vatRate)).toFixed(2) : null
                return (
                  <div key={side} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: 'var(--accent)' }}>{label}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Driver</label>
                        <SearchableSelect
                          value={f.driver_id ? String(f.driver_id) : ''}
                          onChange={v => {
                            const d = drivers.find(x => String(x.id) === v)
                            setField('driver_id', v ? parseInt(v) : null)
                            setField('driver_name', d ? `${d.first_name} ${d.last_name}`.trim() : '')
                          }}
                          options={drivers}
                          getValue={d => String(d.id)}
                          getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`}
                          placeholder="Driver…"
                          style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Slip #</label>
                        <input value={f.slip_number} onChange={e => setField('slip_number', e.target.value)}
                          placeholder="Slip #" style={{ ...S.input, width: '100%' }} />
                      </div>
                      {showPo && (
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>PO #</label>
                          <input value={f.po_number} onChange={e => setField('po_number', e.target.value)}
                            placeholder="PO #" style={{ ...S.input, width: '100%' }} />
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Mine</label>
                        <SearchableSelect
                          value={String(f.mine_id)}
                          onChange={v => setField('mine_id', v)}
                          options={mines.filter(m => m.is_active)}
                          getValue={m => String(m.id)}
                          getLabel={m => m.name}
                          placeholder="Mine…"
                          style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Date</label>
                        <DateInput value={f.load_date} onChange={e => setField('load_date', e.target.value)}
                          style={{ ...S.input, width: '100%' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Tonnes</label>
                        <input type="number" step="0.001" min="0" value={f.tonnes}
                          onChange={e => setField('tonnes', e.target.value)}
                          placeholder="0.000" style={{ ...S.input, width: '100%', textAlign: 'right' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
                          Rate/t
                          {f.mine_id && f.rate_per_ton && mines.find(m => String(m.id) === String(f.mine_id))?.rates?.find(r => r.entity_id === truck.entity_id && !r.effective_to && String(r.rate_per_ton) === String(f.rate_per_ton)) && (
                            <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: 'var(--accent)' }}>auto</span>
                          )}
                        </label>
                        <input type="number" step="0.01" min="0" value={f.rate_per_ton}
                          onChange={e => setField('rate_per_ton', e.target.value)}
                          placeholder="0.00" style={{ ...S.input, width: '100%', textAlign: 'right' }} />
                      </div>
                      {exclVat && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                          Excl VAT: <strong style={{ color: 'var(--text-primary)' }}>R {parseFloat(exclVat).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</strong>
                          {vatRegistered && inclVat && <> · Incl VAT: <strong style={{ color: 'var(--accent)' }}>R {parseFloat(inclVat).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</strong></>}
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Notes</label>
                        <input value={f.notes} onChange={e => setField('notes', e.target.value)}
                          placeholder="Notes" style={{ ...S.input, width: '100%' }} />
                      </div>
                    </div>
                  </div>
                )
              })}
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
