import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Save, X, Trash2, CheckCircle,
  ChevronLeft, ChevronRight, Loader, Fuel, UtensilsCrossed, BarChart3,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import SearchableSelect from '../components/SearchableSelect'
import {
  getTruck, getTruckLoads, getTruckLoadSummary,
  createTruckLoad, updateTruckLoad, deleteTruckLoad, archiveTruckLoad,
  getMines, getDrivers, getSettings, getSuppliers,
  getDieselFillUps, createDieselFillUp, deleteDieselFillUp, archiveDieselFillUp, getCurrentDieselRate,
  addDriverAdditionalLoad, deleteDriverAdditionalLoad, archiveDriverAdditionalLoad,
  addDriverFoodPayment, getTruckAdditionalLoads,
  getTruckMonthlyExpenses, upsertTruckMonthlyExpenses,
} from '../services/api'
import toast from 'react-hot-toast'
import DeleteModal from '../components/DeleteModal'

const fmt    = (n) => n == null ? '—' : `R ${parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtNum = (n) => n == null ? '—' : parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA') : '—'
const today = new Date().toISOString().slice(0, 10)

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const EMPTY_LOAD = {
  load_date: today, slip_number: '', po_number: '', driver_name: '',
  mine_id: '', supplier_id: '', tonnes: '', rate_per_ton: '', is_paid: false, notes: '', checked_by: '',
}
const EMPTY_DIESEL = {
  fillup_date: today, supplier_id: '', invoice_number: '', litres: '', rate_per_litre: '', notes: '',
}
const EMPTY_FOOD = { driver_id: '', amount: '', payment_date: today, notes: '' }


// ── Inline edit row (Loads tab) ────────────────────────────────────────────────
function EditRow({ form, setForm, mines, drivers, haulageSuppliers, vatRate, rateSource, setRateSource,
  saving, onSave, onCancel, firstInputRef, showPo }) {

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
        <input ref={firstInputRef} type="date" value={form.load_date}
          onChange={e => set('load_date', e.target.value)} onKeyDown={handleKey} style={S.input} />
      </td>
      <td style={S.td}>
        <input value={form.slip_number} placeholder="Slip #"
          onChange={e => set('slip_number', e.target.value)} onKeyDown={handleKey}
          style={{ ...S.input, width: 80 }} />
      </td>
      {showPo && (
        <td style={S.td}>
          <input value={form.po_number} placeholder="PO #"
            onChange={e => set('po_number', e.target.value)} onKeyDown={handleKey}
            style={{ ...S.input, width: 80 }} />
        </td>
      )}
      <td style={S.td}>
        <SearchableSelect value={form.driver_name} onChange={v => set('driver_name', v)}
          options={drivers} getValue={d => `${d.first_name} ${d.last_name}`.trim()}
          getLabel={d => `${d.first_name} ${d.last_name} (${d.driver_type === 'permanent' ? 'P' : 'C'})`.trim()} placeholder="Driver…"
          style={{ minWidth: 110 }} />
      </td>
      <td style={S.td}>
        <SearchableSelect value={String(form.mine_id)} onChange={v => { set('mine_id', v); setRateSource(null) }}
          options={mines.filter(m => m.is_active)} getValue={m => String(m.id)}
          getLabel={m => m.name} placeholder="Mine…" style={{ minWidth: 100 }} />
      </td>
      <td style={S.td}>
        <SearchableSelect value={String(form.supplier_id)} onChange={v => set('supplier_id', v)}
          options={haulageSuppliers} getValue={s => String(s.id)}
          getLabel={s => s.name} placeholder="Supplier (optional)…" style={{ minWidth: 130 }} />
      </td>
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
      <td style={{ ...S.td, textAlign: 'center' }}>
        <input type="checkbox" checked={form.is_paid} onChange={e => set('is_paid', e.target.checked)} style={{ cursor: 'pointer' }} />
      </td>
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
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

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

  const handleAdd = async () => {
    if (!form.supplier_id)  return toast.error('Select a supplier')
    if (!form.fillup_date)  return toast.error('Date required')
    if (litresNum <= 0)     return toast.error('Enter litres')
    if (rateNum <= 0)       return toast.error('Enter rate per litre')
    setSaving(true)
    try {
      await createDieselFillUp({
        entity_id:      truck.entity_id,
        truck_id:       truck.id,
        supplier_id:    parseInt(form.supplier_id),
        fillup_date:    form.fillup_date,
        litres:         litresNum,
        rate_per_litre: rateNum,
        invoice_number: form.invoice_number || null,
        notes:          form.notes || null,
      })
      toast.success('Diesel entry added')
      setForm({ ...EMPTY_DIESEL })
      setAddingNew(false)
      fetchFillups()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save diesel entry')
    } finally { setSaving(false) }
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
          <Plus size={14} /> Add Fill-up
        </button>
      </div>

      {addingNew && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>New Diesel Entry</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <div>
              <label className="form-label">Date *</label>
              <input className="form-input" type="date" value={form.fillup_date} onChange={e => set('fillup_date', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Supplier *</label>
              <SearchableSelect value={String(form.supplier_id)} onChange={v => { set('supplier_id', v); setRateEdited(false); setAutoRate(null) }}
                options={suppliers} getValue={s => String(s.id)} getLabel={s => s.name} placeholder="Supplier…" formInput />
            </div>
            <div>
              <label className="form-label">Invoice #</label>
              <input className="form-input" value={form.invoice_number} onChange={e => set('invoice_number', e.target.value)} placeholder="INV-001" />
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
                      <th>Date</th>
                      <th>Invoice #</th>
                      <th style={{ textAlign: 'right' }}>Litres</th>
                      <th style={{ textAlign: 'right' }}>Rate/L</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Admin</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th>Notes</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(f => (
                      <tr key={f.id} style={{ height: 48 }}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(f.fillup_date)}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{f.invoice_number || '—'}</td>
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
                      <td colSpan={2} style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>Total</td>
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
              <input className="form-input" type="date" value={form.load_date} onChange={e => set('load_date', e.target.value)} />
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
                <th>Driver</th>
                <th>Description</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
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
  const [form, setForm]              = useState({ ...EMPTY_FOOD })
  const [saving, setSaving]          = useState(false)
  const [addingNew, setAddingNew]    = useState(false)
  const [sessionEntries, setSession] = useState([])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const formDriver = drivers.find(d => String(d.id) === String(form.driver_id))

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
      setSession(prev => [...prev, { driver: driverName, amount, date: form.payment_date }])
      setAddingNew(false)
      setForm({ ...EMPTY_FOOD })
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save food allowance')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={handleOpenAdd} disabled={addingNew}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
              <input className="form-input" type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
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

      {sessionEntries.length > 0 ? (
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ padding: '10px 16px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
            Added this session
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {sessionEntries.map((e, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{e.driver}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(e.date)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmt(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !addingNew ? (
        <div className="empty-state" style={{ padding: 40 }}>
          <UtensilsCrossed size={32} />
          <p>No food allowance entries added yet</p>
        </div>
      ) : null}
    </div>
  )
}


const INCOME_ROWS = [
  { key: 'income_excl_vat', label: 'Income Excl. VAT' },
  { key: 'income_incl_vat', label: 'Income Incl. VAT' },
]
const EXPENSE_ROWS = [
  { key: 'drivers_salary',       label: "Driver's Salary" },
  { key: 'insurance_trailer',    label: 'Insurance Trailer' },
  { key: 'liability_3rd_party',  label: '3rd Party Liability' },
  { key: 'goods_in_transit',     label: 'Goods in Transit' },
  { key: 'loss_of_use',          label: 'Loss of Use' },
  { key: 'personal_accident',    label: 'Personal Accident' },
  { key: 'communication_device', label: 'Communication Device' },
  { key: 'sauma',                label: 'SAUMA' },
  { key: 'diesel',               label: 'Diesel' },
  { key: 'tyre_maintenance',     label: 'Tyre Maintenance' },
  { key: 'other_suppliers',      label: 'Other Suppliers' },
]

const inputStyle = {
  width: '100%', textAlign: 'right', padding: '3px 7px',
  borderRadius: 4, border: '1px solid var(--border)',
  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
}

// ── Profit Sheet (SFT only) ───────────────────────────────────────────────────
function ProfitSheetSection({ truck, year, month }) {
  const [data, setData]     = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty]   = useState(false)

  const set = (k, v) => { setData(d => ({ ...d, [k]: v })); setDirty(true) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getTruckMonthlyExpenses(truck.id, { year, month })
      setData(res.data)
      setDirty(false)
    } catch { toast.error('Failed to load profit sheet') }
    finally { setLoading(false) }
  }, [truck.id, year, month])

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

  const incInclVat     = parseFloat(data.income_incl_vat) || 0
  const totalExpenses  = EXPENSE_ROWS.reduce((s, r) => s + (parseFloat(data[r.key]) || 0), 0)
  const netProfit      = incInclVat - totalExpenses
  const hasValues      = incInclVat > 0 || totalExpenses > 0

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 10, alignItems: 'center' }}>
        {dirty && <span style={{ fontSize: 12, color: '#d97706' }}>Unsaved changes</span>}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', fontWeight: 700, fontSize: 13, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
            Income
          </div>
          <table className="data-table">
            <tbody>
              {INCOME_ROWS.map(r => (
                <tr key={r.key}>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.label}</td>
                  <td style={{ width: 140 }}>
                    <input type="number" step="0.01" min="0" style={inputStyle}
                      value={data[r.key] ?? ''} placeholder="—"
                      onChange={e => set(r.key, e.target.value || null)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', fontWeight: 700, fontSize: 13, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
            Expenses
          </div>
          <table className="data-table">
            <tbody>
              {EXPENSE_ROWS.map(r => (
                <tr key={r.key}>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.label}</td>
                  <td style={{ width: 140 }}>
                    <input type="number" step="0.01" min="0" style={inputStyle}
                      value={data[r.key] ?? ''} placeholder="—"
                      onChange={e => set(r.key, e.target.value || null)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Net Profit</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: hasValues ? (netProfit >= 0 ? '#16a34a' : 'var(--danger)') : 'var(--text-muted)', fontStyle: hasValues ? 'normal' : 'italic' }}>
            {hasValues ? fmt(netProfit) : '—'}
          </span>
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
  const firstInputRef = useRef(null)

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

  // ── Default central driver to permanent driver once data loads ───────────────
  useEffect(() => {
    if (!truck || drivers.length === 0) return
    const perm = drivers.find(d => d.truck_id === truck.id && d.driver_type === 'permanent')
    if (perm) setSelectedDriverId(prev => prev || String(perm.id))
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
  const cancelEdit = () => { setEditingId(null); setEditForm({ ...EMPTY_LOAD }) }

  const startEdit = (load) => {
    if (editingId !== null) return
    setEditForm({
      load_date:    load.load_date ? load.load_date.slice(0, 10) : today,
      slip_number:  load.slip_number  || '',
      po_number:    load.po_number    || '',
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
    driver_name:  form.driver_name || null,
    tonnes:       parseFloat(form.tonnes),
    rate_per_ton: form.rate_per_ton ? parseFloat(form.rate_per_ton) : null,
    is_paid:      form.is_paid,
    notes:        form.notes       || null,
    checked_by:   form.checked_by  || null,
  })

  const handleSave = async () => {
    if (!editForm.mine_id)  return toast.error('Select a mine')
    if (!editForm.load_date) return toast.error('Load date required')
    if (!editForm.tonnes || isNaN(editForm.tonnes)) return toast.error('Valid tonnes required')
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
      fetchLoads()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save')
    } finally { setSaving(false) }
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

  // ── Derived ──────────────────────────────────────────────────────────────────
  const entityCode = truck ? (entities.find(e => e.id === truck.entity_id)?.code || '') : ''
  const isSafetec  = entityCode === 'SFT'
  const permanentDriver = drivers.find(d => d.truck_id === truck?.id && d.driver_type === 'permanent')
  const selectedDriver  = drivers.find(d => String(d.id) === selectedDriverId)
  const driverTypeByName = drivers.reduce((acc, d) => {
    acc[`${d.first_name} ${d.last_name}`.trim()] = d.driver_type
    return acc
  }, {})
  const showPo = truck?.notes?.toLowerCase() === 'intsimbi'
  const COLS   = showPo ? 13 : 12

  const TABS = [
    { key: 'loads',  label: 'Loads'         },
    { key: 'diesel', label: 'Diesel'         },
    { key: 'food',   label: 'Food Allowance' },
    ...(isSafetec ? [{ key: 'profit', label: 'Profit Sheet' }] : []),
  ]

  const editRowProps = {
    form: editForm, setForm: setEditForm, mines, drivers, haulageSuppliers, vatRate,
    rateSource, setRateSource, saving, onSave: handleSave,
    onCancel: cancelEdit, firstInputRef, showPo,
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

        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            Active Driver
            {permanentDriver && selectedDriverId === String(permanentDriver.id) && (
              <span style={{ fontSize: 9, color: '#16a34a', background: 'rgba(22,163,74,0.1)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>PERMANENT</span>
            )}
            {selectedDriver && permanentDriver && selectedDriverId !== String(permanentDriver.id) && (
              <span style={{ fontSize: 9, color: '#d97706', background: 'rgba(217,119,6,0.1)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>CASUAL</span>
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
              Reset to {permanentDriver.first_name} {permanentDriver.last_name}
            </button>
          )}
          {!permanentDriver && !selectedDriverId && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>No permanent driver assigned</div>
          )}
        </div>

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
              { label: 'Incl VAT', value: fmt(summary.total_incl_vat), accent: true },
            ].map(c => (
              <div key={c.label} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{c.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: c.accent ? 'var(--accent)' : 'var(--text-primary)' }}>{c.value}</div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'loads' && (
          <button className="btn btn-primary" onClick={startNew} disabled={editingId === 'new'}>
            <Plus size={14} /> Add Load
          </button>
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
      {activeTab === 'loads' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Slip #</th>
                {showPo && <th>PO #</th>}
                <th>Driver</th>
                <th>Mine</th>
                <th>Supplier</th>
                <th style={{ textAlign: 'right' }}>Tonnes</th>
                <th style={{ textAlign: 'right' }}>Rate/t</th>
                <th style={{ textAlign: 'right' }}>Excl VAT</th>
                <th style={{ textAlign: 'right' }}>Incl VAT</th>
                <th style={{ textAlign: 'center' }}>Paid</th>
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
              {!loading && loads.map(l => {
                const isEditing = editingId === l.id
                return isEditing ? (
                  <EditRow key={l.id} {...editRowProps} />
                ) : (
                  <tr key={l.id} onClick={() => startEdit(l)}
                    style={{ cursor: 'pointer', opacity: l.is_paid ? 0.7 : 1 }}
                    className="hoverable-row">
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.load_date)}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.slip_number || '—'}</td>
                    {showPo && <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.po_number || '—'}</td>}
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
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
                    </td>
                    <td style={{ fontSize: 13 }}>{l.mine_name || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.supplier_name || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(l.tonnes)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(l.rate_per_ton)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-muted)' }}>{fmt(l.amount_excl_vat)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt(l.amount_incl_vat)}</td>
                    <td style={{ textAlign: 'center' }} onClick={e => handleTogglePaid(l, e)}>
                      <CheckCircle size={16} style={{ color: l.is_paid ? '#16a34a' : 'var(--border)', cursor: 'pointer' }} />
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.notes || '—'}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {isAdmin && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                          onClick={e => handleDelete(l, e)}><Trash2 size={13} /></button>
                      )}
                    </td>
                  </tr>
                )
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
                  <td style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--accent)' }}>{fmt(summary.total_incl_vat)}</td>
                  <td colSpan={3} />
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
        <ProfitSheetSection truck={truck} year={year} month={month} />
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
