import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getSupplier, getEntities,
  getSupplierInvoices, createSupplierInvoice,
  updateSupplierInvoice, deleteSupplierInvoice, archiveSupplierInvoice, markStatementPaid,
  verifySupplierInvoice, getCurrentDieselRate, getTruckLoads, getFleetTrucks,
  addInvoiceLineItem, updateInvoiceLineItem, deleteInvoiceLineItem,
  getSubcontractors, getDieselFillUps,
  finalizeSupplierInvoice, bulkImportSupplierInvoices,
} from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, Save, X, CheckCircle, Fuel, Upload } from 'lucide-react'
import * as XLSX from 'xlsx'
import ExportButton from '../components/ExportButton'
import VerifyBadge from '../components/VerifyBadge'
import DeleteModal from '../components/DeleteModal'
import SearchableSelect from '../components/SearchableSelect'
import DateInput from '../components/DateInput'

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const today = new Date().toISOString().slice(0, 10)
const currentMonth = () => new Date().getMonth() + 1
const currentYear  = () => new Date().getFullYear()

const blankForm = (entityId, isDieselSupplier = false) => ({
  entity_id: entityId || '',
  invoice_date: today,
  invoice_number: '',
  amount: '',
  litres: '',
  _rate: '',
  vehicle_reg: '',
  description: '',
  vat_applicable: !isDieselSupplier,
  notes: '',
  is_multi_line: false,
  line_items: [],
  statement_month: currentMonth(),
  statement_year: currentYear(),
})

const blankLineItem = () => ({
  _key: Math.random(),
  item_code: '',
  item_description: '',
  unit: '',
  quantity: '',
  _rate: '',
  amount_excl_vat: '',
  amount_incl_vat: '',
  sort_order: 0,
})

// ── WBG Excel import helpers & modal ─────────────────────────────────────────

function visibleSheetNames(wb) {
  return wb.SheetNames.filter((name, i) => {
    const props = wb.Workbook?.Sheets?.[i]
    return !props || !props.Hidden
  })
}

function matchingSheets(sheetNames, entityName) {
  if (!entityName) return sheetNames
  const keyword = entityName.trim().split(/\s+/)[0].toLowerCase()
  const matches = sheetNames.filter(n => n.toLowerCase().includes(keyword))
  return matches.length > 0 ? matches : sheetNames
}

function parseWBGSheet(ws) {
  // raw: true (default) keeps numbers as numbers and dates as Dates via cellDates.
  // raw: false would stringify everything, breaking the typeof check below.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, cellDates: true })
  const invoices = []
  let pending = []
  for (const row of rows.slice(3)) {
    const [siteOrDate,,slip,rawReg,,colDriver,ltr,,txnVal] = row
    const invDate  = row[9]
    const invNo    = row[10]
    const invTotal = row[11]
    if (!siteOrDate && !invNo) continue
    if (invNo && typeof siteOrDate !== 'string') {
      invoices.push({
        invoice_date:   invDate instanceof Date ? invDate.toISOString() : invDate,
        invoice_number: String(invNo).trim(),
        amount:         parseFloat(invTotal) || 0,
        line_items:     pending,
      })
      pending = []
      continue
    }
    if (typeof siteOrDate === 'string' && slip) {
      // Col 3 may contain "REG — DRIVER" — split on any dash with surrounding spaces
      const rawRegStr = String(rawReg || '').trim()
      const parts = rawRegStr.split(/ [-–—] /)
      const cleanReg = parts[0].trim().toUpperCase()
      const driverFromReg = (parts[1] || '').trim()
      const cleanDriver = driverFromReg || String(colDriver || '').trim()

      const excl = parseFloat(txnVal) || 0
      pending.push({
        item_code:        String(slip).replace(/^INV/i, '').trim(),
        unit:             cleanReg,
        item_description: '',
        driver_name:      cleanDriver,
        quantity:         parseFloat(ltr) || 0,
        amount_excl_vat:  excl,
        amount_incl_vat:  excl,
        sort_order:       pending.length,
      })
    }
  }
  return invoices
}

const _modalOverlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const _modalBox = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
  padding: 24, width: 680, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
}
const _th = { padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const _td = { padding: '5px 10px', verticalAlign: 'middle' }

function lineStatus(li, trucks, entityId) {
  if (!li.item_code || !(li.quantity > 0)) return 'missing'
  const reg = (li.unit || '').toLowerCase()
  const found = (trucks || []).some(
    t => t.registration?.toLowerCase() === reg && t.entity_id === parseInt(entityId)
  )
  return found ? 'valid' : 'no_truck'
}

const _statusBadge = {
  valid:    { color: '#16a34a', label: '✓' },
  no_truck: { color: '#d97706', label: '! Truck not found' },
  missing:  { color: '#dc2626', label: '! Missing data' },
}

function WBGImportModal({ supplierId, supplier, entities, trucks, onClose, onImported }) {
  const [step, setStep]         = useState('idle')
  const [workbook, setWorkbook] = useState(null)
  const [entityId, setEntityId] = useState(supplier?.entity_id || '')
  const [sheetName, setSheetName] = useState('')
  const [invoices, setInvoices] = useState([])
  const [selectedNums, setSelectedNums] = useState(new Set())
  const [expanded, setExpanded] = useState({})
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileRef = useRef(null)

  const selectedEntity  = entities?.find(e => e.id === parseInt(entityId))
  const availableSheets = workbook
    ? matchingSheets(visibleSheetNames(workbook), selectedEntity?.name)
    : []

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: true })
      setWorkbook(wb)
      const visible = visibleSheetNames(wb)
      const sheets  = matchingSheets(visible, selectedEntity?.name)
      setSheetName(sheets[0] || visible[0] || '')
    }
    reader.readAsArrayBuffer(file)
  }

  function handleEntityChange(newEntityId) {
    setEntityId(newEntityId)
    if (workbook) {
      const entity  = entities?.find(e => e.id === parseInt(newEntityId))
      const visible = visibleSheetNames(workbook)
      const sheets  = matchingSheets(visible, entity?.name)
      setSheetName(sheets[0] || visible[0] || '')
    }
  }

  function handlePreview() {
    if (!workbook || !sheetName) return
    const ws = workbook.Sheets[sheetName]
    const parsed = parseWBGSheet(ws)
    setInvoices(parsed)
    setSelectedNums(new Set(parsed.map(inv => inv.invoice_number)))
    setExpanded({})
    setStep('preview')
  }

  async function handleImport() {
    setImporting(true)
    try {
      const r = await bulkImportSupplierInvoices({
        supplier_id: parseInt(supplierId),
        entity_id:   parseInt(entityId),
        invoices:    invoices.filter(inv => selectedNums.has(inv.invoice_number)),
      })
      setImportResult(r.data)
      setStep('results')
      onImported()
    } catch (e) {
      toast.error(errorMessage(e))
      setImporting(false)
    }
  }

  const totalLines = invoices.reduce((s, inv) => s + inv.line_items.length, 0)
  const allLineItems = invoices.flatMap(inv => inv.line_items)
  const statusCounts = allLineItems.reduce((acc, li) => {
    const s = lineStatus(li, trucks, entityId)
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  return (
    <div style={_modalOverlay} onClick={onClose}>
      <div style={_modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Import WBG Excel</h3>
          <button className="btn-ghost" onClick={onClose} style={{ padding: '2px 6px' }}><X size={14} /></button>
        </div>

        {step === 'idle' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>Entity</label>
              <select value={entityId} onChange={e => handleEntityChange(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}>
                <option value="">— select entity —</option>
                {(entities || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>Excel file (.xlsx)</label>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ fontSize: 13 }} />
            </div>
            {workbook && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>Sheet</label>
                <select value={sheetName} onChange={e => setSheetName(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}>
                  {availableSheets.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                {availableSheets.length < workbook.SheetNames.length && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                    Showing {availableSheets.length} of {workbook.SheetNames.length} sheets matching &ldquo;{selectedEntity?.name}&rdquo;
                  </p>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handlePreview} disabled={!workbook || !entityId}>
                Preview
              </button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                Sheet: <strong>{sheetName}</strong> — {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}, {totalLines} line items
              </p>
              <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                  onClick={() => setSelectedNums(new Set(invoices.map(inv => inv.invoice_number)))}>
                  Select All
                </button>
                <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                  onClick={() => setSelectedNums(new Set())}>
                  Deselect All
                </button>
              </div>
            </div>
            {(statusCounts.no_truck > 0 || statusCounts.missing > 0) && (
              <div style={{ marginBottom: 8, padding: '7px 12px', borderRadius: 4, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', fontSize: 12 }}>
                {statusCounts.no_truck > 0 && <span style={{ color: '#d97706', marginRight: 12 }}>⚠ {statusCounts.no_truck} truck registration{statusCounts.no_truck !== 1 ? 's' : ''} not found — fill-ups will be skipped</span>}
                {statusCounts.missing > 0 && <span style={{ color: '#dc2626' }}>✕ {statusCounts.missing} line{statusCounts.missing !== 1 ? 's' : ''} with missing data</span>}
              </div>
            )}
            <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)' }}>
                    <th style={{ ..._th, width: 28 }}></th>
                    <th style={_th}></th>
                    <th style={_th}>Invoice No</th>
                    <th style={_th}>Invoice Date</th>
                    <th style={{ ..._th, textAlign: 'right' }}>Total</th>
                    <th style={{ ..._th, textAlign: 'right' }}>Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, i) => {
                    const isSelected = selectedNums.has(inv.invoice_number)
                    return (
                      <Fragment key={i}>
                        <tr style={{ borderBottom: '1px solid var(--border)', opacity: isSelected ? 1 : 0.45 }}>
                          <td style={{ ..._td, width: 28 }}>
                            <input type="checkbox" checked={isSelected}
                              onChange={() => setSelectedNums(prev => {
                                const next = new Set(prev)
                                isSelected ? next.delete(inv.invoice_number) : next.add(inv.invoice_number)
                                return next
                              })} />
                          </td>
                          <td style={{ ..._td, width: 24, cursor: 'pointer' }}
                            onClick={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}>
                            {expanded[i] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </td>
                          <td style={_td}>{inv.invoice_number}</td>
                          <td style={_td}>{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-ZA') : '—'}</td>
                          <td style={{ ..._td, textAlign: 'right' }}>{inv.amount.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td>
                          <td style={{ ..._td, textAlign: 'right' }}>{inv.line_items.length}</td>
                        </tr>
                        {expanded[i] && inv.line_items.map((li, j) => {
                          const st = lineStatus(li, trucks, entityId)
                          const badge = _statusBadge[st]
                          return (
                            <tr key={j} style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', opacity: isSelected ? 1 : 0.45 }}>
                              <td style={_td}></td>
                              <td style={{ ..._td, width: 24 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: badge.color }} title={badge.label}>
                                  {st === 'valid' ? '✓' : '!'}
                                </span>
                              </td>
                              <td style={{ ..._td, color: 'var(--text-muted)', paddingLeft: 8 }}>{li.item_code}</td>
                              <td style={{ ..._td }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{li.unit}</span>
                                {li.driver_name && <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>{li.driver_name}</span>}
                                {st !== 'valid' && <span style={{ marginLeft: 8, fontSize: 10, color: badge.color, fontWeight: 600 }}>{badge.label}</span>}
                              </td>
                              <td style={{ ..._td, textAlign: 'right', color: 'var(--text-muted)' }}>{li.amount_excl_vat.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td>
                              <td style={{ ..._td, textAlign: 'right', color: 'var(--text-muted)' }}>{li.quantity}L</td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {selectedNums.size} of {invoices.length} selected
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ghost" onClick={() => setStep('idle')}>Back</button>
                <button className="btn-primary" onClick={handleImport} disabled={importing || selectedNums.size === 0}>
                  {importing ? 'Importing…' : `Import ${selectedNums.size} invoice${selectedNums.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'results' && importResult && (
          <>
            <div style={{ marginBottom: 16 }}>
              {importResult.created > 0 ? (
                <p style={{ margin: '0 0 8px', fontSize: 14, color: '#16a34a', fontWeight: 600 }}>
                  ✓ {importResult.created} invoice{importResult.created !== 1 ? 's' : ''} imported successfully
                </p>
              ) : (
                <p style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text-muted)' }}>
                  All invoices already exist — nothing new imported
                </p>
              )}
              {importResult.skipped > 0 && (
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-muted)' }}>
                  {importResult.skipped} invoice{importResult.skipped !== 1 ? 's' : ''} skipped (already exist)
                </p>
              )}
              <p style={{ margin: '8px 0 4px', fontSize: 13 }}>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>{importResult.fillups_created}</span> diesel fill-up record{importResult.fillups_created !== 1 ? 's' : ''} created
                {importResult.fillups_skipped > 0 && (
                  <span style={{ color: '#d97706', marginLeft: 10 }}>
                    ⚠ {importResult.fillups_skipped} skipped — truck not found or missing data
                  </span>
                )}
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PaymentTermBadge({ term }) {
  const is30 = term === '30_days'
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 4,
      fontSize: 12, fontWeight: 700,
      background: is30 ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
      color: is30 ? '#d97706' : '#16a34a',
    }}>
      {is30 ? '30 Days' : 'Current / Cash'}
    </span>
  )
}

export default function SupplierProfilePage() {
  const { supplierId } = useParams()
  const navigate = useNavigate()
  const { activeEntity, user, isAdmin } = useAuth()

  const [supplier, setSupplier] = useState(null)
  const [entities, setEntities] = useState([])
  const [trucks, setTrucks] = useState([])
  const [groups, setGroups] = useState([])
  const [truckLoadGroups, setTruckLoadGroups] = useState([])
  const [loadsCollapsed, setLoadsCollapsed] = useState({})
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState({})

  // Inline editing state
  const [editingId, setEditingId] = useState(null)   // invoice id being edited
  const [editForm, setEditForm] = useState({})
  const [showNew, setShowNew] = useState(false)       // new inline row visible
  const [newForm, setNewForm] = useState(blankForm(''))
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)  // invoice pending deletion
  const [openInvoiceIds, setOpenInvoiceIds] = useState(new Set())
  const firstInputRef = useRef(null)

  // Diesel rate auto-fill state (for diesel suppliers)
  const [dieselRate, setDieselRate] = useState(null)
  const [amountAutoFilled, setAmountAutoFilled] = useState(false)
  const [subbies, setSubbies] = useState([])
  const [dieselFillups, setDieselFillups] = useState([])
  const [sortCol, setSortCol] = useState('vehicle_reg')
  const [sortDir, setSortDir] = useState('asc')
  const [filterText, setFilterText] = useState('')

  const loadInvoices = useCallback(() =>
    getSupplierInvoices({ supplier_id: supplierId }).then(r => setGroups(r.data))
  , [supplierId])

  useEffect(() => {
    Promise.all([
      getSupplier(supplierId).then(r => {
        setSupplier(r.data)
        setNewForm(blankForm(r.data.entity_id, r.data.is_diesel_supplier))
      }),
      getEntities().then(r => setEntities(r.data)),
    ]).then(() => setLoading(false))
  }, [supplierId])

  useEffect(() => { if (!loading) loadInvoices() }, [loading, loadInvoices])

  // Fetch trucks for vehicle reg dropdown — filtered by active entity (or supplier's entity as fallback)
  useEffect(() => {
    if (!supplier) return
    const entityId = activeEntity?.id || supplier.entity_id
    getFleetTrucks({ entity_id: entityId, limit: 500 })
      .then(r => {
        const sorted = (r.data || []).sort((a, b) => {
          const fa = parseInt(a.fleet_number) || 9999
          const fb = parseInt(b.fleet_number) || 9999
          return fa - fb || a.registration.localeCompare(b.registration)
        })
        setTrucks(sorted)
      })
      .catch(() => {})
  }, [supplier, activeEntity])

  useEffect(() => {
    getTruckLoads({ supplier_id: supplierId, limit: 500 })
      .then(r => {
        const loads = r.data || []
        const byKey = {}
        loads.forEach(l => {
          const d = new Date(l.load_date)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          if (!byKey[key]) byKey[key] = { year: d.getFullYear(), month: d.getMonth() + 1, loads: [] }
          byKey[key].loads.push(l)
        })
        setTruckLoadGroups(
          Object.values(byKey).sort((a, b) => b.year - a.year || b.month - a.month)
        )
      })
      .catch(() => {})
  }, [supplierId])

  // Fetch subcontractors for diesel supplier's entity (used for Subbie Name dropdown)
  useEffect(() => {
    if (!supplier?.is_diesel_supplier || !supplier?.entity_id) { setSubbies([]); return }
    getSubcontractors({ entity_id: supplier.entity_id, limit: 500 })
      .then(r => setSubbies(r.data || []))
      .catch(() => setSubbies([]))
  }, [supplier?.id, supplier?.entity_id, supplier?.is_diesel_supplier])

  // Fetch diesel fill-ups for slip# dropdown in sub-lines (diesel suppliers only)
  useEffect(() => {
    if (!supplier?.is_diesel_supplier || !supplier?.entity_id) { setDieselFillups([]); return }
    getDieselFillUps({ entity_id: supplier.entity_id, limit: 1000 })
      .then(r => setDieselFillups((r.data || []).filter(f => f.slip_number)))
      .catch(() => setDieselFillups([]))
  }, [supplier?.id, supplier?.entity_id, supplier?.is_diesel_supplier])

  // Focus first input whenever new row appears or edit row opens
  useEffect(() => {
    if ((showNew || editingId) && firstInputRef.current)
      firstInputRef.current.focus()
  }, [showNew, editingId])

  // Fetch the diesel rate for this supplier's entity (always, not just when form is open)
  useEffect(() => {
    if (!supplier?.is_diesel_supplier || !supplier?.entity_id) {
      setDieselRate(null)
      return
    }
    const date = (showNew ? newForm.invoice_date : null) || today
    getCurrentDieselRate(supplier.id, { entity_id: supplier.entity_id, on_date: date })
      .then(r => {
        setDieselRate(r.data || null)
        if (r.data && showNew)
          setNewForm(f => ({ ...f, _rate: String(parseFloat(r.data.rate_per_litre)) }))
      })
      .catch(() => setDieselRate(null))
  }, [supplier?.id, supplier?.entity_id, supplier?.is_diesel_supplier, newForm.invoice_date, showNew])

  // Auto-fill amount when litres or rate change
  useEffect(() => {
    if (!showNew || !newForm.litres || !newForm._rate) return
    const litres = parseFloat(newForm.litres)
    const rate = parseFloat(newForm._rate)
    if (!litres || !rate) return
    if (newForm.amount && !amountAutoFilled) return
    setNewForm(f => ({ ...f, amount: (litres * rate).toFixed(2) }))
    setAmountAutoFilled(true)
  }, [newForm.litres, newForm._rate, showNew])

  const toggleCollapse      = (key) => setCollapsed(s => ({ ...s, [key]: !s[key] }))
  const toggleLoadsCollapse = (key) => setLoadsCollapsed(s => ({ ...s, [key]: !s[key] }))

  const startEdit = (inv) => {
    if (editingId !== null) return   // intentional exit required (Esc or X) before switching rows
    setShowNew(false)
    setEditingId(inv.id)
    setEditForm({
      entity_id: inv.entity_id,
      invoice_date: inv.invoice_date?.slice(0, 10) || today,
      invoice_number: inv.invoice_number || '',
      amount: String(inv.amount || ''),
      litres: inv.litres ? String(inv.litres) : '',
      _rate: inv.litres && inv.amount ? String(Math.round(parseFloat(inv.amount) / parseFloat(inv.litres) * 10000) / 10000) : '',
      vehicle_reg: inv.vehicle_reg || '',
      description: inv.description || '',
      vat_applicable: inv.vat_applicable !== false,
      notes: inv.notes || '',
      is_multi_line: inv.is_multi_line || false,
      line_items: inv.line_items ? inv.line_items.map(li => {
        const qty = parseFloat(li.quantity) || 0
        const excl = parseFloat(li.amount_excl_vat) || 0
        return { ...li, _key: li.id, _rate: qty > 0 ? String(Math.round(excl / qty * 10000) / 10000) : '' }
      }) : [],
      statement_month: inv.statement_month || currentMonth(),
      statement_year: inv.statement_year || currentYear(),
    })
    if (inv.is_multi_line) {
      setOpenInvoiceIds(s => { const n = new Set(s); n.add(inv.id); return n })
    }
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({}) }
  const cancelNew = () => { setShowNew(false); setNewForm(blankForm(supplier?.entity_id, supplier?.is_diesel_supplier)); setAmountAutoFilled(false) }

  const handleAddClick = () => {
    setEditingId(null)
    setNewForm(blankForm(supplier?.entity_id, supplier?.is_diesel_supplier))
    setAmountAutoFilled(false)
    setDieselRate(null)
    setShowNew(true)
  }

  const buildPayload = (form) => ({
    entity_id: parseInt(form.entity_id),
    invoice_date: new Date(form.invoice_date + 'T12:00:00').toISOString(),
    invoice_number: form.invoice_number.trim(),
    amount: form.is_multi_line ? 0 : parseFloat(form.amount),
    litres: form.litres ? parseFloat(form.litres) : null,
    vat_applicable: form.vat_applicable,
    vehicle_reg: form.vehicle_reg.trim() || null,
    description: form.description.trim() || null,
    notes: form.notes.trim() || null,
    is_multi_line: form.is_multi_line,
    statement_month: parseInt(form.statement_month),
    statement_year: parseInt(form.statement_year),
  })

  const buildLineItemPayload = (li, idx) => ({
    item_code: li.item_code?.trim() || null,
    item_description: li.item_description?.trim() || null,
    quantity: li.quantity !== '' && li.quantity != null ? parseFloat(li.quantity) : null,
    unit: li.unit?.trim() || null,
    amount_excl_vat: parseFloat(li.amount_excl_vat) || 0,
    amount_incl_vat: parseFloat(li.amount_incl_vat) || 0,
    sort_order: idx,
  })

  const validate = (form) => {
    if (!form.invoice_date) return 'Invoice date is required'
    if (!isDiesel && !form.invoice_number.trim()) return 'Invoice number is required'
    if (!form.is_multi_line && (form.amount === '' || isNaN(form.amount))) return 'Valid amount is required'
    return null
  }

  const saveNew = async () => {
    const err = validate(newForm)
    if (err) return toast.error(err)
    if (isDuplicateInvoiceNumber(newForm.invoice_number))
      return toast.error(`Invoice "${newForm.invoice_number}" already exists for this supplier`)
    setSaving(true)
    try {
      const r = await createSupplierInvoice({ ...buildPayload(newForm), supplier_id: parseInt(supplierId) })
      const newInvId = r.data.id
      if (newForm.is_multi_line && newForm.line_items.length > 0) {
        for (let i = 0; i < newForm.line_items.length; i++) {
          await addInvoiceLineItem(newInvId, buildLineItemPayload(newForm.line_items[i], i))
        }
      }
      const fillupCreated = r.data?.diesel_fillup_id
      if (fillupCreated && newForm.vehicle_reg) {
        toast.success(`Invoice added · Diesel log created for ${newForm.vehicle_reg.toUpperCase()}`)
      } else if (supplier?.is_diesel_supplier && newForm.litres && newForm.vehicle_reg && !fillupCreated) {
        toast.success('Invoice added · Truck not found — diesel log was not created')
      } else {
        toast.success('Invoice added')
      }
      setShowNew(false)
      setNewForm(blankForm(supplier?.entity_id))
      setAmountAutoFilled(false)
      await loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }

  const saveEdit = async () => {
    const err = validate(editForm)
    if (err) return toast.error(err)
    if (isDuplicateInvoiceNumber(editForm.invoice_number, editingId))
      return toast.error(`Invoice "${editForm.invoice_number}" already exists for this supplier`)
    setSaving(true)
    try {
      await updateSupplierInvoice(editingId, buildPayload(editForm))
      if (editForm.is_multi_line) {
        const origInv = groups.flatMap(g => g.invoices).find(i => i.id === editingId)
        const origItems = origInv?.line_items || []
        const editItems = editForm.line_items || []
        const editIds = new Set(editItems.filter(li => li.id).map(li => li.id))
        for (const li of origItems) {
          if (!editIds.has(li.id)) await deleteInvoiceLineItem(editingId, li.id)
        }
        for (let i = 0; i < editItems.length; i++) {
          const li = editItems[i]
          const payload = buildLineItemPayload(li, i)
          if (li.id) await updateInvoiceLineItem(editingId, li.id, payload)
          else await addInvoiceLineItem(editingId, payload)
        }
      }
      toast.success('Saved')
      setEditingId(null)
      await loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }

  const handleDelete = (inv) => setDeleteTarget(inv)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteSupplierInvoice(deleteTarget.id)
      toast.success('Invoice deleted')
      setDeleteTarget(null)
      loadInvoices()
    } catch (e) {
      toast.error(errorMessage(e))
      setDeleteTarget(null)
    }
  }

  const handleVerify = async (inv) => {
    try {
      await verifySupplierInvoice(inv.id)
      loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const handleFinalize = async (inv) => {
    try {
      await finalizeSupplierInvoice(inv.id)
      loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const handleMarkPaid = async (inv, e) => {
    e.stopPropagation()
    try {
      await updateSupplierInvoice(inv.id, {
        is_paid: !inv.is_paid,
        paid_date: inv.is_paid ? null : new Date().toISOString(),
      })
      loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const handleMarkAllPaid = async (group) => {
    if (!confirm(`Mark all invoices in ${MONTH_NAMES[group.statement_month]} ${group.statement_year} as paid?`)) return
    try {
      await markStatementPaid(supplierId, group.statement_year, group.statement_month)
      toast.success('Statement marked as paid')
      loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const handleKeyDown = (e, saveFn, cancelFn) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveFn() }
    if (e.key === 'Escape') cancelFn()
  }

  const toggleInvoiceExpand = (id) => setOpenInvoiceIds(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const allInvoices = groups.flatMap(g => g.invoices)
  const multiEntity = entities.length > 1
  // Suppliers with requires_registration=false (e.g. Axxess) don't use vehicle regs on invoices
  const showVehicleReg = supplier?.requires_registration !== false
  const isDiesel = supplier?.is_diesel_supplier === true

  const isDuplicateInvoiceNumber = (invoiceNumber, excludeId = null) =>
    allInvoices.some(inv =>
      (inv.invoice_number || '').trim().toLowerCase() === invoiceNumber.trim().toLowerCase() &&
      inv.id !== excludeId
    )

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const sortArrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const processInvoices = (invoices) => {
    let result = invoices
    if (filterText.trim()) {
      const q = filterText.toLowerCase()
      result = result.filter(inv =>
        (inv.invoice_number || '').toLowerCase().includes(q) ||
        (inv.vehicle_reg || '').toLowerCase().includes(q) ||
        (inv.description || '').toLowerCase().includes(q) ||
        (inv.notes || '').toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => {
      let av, bv
      switch (sortCol) {
        case 'invoice_date':   av = a.invoice_date || '';   bv = b.invoice_date || '';   break
        case 'invoice_number': av = a.invoice_number || ''; bv = b.invoice_number || ''; break
        case 'vehicle_reg':    av = (a.vehicle_reg || '').toUpperCase(); bv = (b.vehicle_reg || '').toUpperCase(); break
        case 'slip_number':    av = (a.slip_number || '').toLowerCase(); bv = (b.slip_number || '').toLowerCase(); break
        case 'amount':         av = parseFloat(a.amount) || 0; bv = parseFloat(b.amount) || 0; break
        case 'litres':         av = parseFloat(a.litres) || 0; bv = parseFloat(b.litres) || 0; break
        default:               av = ''; bv = ''
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  if (loading) return <div style={styles.page}><div className="loading-center"><div className="spinner" /></div></div>
  if (!supplier) return <div style={styles.page}><p style={{ color: 'var(--text-muted)' }}>Supplier not found.</p></div>

  return (
    <div style={styles.page}>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn-ghost btn-icon" onClick={() => navigate('/suppliers')}><ArrowLeft size={16} /></button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 className="page-title" style={{ margin: 0 }}>{supplier.name}</h1>
              <PaymentTermBadge term={supplier.payment_term} />
            </div>
            <p className="page-subtitle" style={{ marginTop: 2 }}>
              {supplier.trading_name || supplier.contact_person || 'Supplier profile'}
            </p>
            {isDiesel && dieselRate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                <Fuel size={12} color="var(--accent)" />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Current rate:&nbsp;
                  <strong style={{ color: 'var(--text)', fontFamily: 'monospace' }}>
                    R {parseFloat(dieselRate.rate_per_litre).toFixed(4)}/L
                  </strong>
                  {dieselRate.effective_date && (
                    <span style={{ marginLeft: 6, fontSize: 11 }}>
                      (eff. {formatDate(dieselRate.effective_date)})
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ExportButton
            title={`${supplier.name} — Invoices`}
            filename={`invoices-${supplier.name.replace(/\s+/g, '-').toLowerCase()}`}
            data={allInvoices}
            columns={[
              { header: 'Invoice Date',    value: r => formatDate(r.invoice_date) },
              { header: 'Invoice #',       key: 'invoice_number' },
              ...(showVehicleReg ? [{ header: 'Vehicle Reg', key: 'vehicle_reg' }] : []),
              { header: 'Description',     key: 'description' },
              { header: 'Amount',          value: r => parseFloat(r.amount).toFixed(2) },
              { header: 'VAT',             value: r => r.vat_applicable ? 'Yes' : 'No' },
              { header: 'Statement Month', value: r => `${MONTH_NAMES[r.statement_month]} ${r.statement_year}` },
              { header: 'Due Date',        value: r => formatDate(r.payment_due_date) },
              { header: 'Verified',        value: r => r.is_verified ? 'Yes' : '' },
              { header: 'Paid',            value: r => r.is_paid ? 'Yes' : '' },
              { header: 'Paid Date',       value: r => formatDate(r.paid_date) },
              { header: 'Payment Ref',     key: 'payment_reference' },
              { header: 'Notes',           key: 'notes' },
            ]}
          />
          {isDiesel && supplier?.name?.toLowerCase().includes('wbg') && (
            <button className="btn-ghost" onClick={() => setShowImport(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Upload size={15} /> Import Excel
            </button>
          )}
          <button className="btn-primary" onClick={handleAddClick} disabled={showNew}>
            <Plus size={15} /> Add Invoice
          </button>
        </div>
      </div>

      {/* Supplier info */}
      <div style={styles.infoCard}>
        {supplier.contact_person && <span><strong>Contact:</strong> {supplier.contact_person}</span>}
        {supplier.email && <span><strong>Email:</strong> {supplier.email}</span>}
        {supplier.phone && <span><strong>Phone:</strong> {supplier.phone}</span>}
        {supplier.vat_number && <span><strong>VAT No:</strong> {supplier.vat_number}</span>}
        {supplier.registration_number && <span><strong>Reg:</strong> {supplier.registration_number}</span>}
      </div>

      {/* Truck loads section — shows loads where this supplier was selected */}
      {truckLoadGroups.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 8 }}>
            Truck Loads
          </div>
          {truckLoadGroups.map(group => {
            const key     = `loads-${group.year}-${group.month}`
            const isOpen  = !loadsCollapsed[key]
            const totalTonnes = group.loads.reduce((s, l) => s + parseFloat(l?.tonnes || 0), 0)
            const totalAmt    = group.loads.reduce((s, l) => s + parseFloat(l?.amount_excl_vat || 0), 0)
            return (
              <div key={key} style={{ ...styles.group, marginBottom: 10 }}>
                <div style={styles.groupHeader} onClick={() => toggleLoadsCollapse(key)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{MONTH_NAMES[group.month]} {group.year}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {group.loads.length} load{group.loads.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalTonnes.toFixed(3)} t</span>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{formatCurrency(totalAmt)}</span>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-surface)' }}>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Slip #</th>
                          <th style={styles.th}>Truck Reg</th>
                          <th style={styles.th}>Driver</th>
                          <th style={styles.th}>Mine</th>
                          <th style={{ ...styles.th, textAlign: 'right' }}>Tonnes</th>
                          <th style={{ ...styles.th, textAlign: 'right' }}>Excl VAT</th>
                          <th style={{ ...styles.th, textAlign: 'center' }}>Paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.loads.map(load => (
                          <tr key={load.id} style={{ borderBottom: '1px solid var(--border)', opacity: load.is_paid ? 0.65 : 1 }}>
                            <td style={styles.td}>{formatDate(load.load_date)}</td>
                            <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11 }}>{load.slip_number || '—'}</td>
                            <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>{load.truck_registration || '—'}</td>
                            <td style={styles.td}>{load.driver_name || '—'}</td>
                            <td style={styles.td}>{load.mine_name || '—'}</td>
                            <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{parseFloat(load.tonnes).toFixed(3)}</td>
                            <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{formatCurrency(load.amount_excl_vat)}</td>
                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              {load.is_paid
                                ? <span style={{ color: '#16a34a', fontSize: 13 }}>✓</span>
                                : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
                          <td colSpan={5} style={{ ...styles.td, fontWeight: 700, textAlign: 'right' }}>Total:</td>
                          <td style={{ ...styles.td, fontWeight: 700, textAlign: 'right', fontFamily: 'monospace' }}>{totalTonnes.toFixed(3)} t</td>
                          <td style={{ ...styles.td, fontWeight: 700, textAlign: 'right' }}>{formatCurrency(totalAmt)}</td>
                          <td style={styles.td} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {groups.length === 0 && !showNew && (
        <div style={{ ...styles.group, padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>No invoices yet — click "Add Invoice" to start</p>
        </div>
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Supplier Invoice"
        description={deleteTarget ? `Invoice ${deleteTarget.invoice_number || '(no number)'}${deleteTarget.amount ? ` — ${formatCurrency(deleteTarget.amount)}` : ''}` : ''}
        onArchive={async () => {
          try { await archiveSupplierInvoice(deleteTarget.id); toast.success('Invoice archived'); setDeleteTarget(null); loadInvoices() }
          catch (e) { toast.error(errorMessage(e)) }
        }}
        onDelete={async () => {
          try { await deleteSupplierInvoice(deleteTarget.id); toast.success('Invoice deleted'); setDeleteTarget(null); loadInvoices() }
          catch (e) { toast.error(errorMessage(e)) }
        }}
      />

      {showImport && (
        <WBGImportModal
          supplierId={supplierId}
          supplier={supplier}
          entities={entities}
          trucks={trucks}
          onClose={() => setShowImport(false)}
          onImported={() => { loadInvoices() }}
        />
      )}

      {/* ── New invoice card ── */}
      {showNew && (
        <NewInvoiceCard
          form={newForm} setForm={setNewForm} saving={saving}
          onSave={saveNew} onCancel={cancelNew}
          entities={entities} multiEntity={multiEntity}
          firstInputRef={firstInputRef}
          onKeyDown={handleKeyDown}
          showVehicleReg={showVehicleReg}
          isDiesel={isDiesel}
          dieselRate={dieselRate}
          amountAutoFilled={amountAutoFilled}
          onAmountEdit={() => setAmountAutoFilled(false)}
          trucks={trucks}
          subbies={subbies}
          fillups={dieselFillups}
        />
      )}

      {/* ── Filter bar ── */}
      {groups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            placeholder={`Filter by invoice #, vehicle reg, ${isDiesel ? 'subbie name' : 'description'}, notes…`}
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            style={{
              flex: 1, maxWidth: 400, padding: '5px 10px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-input, var(--bg-card))',
              color: 'var(--text)', fontSize: 13,
            }}
          />
          {filterText && (
            <button onClick={() => setFilterText('')} className="btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }}>
              Clear
            </button>
          )}
        </div>
      )}

      {groups.map((group, groupIndex) => {
        const key = `${group.statement_year}-${group.statement_month}`
        const isOpen = !collapsed[key]
        const unpaidCount = group.invoices.filter(i => !i.is_paid).length

        return (
          <div key={key} style={{
            ...styles.group,
            borderColor: group.is_fully_paid ? 'var(--border)' : unpaidCount > 0 ? '#d97706' : 'var(--border)',
          }}>
            {/* Group header */}
            <div style={styles.groupHeader} onClick={() => toggleCollapse(key)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  {MONTH_NAMES[group.statement_month]} {group.statement_year}
                </span>
                {group.is_fully_paid
                  ? <span style={styles.paidBadge}>PAID</span>
                  : unpaidCount > 0 && <span style={styles.unpaidBadge}>{unpaidCount} unpaid</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {group.invoices.length} invoice{group.invoices.length !== 1 ? 's' : ''}
                </span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{formatCurrency(group.subtotal)}</span>
                {group.payment_due_date && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Due: {formatDate(group.payment_due_date)}
                  </span>
                )}
                {!group.is_fully_paid && (
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={e => { e.stopPropagation(); handleMarkAllPaid(group) }}
                  >
                    Mark All Paid
                  </button>
                )}
              </div>
            </div>

            {/* Invoice table */}
            {isOpen && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface)' }}>
                      {multiEntity && <th style={styles.th}>Entity</th>}
                      <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('invoice_date')}>
                        Date{sortArrow('invoice_date')}
                      </th>
                      <th style={styles.th}>Period</th>
                      <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('invoice_number')}>
                        Invoice #{sortArrow('invoice_number')}
                      </th>
                      {isDiesel && (
                        <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('slip_number')}>
                          Slip #{sortArrow('slip_number')}
                        </th>
                      )}
                      {showVehicleReg && (
                        <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('vehicle_reg')}>
                          Vehicle Reg{sortArrow('vehicle_reg')}
                        </th>
                      )}
                      <th style={styles.th}>{isDiesel ? 'Subbie Name' : 'Description'}</th>
                      <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('amount')}>
                        Amount{sortArrow('amount')}
                      </th>
                      {isDiesel && (
                        <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('litres')}>
                          Litres{sortArrow('litres')}
                        </th>
                      )}
                      {isDiesel && <th style={{ ...styles.th, textAlign: 'right' }}>Rate/L</th>}
                      <th style={{ ...styles.th, textAlign: 'center' }}>VAT</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Verified</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Paid</th>
                      <th style={styles.th}>Notes</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {processInvoices(group.invoices).map(inv => {
                      const isEditing = editingId === inv.id
                      const f = editForm
                      const isExpanded = openInvoiceIds.has(inv.id)
                      const totalCols = 10 + (multiEntity ? 1 : 0) + (showVehicleReg ? 1 : 0) + (isDiesel ? 3 : 0)

                      return (
                        <Fragment key={inv.id}>
                          <tr
                            onClick={() => !isEditing && startEdit(inv)}
                            style={{
                              borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                              background: isEditing ? 'var(--accent-subtle)' : 'transparent',
                              opacity: inv.is_paid && !isEditing ? 0.6 : 1,
                              cursor: isEditing ? 'default' : 'pointer',
                              transition: 'background 0.1s',
                            }}
                          >
                            {/* Entity cell */}
                            {multiEntity && (
                              <td style={styles.td}>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                                  {entities.find(e => e.id === inv.entity_id)?.code || '—'}
                                </span>
                              </td>
                            )}

                            {/* Date */}
                            <td style={styles.td}>
                              {isEditing ? (
                                <DateInput
                                  ref={firstInputRef} value={f.invoice_date}
                                  onChange={e => setEditForm(p => ({ ...p, invoice_date: e.target.value }))}
                                  onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                  onClick={e => e.stopPropagation()}
                                  inputStyle={styles.cellInput}
                                />
                              ) : formatDate(inv.invoice_date)}
                            </td>

                            {/* Period */}
                            <td style={styles.td}>
                              {isEditing ? (
                                <div style={{ display: 'flex', gap: 3 }} onClick={e => e.stopPropagation()}>
                                  <select
                                    value={f.statement_month}
                                    onChange={e => setEditForm(p => ({ ...p, statement_month: parseInt(e.target.value) }))}
                                    style={{ ...styles.cellInput, width: 72, padding: '2px 2px' }}
                                  >
                                    {MONTH_NAMES.slice(1).map((m, i) => (
                                      <option key={i + 1} value={i + 1}>{m.slice(0, 3)}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="number" min="2020" max="2099"
                                    value={f.statement_year}
                                    onChange={e => setEditForm(p => ({ ...p, statement_year: parseInt(e.target.value) }))}
                                    style={{ ...styles.cellInput, width: 52 }}
                                  />
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {MONTH_NAMES[inv.statement_month]?.slice(0, 3)} {inv.statement_year}
                                </span>
                              )}
                            </td>

                            {/* Invoice # */}
                            <td style={{ ...styles.td, fontWeight: isEditing ? 400 : 600 }}>
                              {isEditing ? (
                                <input
                                  value={f.invoice_number}
                                  onChange={e => setEditForm(p => ({ ...p, invoice_number: e.target.value }))}
                                  onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                  onClick={e => e.stopPropagation()}
                                  placeholder={isDiesel ? 'e.g. WBG-001' : ''}
                                  style={{ ...styles.cellInput, minWidth: 90 }}
                                />
                              ) : inv.invoice_number ? inv.invoice_number : (
                                isDiesel
                                  ? <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: 'rgba(245,158,11,0.12)', padding: '2px 6px', borderRadius: 3 }}>Pending</span>
                                  : '—'
                              )}
                            </td>

                            {/* Slip # — diesel only, read-only from linked DieselFillUp */}
                            {isDiesel && (
                              <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11 }}>
                                {inv.slip_number ? (
                                  <span>{inv.slip_number}</span>
                                ) : (
                                  <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 10 }}>⚠ missing</span>
                                )}
                              </td>
                            )}

                            {/* Vehicle Reg */}
                            {showVehicleReg && (
                              <td style={styles.td}>
                                {isEditing ? (
                                  <div onClick={e => e.stopPropagation()}>
                                    <SearchableSelect
                                      value={f.vehicle_reg}
                                      onChange={v => setEditForm(p => ({ ...p, vehicle_reg: v }))}
                                      options={[{ id: '', registration: '', fleet_number: null }, ...trucks]}
                                      getValue={t => t.registration}
                                      getLabel={t => t.registration === '' ? '— Select —' : t.fleet_number ? `#${t.fleet_number} · ${t.registration}` : t.registration}
                                      placeholder="Vehicle reg…"
                                      style={{ width: 150 }}
                                    />
                                  </div>
                                ) : (
                                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                    {inv.vehicle_reg || '—'}
                                  </span>
                                )}
                              </td>
                            )}

                            {/* Description / Subbie Name */}
                            <td style={{ ...styles.td, maxWidth: 200 }}>
                              {isEditing ? (
                                isDiesel && subbies.length > 0 ? (
                                  <div onClick={e => e.stopPropagation()}>
                                    <SearchableSelect
                                      value={f.description}
                                      onChange={v => setEditForm(p => ({ ...p, description: v }))}
                                      options={[{ id: '', name: '' }, ...subbies]}
                                      getValue={s => s.name}
                                      getLabel={s => s.name || '— None —'}
                                      placeholder="Subbie name…"
                                      style={{ width: 160 }}
                                    />
                                  </div>
                                ) : (
                                  <input
                                    value={f.description}
                                    onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                                    onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                    onClick={e => e.stopPropagation()}
                                    style={{ ...styles.cellInput, minWidth: 140 }}
                                    placeholder={isDiesel ? 'Subbie name…' : 'Description'}
                                  />
                                )
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }} title={inv.description}>
                                  {inv.description
                                    ? inv.description.length > 40 ? inv.description.slice(0, 40) + '…' : inv.description
                                    : '—'}
                                </span>
                              )}
                            </td>

                            {/* Amount */}
                            <td style={{
                              ...styles.td, fontWeight: 600,
                              ...(inv.verified2_by ? { background: 'rgba(253,224,71,0.55)' } : {}),
                            }}>
                              {isEditing && !f.is_multi_line ? (
                                <input
                                  type="number" step="0.01"
                                  value={f.amount}
                                  onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))}
                                  onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                  onClick={e => e.stopPropagation()}
                                  style={{ ...styles.cellInput, width: 90, textAlign: 'right' }}
                                />
                              ) : (
                                <>
                                  {formatCurrency(inv.amount)}
                                  {inv.is_multi_line && !isEditing && (
                                    <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>ML</span>
                                  )}
                                </>
                              )}
                            </td>

                            {/* Litres — diesel suppliers only */}
                            {isDiesel && (
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                {isEditing ? (
                                  <input
                                    type="number" step="0.001" min="0" placeholder="0.000"
                                    value={f.litres || ''}
                                    onChange={e => {
                                      const litres = e.target.value
                                      setEditForm(p => {
                                        const rate = parseFloat(p._rate) || 0
                                        const l = parseFloat(litres) || 0
                                        return { ...p, litres, ...(rate && l ? { amount: (l * rate).toFixed(2) } : {}) }
                                      })
                                    }}
                                    onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                    onClick={e => e.stopPropagation()}
                                    style={{ ...styles.cellInput, width: 80, textAlign: 'right' }}
                                  />
                                ) : inv.litres ? (
                                  <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                    {inv.diesel_fillup_id && <Fuel size={11} color="#16a34a" title="Diesel log created" />}
                                    {parseFloat(inv.litres).toFixed(1)}L
                                  </span>
                                ) : (
                                  inv.diesel_fillup_id
                                    ? <Fuel size={12} color="#16a34a" title="Linked to diesel log" />
                                    : <span style={{ color: 'var(--text-muted)' }}>—</span>
                                )}
                              </td>
                            )}

                            {/* Rate/L — diesel suppliers only */}
                            {isDiesel && (
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                {isEditing ? (
                                  <input
                                    type="number" step="0.0001" min="0" placeholder="0.0000"
                                    value={f._rate || ''}
                                    onChange={e => {
                                      const rate = e.target.value
                                      setEditForm(p => {
                                        const l = parseFloat(p.litres) || 0
                                        const r = parseFloat(rate) || 0
                                        return { ...p, _rate: rate, ...(l && r ? { amount: (l * r).toFixed(2) } : {}) }
                                      })
                                    }}
                                    onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                    onClick={e => e.stopPropagation()}
                                    style={{ ...styles.cellInput, width: 80, textAlign: 'right' }}
                                  />
                                ) : inv.litres && inv.amount ? (
                                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                    {(parseFloat(inv.amount) / parseFloat(inv.litres)).toFixed(4)}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                                )}
                              </td>
                            )}

                            {/* VAT */}
                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              {isEditing ? (
                                <input
                                  type="checkbox" checked={f.vat_applicable}
                                  onChange={e => setEditForm(p => ({ ...p, vat_applicable: e.target.checked }))}
                                  onClick={e => e.stopPropagation()}
                                  style={{ cursor: 'pointer' }}
                                />
                              ) : (
                                inv.vat_applicable
                                  ? <span style={{ color: '#16a34a', fontSize: 15, fontWeight: 700 }}>✓</span>
                                  : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                              )}
                            </td>

                            {/* Verified */}
                            <td style={styles.td}>
                              <VerifyBadge item={inv} onVerify={handleVerify} onFinalize={handleFinalize} currentUserId={user?.id} isAdmin={isAdmin} />
                            </td>

                            {/* Paid */}
                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              <button
                                onClick={e => handleMarkPaid(inv, e)}
                                title={inv.is_paid ? `Paid${inv.paid_date ? ' ' + formatDate(inv.paid_date) : ''}` : 'Mark paid'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: inv.is_paid ? '#16a34a' : 'var(--border)' }}
                              >
                                <CheckCircle size={16} />
                              </button>
                            </td>

                            {/* Notes */}
                            <td style={{ ...styles.td, maxWidth: 180 }}>
                              {isEditing ? (
                                <input
                                  value={f.notes}
                                  onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                                  onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                  onClick={e => e.stopPropagation()}
                                  style={{ ...styles.cellInput, minWidth: 120 }}
                                  placeholder="Notes"
                                />
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }} title={inv.notes}>
                                  {inv.notes
                                    ? inv.notes.length > 30 ? inv.notes.slice(0, 30) + '…' : inv.notes
                                    : '—'}
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td style={{ ...styles.td, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                              {isEditing ? (
                                <>
                                  <button onClick={saveEdit} disabled={saving} className="btn btn-icon btn-primary" style={{ marginRight: 4 }} title="Save (Enter)">
                                    <Save size={14} />
                                  </button>
                                  <button onClick={cancelEdit} className="btn btn-icon btn-ghost" title="Cancel (Esc)">
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  {inv.is_multi_line && (
                                    <button
                                      className="btn-icon btn-ghost"
                                      onClick={e => { e.stopPropagation(); toggleInvoiceExpand(inv.id) }}
                                      title={isExpanded ? 'Collapse lines' : 'Expand lines'}
                                    >
                                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </button>
                                  )}
                                  <button
                                    className="btn-icon btn-ghost"
                                    onClick={() => handleDelete(inv)}
                                    title="Delete"
                                  >
                                    <Trash2 size={13} color="var(--danger)" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>

                          {/* Expanded line items row */}
                          {inv.is_multi_line && isExpanded && (
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <td colSpan={totalCols} style={{ padding: '0 0 12px 0', background: 'var(--bg-base)' }}>
                                {isEditing ? (
                                  isDiesel
                                    ? <DieselLineItemsEditor
                                        items={editForm.line_items || []}
                                        onChange={items => setEditForm(p => ({ ...p, line_items: items }))}
                                        vatApplicable={editForm.vat_applicable !== false}
                                        subbies={subbies}
                                        trucks={trucks}
                                        fillups={dieselFillups}
                                      />
                                    : <LineItemsEditor
                                        items={editForm.line_items || []}
                                        onChange={items => setEditForm(p => ({ ...p, line_items: items }))}
                                        vatApplicable={editForm.vat_applicable !== false}
                                      />
                                ) : (
                                  isDiesel
                                    ? <DieselLineItemsViewer items={inv.line_items || []} total={inv.amount} />
                                    : <LineItemsViewer items={inv.line_items || []} total={inv.amount} />
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
                      <td
                        colSpan={3 + (multiEntity ? 1 : 0) + (showVehicleReg ? 1 : 0)}
                        style={{ ...styles.td, fontWeight: 700, textAlign: 'right' }}
                      >
                        Statement Total:
                      </td>
                      <td style={{ ...styles.td, fontWeight: 700 }}>{formatCurrency(group.subtotal)}</td>
                      <td colSpan={5 + (isDiesel ? 2 : 0)} style={styles.td} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


const CS = {
  field: (minWidth = 140) => ({ display: 'flex', flexDirection: 'column', minWidth, flex: '1 1 auto' }),
  label: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5,
  },
  input: {
    padding: '6px 10px', fontSize: 13,
    background: 'var(--bg-input, var(--bg-card))',
    border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text-primary)', width: '100%',
    outline: 'none', boxSizing: 'border-box',
  },
}


function NewInvoiceCard({ form, setForm, saving, onSave, onCancel, entities, multiEntity, firstInputRef, onKeyDown, showVehicleReg, isDiesel, dieselRate, amountAutoFilled, onAmountEdit, trucks = [], subbies = [], fillups = [] }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const entityCode = entities.find(e => String(e.id) === String(form.entity_id))?.code || '—'
  const lineTotal = (form.line_items || []).reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--accent)',
      borderRadius: 12,
      padding: '18px 22px',
      marginBottom: 20,
      boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>New Invoice</span>
          {multiEntity && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 4, fontWeight: 600, border: '1px solid var(--border)' }}>
              {entityCode}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {['single', 'multi'].map(v => (
              <button key={v}
                onClick={() => setForm(f => ({ ...f, is_multi_line: v === 'multi', line_items: [] }))}
                style={{
                  padding: '5px 12px', border: 'none',
                  borderRight: v === 'single' ? '1px solid var(--border)' : 'none',
                  background: (form.is_multi_line ? v === 'multi' : v === 'single') ? 'var(--accent)' : 'var(--bg-card)',
                  color: (form.is_multi_line ? v === 'multi' : v === 'single') ? '#fff' : 'var(--text)',
                  fontWeight: 600, fontSize: 11, cursor: 'pointer',
                }}>
                {v === 'single' ? 'Single' : 'Multi-line'}
              </button>
            ))}
          </div>
          <button onClick={onSave} disabled={saving} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Save size={13} /> Save
          </button>
          <button onClick={onCancel} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <X size={13} /> Cancel
          </button>
        </div>
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 16px', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 120 }}>
          <label style={CS.label}>Date</label>
          <DateInput ref={firstInputRef} value={form.invoice_date}
            onChange={e => set('invoice_date', e.target.value)}
            onKeyDown={e => onKeyDown(e, onSave, onCancel)}
            inputStyle={CS.input} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={CS.label}>Statement Period</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={form.statement_month} onChange={e => set('statement_month', parseInt(e.target.value))}
              style={{ ...CS.input, width: 118, flex: 'none' }}>
              {MONTH_NAMES.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
            <input type="number" min="2020" max="2099" value={form.statement_year}
              onChange={e => set('statement_year', parseInt(e.target.value))}
              onKeyDown={e => onKeyDown(e, onSave, onCancel)}
              style={{ ...CS.input, width: 68, flex: 'none' }} />
          </div>
        </div>

        <div style={CS.field(140)}>
          <label style={CS.label}>Invoice #</label>
          <input value={form.invoice_number} placeholder={isDiesel ? 'Fill in when received' : 'e.g. TM1794'}
            onChange={e => set('invoice_number', e.target.value)}
            onKeyDown={e => onKeyDown(e, onSave, onCancel)}
            style={CS.input} />
        </div>

        {showVehicleReg && !isDiesel && (
          <div style={CS.field(170)}>
            <label style={CS.label}>Vehicle Reg</label>
            <SearchableSelect
              value={form.vehicle_reg}
              onChange={v => set('vehicle_reg', v)}
              options={[{ id: '', registration: '', fleet_number: null }, ...trucks]}
              getValue={t => t.registration}
              getLabel={t => t.registration === '' ? '— Select —' : t.fleet_number ? `#${t.fleet_number} · ${t.registration}` : t.registration}
              placeholder="Vehicle reg…"
              style={{ width: '100%', padding: '6px 10px', fontSize: 13 }}
            />
          </div>
        )}

        {!isDiesel && (
          <div style={CS.field(110)}>
            <label style={CS.label}>Litres</label>
            <input type="number" step="0.001" min="0" placeholder="0.000"
              value={form.litres}
              onChange={e => set('litres', e.target.value)}
              onKeyDown={e => onKeyDown(e, onSave, onCancel)}
              style={{ ...CS.input, textAlign: 'right' }} />
          </div>
        )}

        {!isDiesel && (
          <div style={CS.field(130)}>
            <label style={CS.label}>
              Rate/L
              {dieselRate && (
                <span style={{ fontWeight: 400, color: 'var(--accent)', marginLeft: 5, fontSize: 10 }}>
                  (R{parseFloat(dieselRate.rate_per_litre).toFixed(4)})
                </span>
              )}
            </label>
            <input type="number" step="0.0001" min="0" placeholder="0.0000"
              value={form._rate || ''}
              onChange={e => { set('_rate', e.target.value); onAmountEdit?.() }}
              onKeyDown={e => onKeyDown(e, onSave, onCancel)}
              style={{ ...CS.input, textAlign: 'right' }} />
          </div>
        )}

        <div style={CS.field(120)}>
          <label style={CS.label}>
            Amount
            {amountAutoFilled && <span style={{ marginLeft: 5, color: '#16a34a', fontWeight: 700, fontSize: 10 }}>AUTO</span>}
          </label>
          {form.is_multi_line ? (
            <div style={{ padding: '6px 10px', fontWeight: 700, fontSize: 14, background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
              {lineTotal > 0 ? `R ${lineTotal.toFixed(2)}` : '—'}
            </div>
          ) : (
            <input type="number" step="0.01" placeholder="0.00"
              value={form.amount}
              onChange={e => { set('amount', e.target.value); onAmountEdit?.() }}
              onKeyDown={e => onKeyDown(e, onSave, onCancel)}
              style={{ ...CS.input, textAlign: 'right' }} />
          )}
        </div>

        <div style={{ ...CS.field(110), flex: 'none' }}>
          <label style={CS.label}>VAT</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 7 }}>
            <input type="checkbox" checked={form.vat_applicable}
              onChange={e => set('vat_applicable', e.target.checked)}
              style={{ cursor: 'pointer', width: 15, height: 15 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Applicable</span>
          </div>
        </div>

        <div style={CS.field(170)}>
          <label style={CS.label}>{isDiesel ? 'Subbie Name' : 'Description'}</label>
          {isDiesel && subbies.length > 0 ? (
            <SearchableSelect
              value={form.description}
              onChange={v => set('description', v)}
              options={[{ id: '', name: '' }, ...subbies]}
              getValue={s => s.name}
              getLabel={s => s.name || '— None —'}
              placeholder="Subbie name…"
              style={{ width: '100%', padding: '6px 10px', fontSize: 13 }}
            />
          ) : (
            <input value={form.description}
              placeholder={isDiesel ? 'Subbie name…' : 'Description'}
              onChange={e => set('description', e.target.value)}
              onKeyDown={e => onKeyDown(e, onSave, onCancel)}
              style={CS.input} />
          )}
        </div>

        <div style={{ ...CS.field(200), flex: '3 1 200px' }}>
          <label style={CS.label}>Notes</label>
          <input value={form.notes} placeholder="Optional notes"
            onChange={e => set('notes', e.target.value)}
            onKeyDown={e => onKeyDown(e, onSave, onCancel)}
            style={CS.input} />
        </div>
      </div>

      {form.is_multi_line && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          {isDiesel
            ? <DieselLineItemsEditor
                items={form.line_items || []}
                onChange={items => setForm(f => ({ ...f, line_items: items }))}
                vatApplicable={form.vat_applicable !== false}
                subbies={subbies}
                trucks={trucks}
                fillups={fillups}
              />
            : <LineItemsEditor
                items={form.line_items || []}
                onChange={items => setForm(f => ({ ...f, line_items: items }))}
                vatApplicable={form.vat_applicable !== false}
              />
          }
        </div>
      )}
    </div>
  )
}


function LineItemsEditor({ items, onChange, vatApplicable = true }) {
  const vatMult = vatApplicable ? 1.15 : 1
  const addLine = () => onChange([...items, blankLineItem()])
  const removeLine = (idx) => onChange(items.filter((_, i) => i !== idx))
  const updateLine = (idx, field, value) => {
    const updated = { ...items[idx], [field]: value }
    const qty = parseFloat(field === 'quantity' ? value : updated.quantity) || 0
    const rate = parseFloat(field === '_rate' ? value : updated._rate) || 0
    if (field === 'quantity' || field === '_rate') {
      const excl = qty && rate ? Math.round(qty * rate * 100) / 100 : 0
      updated.amount_excl_vat = excl || ''
      updated.amount_incl_vat = excl ? String(Math.round(excl * vatMult * 100) / 100) : ''
    }
    onChange(items.map((li, i) => i === idx ? updated : li))
  }

  const totalExcl = items.reduce((s, li) => s + (parseFloat(li.amount_excl_vat) || 0), 0)
  const totalIncl = items.reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)

  return (
    <div style={{ marginTop: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 80 }} />
          <col />
          <col style={{ width: 65 }} />
          <col style={{ width: 105 }} />
          <col style={{ width: 95 }} />
          <col style={{ width: 95 }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Item Code</th>
            <th style={liStyles.th}>Description</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Qty</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Rate</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Incl. VAT</th>
            <th style={liStyles.th} />
          </tr>
        </thead>
        <tbody>
          {items.map((li, idx) => (
            <tr key={li._key ?? li.id ?? idx} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={liStyles.td}>
                <input value={li.item_code ?? ''} placeholder="Code"
                  onChange={e => updateLine(idx, 'item_code', e.target.value)}
                  style={{ ...liStyles.input, width: '100%' }} />
              </td>
              <td style={liStyles.td}>
                <input value={li.item_description ?? ''} placeholder="Description"
                  onChange={e => updateLine(idx, 'item_description', e.target.value)}
                  style={{ ...liStyles.input, width: '100%' }} />
              </td>
              <td style={liStyles.td}>
                <input type="number" step="0.001" value={li.quantity ?? ''} placeholder="0"
                  onChange={e => updateLine(idx, 'quantity', e.target.value)}
                  style={{ ...liStyles.input, width: '100%', textAlign: 'right' }} />
              </td>
              <td style={liStyles.td}>
                <input type="number" step="0.0001" value={li._rate || ''} placeholder="0.00"
                  onChange={e => updateLine(idx, '_rate', e.target.value)}
                  style={{ ...liStyles.input, width: '100%', textAlign: 'right' }} />
              </td>
              <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 11 }}>
                {parseFloat(li.amount_excl_vat) ? parseFloat(li.amount_excl_vat).toFixed(2) : '—'}
              </td>
              <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                {parseFloat(li.amount_incl_vat) ? parseFloat(li.amount_incl_vat).toFixed(2) : '—'}
              </td>
              <td style={{ ...liStyles.td, textAlign: 'center' }}>
                <button onClick={() => removeLine(idx)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                  <X size={12} color="var(--danger)" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
            <td colSpan={3} style={{ padding: '8px 6px' }}>
              <button onClick={addLine}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: 12, padding: 0 }}>
                <Plus size={13} /> Add line
              </button>
            </td>
            <td style={{ ...liStyles.td, fontWeight: 700, textAlign: 'right' }}>Total:</td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
              {totalExcl.toFixed(2)}
            </td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
              {totalIncl.toFixed(2)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}


function LineItemsViewer({ items, total }) {
  if (!items || items.length === 0) {
    return <p style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>No line items.</p>
  }
  const totalExcl = items.reduce((s, li) => s + (parseFloat(li.amount_excl_vat) || 0), 0)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 80 }} />
          <col />
          <col style={{ width: 65 }} />
          <col style={{ width: 105 }} />
          <col style={{ width: 95 }} />
          <col style={{ width: 95 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Item Code</th>
            <th style={liStyles.th}>Description</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Qty</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Rate</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Incl. VAT</th>
          </tr>
        </thead>
        <tbody>
          {items.map(li => {
            const qty = parseFloat(li.quantity) || 0
            const excl = parseFloat(li.amount_excl_vat) || 0
            const rate = qty > 0 ? excl / qty : null
            return (
              <tr key={li.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={liStyles.td}>{li.item_code || '—'}</td>
                <td style={liStyles.td}>{li.item_description || '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right' }}>{qty || '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>
                  {rate != null ? rate.toFixed(4) : '—'}
                </td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  R {excl.toFixed(2)}
                </td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>
                  R {parseFloat(li.amount_incl_vat ?? 0).toFixed(2)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
            <td colSpan={3} style={liStyles.td} />
            <td style={{ ...liStyles.td, fontWeight: 700, textAlign: 'right' }}>Total:</td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
              R {totalExcl.toFixed(2)}
            </td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
              R {parseFloat(total ?? 0).toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}


// Diesel sub-line columns mirror the main invoice table:
// Slip # | Vehicle Reg | Subbie Name | Litres | Rate/L | Excl. VAT | Incl. VAT
// Stored as: item_code | unit | item_description | quantity | _rate(computed) | amount_excl_vat | amount_incl_vat

function DieselLineItemsEditor({ items, onChange, vatApplicable = true, subbies = [], trucks = [], fillups = [] }) {
  const vatMult = vatApplicable ? 1.15 : 1
  const addLine = () => onChange([...items, blankLineItem()])
  const removeLine = (idx) => onChange(items.filter((_, i) => i !== idx))
  const updateLine = (idx, field, value) => {
    const updated = { ...items[idx], [field]: value }
    const litres = parseFloat(field === 'quantity' ? value : updated.quantity) || 0
    const rate = parseFloat(field === '_rate' ? value : updated._rate) || 0
    if (field === 'quantity' || field === '_rate') {
      const excl = litres && rate ? Math.round(litres * rate * 100) / 100 : 0
      updated.amount_excl_vat = excl || ''
      updated.amount_incl_vat = excl ? String(Math.round(excl * vatMult * 100) / 100) : ''
    }
    onChange(items.map((li, i) => i === idx ? updated : li))
  }
  const selectSlip = (idx, slipNumber) => {
    const f = fillups.find(f => f.slip_number === slipNumber)
    if (!f) { updateLine(idx, 'item_code', slipNumber); return }
    const litres = parseFloat(f.litres) || 0
    const rate   = parseFloat(f.rate_per_litre) || 0
    const excl   = litres && rate ? Math.round(litres * rate * 100) / 100 : 0
    onChange(items.map((li, i) => i !== idx ? li : {
      ...li,
      item_code:       f.slip_number,
      unit:            f.truck_registration || li.unit,
      quantity:        String(f.litres),
      _rate:           String(f.rate_per_litre),
      amount_excl_vat: excl || '',
      amount_incl_vat: excl ? String(Math.round(excl * vatMult * 100) / 100) : '',
    }))
  }
  const totalLitres = items.reduce((s, li) => s + (parseFloat(li.quantity) || 0), 0)
  const totalExcl = items.reduce((s, li) => s + (parseFloat(li.amount_excl_vat) || 0), 0)
  const totalIncl = items.reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)

  return (
    <div style={{ marginTop: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Slip #</th>
            <th style={liStyles.th}>Vehicle Reg</th>
            <th style={liStyles.th}>Subbie Name</th>
            <th style={liStyles.th}>Litres</th>
            <th style={liStyles.th}>Rate/L</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Incl. VAT</th>
            <th style={liStyles.th} />
          </tr>
        </thead>
        <tbody>
          {items.map((li, idx) => (
            <tr key={li._key ?? li.id ?? idx} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={liStyles.td}>
                {fillups.length > 0 ? (
                  <SearchableSelect
                    value={li.item_code ?? ''}
                    onChange={v => selectSlip(idx, v)}
                    options={[{ slip_number: '' }, ...fillups]}
                    getValue={f => f.slip_number ?? ''}
                    getLabel={f => f.slip_number ? f.slip_number : '— Select —'}
                    placeholder="Select slip…"
                    style={{ minWidth: 130 }}
                  />
                ) : (
                  <input value={li.item_code ?? ''} placeholder="Slip #"
                    onChange={e => updateLine(idx, 'item_code', e.target.value)}
                    style={{ ...liStyles.input, minWidth: 90 }} />
                )}
              </td>
              <td style={liStyles.td}>
                {trucks.length > 0 ? (
                  <SearchableSelect
                    value={li.unit ?? ''}
                    onChange={v => updateLine(idx, 'unit', v)}
                    options={[{ id: '', registration: '', fleet_number: null }, ...trucks]}
                    getValue={t => t.registration}
                    getLabel={t => t.registration === '' ? '— Select —' : t.registration}
                    placeholder="Vehicle reg…"
                    style={{ minWidth: 130 }}
                  />
                ) : (
                  <input value={li.unit ?? ''} placeholder="e.g. DDM652NC"
                    onChange={e => updateLine(idx, 'unit', e.target.value.toUpperCase())}
                    style={{ ...liStyles.input, minWidth: 100, textTransform: 'uppercase' }} />
                )}
              </td>
              <td style={liStyles.td}>
                {subbies.length > 0 ? (
                  <SearchableSelect
                    value={li.item_description ?? ''}
                    onChange={v => updateLine(idx, 'item_description', v)}
                    options={[{ id: '', name: '' }, ...subbies]}
                    getValue={s => s.name}
                    getLabel={s => s.name || '— None —'}
                    placeholder="Subbie name…"
                    style={{ minWidth: 130 }}
                  />
                ) : (
                  <input value={li.item_description ?? ''} placeholder="Subbie name…"
                    onChange={e => updateLine(idx, 'item_description', e.target.value)}
                    style={{ ...liStyles.input, minWidth: 120 }} />
                )}
              </td>
              <td style={liStyles.td}>
                <input type="number" step="0.001" value={li.quantity ?? ''} placeholder="0.000"
                  onChange={e => updateLine(idx, 'quantity', e.target.value)}
                  style={{ ...liStyles.input, width: 80, textAlign: 'right' }} />
              </td>
              <td style={liStyles.td}>
                <input type="number" step="0.0001" value={li._rate || ''} placeholder="0.0000"
                  onChange={e => updateLine(idx, '_rate', e.target.value)}
                  style={{ ...liStyles.input, width: 80, textAlign: 'right' }} />
              </td>
              <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 11 }}>
                {parseFloat(li.amount_excl_vat) ? parseFloat(li.amount_excl_vat).toFixed(2) : '—'}
              </td>
              <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                {parseFloat(li.amount_incl_vat) ? parseFloat(li.amount_incl_vat).toFixed(2) : '—'}
              </td>
              <td style={{ ...liStyles.td, textAlign: 'center' }}>
                <button onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
                  <X size={12} color="var(--danger)" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
            <td colSpan={2} style={{ padding: '8px 6px' }}>
              <button onClick={addLine} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: 12, padding: 0 }}>
                <Plus size={13} /> Add line
              </button>
            </td>
            <td style={{ ...liStyles.td, fontWeight: 700, textAlign: 'right' }}>Total:</td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>{totalLitres.toFixed(1)}L</td>
            <td style={liStyles.td} />
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>{totalExcl.toFixed(2)}</td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>{totalIncl.toFixed(2)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}


function DieselLineItemsViewer({ items, total }) {
  if (!items || items.length === 0)
    return <p style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>No line items.</p>
  const totalLitres = items.reduce((s, li) => s + (parseFloat(li.quantity) || 0), 0)
  const totalExcl = items.reduce((s, li) => s + (parseFloat(li.amount_excl_vat) || 0), 0)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Slip #</th>
            <th style={liStyles.th}>Vehicle Reg</th>
            <th style={liStyles.th}>Subbie Name</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Litres</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Rate/L</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Incl. VAT</th>
          </tr>
        </thead>
        <tbody>
          {items.map(li => {
            const litres = parseFloat(li.quantity) || 0
            const excl = parseFloat(li.amount_excl_vat) || 0
            const rate = litres > 0 ? excl / litres : null
            return (
              <tr key={li.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...liStyles.td, fontWeight: 600 }}>{li.item_code || '—'}</td>
                <td style={liStyles.td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{li.unit || '—'}</span></td>
                <td style={{ ...liStyles.td, color: 'var(--text-muted)' }}>{li.item_description || '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right' }}>{litres ? `${litres.toFixed(1)}L` : '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>{rate != null ? rate.toFixed(4) : '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>R {excl.toFixed(2)}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>R {parseFloat(li.amount_incl_vat ?? 0).toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
            <td colSpan={2} style={liStyles.td} />
            <td style={{ ...liStyles.td, fontWeight: 700, textAlign: 'right' }}>Total:</td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>{totalLitres.toFixed(1)}L</td>
            <td style={liStyles.td} />
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>R {totalExcl.toFixed(2)}</td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>R {parseFloat(total ?? 0).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}


const liStyles = {
  th: {
    padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700,
    color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5,
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  },
  td: { padding: '5px 8px', verticalAlign: 'middle' },
  input: {
    padding: '3px 6px', fontSize: 12,
    background: 'var(--bg-input, var(--bg-card))',
    border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-primary)', outline: 'none',
    boxSizing: 'border-box',
  },
}


const styles = {
  page: { padding: '28px 32px', flex: 1 },
  infoCard: {
    display: 'flex', flexWrap: 'wrap', gap: '6px 24px',
    padding: '12px 16px', marginBottom: 24,
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 8, fontSize: 13, color: 'var(--text-muted)',
  },
  group: {
    marginBottom: 20, border: '1px solid var(--border)',
    borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)',
  },
  groupHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 18px', cursor: 'pointer', userSelect: 'none',
    background: 'var(--bg-surface)',
  },
  paidBadge: {
    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 800,
    background: 'rgba(34,197,94,0.15)', color: '#16a34a', letterSpacing: 1,
  },
  unpaidBadge: {
    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
    background: 'rgba(245,158,11,0.15)', color: '#d97706',
  },
  th: {
    padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5,
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  },
  td: { padding: '7px 10px', fontSize: 13, verticalAlign: 'middle' },
  cellInput: {
    padding: '4px 8px', fontSize: 13,
    background: 'var(--bg-input, var(--bg-card))',
    border: '1px solid var(--border)', borderRadius: 5,
    color: 'var(--text-primary)', width: '100%', minWidth: 60,
    outline: 'none',
  },
  cellSelect: {
    padding: '4px 6px', fontSize: 12,
    background: 'var(--bg-input, var(--bg-card))',
    border: '1px solid var(--border)', borderRadius: 5,
    color: 'var(--text-primary)',
  },
  noVatTag: {
    marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 10,
    fontWeight: 700, background: 'rgba(156,163,175,0.2)', color: 'var(--text-muted)',
  },
}
