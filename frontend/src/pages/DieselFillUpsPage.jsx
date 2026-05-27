import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  getDieselFillUps, getDieselFillUpSummary, createDieselFillUp,
  updateDieselFillUp, deleteDieselFillUp, archiveDieselFillUp, verifyDieselFillUp, finalizeDieselFillUp,
  getCurrentDieselRate, getEntities, getDieselSettings, getSuppliers,
} from '../services/api'
import { formatCurrency, formatDate, errorMessage } from '../utils/helpers'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { Plus, Search, X, Trash2, Fuel, Save } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import SearchableSelect from '../components/SearchableSelect'
import VerifyBadge from '../components/VerifyBadge'
import DeleteModal from '../components/DeleteModal'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'
import DateInput from '../components/DateInput'

const API = import.meta.env.VITE_API_URL || ''
function rawApi(path, opts = {}) {
  const token = localStorage.getItem('token')
  return fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers },
    ...opts,
  }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const today = new Date().toISOString().slice(0, 10)

const BLANK = {
  entity_id: '', truck_id: '', supplier_id: '', fillup_date: today,
  litres: '', rate_per_litre: '', invoice_number: '', slip_number: '', notes: '', diesel_type: 'fillup',
}

export default function DieselFillUpsPage() {
  const { activeEntity, isAdmin, entities: authEntities, user } = useAuth()
  const now = new Date()

  const [fillups, setFillups]     = useState([])
  const [summary, setSummary]     = useState(null)
  const [entities, setEntities]   = useState([])
  const [trucks, setTrucks]       = useState([])   // filter bar trucks
  const [suppliers, setSuppliers] = useState([])   // filter bar suppliers
  const [rowSuppliers, setRowSuppliers] = useState([]) // edit row suppliers (entity-scoped)
  const [loading, setLoading]     = useState(true)

  // Filters
  const [filterEntity,   setFilterEntity]   = useState(activeEntity?.id?.toString() || '')
  const [filterYear,     setFilterYear]     = useState(now.getFullYear())
  const [filterMonth,    setFilterMonth]    = useState(now.getMonth() + 1)
  const [filterTruck,    setFilterTruck]    = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [filterVerified, setFilterVerified] = useState('')
  const [search,         setSearch]         = useState('')

  // Inline editing
  const [editingId,    setEditingId]    = useState(null)   // null | 'new' | fillup.id
  const [editForm,     setEditForm]     = useState({ ...BLANK })
  const [rowTrucks,    setRowTrucks]    = useState([])
  const [autoRate,     setAutoRate]     = useState(null)
  const [rateEdited,   setRateEdited]   = useState(false)
  const [preview,      setPreview]      = useState({ amount: null, fee: null, total: null })
  const [dieselSettings, setDieselSettings] = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const firstInputRef = useRef(null)
  const { sort, onSort } = useSort('truck_registration', 'asc')

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])

  // Reference data — entities once on mount
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  // Filter bar: trucks and suppliers scoped to the selected entity
  useEffect(() => {
    if (!filterEntity) { setTrucks([]); setSuppliers([]); return }
    rawApi(`/api/fleet/trucks?entity_id=${filterEntity}&limit=200`).then(setTrucks).catch(() => setTrucks([]))
    getSuppliers({ entity_id: filterEntity, is_diesel_supplier: true, limit: 500 }).then(r => setSuppliers(r.data || [])).catch(() => setSuppliers([]))
  }, [filterEntity])

  const buildParams = useCallback(() => {
    const p = {}
    if (filterEntity)       p.entity_id  = filterEntity
    if (filterYear)         p.year       = filterYear
    if (filterMonth)        p.month      = filterMonth
    if (filterTruck)        p.truck_id   = filterTruck
    if (filterSupplier)     p.supplier_id = filterSupplier
    if (filterVerified !== '') p.verified = filterVerified
    return p
  }, [filterEntity, filterYear, filterMonth, filterTruck, filterSupplier, filterVerified])

  const load = useCallback(() => {
    setLoading(true)
    const params = buildParams()
    Promise.all([
      getDieselFillUps(params).then(r => setFillups(r.data)),
      getDieselFillUpSummary(params).then(r => setSummary(r.data)),
    ]).finally(() => setLoading(false))
  }, [buildParams])

  useEffect(() => { load() }, [load])

  // Fetch trucks, suppliers, and diesel settings when edit row entity changes
  useEffect(() => {
    const eid = editForm.entity_id
    if (!eid) { setRowTrucks([]); setRowSuppliers([]); setDieselSettings(null); return }
    rawApi(`/api/fleet/trucks?entity_id=${eid}&limit=200`).then(setRowTrucks).catch(() => setRowTrucks([]))
    getSuppliers({ entity_id: eid, is_diesel_supplier: true, limit: 500 }).then(r => setRowSuppliers(r.data || [])).catch(() => setRowSuppliers([]))
    getDieselSettings({ entity_id: eid }).then(r => setDieselSettings(r.data?.[0] || null)).catch(() => {})
  }, [editForm.entity_id])

  // Auto-fetch rate when supplier / entity / date change
  useEffect(() => {
    if (!editForm.supplier_id || !editForm.entity_id || !editForm.fillup_date) return
    getCurrentDieselRate(editForm.supplier_id, {
      entity_id: editForm.entity_id,
      on_date: editForm.fillup_date,
    }).then(r => {
      const rate = r.data
      if (rate && !rateEdited) {
        setAutoRate(rate.rate_per_litre)
        setEditForm(f => ({ ...f, rate_per_litre: parseFloat(rate.rate_per_litre).toFixed(2) }))
      }
      if (!rate) setAutoRate(null)
    }).catch(() => {})
  }, [editForm.supplier_id, editForm.entity_id, editForm.fillup_date, rateEdited])

  // Live calc preview
  useEffect(() => {
    const litres = parseFloat(editForm.litres)
    const rate   = parseFloat(editForm.rate_per_litre)
    if (isNaN(litres) || isNaN(rate) || litres <= 0 || rate <= 0) {
      setPreview({ amount: null, fee: null, total: null }); return
    }
    const amount = litres * rate
    const pct      = dieselSettings ? parseFloat(dieselSettings.admin_fee_pct) : 0
    const applyFee = dieselSettings ? dieselSettings.apply_admin_fee : false
    const feeExcl = applyFee && pct > 0 ? amount * pct : 0
    const feeVat  = feeExcl * 0.15
    const feeIncl = feeExcl + feeVat
    setPreview({ amount: amount.toFixed(2), fee: feeExcl.toFixed(2), feeVat: feeVat.toFixed(2), feeIncl: feeIncl.toFixed(2), total: (amount + feeIncl).toFixed(2) })
  }, [editForm.litres, editForm.rate_per_litre, dieselSettings])

  // Focus first input when edit opens
  useEffect(() => {
    if (editingId && firstInputRef.current) firstInputRef.current.focus()
  }, [editingId])

  const startNew = () => {
    if (editingId !== null) return // guard — must intentionally exit first
    setEditForm({ ...BLANK, entity_id: filterEntity || '' })
    setAutoRate(null); setRateEdited(false)
    setEditingId('new')
  }

  const startEdit = (f) => {
    if (editingId !== null) return // guard — intentional exit only
    setEditForm({
      entity_id:     String(f.entity_id    || ''),
      truck_id:      String(f.truck_id     || ''),
      supplier_id:   String(f.supplier_id  || ''),
      fillup_date:   f.fillup_date || today,
      litres:        f.litres     != null ? String(f.litres)        : '',
      rate_per_litre: f.rate_per_litre != null ? parseFloat(f.rate_per_litre).toFixed(2) : '',
      invoice_number: f.invoice_number || '',
      slip_number:   f.slip_number    || '',
      notes:         f.notes          || '',
      diesel_type:   f.diesel_type    || 'fillup',
    })
    setAutoRate(null); setRateEdited(true) // treat existing rate as manual
    setEditingId(f.id)
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({ ...BLANK }) }

  const handleSave = async () => {
    const f = editForm
    if (!f.entity_id)    return toast.error('Select an entity')
    if (!f.truck_id)     return toast.error('Select a truck')
    if (!f.supplier_id)  return toast.error('Select a supplier')
    if (!f.fillup_date)  return toast.error('Date required')
    if (!f.litres || isNaN(f.litres))           return toast.error('Enter valid litres')
    if (!f.rate_per_litre || isNaN(f.rate_per_litre)) return toast.error('Enter valid rate')
    setSaving(true)
    const payload = {
      entity_id:     parseInt(f.entity_id),
      truck_id:      parseInt(f.truck_id),
      supplier_id:   parseInt(f.supplier_id),
      fillup_date:   f.fillup_date,
      litres:        parseFloat(f.litres),
      rate_per_litre: parseFloat(f.rate_per_litre),
      invoice_number: f.invoice_number || null,
      slip_number:   f.slip_number    || null,
      diesel_type:   f.diesel_type    || 'fillup',
      notes:         f.notes          || null,
    }
    try {
      if (editingId === 'new') {
        await createDieselFillUp(payload)
        toast.success('Entry added')
      } else {
        await updateDieselFillUp(editingId, payload)
        toast.success('Entry updated')
      }
      setEditingId(null)
      load()
    } catch (err) { toast.error(errorMessage(err)) }
    finally { setSaving(false) }
  }

  const handleVerify = async (f) => {
    try { await verifyDieselFillUp(f.id); load() }
    catch (err) { toast.error(errorMessage(err)) }
  }

  const handleFinalize = async (f) => {
    try { await finalizeDieselFillUp(f.id); load() }
    catch (err) { toast.error(errorMessage(err)) }
  }

  const handleDelete = (f, e) => {
    e.stopPropagation()
    setDeleteTarget(f)
  }

  const confirmDelete = async () => {
    try { await deleteDieselFillUp(deleteTarget.id); toast.success('Deleted'); load() }
    catch (err) { toast.error(errorMessage(err)) }
    finally { setDeleteTarget(null) }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
    if (e.key === 'Escape') cancelEdit()
  }

  const set = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  const years = []
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) years.push(y)

  const visible = useMemo(() => {
    const base = search
      ? fillups.filter(f =>
          (f.truck_registration || '').toLowerCase().includes(search.toLowerCase()) ||
          (f.supplier_name      || '').toLowerCase().includes(search.toLowerCase()) ||
          (f.invoice_number     || '').toLowerCase().includes(search.toLowerCase()) ||
          (f.slip_number        || '').toLowerCase().includes(search.toLowerCase())
        )
      : fillups
    return applySort(base, sort)
  }, [fillups, search, sort])

  const multiEntity = entities.length > 1
  const COLS = multiEntity ? 15 : 14

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Diesel Log</h1>
          <p className="page-subtitle">{fillups.length} records — {MONTHS[filterMonth]} {filterYear}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title={`Diesel Logs — ${MONTHS[filterMonth]} ${filterYear}`}
            filename={`diesel-${filterYear}-${filterMonth}`}
            data={visible}
            columns={[
              { header: 'Date',          value: r => formatDate(r.fillup_date) },
              { header: 'Truck',         key: 'truck_registration' },
              { header: 'Supplier',      key: 'supplier_name' },
              { header: 'Litres',        value: r => parseFloat(r.litres).toFixed(2) },
              { header: 'Rate/L',        value: r => parseFloat(r.rate_per_litre).toFixed(2) },
              { header: 'Amount (excl)', value: r => parseFloat(r.amount).toFixed(2) },
              { header: 'Admin Fee %',        value: r => (parseFloat(r.admin_fee_pct) * 100).toFixed(2) + '%' },
              { header: 'Admin Fee (excl VAT)', value: r => parseFloat(r.admin_fee_amount).toFixed(2) },
              { header: 'Admin Fee VAT',        value: r => parseFloat(r.admin_fee_vat || 0).toFixed(2) },
              { header: 'Admin Fee (incl VAT)', value: r => (parseFloat(r.admin_fee_amount) + parseFloat(r.admin_fee_vat || 0)).toFixed(2) },
              { header: 'Total',                value: r => parseFloat(r.total_amount).toFixed(2) },
              { header: 'Invoice #',     key: 'invoice_number' },
              { header: 'Slip #',        key: 'slip_number' },
              { header: 'Verified',      value: r => r.verified ? 'Yes' : '' },
              { header: 'Notes',         key: 'notes' },
            ]}
          />
          <button className="btn-primary" onClick={startNew} disabled={editingId !== null}>
            <Plus size={15} /> Log Diesel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 20 }}>
        {/* Row 1: Entity, Supplier, Search, Verified (right) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {isAdmin && (
            <div className="form-group" style={{ margin: 0, width: 180 }}>
              <label className="form-label">Entity</label>
              <select className="form-control" value={filterEntity} onChange={e => setFilterEntity(e.target.value)}>
                <option value="">All Entities</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ margin: 0, width: 160 }}>
            <label className="form-label">Supplier</label>
            <select className="form-control" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}>
              <option value="">All Suppliers</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <label className="form-label">Search</label>
            <div className="search-bar">
              <Search size={13} />
              <input placeholder="Truck / supplier / invoice…" value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button className="btn-icon" onClick={() => setSearch('')}><X size={12} /></button>}
            </div>
          </div>
          <div className="form-group" style={{ margin: 0, marginLeft: 'auto' }}>
            <label className="form-label">Verified</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {['', 'true', 'false'].map(v => (
                <button key={v}
                  className={`btn btn-sm ${filterVerified === v ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilterVerified(v)} style={{ fontSize: 12 }}>
                  {v === '' ? 'All' : v === 'true' ? 'Verified' : 'Unverified'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

        {/* Row 2: Truck, Month, Year */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, width: 160 }}>
            <label className="form-label">Truck</label>
            <select className="form-control" value={filterTruck} onChange={e => setFilterTruck(e.target.value)}>
              <option value="">All Trucks</option>
              {trucks.map(t => <option key={t.id} value={t.id}>{t.registration}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, width: 110 }}>
            <label className="form-label">Month</label>
            <select className="form-control" value={filterMonth} onChange={e => setFilterMonth(parseInt(e.target.value))}>
              {MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, width: 90 }}>
            <label className="form-label">Year</label>
            <select className="form-control" value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid-4" style={{ marginBottom: 16 }}>
          <SummaryCard label="Logs" value={summary.total_fillups} />
          <SummaryCard label="Total Litres" value={`${parseFloat(summary.total_litres).toLocaleString('en-ZA', { minimumFractionDigits: 2 })} L`} />
          <SummaryCard label="Admin Fee (incl VAT)" value={formatCurrency(parseFloat(summary.total_admin_fee) + parseFloat(summary.total_admin_fee_vat || 0))} />
          <SummaryCard label="Grand Total (incl. fee + VAT)" value={formatCurrency(summary.grand_total)} accent />
        </div>
      )}

      {/* Table — always visible */}
      <div className="table-wrapper" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              {multiEntity && <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={onSort} />}
              <SortableHeader label="Date" col="fillup_date" sort={sort} onSort={onSort} />
              <SortableHeader label="Truck" col="truck_registration" sort={sort} onSort={onSort} />
              <SortableHeader label="Supplier" col="supplier_name" sort={sort} onSort={onSort} />
              <th className="text-right">Litres</th>
              <th className="text-right">Rate/L</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Admin Fee (excl)</th>
              <th className="text-right">Admin Fee (incl)</th>
              <SortableHeader label="Total" col="total_amount" sort={sort} onSort={onSort} className="text-right" />
              <th>Type</th>
              <th>Invoice #</th>
              <th>Slip #</th>
              <th>Verified</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {/* New row */}
            {editingId === 'new' && (
              <EditRow
                form={editForm} set={set} rowTrucks={rowTrucks} suppliers={rowSuppliers}
                entities={entities} multiEntity={multiEntity} isNew
                autoRate={autoRate} rateEdited={rateEdited} setRateEdited={setRateEdited}
                preview={preview} saving={saving}
                onSave={handleSave} onCancel={cancelEdit} onKeyDown={handleKeyDown}
                firstInputRef={firstInputRef}
              />
            )}

            {loading && (
              <tr><td colSpan={COLS} style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            )}

            {!loading && visible.length === 0 && editingId !== 'new' && (
              <tr><td colSpan={COLS}>
                <div className="empty-state"><Fuel size={32} /><p>No diesel logs found — click "Log Diesel" to start</p></div>
              </td></tr>
            )}

            {!loading && visible.map(f => {
              const isEditing = editingId === f.id
              return isEditing ? (
                <EditRow
                  key={f.id}
                  form={editForm} set={set} rowTrucks={rowTrucks} suppliers={rowSuppliers}
                  entities={entities} multiEntity={multiEntity} isNew={false}
                  autoRate={autoRate} rateEdited={rateEdited} setRateEdited={setRateEdited}
                  preview={preview} saving={saving}
                  onSave={handleSave} onCancel={cancelEdit} onKeyDown={handleKeyDown}
                  firstInputRef={firstInputRef}
                />
              ) : (
                <tr key={f.id}
                  onClick={() => startEdit(f)}
                  style={{ cursor: editingId !== null ? 'default' : 'pointer' }}>
                  {multiEntity && (
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {entities.find(e => e.id === f.entity_id)?.code || '—'}
                    </td>
                  )}
                  <td style={{ fontSize: 12 }}>{formatDate(f.fillup_date)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{f.truck_registration || '—'}</td>
                  <td>
                    <div style={{ fontSize: 13 }}>{f.supplier_name}</div>
                  </td>
                  <td className="text-right" style={{ fontSize: 13 }}>{parseFloat(f.litres).toFixed(2)}</td>
                  <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>R {parseFloat(f.rate_per_litre).toFixed(2)}</td>
                  <td className="text-right">{formatCurrency(f.amount)}</td>
                  <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {parseFloat(f.admin_fee_amount) > 0 ? formatCurrency(f.admin_fee_amount) : '—'}
                  </td>
                  <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {parseFloat(f.admin_fee_amount) > 0
                      ? formatCurrency(parseFloat(f.admin_fee_amount) + parseFloat(f.admin_fee_vat || 0))
                      : '—'}
                  </td>
                  <td className="text-right" style={{
                    fontWeight: 700,
                    ...(f.verified2_by ? { background: 'rgba(253,224,71,0.55)' } : {}),
                  }}>{formatCurrency(f.total_amount)}</td>
                  <td>
                    <span style={{
                      padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                      background: f.diesel_type === 'topup' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
                      color: f.diesel_type === 'topup' ? '#d97706' : '#16a34a',
                    }}>
                      {f.diesel_type === 'topup' ? 'Top-up' : 'Fill-up'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{f.invoice_number || '—'}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{f.slip_number || '—'}</td>
                  <td>
                    <VerifyBadge item={f} onVerify={handleVerify} onFinalize={handleFinalize} currentUserId={user?.id} isAdmin={isAdmin} />
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button className="btn-icon btn-ghost" onClick={e => handleDelete(f, e)} title="Delete">
                      <Trash2 size={13} color="var(--danger)" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>

          {visible.length > 0 && summary && (
            <tfoot>
              <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
                <td colSpan={multiEntity ? 4 : 3} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>Totals:</td>
                <td className="text-right" style={{ padding: '10px 12px' }}>{parseFloat(summary.total_litres).toFixed(2)}</td>
                <td />
                <td className="text-right" style={{ padding: '10px 12px' }}>{formatCurrency(summary.total_amount)}</td>
                <td className="text-right" style={{ padding: '10px 12px' }}>{formatCurrency(summary.total_admin_fee)}</td>
                <td className="text-right" style={{ padding: '10px 12px' }}>
                  {formatCurrency((parseFloat(summary.total_admin_fee) + parseFloat(summary.total_admin_fee_vat || 0)))}
                </td>
                <td className="text-right" style={{ padding: '10px 12px' }}>{formatCurrency(summary.grand_total)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Diesel Log"
        description={deleteTarget ? `${parseFloat(deleteTarget.litres).toFixed(2)} L on ${formatDate(deleteTarget.fillup_date)}${deleteTarget.supplier_name ? ` — ${deleteTarget.supplier_name}` : ''}` : ''}
        onArchive={async () => {
          try { await archiveDieselFillUp(deleteTarget.id); toast.success('Entry archived'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
        onDelete={async () => {
          try { await deleteDieselFillUp(deleteTarget.id); toast.success('Entry deleted'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

// ── Inline edit row ────────────────────────────────────────────────────────────
function EditRow({ form, set, rowTrucks, suppliers, entities, multiEntity, isNew,
  autoRate, rateEdited, setRateEdited, preview, saving,
  onSave, onCancel, onKeyDown, firstInputRef }) {
  return (
    <tr style={{ background: 'var(--accent-subtle)', outline: '2px solid var(--accent)', outlineOffset: -1 }}
      onClick={e => e.stopPropagation()}>

      {multiEntity && (
        <td style={S.td}>
          <select value={form.entity_id} onChange={e => set('entity_id', e.target.value)} style={S.select}>
            <option value="">Entity…</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
          </select>
        </td>
      )}

      {/* Date */}
      <td style={S.td}>
        <DateInput ref={firstInputRef} value={form.fillup_date}
          onChange={e => set('fillup_date', e.target.value)} onKeyDown={onKeyDown}
          max={new Date().toISOString().slice(0, 10)} style={S.input} />
      </td>

      {/* Truck */}
      <td style={S.td}>
        <SearchableSelect
          value={String(form.truck_id)}
          onChange={v => set('truck_id', v)}
          options={rowTrucks}
          getValue={t => String(t.id)}
          getLabel={t => t.registration}
          placeholder="Truck…"
          style={{ minWidth: 110 }}
        />
      </td>

      {/* Supplier */}
      <td style={S.td}>
        <SearchableSelect
          value={String(form.supplier_id)}
          onChange={v => { set('supplier_id', v); setRateEdited(false) }}
          options={suppliers}
          getValue={s => String(s.id)}
          getLabel={s => s.name}
          placeholder="Supplier…"
          style={{ minWidth: 130 }}
        />
      </td>

      {/* Litres */}
      <td style={S.td}>
        <input type="number" step="0.01" min="0.01" placeholder="0.00" value={form.litres}
          onChange={e => set('litres', e.target.value)} onKeyDown={onKeyDown}
          style={{ ...S.input, width: 72, textAlign: 'right' }} />
      </td>

      {/* Rate/L */}
      <td style={S.td}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ height: 13, fontSize: 9, fontWeight: 700,
            color: rateEdited && autoRate ? '#d97706' : '#16a34a' }}>
            {autoRate && !rateEdited ? 'auto' : rateEdited && autoRate ? 'manual' : ''}
          </span>
          <input type="number" step="0.01" min="0.01" placeholder="0.00" value={form.rate_per_litre}
            onChange={e => { set('rate_per_litre', e.target.value); setRateEdited(true) }} onKeyDown={onKeyDown}
            style={{ ...S.input, width: 78, textAlign: 'right' }} />
        </div>
      </td>

      {/* Amount (calc) */}
      <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {preview.amount ? formatCurrency(preview.amount) : '—'}
      </td>

      {/* Admin fee excl (calc) */}
      <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {preview.fee && parseFloat(preview.fee) > 0 ? formatCurrency(preview.fee) : '—'}
      </td>

      {/* Admin fee incl VAT (calc) */}
      <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {preview.feeIncl && parseFloat(preview.feeIncl) > 0 ? formatCurrency(preview.feeIncl) : '—'}
      </td>

      {/* Total (calc) */}
      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', color: 'var(--accent)' }}>
        {preview.total ? formatCurrency(preview.total) : '—'}
      </td>

      {/* Type toggle */}
      <td style={S.td}>
        <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {[['fillup', 'Fill-up'], ['topup', 'Top-up']].map(([val, label]) => (
            <button key={val} type="button" onClick={() => set('diesel_type', val)}
              style={{
                padding: '3px 9px', fontSize: 11, border: 'none', cursor: 'pointer',
                background: form.diesel_type === val ? 'var(--accent)' : 'transparent',
                color: form.diesel_type === val ? '#fff' : 'var(--text-secondary)',
              }}>
              {label}
            </button>
          ))}
        </div>
      </td>

      {/* Invoice # */}
      <td style={S.td}>
        <input value={form.invoice_number} placeholder="Invoice #"
          onChange={e => set('invoice_number', e.target.value)} onKeyDown={onKeyDown}
          style={{ ...S.input, width: 90 }} />
      </td>

      {/* Slip # */}
      <td style={S.td}>
        <input value={form.slip_number} placeholder="Slip #"
          onChange={e => set('slip_number', e.target.value)} onKeyDown={onKeyDown}
          style={{ ...S.input, width: 80 }} />
      </td>

      {/* Verified — n/a while editing */}
      <td style={S.td} />

      {/* Actions */}
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

function SummaryCard({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={accent ? { color: 'var(--accent)' } : {}}>{value}</div>
    </div>
  )
}

const styles = {
  page: { padding: '28px 32px', flex: 1 },
}

const S = {
  td: { padding: '6px 8px', fontSize: 12, verticalAlign: 'bottom' },
  input: {
    padding: '4px 7px', fontSize: 12, borderRadius: 5,
    border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)', outline: 'none',
  },
  select: {
    padding: '4px 6px', fontSize: 12, borderRadius: 5,
    border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)',
  },
}