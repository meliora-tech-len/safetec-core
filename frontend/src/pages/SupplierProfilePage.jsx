import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  getSupplier, getSuppliers, getEntities,
  getSupplierInvoices, createSupplierInvoice,
  updateSupplierInvoice, updateSupplierInvoicePeriods, deleteSupplierInvoice, archiveSupplierInvoice, markStatementPaid,
  verifySupplierInvoice, getCurrentDieselRate, getTruckLoads, getFleetTrucks,
  addInvoiceLineItem, updateInvoiceLineItem, deleteInvoiceLineItem,
  getSubcontractors, getDieselFillUpSlips,
  finalizeSupplierInvoice, bulkImportSupplierInvoices, resolveSupplierDieselConflicts,
  setSupplierInvoiceLock, setSupplierInvoiceLocksBulk,
  getVerifications, verifyValue, finalizeValue,
  uploadSupplierInvoiceAttachment, deleteSupplierInvoiceAttachment, viewSupplierInvoiceAttachment,
  updateSupplierStatementNote, uploadSupplierStatementDocument,
  deleteSupplierStatementDocument, viewSupplierStatementDocument,
} from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { useLocalState } from '../hooks/useLocalState'
import { useSessionState } from '../hooks/useSessionState'
import { formatCurrency, formatDate, errorMessage, entityVatRate } from '../utils/helpers'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, SlidersHorizontal, Save, X, CheckCircle, Fuel, Upload, Paperclip, Eye, Lock, Unlock, Calendar, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'
import ExportButton from '../components/ExportButton'
import VerifyBadge from '../components/VerifyBadge'
import VerifiableAmount from '../components/VerifiableAmount'
import DeleteModal from '../components/DeleteModal'
import SearchableSelect from '../components/SearchableSelect'
import DateInput from '../components/DateInput'
import SupplierWorkbookExportModal from '../components/SupplierWorkbookExportModal'

import { MONTHS_LONG_1 as MONTH_NAMES } from '../utils/helpers'

const today = new Date().toISOString().slice(0, 10)
const currentMonth = () => new Date().getMonth() + 1
const currentYear  = () => new Date().getFullYear()

// Invoice-table columns in display order. `when` says whether a column
// applies to the supplier at all (diesel vs general, multi-entity, WBG);
// `fixed` columns can't be hidden. The user's hidden set lives in
// localStorage and is shared by every supplier profile — it's a view
// preference like the sort order.
const INVOICE_COLUMNS = [
  { key: 'entity',         label: 'Entity',        when: c => c.multiEntity },
  { key: 'date',           label: 'Date' },
  { key: 'period',         label: 'Period' },
  { key: 'invoice_number', label: 'Invoice #',     fixed: true },
  { key: 'vehicle_reg',    label: 'Vehicle Reg',   when: c => c.showVehicleReg && !c.isWBGDiesel },
  { key: 'subcontractor',  label: 'Subcontractor', when: c => c.showVehicleReg && !c.isWBGDiesel },
  { key: 'description',    label: 'Description',   when: c => !c.isDiesel },
  { key: 'amount',         label: 'Amount',        fixed: true },
  { key: 'deposit',        label: 'Deposit',       when: c => !c.isDiesel },
  { key: 'outstanding',    label: 'Outstanding',   when: c => !c.isDiesel },
  { key: 'litres',         label: 'Litres',        when: c => c.isDiesel && !c.isWBGDiesel },
  { key: 'rate',           label: 'Rate/L',        when: c => c.isDiesel && !c.isWBGDiesel },
  { key: 'vat',            label: 'VAT',           when: c => !c.isDiesel },
  { key: 'select',         label: 'Select',        fixed: true },
  { key: 'verified',       label: 'Verified' },
  { key: 'paid',           label: 'Paid' },
  { key: 'paid_date',      label: 'Paid Date' },
  { key: 'notes',          label: 'Notes' },
  { key: 'actions',        label: 'Actions',       fixed: true },
]

function ColumnPicker({ columns, hidden, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (key) => onChange(hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key])
  const hiddenHere = columns.filter(c => !c.fixed && hidden.includes(c.key)).length

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="btn-ghost"
        onClick={() => setOpen(o => !o)}
        title="Choose which columns to show"
        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 10px' }}
      >
        <SlidersHorizontal size={13} />
        Columns{hiddenHere > 0 ? ` (${hiddenHere} hidden)` : ''}
        <ChevronDown size={11} style={{ opacity: 0.6, marginLeft: 1 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 100,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: 'var(--shadow)', minWidth: 190, padding: '6px 0',
        }}>
          {columns.map(c => (
            <label
              key={c.key}
              title={c.fixed ? 'Always shown' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '6px 14px',
                fontSize: 13, cursor: c.fixed ? 'default' : 'pointer',
                color: c.fixed ? 'var(--text-muted)' : 'var(--text-primary)',
              }}
            >
              <input
                type="checkbox"
                checked={c.fixed || !hidden.includes(c.key)}
                disabled={c.fixed}
                onChange={() => toggle(c.key)}
                style={{ width: 'auto', cursor: c.fixed ? 'default' : 'pointer' }}
              />
              {c.label}
            </label>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, padding: '6px 14px 2px' }}>
            <button
              onClick={() => onChange([])}
              disabled={hidden.length === 0}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: hidden.length ? 'var(--accent)' : 'var(--text-muted)', cursor: hidden.length ? 'pointer' : 'default' }}
            >
              Show all columns
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const blankForm = (entityId, isDieselSupplier = false) => ({
  entity_id: entityId || '',
  invoice_date: today,
  invoice_number: '',
  amount: '',
  deposit_paid: '',
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
  line_date: '',
  _vat: true,            // per-line VAT, on by default; cleared for non-VAT lines
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

function fmtISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseSlipDate(val) {
  if (val instanceof Date) return fmtISODate(val)
  if (typeof val === 'string') {
    const m = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10)
  }
  return null
}

// Parse a South African currency/numeric cell that may arrive as a number or as
// text like "R 24 857,81" (R prefix, space thousands separator, comma decimal).
function parseZAR(val) {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    // strip everything except digits and comma, then treat comma as decimal point
    const n = parseFloat(val.replace(/[^0-9,]/g, '').replace(',', '.'))
    return isNaN(n) ? 0 : n
  }
  return 0
}

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const r4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

// True when a cell holds a date rather than a site name — a real Excel date, or
// text like "09-07-2026" / "08/12/2025 14:14:08". Day-total rows put the date in
// the Site column and carry no Slip #, which otherwise makes them look exactly
// like the continuation rows handled in parseWBGSheet.
function looksLikeDateCell(val) {
  if (val instanceof Date) return true
  if (typeof val !== 'string') return false
  const s = val.trim()
  return /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}(\s|$)/.test(s) || /^\d{4}-\d{1,2}-\d{1,2}(\s|$)/.test(s)
}

function parseWBGSheet(ws) {
  // raw: true (default) keeps numbers as numbers and dates as Date objects via
  // cellDates — raw: false would stringify numbers and dates below.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, cellDates: true })
  const invoices = []
  let pending = []
  for (const row of rows.slice(3)) {
    // Col layout: 0=site, 1=datetime, 2=slip#, 3=truck reg, 4=odometer(skip),
    //             5=driver, 6=litres, 7=rate/L, 8=amount excl
    const [siteOrDate, slipDate, slip, reg, , driver, ltr, rawRate, txnVal] = row
    const invDate  = row[9]
    const invNo    = row[10]
    const invTotal = row[11]
    if (!siteOrDate && !invNo) continue
    // Invoice-summary rows never carry a Slip Number (col 2) — data rows always do.
    // The date in col 0 is sometimes a real Excel date, sometimes plain text
    // ("03-07-2026"), so typeof can't reliably tell a summary row from a data row.
    if (invNo && !slip) {
      invoices.push({
        invoice_date:   invDate instanceof Date ? fmtISODate(invDate) : (parseSlipDate(invDate) || invDate),
        invoice_number: String(invNo).trim(),
        amount:         parseZAR(invTotal),
        line_items:     pending,
      })
      pending = []
      continue
    }
    // Same day-total row, but WBG hasn't issued the day's consolidated invoice
    // number yet (the Invoice No column is still blank while the date and due date
    // are filled in). Import the day anyway as a numberless invoice — it shows as
    // "Pending" in the list — so the fills are captured now and someone fills the
    // number in when WBG sends it. Distinguished from the numbered case above by
    // col 0 being a date and there being no Invoice No.
    if (!slip && !invNo && looksLikeDateCell(siteOrDate) && pending.length) {
      const iso = siteOrDate instanceof Date ? fmtISODate(siteOrDate)
        : (parseSlipDate(siteOrDate) || (invDate instanceof Date ? fmtISODate(invDate) : parseSlipDate(invDate)))
      invoices.push({
        invoice_date:   iso,
        invoice_number: null,
        amount:         parseZAR(txnVal),   // the day-total transaction value (col 8)
        line_items:     pending,
      })
      pending = []
      continue
    }
    // A data row with no Slip # is the continuation of the fill above it: the
    // depot dispensed one fuel transaction in several tranches (the pump cut out
    // and restarted), and only the first tranche carries the slip, reg and driver.
    // Keep each tranche as its OWN line — the invoice must show every row the depot
    // billed, and its block subtotal counts them all, so dropping one under-bills —
    // but carry the slip/reg/driver down so the tranche is attributed to the same
    // slip and truck. Otherwise it has no slip to appear under and no reg to find a
    // truck by, which is why it was being dropped. Guarded on col 0 being a site
    // name: day-total rows also lack a slip but hold a date there and must not
    // inherit one.
    if (!slip && !reg && !looksLikeDateCell(siteOrDate) && pending.length && parseZAR(ltr) > 0) {
      const prev = pending[pending.length - 1]
      const excl = parseZAR(txnVal)
      pending.push({
        item_code:        prev.item_code,
        unit:             prev.unit,
        item_description: prev.item_description,
        quantity:         parseZAR(ltr),
        amount_excl_vat:  excl,
        amount_incl_vat:  excl,
        rate_per_litre:   parseZAR(rawRate) || prev.rate_per_litre,
        sort_order:       pending.length,
        slip_date:        prev.slip_date,
      })
      continue
    }
    // Col 0 is the site/location; col 1 is the Date column (next to Slip# at col 2).
    // Rows that repeat a slip+reg (the depot's other way of recording a split fill)
    // stay as separate lines too — each is one diesel record under the same slip.
    if ((typeof siteOrDate === 'string' || siteOrDate instanceof Date) && slip) {
      const excl = parseZAR(txnVal)
      const rate = parseZAR(rawRate) || null
      pending.push({
        item_code:        String(slip).replace(/^INV/i, '').trim(),
        unit:             String(reg || '').trim().toUpperCase(),
        item_description: String(driver || '').trim(),
        quantity:         parseZAR(ltr),
        amount_excl_vat:  excl,
        amount_incl_vat:  excl,
        rate_per_litre:   rate,
        sort_order:       pending.length,
        slip_date:        parseSlipDate(slipDate),
      })
    }
  }
  return invoices
}

// True when the sheet is an Intsimbi "Diesel Transaction Report" (vs a WBG sheet).
function isIntsimbiSheet(ws) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1 })
  return grid.some(r => (r || []).some(c => String(c ?? '').trim().toUpperCase() === 'LDISPENSED'))
}

// Parse the Intsimbi sheet into the same {invoice → line_items} shape the importer
// expects. One row = one fill-up; rows are grouped by the INV (supplier invoice
// number). Columns: Date | … | TransID | Driver | Slip | RegNo | … |
// LDispensed(litres) | … | Price(rate) | Km's | Price(amount excl) | Amin Fee | INV.
// Slip is the printed depot slip — the same reference already captured on
// manually-logged fill-ups and their auto-created placeholder invoices, so it
// must be the item_code or the import can never match/absorb them. TransID is
// kept in the description for reference only. Diesel is zero-rated; VAT applies
// only to the admin fee, so the line's incl-VAT = diesel + admin fee + VAT(admin fee).
function parseIntsimbiSheet(ws, vatRate = 0.15) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, cellDates: true })

  const hdr = grid.findIndex(r => (r || []).some(c => String(c ?? '').trim().toUpperCase() === 'LDISPENSED'))
  if (hdr < 0) throw new Error('Could not find the header row (LDispensed).')
  const H = (grid[hdr] || []).map(c => String(c ?? '').trim().toUpperCase())
  const find = (t) => H.indexOf(t)
  const cDate = find('DATE'), cDriver = find('DRIVER'), cTrans = find('TRANSID')
  const cReg = find('REGNO'), cLit = find('LDISPENSED'), cInv = find('INV'), cSlip = find('SLIP')
  const cFee = H.findIndex(h => h === 'AMIN FEE' || h === 'ADMIN FEE')
  const cAmt = cFee > 0 ? cFee - 1 : -1     // the Price column immediately before Amin Fee
  if (cReg < 0 || cLit < 0 || cFee < 0 || cAmt < 0) {
    throw new Error('Missing required columns (RegNo / LDispensed / Amin Fee).')
  }

  const byInv = new Map()
  for (const row of grid.slice(hdr + 1)) {
    const lit = row[cLit]
    if (lit == null || lit === '') continue
    const reg = String(row[cReg] ?? '').trim()
    if (!reg) continue

    const litres = parseZAR(lit)
    const diesel = r2(parseZAR(row[cAmt]))
    const fee = row[cFee] == null || row[cFee] === '' ? 0 : r2(parseZAR(row[cFee]))
    const feeVat = r2(fee * vatRate)
    const dateISO = row[cDate] instanceof Date ? fmtISODate(row[cDate]) : parseSlipDate(row[cDate])
    const invNo = String(row[cInv] ?? '').trim() || '(no invoice)'
    const driver = cDriver >= 0 ? String(row[cDriver] ?? '').trim() : ''
    const slip = cSlip >= 0 ? String(row[cSlip] ?? '').trim() : ''

    if (!byInv.has(invNo)) byInv.set(invNo, { invoice_number: invNo, invoice_date: dateISO, line_items: [] })
    const inv = byInv.get(invNo)
    if (!inv.invoice_date && dateISO) inv.invoice_date = dateISO
    const trans = cTrans >= 0 ? String(row[cTrans] ?? '').trim() : ''
    inv.line_items.push({
      // Slip is the depot reference used everywhere else to match/link fill-ups.
      item_code:        slip,
      // TransID uniquely identifies this one fill; a printed slip can span several,
      // so the importer keys diesel records off it (not the shared slip).
      trans_id:         trans,
      item_description: [driver, trans && `trans ${trans}`].filter(Boolean).join(' · '),
      unit:             reg.toUpperCase(),
      quantity:         litres,
      amount_excl_vat:  diesel,
      amount_incl_vat:  r2(diesel + fee + feeVat),
      rate_per_litre:   litres > 0 ? r4(diesel / litres) : null,
      admin_fee:        fee,
      sort_order:       inv.line_items.length,
      slip_date:        dateISO,
    })
  }
  return [...byInv.values()].map(inv => ({
    ...inv,
    amount: r2(inv.line_items.reduce((s, li) => s + li.amount_incl_vat, 0)),
  }))
}

function invLineStatus(li, trucks, entityId) {
  if (!li.unit || !(li.quantity > 0)) return 'missing'
  const reg = li.unit.toLowerCase()
  const found = (trucks || []).some(
    t => t.registration?.toLowerCase() === reg && t.entity_id === parseInt(entityId)
  )
  return found ? 'ok' : 'no_truck'
}

function DieselConflictStep({ conflicts, onDone }) {
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(conflicts.map(c => [c.fillup_id, 'existing']))
  )
  const [resolving, setResolving] = useState(false)

  const fmt = (v) => v != null ? parseFloat(v).toLocaleString('en-ZA', { minimumFractionDigits: 2 }) : '—'
  const fmtDate = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—'

  async function handleResolve() {
    setResolving(true)
    try {
      const resolutions = conflicts.map(c => ({
        fillup_id:        c.fillup_id,
        invoice_id:       c.invoice_id,
        use_import_values: choices[c.fillup_id] === 'import',
        litres:            choices[c.fillup_id] === 'import' ? c.incoming.litres : undefined,
        rate_per_litre:    choices[c.fillup_id] === 'import' ? c.incoming.rate_per_litre : undefined,
        fillup_date:       choices[c.fillup_id] === 'import' ? c.incoming.fillup_date : undefined,
      }))
      await resolveSupplierDieselConflicts(resolutions)
      toast.success(`${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} resolved`)
      onDone()
    } catch (e) {
      toast.error('Failed to resolve conflicts')
      setResolving(false)
    }
  }

  return (
    <>
      <p style={{ margin:'0 0 12px', fontSize:13, color:'var(--text-muted)' }}>
        {conflicts.length} diesel record{conflicts.length !== 1 ? 's' : ''} already exist with different values.
        Choose which values to keep for each slip:
      </p>
      <div style={{ maxHeight:420, overflowY:'auto', marginBottom:16 }}>
        {conflicts.map(c => {
          const choice = choices[c.fillup_id]
          return (
            <div key={c.fillup_id} style={{ marginBottom:12, border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
              <div style={{ padding:'6px 12px', background:'var(--bg-surface)', fontWeight:700, fontSize:12, display:'flex', justifyContent:'space-between' }}>
                <span>Slip # {c.slip_number}</span>
                {c.invoice_number && <span style={{ color:'var(--text-muted)', fontWeight:400 }}>Invoice {c.invoice_number}</span>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:0 }}>
                {[
                  { key: 'existing', label: 'Existing record', side: c.existing },
                  { key: 'import',   label: 'From import',     side: c.incoming },
                ].map(({ key, label, side }) => (
                  <label key={key} style={{
                    padding:'10px 12px', cursor:'pointer',
                    background: choice === key ? 'rgba(59,130,246,0.07)' : 'var(--bg-card)',
                    borderLeft: choice === key ? '3px solid var(--accent)' : '3px solid transparent',
                    borderTop: '1px solid var(--border)',
                    borderRight: key === 'existing' ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                      <input type="radio" name={`conflict-${c.fillup_id}`} value={key}
                        checked={choice === key}
                        onChange={() => setChoices(p => ({ ...p, [c.fillup_id]: key }))}
                        style={{ accentColor:'var(--accent)' }} />
                      <span style={{ fontWeight:600, fontSize:12 }}>{label}</span>
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.7, paddingLeft:20 }}>
                      <div>Truck: <strong style={{ color:'var(--text-primary)', fontFamily:'monospace' }}>{side.truck_registration || '—'}</strong></div>
                      <div>Date: <strong style={{ color:'var(--text-primary)' }}>{fmtDate(side.fillup_date)}</strong></div>
                      <div>Litres: <strong style={{ color:'var(--text-primary)' }}>{fmt(side.litres)} L</strong></div>
                      <div>Rate/L: <strong style={{ color:'var(--text-primary)' }}>R&nbsp;{fmt(side.rate_per_litre)}</strong></div>
                      <div>Amount: <strong style={{ color:'var(--text-primary)' }}>R&nbsp;{fmt(side.amount)}</strong></div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <button className="btn-ghost" onClick={onDone}>Skip</button>
        <button className="btn-primary" onClick={handleResolve} disabled={resolving}>
          {resolving ? 'Saving…' : 'Save choices'}
        </button>
      </div>
    </>
  )
}

function WBGImportModal({ supplierId, supplier, entities, trucks, onClose, onImported }) {
  const [step, setStep]           = useState('idle')
  const [workbook, setWorkbook]   = useState(null)
  const [entityId, setEntityId]   = useState(supplier?.entity_id || '')
  const [sheetName, setSheetName] = useState('')
  const [invoices, setInvoices]   = useState([])
  const [selectedNums, setSelectedNums] = useState(new Set())
  const [expanded, setExpanded]   = useState({})
  const [importing, setImporting] = useState(false)
  const [conflicts, setConflicts] = useState([])
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
    try {
      const parsed = isIntsimbiSheet(ws) ? parseIntsimbiSheet(ws, entityVatRate(entities, entityId)) : parseWBGSheet(ws)
      setInvoices(parsed)
      // Select by row index, not invoice number — a not-yet-numbered day imports
      // with a null number, and several could share it.
      setSelectedNums(new Set(parsed.map((_, i) => i)))
      setExpanded({})
      setStep('preview')
    } catch (err) {
      toast.error(err.message || 'Could not parse the sheet')
    }
  }

  async function handleImport() {
    setImporting(true)
    try {
      const r = await bulkImportSupplierInvoices({
        supplier_id: parseInt(supplierId),
        entity_id:   parseInt(entityId),
        invoices:    invoices.filter((_, i) => selectedNums.has(i)),
      })
      const { created, skipped, diesel_created, diesel_linked, locked_skipped, conflicts: cfts } = r.data
      const parts = []
      if (created > 0) parts.push(`${created} invoice${created !== 1 ? 's' : ''} imported`)
      if (skipped > 0)  parts.push(`${skipped} skipped`)
      if (diesel_created > 0) parts.push(`${diesel_created} diesel record${diesel_created !== 1 ? 's' : ''} created`)
      if (diesel_linked > 0)  parts.push(`${diesel_linked} linked`)
      if (locked_skipped > 0) parts.push(`${locked_skipped} line${locked_skipped !== 1 ? 's' : ''} left on locked invoices`)
      if (parts.length) toast.success(parts.join(', '))
      else toast('All invoices already exist — nothing imported')
      onImported()
      if (cfts?.length > 0) {
        setConflicts(cfts)
        setStep('conflicts')
      } else {
        onClose()
      }
    } catch (e) {
      const msg = errorMessage(e)
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      setImporting(false)
    }
  }

  const totalLines = invoices.reduce((s, inv) => s + inv.line_items.length, 0)

  return (
    <div style={wbgModalOverlay} onClick={onClose}>
      <div style={wbgModalBox} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ margin:0, fontSize:16 }}>Import {supplier?.name || 'Diesel'} Excel</h3>
          <button className="btn-ghost" onClick={onClose} style={{ padding:'2px 6px' }}><X size={14}/></button>
        </div>

        {step === 'idle' && (
          <>
            <div style={{ marginBottom:12 }}>
              <label style={{ display:'block', marginBottom:4, fontSize:13, fontWeight:600 }}>Entity</label>
              <select value={entityId} onChange={e => handleEntityChange(e.target.value)}
                      style={{ width:'100%', padding:'6px 8px', borderRadius:4, border:'1px solid var(--border)', fontSize:13 }}>
                <option value="">— select entity —</option>
                {(entities || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={{ display:'block', marginBottom:4, fontSize:13, fontWeight:600 }}>Excel file (.xlsx)</label>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile}
                     style={{ fontSize:13 }} />
            </div>
            {workbook && (
              <div style={{ marginBottom:16 }}>
                <label style={{ display:'block', marginBottom:4, fontSize:13, fontWeight:600 }}>Sheet</label>
                <select value={sheetName} onChange={e => setSheetName(e.target.value)}
                        style={{ width:'100%', padding:'6px 8px', borderRadius:4, border:'1px solid var(--border)', fontSize:13 }}>
                  {availableSheets.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                {availableSheets.length < workbook.SheetNames.length && (
                  <p style={{ margin:'4px 0 0', fontSize:11, color:'var(--text-muted)' }}>
                    Showing {availableSheets.length} of {workbook.SheetNames.length} sheets matching "{selectedEntity?.name}"
                  </p>
                )}
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handlePreview} disabled={!workbook || !entityId}>
                Preview
              </button>
            </div>
          </>
        )}

        {step === 'preview' && (() => {
          const allLineItems = invoices.flatMap(inv => inv.line_items)
          const noTruckCount = allLineItems.filter(li => invLineStatus(li, trucks, entityId) === 'no_truck').length
          const missingCount = allLineItems.filter(li => invLineStatus(li, trucks, entityId) === 'missing').length
          return (
          <>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <p style={{ margin:0, fontSize:13, color:'var(--text-muted)' }}>
                Sheet: <strong>{sheetName}</strong> — {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}, {totalLines} line items
              </p>
              <div style={{ display:'flex', gap:6 }}>
                <button className="btn-ghost" style={{ padding:'2px 8px', fontSize:12 }}
                        onClick={() => setSelectedNums(new Set(invoices.map((_, i) => i)))}>
                  Select All
                </button>
                <button className="btn-ghost" style={{ padding:'2px 8px', fontSize:12 }}
                        onClick={() => setSelectedNums(new Set())}>
                  Deselect All
                </button>
              </div>
            </div>
            {(noTruckCount > 0 || missingCount > 0) && (
              <div style={{ marginBottom:10, padding:'6px 12px', borderRadius:4, background:'rgba(217,119,6,0.08)', border:'1px solid rgba(217,119,6,0.3)', fontSize:12 }}>
                {noTruckCount > 0 && <span style={{ color:'#d97706', marginRight:12 }}>⚠ {noTruckCount} truck reg{noTruckCount !== 1 ? 's' : ''} not found in this entity</span>}
                {missingCount > 0 && <span style={{ color:'#dc2626' }}>✕ {missingCount} line{missingCount !== 1 ? 's' : ''} missing data</span>}
              </div>
            )}
            <div style={{ maxHeight:400, overflowY:'auto', border:'1px solid var(--border)', borderRadius:4, marginBottom:16 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'var(--bg-secondary)' }}>
                    <th style={{ ...wbgTh, width:28 }}></th>
                    <th style={{ ...wbgTh, width:24 }}></th>
                    <th style={wbgTh}>Invoice No</th>
                    <th style={wbgTh}>Date</th>
                    <th style={wbgTh}>Truck Reg</th>
                    <th style={{...wbgTh, textAlign:'right'}}>Amount</th>
                    <th style={{...wbgTh, textAlign:'right'}}>Lines / L</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, i) => {
                    const isSelected = selectedNums.has(i)
                    const statuses   = inv.line_items.map(li => invLineStatus(li, trucks, entityId))
                    const hasMissing = statuses.includes('missing')
                    const hasNoTruck = statuses.includes('no_truck')
                    const rowBg = hasMissing
                      ? 'rgba(220,38,38,0.07)'
                      : hasNoTruck ? 'rgba(217,119,6,0.08)' : 'transparent'
                    return (
                      <Fragment key={i}>
                        <tr style={{ borderBottom:'1px solid var(--border)', background: rowBg, opacity: isSelected ? 1 : 0.45 }}>
                          <td style={{ ...wbgTd, width:28 }}>
                            <input type="checkbox" checked={isSelected}
                                   onChange={() => setSelectedNums(prev => {
                                     const next = new Set(prev)
                                     isSelected ? next.delete(i) : next.add(i)
                                     return next
                                   })} />
                          </td>
                          <td style={{ ...wbgTd, width:24, cursor:'pointer' }}
                              onClick={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}>
                            {expanded[i] ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                          </td>
                          <td style={{ ...wbgTd, fontWeight:600 }}>
                            {inv.invoice_number || (
                              <span style={{ fontSize:10, fontWeight:700, color:'#d97706', background:'rgba(245,158,11,0.14)', padding:'2px 6px', borderRadius:3 }}>No invoice #</span>
                            )}
                          </td>
                          <td style={wbgTd}>{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-ZA') : '—'}</td>
                          <td style={{ ...wbgTd, color:'var(--text-muted)' }}></td>
                          <td style={{...wbgTd, textAlign:'right', fontWeight:600}}>{inv.amount.toLocaleString('en-ZA', { minimumFractionDigits:2 })}</td>
                          <td style={{...wbgTd, textAlign:'right', color:'var(--text-muted)'}}>{inv.line_items.length}</td>
                        </tr>
                        {expanded[i] && inv.line_items.map((li, j) => {
                          const st = invLineStatus(li, trucks, entityId)
                          const lineBg = st === 'missing'
                            ? 'rgba(220,38,38,0.07)'
                            : st === 'no_truck' ? 'rgba(217,119,6,0.06)' : 'var(--bg-secondary)'
                          return (
                            <tr key={j} style={{ background: lineBg, borderBottom:'1px solid var(--border)', opacity: isSelected ? 1 : 0.45 }}>
                              <td style={wbgTd}></td>
                              <td style={wbgTd}></td>
                              <td style={{ ...wbgTd, color:'var(--text-muted)', paddingLeft:16 }}>{li.item_code}</td>
                              <td style={{ ...wbgTd, color:'var(--text-muted)' }}>{li.slip_date ? new Date(li.slip_date + 'T00:00:00').toLocaleDateString('en-ZA') : '—'}</td>
                              <td style={{ ...wbgTd, fontFamily:'monospace', fontSize:11 }}>
                                {li.unit}
                                {st === 'no_truck' && <span style={{ marginLeft:6, color:'#d97706', fontSize:10, fontWeight:700 }}>⚠ not found</span>}
                                {st === 'missing' && <span style={{ marginLeft:6, color:'#dc2626', fontSize:10, fontWeight:700 }}>✕ missing</span>}
                              </td>
                              <td style={{ ...wbgTd, textAlign:'right', color:'var(--text-muted)' }}>{li.amount_excl_vat.toLocaleString('en-ZA', { minimumFractionDigits:2 })}</td>
                              <td style={{ ...wbgTd, textAlign:'right', color:'var(--text-muted)' }}>{li.quantity}L</td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'var(--text-muted)' }}>
                {selectedNums.size} of {invoices.length} selected
              </span>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn-ghost" onClick={() => setStep('idle')}>Back</button>
                <button className="btn-primary" onClick={handleImport} disabled={importing || selectedNums.size === 0}>
                  {importing ? 'Importing…' : `Import ${selectedNums.size} invoice${selectedNums.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )
        })()}

        {step === 'conflicts' && (
          <DieselConflictStep
            conflicts={conflicts}
            onDone={onClose}
          />
        )}
      </div>
    </div>
  )
}

const wbgModalOverlay = {
  position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000,
  display:'flex', alignItems:'center', justifyContent:'center',
}
const wbgModalBox = {
  background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8,
  padding:24, width:680, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto',
  boxShadow:'0 8px 32px rgba(0,0,0,0.25)',
}
const wbgTh = { padding:'6px 10px', textAlign:'left', fontWeight:600, fontSize:11,
                borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }
const wbgTd = { padding:'5px 10px', verticalAlign:'middle' }

// The invoice's "current" month per bucket — where it sits now, WITHOUT the
// costing cash rule (Manage never applies it): costing/listing default to the
// statement month, the SARS report to the invoice date. An existing pin wins.
function currentCostingPeriod(inv) {
  if (inv.costing_period_month && inv.costing_period_year)
    return { month: inv.costing_period_month, year: inv.costing_period_year }
  if (!inv.statement_month || !inv.statement_year) return null
  return { month: inv.statement_month, year: inv.statement_year }
}
function currentReportPeriod(inv) {
  if (inv.report_period_month && inv.report_period_year)
    return { month: inv.report_period_month, year: inv.report_period_year }
  if (!inv.invoice_date) return null
  const d = new Date(inv.invoice_date)
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}
// Every managed invoice stores explicit costing/report pins, so a pin alone
// doesn't mean "moved". A bucket is genuinely moved only when its pinned month
// differs from its natural home (costing → statement month; report → invoice date).
function costingMoved(inv) {
  if (!inv.costing_period_month) return false
  return inv.costing_period_month !== inv.statement_month
      || inv.costing_period_year !== inv.statement_year
}
function reportMoved(inv) {
  if (!inv.report_period_month || !inv.invoice_date) return false
  const d = new Date(inv.invoice_date)
  return inv.report_period_month !== d.getMonth() + 1
      || inv.report_period_year !== d.getFullYear()
}

const periodOverrideTooltip = (inv) => {
  const parts = []
  if (costingMoved(inv))
    parts.push(`Costing → ${MONTH_NAMES[inv.costing_period_month]?.slice(0, 3)} ${inv.costing_period_year}`)
  if (reportMoved(inv))
    parts.push(`SARS report → ${MONTH_NAMES[inv.report_period_month]?.slice(0, 3)} ${inv.report_period_year}`)
  return parts.join('  •  ')
}

// "Manage → Move": shift one invoice between months across the three independent
// buckets (costing, SARS/Income-vs-Expenses report, supplier-invoices listing).
function ManagePeriodsModal({ invoices, onClose, onSaved }) {
  const [selectedId, setSelectedId] = useState(invoices[0]?.id ?? null)
  const [search, setSearch]   = useState('')
  const [saving, setSaving]   = useState(false)
  const [costing, setCosting] = useState({ month:'', year:'' })
  const [report, setReport]   = useState({ month:'', year:'' })
  const [listing, setListing] = useState({ month:'', year:'' })

  const inv = invoices.find(i => i.id === selectedId) || null

  // Each bucket's current month — flagged "(current)" in its dropdown. Costing
  // and listing use the statement month (no cash rule); the report uses the
  // invoice date. An existing pin wins.
  const costingCurrent = inv ? currentCostingPeriod(inv) : null
  const reportCurrent  = inv ? currentReportPeriod(inv) : null
  const listingCurrent = inv ? { month: inv.statement_month, year: inv.statement_year } : null

  // Prefill each bucket to its current month so a concrete month is always
  // selected — the user just picks a different month to move it.
  useEffect(() => {
    if (!inv) return
    setCosting({ month: costingCurrent?.month || '', year: costingCurrent?.year || '' })
    setReport({ month: reportCurrent?.month || '', year: reportCurrent?.year || '' })
    setListing({ month: listingCurrent?.month || '', year: listingCurrent?.year || '' })
  }, [selectedId])   // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = invoices.filter(i => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return (i.invoice_number || '').toLowerCase().includes(s)
        || (i.description || '').toLowerCase().includes(s)
        || (i.vehicle_reg || '').toLowerCase().includes(s)
  })

  // Anchor the selection to what's visible: if the current pick falls outside
  // the filtered list (e.g. after typing a search), select the first match. This
  // stops a save ever targeting a hidden/previously-selected invoice.
  useEffect(() => {
    if (filtered.length && !filtered.some(i => i.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
  }, [search])   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!inv) return
    if (!costing.month || !costing.year) { toast.error('Pick a costing month and year'); return }
    if (!report.month || !report.year)   { toast.error('Pick a SARS report month and year'); return }
    if (!listing.month || !listing.year) { toast.error('Pick a supplier-invoices month and year'); return }
    setSaving(true)
    try {
      await updateSupplierInvoicePeriods(inv.id, {
        // Whatever the user chose is pinned exactly — no cash rule, no auto.
        costing_month: parseInt(costing.month),
        costing_year:  parseInt(costing.year),
        report_month:  parseInt(report.month),
        report_year:   parseInt(report.year),
        statement_month: parseInt(listing.month),
        statement_year:  parseInt(listing.year),
      })
      toast.success('Invoice periods updated')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const bucketRow = (label, help, bucket, setBucket, current) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, padding:'11px 0', borderBottom:'1px solid var(--border)' }}>
      <div style={{ maxWidth: 300 }}>
        <div style={{ fontSize:13, fontWeight:600 }}>{label}</div>
        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2, lineHeight:1.4 }}>{help}</div>
      </div>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
        <select
          value={bucket.month}
          onChange={e => {
            const mo = e.target.value
            setBucket(b => ({ month: mo, year: b.year || (current?.year ?? currentYear()) }))
          }}
          style={{ padding:'5px 6px', borderRadius:4, border:'1px solid var(--border)', fontSize:13 }}
        >
          {MONTH_NAMES.slice(1).map((m, i) => {
            // Flag the invoice's current month for this bucket (same month AND year).
            const isCurrent = current?.month === i + 1 && String(current?.year) === String(bucket.year)
            return (
              <option key={i + 1} value={i + 1}>{m.slice(0, 3)}{isCurrent ? ' (current)' : ''}</option>
            )
          })}
        </select>
        <input
          type="number" min="2020" max="2099"
          value={bucket.year}
          onChange={e => setBucket(b => ({ ...b, year: e.target.value }))}
          style={{ width:64, padding:'5px 6px', borderRadius:4, border:'1px solid var(--border)', fontSize:13 }}
        />
      </div>
    </div>
  )

  return (
    <div style={wbgModalOverlay} onClick={onClose}>
      <div style={{ ...wbgModalBox, width: 620 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <h3 style={{ margin:0, fontSize:16 }}>Manage invoice periods</h3>
          <button className="btn-ghost" onClick={onClose} style={{ padding:'2px 6px' }}><X size={14}/></button>
        </div>

        <p style={{ margin:'0 0 12px', fontSize:12, color:'var(--text-muted)', lineHeight:1.5 }}>
          Move a single invoice between months for costing, the SARS report and the
          supplier-invoices listing — independently. Each bucket shows its
          <strong> (current)</strong> month; pick another month to move it there and count
          it in that month's totals. Costing uses the month you pick exactly — no cash rule.
        </p>

        {/* Invoice picker */}
        <div style={{ marginBottom:14 }}>
          <label style={{ display:'block', marginBottom:4, fontSize:13, fontWeight:600 }}>Invoice</label>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by number, description or reg…"
            style={{ width:'100%', padding:'6px 8px', borderRadius:4, border:'1px solid var(--border)', fontSize:13, marginBottom:6 }}
          />
          <select
            value={selectedId ?? ''}
            onChange={e => setSelectedId(parseInt(e.target.value))}
            size={Math.min(6, Math.max(3, filtered.length))}
            style={{ width:'100%', padding:'4px', borderRadius:4, border:'1px solid var(--border)', fontSize:13 }}
          >
            {filtered.map(i => (
              <option key={i.id} value={i.id}>
                {formatDate(i.invoice_date)} · {i.invoice_number || 'Pending'} · {formatCurrency(i.amount)}{(costingMoved(i) || reportMoved(i)) ? '  • moved' : ''}{i.locked_at ? '  🔒 locked' : ''}
              </option>
            ))}
          </select>
        </div>

        {inv && (
          <div>
            {/* Make the target unmistakable — changes apply ONLY to this invoice. */}
            <div style={{ margin:'4px 0 10px', padding:'8px 10px', borderRadius:6, background:'rgba(124,58,237,0.10)', border:'1px solid rgba(124,58,237,0.30)', fontSize:13 }}>
              Editing <strong>{inv.invoice_number || 'Pending'}</strong>
              <span style={{ color:'var(--text-muted)' }}> · {formatDate(inv.invoice_date)} · {formatCurrency(inv.amount)}{inv.vehicle_reg ? ` · ${inv.vehicle_reg}` : ''}</span>
            </div>
            {inv.locked_at && (
              <div style={{ margin:'0 0 10px', padding:'8px 10px', borderRadius:6, background:'rgba(34,197,94,0.10)', border:'1px solid rgba(34,197,94,0.30)', fontSize:12, display:'flex', alignItems:'center', gap:6 }}>
                <Lock size={13} color="#16a34a" />
                This invoice is locked ({formatDate(inv.locked_at)}) — its periods can't be moved. Unlock it first.
              </div>
            )}
            {bucketRow(
              'Costing month',
              'Subcontractor-costing month. The month you pick is used exactly — no cash “previous month” rule and no sent-costing lock.',
              costing, setCosting, costingCurrent,
            )}
            {bucketRow(
              'SARS report month',
              'Month used by the SARS VAT report and the Income vs Expenses report.',
              report, setReport, reportCurrent,
            )}
            {bucketRow(
              'Supplier-invoices month',
              'Statement month this invoice is listed and paid under.',
              listing, setListing, listingCurrent,
            )}
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:18 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !inv || !!inv?.locked_at}
            title={inv?.locked_at ? 'This invoice is locked — unlock it to move its periods' : undefined}>
            {saving ? 'Saving…' : (inv ? `Save ${inv.invoice_number || 'invoice'}` : 'Save')}
          </button>
        </div>
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

// ── Month statement bar ───────────────────────────────────────────────────────
// Sits under each month's totals header. Holds the ONE consolidated statement the
// supplier sends for the whole month (same upload/view/replace/remove flow as a
// per-invoice document, just keyed on the period instead of an invoice) plus a
// free-text note for the month. Rendered whether the month is open or collapsed,
// so the note stays visible.
function MonthStatementBar({ supplierId, year, month, statement, onChange }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')

  const hasDoc = !!statement?.has_document
  const note = statement?.note || ''

  const pickFile = () => {
    if (fileRef.current) {
      fileRef.current.value = ''   // allow re-picking the same filename
      fileRef.current.click()
    }
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await uploadSupplierStatementDocument(supplierId, year, month, formData)
      onChange(data)
      toast.success('Statement uploaded')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally { setBusy(false) }
  }

  const handleView = async () => {
    try {
      await viewSupplierStatementDocument(supplierId, year, month)
    } catch (err) {
      // The month still loaded fine — only the stored file is unreachable. The
      // error body is a Blob here, so errorMessage() can't read its detail.
      if (err?.response?.status === 404) {
        toast.error('This statement is no longer in storage — re-upload it to restore the file.')
      } else {
        toast.error(errorMessage(err))
      }
    }
  }

  const handleRemoveDoc = async () => {
    if (!confirm('Remove the statement document for this month?')) return
    setBusy(true)
    try {
      const { data } = await deleteSupplierStatementDocument(supplierId, year, month)
      onChange(data)
      toast.success('Statement removed')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally { setBusy(false) }
  }

  const saveNote = async (value) => {
    setBusy(true)
    try {
      const { data } = await updateSupplierStatementNote(supplierId, year, month, value)
      onChange(data)
      setEditingNote(false)
      toast.success(value.trim() ? 'Note saved' : 'Note removed')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally { setBusy(false) }
  }

  const startEditNote = () => { setNoteDraft(note); setEditingNote(true) }

  const btn = { fontSize: 12, padding: '3px 8px' }

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        flexBasis: '100%',
        display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px 20px',
        paddingTop: 8, marginTop: 2, borderTop: '1px dashed var(--border)',
        fontSize: 12,
        // The header itself is a click-to-collapse target; this row is not.
        cursor: 'default', userSelect: 'text',
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      {/* Statement document for the whole month */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 24 }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, fontSize: 10 }}>
          Statement
        </span>
        {hasDoc ? (
          <>
            <Paperclip size={12} color="var(--accent)" />
            <span
              title={statement.document_uploaded_by_name
                ? `Uploaded by ${statement.document_uploaded_by_name}${statement.document_uploaded_at ? ` on ${formatDate(statement.document_uploaded_at)}` : ''}`
                : undefined}
              style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {statement.document_filename}
            </span>
            <button className="btn-ghost" style={btn} onClick={handleView} title="View statement">
              <Eye size={12} />
            </button>
            <button className="btn-ghost" style={btn} disabled={busy} onClick={pickFile} title="Replace statement">
              <Upload size={12} />
            </button>
            <button className="btn-ghost" style={btn} disabled={busy} onClick={handleRemoveDoc} title="Remove statement">
              <X size={12} color="var(--danger)" />
            </button>
          </>
        ) : (
          <button className="btn-ghost" style={btn} disabled={busy} onClick={pickFile}>
            <Upload size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
            {busy ? 'Uploading…' : 'Upload statement'}
          </button>
        )}
      </div>

      {/* Month note */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1, minWidth: 260, minHeight: 24 }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, fontSize: 10, paddingTop: 4 }}>
          Note
        </span>
        {editingNote ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1 }}>
            <textarea
              autoFocus
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); setEditingNote(false) }
                // Enter saves; Shift+Enter adds a line (notes are often multi-line).
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(noteDraft) }
              }}
              rows={2}
              placeholder="Note for this month…"
              style={{
                flex: 1, minWidth: 200, padding: '4px 8px', fontSize: 12, resize: 'vertical',
                background: 'var(--bg-input, var(--bg-card))', border: '1px solid var(--border)',
                borderRadius: 5, color: 'var(--text-primary)', outline: 'none',
              }}
            />
            <button className="btn btn-icon btn-primary" disabled={busy} onClick={() => saveNote(noteDraft)} title="Save (Enter)">
              <Save size={13} />
            </button>
            <button className="btn btn-icon btn-ghost" onClick={() => setEditingNote(false)} title="Cancel (Esc)">
              <X size={13} />
            </button>
          </div>
        ) : note ? (
          <>
            <span
              onClick={startEditNote}
              title={statement?.note_updated_by_name
                ? `Last updated by ${statement.note_updated_by_name}${statement.note_updated_at ? ` on ${formatDate(statement.note_updated_at)}` : ''}`
                : 'Click to edit'}
              style={{ flex: 1, cursor: 'pointer', whiteSpace: 'pre-wrap', paddingTop: 3 }}
            >
              {note}
            </span>
            <button className="btn-ghost" style={btn} onClick={startEditNote} title="Edit note">Edit</button>
            <button
              className="btn-ghost" style={btn} disabled={busy} title="Remove note"
              onClick={() => { if (confirm('Remove the note for this month?')) saveNote('') }}
            >
              <X size={12} color="var(--danger)" />
            </button>
          </>
        ) : (
          <button className="btn-ghost" style={btn} disabled={busy} onClick={startEditNote}>
            <Plus size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
            Add note
          </button>
        )}
      </div>
    </div>
  )
}

export default function SupplierProfilePage() {
  const { supplierId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusInvoiceId = searchParams.get('invoice')
  const [flashId, setFlashId] = useState(null)
  const { activeEntity, user, isAdmin } = useAuth()

  const [supplier, setSupplier] = useState(null)
  const [entities, setEntities] = useState([])
  const [trucks, setTrucks] = useState([])
  const [groups, setGroups] = useState([])
  const [truckLoadGroups, setTruckLoadGroups] = useState([])
  const [loading, setLoading] = useState(true)
  // View state remembered per supplier for the browser session, so leaving the
  // page and coming back restores where the user left off.
  const [loadsCollapsed, setLoadsCollapsed] = useSessionState(`supplier.${supplierId}.loadsCollapsed`, {})
  const [collapsed, setCollapsed] = useSessionState(`supplier.${supplierId}.collapsed`, {})

  // Inline editing state
  const [editingId, setEditingId] = useState(null)   // invoice id being edited
  const [editForm, setEditForm] = useState({})
  // True when the row being edited carries the final verification lock or the
  // invoice lock — only its notes field stays editable (everything else renders
  // disabled).
  const [editLocked, setEditLocked] = useState(false)
  const [showNew, setShowNew] = useState(false)       // new inline row visible
  const [newForm, setNewForm] = useState(blankForm(''))
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [showWorkbook, setShowWorkbook] = useState(false)  // workbook export period modal
  const [deleteTarget, setDeleteTarget] = useState(null)  // invoice pending deletion
  // Expanded multi-line invoices — stored as an array (a Set can't be JSON'd),
  // exposed as a Set so call sites read naturally.
  const [openInvoiceIdsArr, setOpenInvoiceIdsArr] = useSessionState(`supplier.${supplierId}.openInvoices`, [])
  const openInvoiceIds = useMemo(() => new Set(openInvoiceIdsArr), [openInvoiceIdsArr])
  const setOpenInvoiceIds = useCallback(
    (updater) => setOpenInvoiceIdsArr(arr => [...updater(new Set(arr))]),
    [setOpenInvoiceIdsArr]
  )
  const [selectedIds, setSelectedIds] = useState(new Set())  // invoices ticked for bulk verify / pay
  const [verifyingBulk, setVerifyingBulk] = useState(false)
  const [payingBulk, setPayingBulk] = useState(false)
  const [finalizingBulk, setFinalizingBulk] = useState(false)
  const [unfinalizingBulk, setUnfinalizingBulk] = useState(false)
  const firstInputRef = useRef(null)
  // Physical-invoice attachment: one shared hidden file input, targeted at a row.
  const attachInputRef = useRef(null)
  const attachTargetId = useRef(null)
  const [attachBusyId, setAttachBusyId] = useState(null)
  // Invoice lock (closed off/reconciled): locked-date modal + per-row busy flag.
  // lockModal = { invoices: [...] } while the confirm dialog is open.
  const [lockModal, setLockModal] = useState(null)
  const [lockDate, setLockDate] = useState(today)
  const [lockSaving, setLockSaving] = useState(false)
  const [lockBusyId, setLockBusyId] = useState(null)

  // Diesel rate auto-fill state (for diesel suppliers)
  const [dieselRate, setDieselRate] = useState(null)
  const [amountAutoFilled, setAmountAutoFilled] = useState(false)
  const [subbies, setSubbies] = useState([])
  const [dieselFillups, setDieselFillups] = useState([])
  // Remembered across reloads, and shared by every supplier — it's a view
  // preference, not something to re-pick on each profile.
  const [sortCol, setSortCol] = useLocalState('sort:supplier.invoices.col', 'vehicle_reg')
  const [sortDir, setSortDir] = useLocalState('sort:supplier.invoices.dir', 'asc')
  const [hiddenCols, setHiddenCols] = useLocalState('supplier.invoices.hiddenCols', [])
  const [filterText, setFilterText] = useSessionState(`supplier.${supplierId}.filter`, '')

  // Which supplier the loaded groups belong to — on quick-switch the old
  // supplier's rows linger until the fetch resolves, and scroll restore must
  // not fire against them.
  const groupsSupplierRef = useRef(null)
  const loadInvoices = useCallback(() =>
    getSupplierInvoices({ supplier_id: supplierId }).then(r => {
      groupsSupplierRef.current = supplierId
      setGroups(r.data)
    })
  , [supplierId])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getSupplier(supplierId).then(r => {
        setSupplier(r.data)
        setNewForm(blankForm(r.data.entity_id, r.data.is_diesel_supplier))
      }),
      getEntities().then(r => setEntities(r.data)),
    ]).then(() => setLoading(false))
  }, [supplierId])

  // Sibling suppliers in the same entity, for the quick-switch dropdown
  const [entitySuppliers, setEntitySuppliers] = useState([])
  useEffect(() => {
    if (!supplier?.entity_id) return
    getSuppliers({ entity_id: supplier.entity_id, limit: 500 })
      .then(r => setEntitySuppliers(
        (r.data || []).sort((a, b) => a.name.localeCompare(b.name))
      ))
      .catch(() => {})
  }, [supplier?.entity_id])

  useEffect(() => { if (!loading) loadInvoices() }, [loading, loadInvoices])

  // Deep-link from the "to verify" modal: scroll to + briefly highlight the
  // target invoice once its row exists, then drop the ?invoice param so a
  // refresh doesn't re-trigger it.
  useEffect(() => {
    if (!focusInvoiceId || !groups.length) return
    const exists = groups.some(g => g.invoices.some(i => String(i.id) === String(focusInvoiceId)))
    if (!exists) return
    const t = setTimeout(() => {
      const el = document.getElementById(`si-row-${focusInvoiceId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlashId(String(focusInvoiceId))
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('invoice'); return p }, { replace: true })
    }, 150)
    const clear = setTimeout(() => setFlashId(null), 2600)
    return () => { clearTimeout(t); clearTimeout(clear) }
  }, [focusInvoiceId, groups, setSearchParams])

  // Scroll position, remembered per supplier: the app scrolls inside <main>
  // (AppLayout), not the window. Written straight to sessionStorage on scroll
  // so a refresh keeps it too; restored once the rows exist so the offset
  // isn't clamped by a still-empty page. A ?invoice deep link wins.
  const scrollKey = `supplier.${supplierId}.scroll`
  const scrollRestored = useRef(false)
  useEffect(() => { if (loading) scrollRestored.current = false }, [loading])
  useEffect(() => {
    const el = document.querySelector('main')
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        try { sessionStorage.setItem(scrollKey, String(el.scrollTop)) } catch {}
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [scrollKey])
  useEffect(() => {
    if (scrollRestored.current || loading) return
    if (groupsSupplierRef.current !== supplierId) return
    scrollRestored.current = true
    if (focusInvoiceId) return
    let saved = 0
    try { saved = Number(sessionStorage.getItem(scrollKey)) || 0 } catch {}
    const el = document.querySelector('main')
    if (el && saved > 0) el.scrollTop = saved
  }, [loading, groups, focusInvoiceId, scrollKey, supplierId])

  // Per-line verification overlay for multi-line/split invoices: users tick a
  // sub-line once they've confirmed its amount on that subcontractor's costing
  const [lineVerif, setLineVerif] = useState({})
  const lineTarget = (invId, liId) => `si-line:${supplierId}:${invId}:${liId}`
  const loadLineVerif = useCallback(() => {
    getVerifications(`si-line:${supplierId}:`)
      .then(r => {
        const map = {}
        for (const v of r.data) map[v.target] = v
        setLineVerif(map)
      })
      .catch(() => setLineVerif({}))
  }, [supplierId])
  useEffect(() => { if (!loading) loadLineVerif() }, [loading, loadLineVerif])

  const handleVerifyLine = async (target, intent) => {
    try { const { data } = await verifyValue(target, supplier?.entity_id, intent); setLineVerif(prev => ({ ...prev, [data.target]: data })) }
    catch (e) { toast.error(errorMessage(e, 'Verification failed')) }
  }
  const handleFinalizeLine = async (target, intent) => {
    try { const { data } = await finalizeValue(target, supplier?.entity_id, intent); setLineVerif(prev => ({ ...prev, [data.target]: data })) }
    catch (e) { toast.error(errorMessage(e, 'Lock failed')) }
  }

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
    getSubcontractors({ entity_id: supplier.entity_id, exclude_ended: true, limit: 500 })
      .then(r => setSubbies(r.data || []))
      .catch(() => setSubbies([]))
  }, [supplier?.id, supplier?.entity_id, supplier?.is_diesel_supplier])

  // Fetch diesel fill-ups for slip# dropdown in sub-lines (diesel suppliers only)
  useEffect(() => {
    if (!supplier?.is_diesel_supplier || !supplier?.entity_id) { setDieselFillups([]); return }
    getDieselFillUpSlips({ entity_id: supplier.entity_id })
      .then(r => setDieselFillups(r.data || []))
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
    setEditLocked(!!(inv.verified3_by || inv.verified3_by_initials) || !!inv.locked_at)
    setEditForm({
      entity_id: inv.entity_id,
      invoice_date: inv.invoice_date?.slice(0, 10) || today,
      invoice_number: inv.invoice_number || '',
      amount: String(inv.amount || ''),
      deposit_paid: inv.deposit_paid ? String(inv.deposit_paid) : '',
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
        const incl = parseFloat(li.amount_incl_vat) || 0
        // A line is non-VAT when its incl == excl; default new/zero lines to VAT.
        const _vat = excl > 0 ? incl > excl : true
        return { ...li, _key: li.id, _vat, _rate: qty > 0 ? String(Math.round(excl / qty * 100) / 100) : '', line_date: li.line_date ? String(li.line_date).slice(0, 10) : '' }
      }) : [],
      statement_month: inv.statement_month || currentMonth(),
      statement_year: inv.statement_year || currentYear(),
    })
    if (inv.is_multi_line) {
      setOpenInvoiceIds(s => { const n = new Set(s); n.add(inv.id); return n })
    }
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({}); setEditLocked(false) }
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
    deposit_paid: form.deposit_paid !== '' && form.deposit_paid != null ? parseFloat(form.deposit_paid) : null,
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
    line_date: li.line_date || null,
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
      setNewForm(blankForm(supplier?.entity_id, supplier?.is_diesel_supplier))
      setAmountAutoFilled(false)
      await loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }

  const saveEdit = async () => {
    // Locked (finalised) record: notes is the only editable field, so send just
    // that — the server's final-lock whitelist permits a note-only update.
    if (editLocked) {
      setSaving(true)
      try {
        await updateSupplierInvoice(editingId, { notes: (editForm.notes || '').trim() })
        toast.success('Note saved')
        setEditingId(null); setEditLocked(false)
        await loadInvoices()
      } catch (e) { toast.error(errorMessage(e)) }
      finally { setSaving(false) }
      return
    }
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

  // ── Physical-invoice attachment ───────────────────────────────────────────
  const openAttachPicker = (inv) => {
    attachTargetId.current = inv.id
    if (attachInputRef.current) {
      attachInputRef.current.value = ''  // allow re-picking the same filename
      attachInputRef.current.click()
    }
  }

  const handleAttachFile = async (e) => {
    const file = e.target.files?.[0]
    const id = attachTargetId.current
    if (!file || !id) return
    setAttachBusyId(id)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await uploadSupplierInvoiceAttachment(id, formData)
      patchInvoice(data)
      toast.success('Invoice document attached')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAttachBusyId(null)
      attachTargetId.current = null
    }
  }

  const handleViewAttachment = async (inv) => {
    try {
      await viewSupplierInvoiceAttachment(inv.id)
    } catch (err) {
      // The invoice record still loaded fine — only the stored document is
      // unreachable (never uploaded, or lost from storage). Don't surface a raw
      // 404: tell the user plainly so the rest of the row keeps working and they
      // know a re-upload will restore it. (The error body here is a Blob, so
      // errorMessage() can't read the detail anyway.)
      if (err?.response?.status === 404) {
        toast.error('This invoice document is no longer in storage — re-upload it to restore the file.')
      } else {
        toast.error(errorMessage(err))
      }
    }
  }

  const handleRemoveAttachment = async (inv) => {
    setAttachBusyId(inv.id)
    try {
      await deleteSupplierInvoiceAttachment(inv.id)
      patchInvoice({ id: inv.id, has_attachment: false, attachment_filename: null })
      toast.success('Attachment removed')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAttachBusyId(null)
    }
  }

  // Patch a single invoice's verification fields in place (the verify/finalize
  // endpoints return the full row) instead of refetching every statement group.
  // Merge — the response omits line_items / is_multi_line / diesel_fillup_id, so
  // spreading over the existing row preserves them.
  const patchInvoice = (updated) =>
    setGroups(prev => prev.map(g => ({
      ...g,
      invoices: g.invoices.map(i => i.id === updated.id ? { ...i, ...updated } : i),
    })))

  // Same idea for a month's statement document/note — the statement endpoints
  // return the whole statement, so drop it straight onto its group.
  const patchStatement = (updated) =>
    setGroups(prev => prev.map(g => (
      g.statement_year === updated.statement_year && g.statement_month === updated.statement_month
        ? { ...g, statement: updated }
        : g
    )))

  const handleVerify = async (inv, intent) => {
    try {
      const { data } = await verifySupplierInvoice(inv.id, intent)
      patchInvoice(data)
    } catch (e) { toast.error(errorMessage(e)) }
  }

  // Whether the current user can still ADD a verification tick to this invoice —
  // mirrors VerifyBadge's add logic so the bulk checkbox only shows where a
  // "Verify selected" would actually do something (step 1, or step 2 by another
  // user). Records already verified by this user / fully handled are skipped.
  const canUserVerify = (inv) => {
    const step3 = !!(inv.verified3_by || inv.verified3_by_initials)
    if (step3) return false   // final lock applied — no bulk verification
    const step1 = !!(inv.verified || inv.is_verified)
    const step2 = !!(inv.verified2_by || inv.verified2_by_initials)
    if (!step1) return true
    if (!step2 && inv.verified_by !== user?.id) return true
    return false
  }

  // Whether the current (admin) user can apply the final lock to this invoice —
  // admin only, not already locked. No step-1 prerequisite: the admin may lock
  // on her own; other users can still add ticks to empty steps afterwards.
  const canUserFinalize = (inv) =>
    isAdmin && !(inv.verified3_by || inv.verified3_by_initials)

  // The reverse of the above: invoices this user can UNLOCK in bulk. Mirrors the
  // single-invoice rule in VerifyBadge/apply_finalize_step — only the admin who
  // applied the final lock can take it off, so invoices locked by someone else
  // stay out of the selection instead of erroring one by one.
  const canUserUnfinalize = (inv) =>
    isAdmin && !!inv.verified3_by && inv.verified3_by === user?.id

  // A row is selectable if there's a bulk action it can take part in: a pending
  // verification tick, a pending final lock, a final lock of this user's to
  // remove, it's still unpaid (bulk mark-paid), or it's not yet invoice-locked
  // (bulk lock).
  const canUserSelect = (inv) =>
    canUserVerify(inv) || canUserFinalize(inv) || canUserUnfinalize(inv) || !inv.is_paid || !inv.locked_at

  const toggleSelect = (id) => setSelectedIds(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const clearSelection = () => setSelectedIds(new Set())

  // Apply the current user's next verification step to every selected invoice.
  // Reuses the single-invoice endpoint with the explicit 'add' intent (safe — it
  // no-ops server-side on anything this user can't tick), patching each row in
  // place as it returns.
  const handleVerifySelected = async () => {
    const targets = groups.flatMap(g => g.invoices)
      .filter(i => selectedIds.has(i.id) && canUserVerify(i))
    if (!targets.length) return
    setVerifyingBulk(true)
    let ok = 0
    for (const inv of targets) {
      try {
        const { data } = await verifySupplierInvoice(inv.id, 'add')
        patchInvoice(data)
        ok++
      } catch (e) { toast.error(errorMessage(e)) }
    }
    setVerifyingBulk(false)
    clearSelection()
    if (ok) toast.success(`Verified ${ok} invoice${ok === 1 ? '' : 's'}`)
  }

  // Apply the admin final lock to every selected eligible invoice. Reuses the
  // single-invoice endpoint with the explicit 'apply' intent (no-ops server-side
  // on anything already locked), patching each row in place as it returns.
  const handleFinalizeSelected = async () => {
    const targets = groups.flatMap(g => g.invoices)
      .filter(i => selectedIds.has(i.id) && canUserFinalize(i))
    if (!targets.length) return
    if (!confirm(`Apply the final lock to ${targets.length} invoice${targets.length === 1 ? '' : 's'}? Locked invoices can no longer be edited.`)) return
    setFinalizingBulk(true)
    let ok = 0
    for (const inv of targets) {
      try {
        const { data } = await finalizeSupplierInvoice(inv.id, 'apply')
        patchInvoice(data)
        ok++
      } catch (e) { toast.error(errorMessage(e)) }
    }
    setFinalizingBulk(false)
    clearSelection()
    if (ok) toast.success(`Final lock applied to ${ok} invoice${ok === 1 ? '' : 's'}`)
  }

  // Take the admin final lock back off the selection — the counterpart of the
  // above, for when a locked batch turns out to need a correction. Explicit
  // 'remove' intent, so anything already unlocked is a server-side no-op rather
  // than an accidental re-lock.
  const handleUnfinalizeSelected = async () => {
    const targets = groups.flatMap(g => g.invoices)
      .filter(i => selectedIds.has(i.id) && canUserUnfinalize(i))
    if (!targets.length) return
    if (!confirm(`Remove the final lock from ${targets.length} invoice${targets.length === 1 ? '' : 's'}? They become editable again (step 1/2 verifications are kept).`)) return
    setUnfinalizingBulk(true)
    let ok = 0
    for (const inv of targets) {
      try {
        const { data } = await finalizeSupplierInvoice(inv.id, 'remove')
        patchInvoice(data)
        ok++
      } catch (e) { toast.error(errorMessage(e)) }
    }
    setUnfinalizingBulk(false)
    clearSelection()
    if (ok) toast.success(`Final lock removed from ${ok} invoice${ok === 1 ? '' : 's'}`)
  }

  // Mark every selected unpaid invoice as paid (a single payment covering many
  // invoices). Already-paid selections are skipped. Stamped with today's date.
  const handleMarkPaidSelected = async () => {
    const targets = groups.flatMap(g => g.invoices)
      .filter(i => selectedIds.has(i.id) && !i.is_paid)
    if (!targets.length) return
    setPayingBulk(true)
    let ok = 0
    for (const inv of targets) {
      try {
        await updateSupplierInvoice(inv.id, { is_paid: true, paid_date: today })
        ok++
      } catch (e) { toast.error(errorMessage(e)) }
    }
    setPayingBulk(false)
    clearSelection()
    if (ok) {
      toast.success(`Marked ${ok} invoice${ok === 1 ? '' : 's'} as paid`)
      loadInvoices()
    }
  }

  const handleFinalize = async (inv, intent) => {
    try {
      const { data } = await finalizeSupplierInvoice(inv.id, intent)
      patchInvoice(data)
    } catch (e) { toast.error(errorMessage(e)) }
  }

  // ── Invoice lock (closed off/reconciled) ──────────────────────────────────
  // Locking asks for the locked-on date first (backdatable, like the Diesel
  // Log's lock); the same modal serves the single row and the bulk selection.
  const openLockModal = (invoices) => {
    const targets = invoices.filter(i => !i.locked_at)
    if (!targets.length) return
    setLockDate(today)
    setLockModal({ invoices: targets })
  }

  const confirmLock = async () => {
    if (!lockModal || !lockDate) return
    const targets = lockModal.invoices
    setLockSaving(true)
    try {
      await setSupplierInvoiceLocksBulk({
        supplier_invoice_ids: targets.map(i => i.id),
        locked_date: lockDate,
      })
      toast.success(targets.length === 1
        ? `Invoice ${targets[0].invoice_number || ''} locked`.trim()
        : `${targets.length} invoices locked`)
      setLockModal(null)
      setEditingId(null)
      clearSelection()
      await loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setLockSaving(false) }
  }

  const handleUnlockInvoice = async (inv) => {
    if (!window.confirm(`Unlock invoice ${inv.invoice_number || `#${inv.id}`}? Its values can then be changed again.`)) return
    setLockBusyId(inv.id)
    try {
      await setSupplierInvoiceLock({ supplier_invoice_id: inv.id }, { locked: false })
      toast.success('Invoice unlocked')
      await loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setLockBusyId(null) }
  }

  // Marking paid stamps today's date (sent as plain yyyy-mm-dd so the calendar
  // day is stored as-is, no timezone shift); unmarking clears it.
  const handleMarkPaid = async (inv, e) => {
    e.stopPropagation()
    try {
      await updateSupplierInvoice(inv.id, {
        is_paid: !inv.is_paid,
        paid_date: inv.is_paid ? null : today,
      })
      loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const handleMarkAllPaid = async (group) => {
    if (!confirm(`Mark all invoices in ${MONTH_NAMES[group.statement_month]} ${group.statement_year} as paid?`)) return
    try {
      await markStatementPaid(supplierId, group.statement_year, group.statement_month, today)
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
  const openLineCount = allInvoices.filter(i => i.is_multi_line && openInvoiceIds.has(i.id)).length
  const allMonthsCollapsed = groups.length > 0 && groups.every(g => collapsed[`${g.statement_year}-${g.statement_month}`])
  const selectedVerifiable  = allInvoices.filter(i => selectedIds.has(i.id) && canUserVerify(i))
  const selectedUnpaid      = allInvoices.filter(i => selectedIds.has(i.id) && !i.is_paid)
  const selectedTotal       = allInvoices.filter(i => selectedIds.has(i.id)).reduce((s, i) => s + Number(i.amount || 0), 0)
  const selectedUnpaidTotal = selectedUnpaid.reduce((s, i) => s + Number(i.amount || 0), 0)
  const selectedFinalizable = allInvoices.filter(i => selectedIds.has(i.id) && canUserFinalize(i))
  const selectedUnfinalizable = allInvoices.filter(i => selectedIds.has(i.id) && canUserUnfinalize(i))
  const selectedLockable    = allInvoices.filter(i => selectedIds.has(i.id) && !i.locked_at)
  const bulkBusy = verifyingBulk || payingBulk || finalizingBulk || unfinalizingBulk || lockSaving
  const multiEntity = entities.length > 1

  // Map a vehicle registration to its owning subcontractor (display fallback).
  // Temp/old plates are indexed too; real registrations take precedence. Regs are
  // normalised (strip spaces + uppercase) to match the backend's _norm_reg_key,
  // so a reg captured as "KSC 007 EC" still resolves against truck "KSC007EC".
  const normReg = (reg) => (reg || '').replace(/\s+/g, '').toUpperCase()
  const truckByReg = {}
  for (const t of trucks || []) {
    if (t.temp_registration) truckByReg[normReg(t.temp_registration)] = t
  }
  for (const t of trucks || []) {
    if (t.registration) truckByReg[normReg(t.registration)] = t
  }
  const ownerForReg = (reg) => {
    if (!reg) return null
    const t = truckByReg[normReg(reg)]
    // subcontractor_display_name is the backend-computed owner (FK-linked
    // subcontractor → free-text name → operator); older fields kept as fallback
    return t ? (t.subcontractor_display_name || t.subcontractor_name || t.operator || null) : null
  }
  // Authoritative source for the column: the per-invoice value resolved by the
  // backend against the invoice's OWN entity. Falls back to the client-side
  // trucks map (active-entity scoped) only for rows from an older payload that
  // predate the server field.
  const subForInvoice = (inv) => inv.subcontractor_display_name || ownerForReg(inv.vehicle_reg)
  // Suppliers with requires_registration=false (e.g. Axxess) don't use vehicle regs on invoices
  const showVehicleReg = supplier?.requires_registration !== false
  const isDiesel = supplier?.is_diesel_supplier === true
  const isWBGDiesel = isDiesel && supplier?.name?.toLowerCase().includes('wbg')
  // Diesel suppliers with an Excel statement importer (WBG pivot or Intsimbi
  // transaction report). Both feed the same WBGImportModal → bulk import.
  const supportsExcelImport = isDiesel && /wbg|intsimbi/.test(supplier?.name?.toLowerCase() || '')
  const supplierEntityCode = entities.find(e => e.id === supplier?.entity_id)?.code
  // Incl-only sub-line capture (previously OBHI suppliers + Cradock Truck Stop)
  // has been retired: all non-diesel multi-line invoices now capture each
  // sub-line with editable Excl + Incl amounts and a per-line VAT toggle. Diesel
  // suppliers use the separate DieselLineItemsEditor and are unaffected.
  const amountInclOnly = false

  // Columns that apply to this supplier, minus the ones the user has hidden.
  // Header, cells and the footer colSpans all key off this one list.
  const availableCols = INVOICE_COLUMNS.filter(c => !c.when || c.when({ multiEntity, showVehicleReg, isDiesel, isWBGDiesel }))
  const visibleCols = availableCols.filter(c => c.fixed || !hiddenCols.includes(c.key))
  const colVisible = (key) => visibleCols.some(c => c.key === key)
  const amountColIdx = visibleCols.findIndex(c => c.key === 'amount')
  // Merino & Oukop send a statement carrying the slip# before the physical slip
  // is received, so the slip# hasn't been captured as a fill-up yet. Let the user
  // type the slip# freely instead of forcing a pick from the fill-up dropdown.
  const slipFreeText = isDiesel &&
    /merino|oukop/i.test(`${supplier?.name || ''} ${supplier?.short_name || ''}`)

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
        case 'subcontractor':  av = (subForInvoice(a) || '').toLowerCase(); bv = (subForInvoice(b) || '').toLowerCase(); break
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
                    R&nbsp;{parseFloat(dieselRate.rate_per_litre).toFixed(4)}/L
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
          {entitySuppliers.length > 1 && (
            <div style={{ width: 240 }} title={`Jump to another ${supplierEntityCode || ''} supplier`}>
              <SearchableSelect
                value={String(supplierId)}
                onChange={id => { if (id && id !== String(supplierId)) navigate(`/suppliers/${id}`) }}
                options={entitySuppliers}
                getValue={o => String(o.id)}
                getLabel={o => o.name}
                placeholder="Switch supplier…"
                formInput
              />
            </div>
          )}
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
            extraItems={[{
              key: 'workbook',
              label: 'Supplier Workbook…',
              title: 'Excel workbook with month sections — same layout as the Reports → Supplier Summary export, for this supplier only',
              icon: <FileSpreadsheet size={14} style={{ color: '#0d9488' }} />,
              onClick: () => setShowWorkbook(true),
            }]}
          />
          {supportsExcelImport && (
            <button className="btn-ghost" onClick={() => setShowImport(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Upload size={15} /> Import Excel
            </button>
          )}
          {allInvoices.length > 0 && (
            <button className="btn-ghost" onClick={() => setShowManage(true)}
              title="Move an invoice between months for costing / SARS report / listing"
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Calendar size={15} /> Manage
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
        <div style={{ marginBottom: 16 }}>
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

      {/* Bulk-action bar — floats while invoices are selected */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 14, zIndex: 900,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 16px',
          boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {selectedIds.size} selected
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · </span>
            {formatCurrency(selectedTotal)}
          </span>
          {selectedVerifiable.length > 0 && (
            <button
              onClick={handleVerifySelected}
              disabled={bulkBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: verifyingBulk ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              <CheckCircle size={15} />
              {verifyingBulk ? 'Verifying…' : `Verify selected (${selectedVerifiable.length})`}
            </button>
          )}
          {selectedFinalizable.length > 0 && (
            <button
              onClick={handleFinalizeSelected}
              disabled={bulkBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: '#7c3aed', color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: finalizingBulk ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              <Lock size={15} />
              {finalizingBulk ? 'Locking…' : `Final lock selected (${selectedFinalizable.length})`}
            </button>
          )}
          {selectedUnfinalizable.length > 0 && (
            <button
              onClick={handleUnfinalizeSelected}
              disabled={bulkBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: '#d97706', color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: unfinalizingBulk ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              <Unlock size={15} />
              {unfinalizingBulk ? 'Unlocking…' : `Remove final lock (${selectedUnfinalizable.length})`}
            </button>
          )}
          {selectedUnpaid.length > 0 && (
            <button
              onClick={handleMarkPaidSelected}
              disabled={bulkBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: payingBulk ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              <CheckCircle size={15} />
              {payingBulk ? 'Marking…' : `Mark paid (${selectedUnpaid.length} · ${formatCurrency(selectedUnpaidTotal)})`}
            </button>
          )}
          {selectedLockable.length > 0 && (
            <button
              onClick={() => openLockModal(selectedLockable)}
              disabled={bulkBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: lockSaving ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              <Lock size={15} />
              {lockSaving ? 'Locking…' : `Lock selected (${selectedLockable.length})`}
            </button>
          )}
          <button
            onClick={clearSelection}
            disabled={bulkBusy}
            className="btn-ghost"
            style={{ fontSize: 13, padding: '6px 10px' }}>
            Clear
          </button>
        </div>
      )}

      {/* Shared hidden picker for invoice-document attachments (targeted per row) */}
      <input
        ref={attachInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        style={{ display: 'none' }}
        onChange={handleAttachFile}
      />

      {/* Locked-on date prompt for the invoice lock (single row or bulk selection) */}
      {lockModal && (
        <div style={wbgModalOverlay} onClick={() => setLockModal(null)}>
          <div style={{ ...wbgModalBox, width: 380 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Lock size={15} color="#16a34a" />
              {lockModal.invoices.length === 1
                ? `Lock invoice ${lockModal.invoices[0].invoice_number || `#${lockModal.invoices[0].id}`}`
                : `Lock ${lockModal.invoices.length} invoices`}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              While locked, nothing on {lockModal.invoices.length === 1 ? 'this invoice' : 'these invoices'} can
              be added, changed or removed — values, lines, diesel logs and deletion all refuse.
              Paid status, notes, verification ticks and attachments stay available.
            </div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Locked on *</label>
            <DateInput
              autoFocus
              value={lockDate}
              onChange={e => setLockDate(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') confirmLock()
                if (e.key === 'Escape') setLockModal(null)
              }}
              className="form-input"
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Backdate this to the day the invoice was actually closed off — it shows on the badge and in the audit trail.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn-ghost" style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => setLockModal(null)}>
                Cancel
              </button>
              <button
                onClick={confirmLock}
                disabled={!lockDate || lockSaving}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 16px', borderRadius: 7, border: 'none',
                  background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: 13,
                  cursor: lockDate && !lockSaving ? 'pointer' : 'default', opacity: lockDate && !lockSaving ? 1 : 0.6,
                }}>
                <Lock size={15} />
                {lockSaving ? 'Locking…' : lockModal.invoices.length === 1 ? 'Lock Invoice' : `Lock ${lockModal.invoices.length} Invoices`}
              </button>
            </div>
          </div>
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

      {showManage && (
        <ManagePeriodsModal
          invoices={allInvoices}
          onClose={() => setShowManage(false)}
          onSaved={() => { loadInvoices() }}
        />
      )}

      {showWorkbook && (
        <SupplierWorkbookExportModal
          supplier={supplier}
          onClose={() => setShowWorkbook(false)}
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
          amountInclOnly={amountInclOnly}
          freeTextSlip={slipFreeText}
          showReg={showVehicleReg}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
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

          {/* View controls. Open months / expanded lines are remembered for
              the session, so a refresh brings them back — these close the
              lot in one click. */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {openLineCount > 0 && (
              <button
                className="btn-ghost"
                onClick={() => setOpenInvoiceIdsArr([])}
                title="Collapse every expanded invoice's line items"
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 10px' }}
              >
                <ChevronsDownUp size={13} /> Collapse lines ({openLineCount})
              </button>
            )}
            <button
              className="btn-ghost"
              onClick={() => setCollapsed(allMonthsCollapsed ? {} : Object.fromEntries(groups.map(g => [`${g.statement_year}-${g.statement_month}`, true])))}
              title={allMonthsCollapsed ? 'Open every month' : 'Close every month'}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 10px' }}
            >
              {allMonthsCollapsed ? <><ChevronsUpDown size={13} /> Expand months</> : <><ChevronsDownUp size={13} /> Collapse months</>}
            </button>
            <ColumnPicker columns={availableCols} hidden={hiddenCols} onChange={setHiddenCols} />
          </div>
        </div>
      )}

      {groups.map((group, groupIndex) => {
        const key = `${group.statement_year}-${group.statement_month}`
        const isOpen = !collapsed[key]
        const unpaidCount = group.invoices.filter(i => !i.is_paid).length
        // Paid = fully-paid invoices in full + any deposits on the rest; outstanding is the remainder.
        const paidTotal = group.invoices.reduce((s, i) =>
          s + (i.is_paid ? (parseFloat(i.amount) || 0) : (parseFloat(i.deposit_paid) || 0)), 0)
        const outstandingTotal = (group.subtotal || 0) - paidTotal
        const groupSelectable = group.invoices.filter(canUserSelect)
        const allGroupSelected = groupSelectable.length > 0 && groupSelectable.every(i => selectedIds.has(i.id))
        const toggleGroupSelect = () => setSelectedIds(s => {
          const n = new Set(s)
          if (allGroupSelected) groupSelectable.forEach(i => n.delete(i.id))
          else groupSelectable.forEach(i => n.add(i.id))
          return n
        })

        return (
          <div key={key} style={{
            ...styles.group,
            borderColor: group.is_fully_paid ? 'var(--border)' : unpaidCount > 0 ? '#d97706' : 'var(--border)',
          }}>
            {/* Group header */}
            {/* Closed off with a solid rule when the month is open: the invoice
                table's head shares this section's --bg-surface background, so
                without it the statement row reads as the table's first line. */}
            <div
              style={{ ...styles.groupHeader, ...(isOpen ? { borderBottom: '1px solid var(--border)' } : null) }}
              onClick={() => toggleCollapse(key)}
            >
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
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>Paid</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#16a34a' }}>{formatCurrency(paidTotal)}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>Total</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{formatCurrency(group.subtotal)}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>Outstanding</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: outstandingTotal > 0.005 ? '#d97706' : '#16a34a' }}>{formatCurrency(outstandingTotal)}</span>
                </span>
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

              {/* Whole-month statement document + note — flexBasis 100% drops it
                  onto its own line INSIDE the header, so it sits with the month
                  and its totals rather than reading as a separate strip. */}
              <MonthStatementBar
                supplierId={supplierId}
                year={group.statement_year}
                month={group.statement_month}
                statement={group.statement}
                onChange={patchStatement}
              />
            </div>

            {/* Invoice table */}
            {isOpen && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface)' }}>
                      {colVisible('entity') && <th style={styles.th}>Entity</th>}
                      {colVisible('date') && (
                        <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('invoice_date')}>
                          Date{sortArrow('invoice_date')}
                        </th>
                      )}
                      {colVisible('period') && <th style={styles.th}>Period</th>}
                      <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('invoice_number')}>
                        Invoice #{sortArrow('invoice_number')}
                      </th>
                      {colVisible('vehicle_reg') && (
                        <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('vehicle_reg')}>
                          Vehicle Reg{sortArrow('vehicle_reg')}
                        </th>
                      )}
                      {colVisible('subcontractor') && (
                        <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('subcontractor')}>
                          Subcontractor{sortArrow('subcontractor')}
                        </th>
                      )}
                      {colVisible('description') && <th style={styles.th}>Description</th>}
                      <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('amount')}>
                        Amount{sortArrow('amount')}
                      </th>
                      {/* Deposit / Outstanding / VAT don't apply to diesel statements */}
                      {colVisible('deposit') && <th style={{ ...styles.th, textAlign: 'right' }}>Deposit</th>}
                      {colVisible('outstanding') && <th style={{ ...styles.th, textAlign: 'right' }}>Outstanding</th>}
                      {colVisible('litres') && (
                        <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('litres')}>
                          Litres{sortArrow('litres')}
                        </th>
                      )}
                      {colVisible('rate') && <th style={{ ...styles.th, textAlign: 'right' }}>Rate/L</th>}
                      {colVisible('vat') && <th style={{ ...styles.th, textAlign: 'center' }}>VAT</th>}
                      <th style={{ ...styles.th, width: 28, textAlign: 'center' }}>
                        {groupSelectable.length > 0 && (
                          <input
                            type="checkbox"
                            checked={allGroupSelected}
                            onChange={toggleGroupSelect}
                            title="Select all"
                            style={{ cursor: 'pointer' }}
                          />
                        )}
                      </th>
                      {colVisible('verified') && <th style={{ ...styles.th, textAlign: 'center' }}>Verified</th>}
                      {colVisible('paid') && <th style={{ ...styles.th, textAlign: 'center' }}>Paid</th>}
                      {colVisible('paid_date') && <th style={styles.th}>Paid Date</th>}
                      {colVisible('notes') && <th style={styles.th}>Notes</th>}
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {processInvoices(group.invoices).map(inv => {
                      const isEditing = editingId === inv.id
                      // Invoice lock (closed off/reconciled) — separate from the
                      // verification final lock but freezes the row the same way.
                      const invLocked = !!inv.locked_at
                      const isLocked = !!(inv.verified3_by || inv.verified3_by_initials) || invLocked
                      // When editing a locked row, every field but notes is read-only
                      // (rendered as plain text). `editFields` gates the editable inputs;
                      // `lockEdit` is true only while editing a locked row.
                      const lockEdit = isEditing && isLocked
                      const editFields = isEditing && !isLocked
                      const f = editForm
                      const isExpanded = openInvoiceIds.has(inv.id)
                      const totalCols = visibleCols.length

                      return (
                        <Fragment key={inv.id}>
                          <tr
                            id={`si-row-${inv.id}`}
                            onClick={() => !isEditing && startEdit(inv)}
                            style={{
                              borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                              background: isEditing ? 'var(--accent-subtle)' : (flashId === String(inv.id) ? 'rgba(245,158,11,0.18)' : 'transparent'),
                              opacity: inv.is_paid && !isEditing ? 0.6 : 1,
                              cursor: isEditing ? 'default' : 'pointer',
                              transition: 'background 0.1s',
                            }}
                          >
                            {/* Entity cell */}
                            {colVisible('entity') && (
                              <td style={styles.td}>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                                  {entities.find(e => e.id === inv.entity_id)?.code || '—'}
                                </span>
                              </td>
                            )}

                            {/* Date */}
                            {colVisible('date') && (
                            <td style={styles.td}>
                              {editFields ? (
                                <DateInput
                                  ref={firstInputRef} value={f.invoice_date}
                                  onChange={e => setEditForm(p => ({ ...p, invoice_date: e.target.value }))}
                                  onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                  onClick={e => e.stopPropagation()}
                                  inputStyle={styles.cellInput}
                                />
                              ) : formatDate(inv.invoice_date)}
                            </td>
                            )}

                            {/* Period */}
                            {colVisible('period') && (
                            <td style={styles.td}>
                              {editFields ? (
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
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {MONTH_NAMES[inv.statement_month]?.slice(0, 3)} {inv.statement_year}
                                  </span>
                                  {(costingMoved(inv) || reportMoved(inv)) ? (
                                    <span
                                      title={periodOverrideTooltip(inv)}
                                      style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', background: 'rgba(124,58,237,0.12)', padding: '1px 5px', borderRadius: 3, cursor: 'help', whiteSpace: 'nowrap' }}
                                    >
                                      Moved
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </td>
                            )}

                            {/* Invoice # */}
                            <td style={{ ...styles.td, fontWeight: editFields ? 400 : 600 }}>
                              {editFields ? (
                                <input
                                  value={f.invoice_number}
                                  onChange={e => setEditForm(p => ({ ...p, invoice_number: e.target.value }))}
                                  onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                  onClick={e => e.stopPropagation()}
                                  placeholder={isDiesel ? 'e.g. WBG-001' : ''}
                                  style={{ ...styles.cellInput, minWidth: 90 }}
                                />
                              ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  {inv.invoice_number ? inv.invoice_number : (
                                    isDiesel
                                      ? <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: 'rgba(245,158,11,0.12)', padding: '2px 6px', borderRadius: 3 }}>Pending</span>
                                      : '—'
                                  )}
                                  {invLocked && (
                                    <span
                                      title={`Locked by ${inv.locked_by_name || '—'} on ${formatDate(inv.locked_at)} — nothing can be added, changed or removed`}
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 3,
                                        fontSize: 10, fontWeight: 700, color: '#16a34a',
                                        background: 'rgba(34,197,94,0.12)', padding: '1px 5px',
                                        borderRadius: 3, whiteSpace: 'nowrap', cursor: 'help',
                                      }}
                                    >
                                      <Lock size={10} /> LOCKED {formatDate(inv.locked_at)}
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>


                            {/* Vehicle Reg */}
                            {colVisible('vehicle_reg') && (
                              <td style={styles.td}>
                                {editFields ? (
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

                            {/* Subcontractor / truck owner (display only) */}
                            {colVisible('subcontractor') && (
                              <td style={styles.td}>
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  {subForInvoice(inv) || '—'}
                                </span>
                              </td>
                            )}

                            {/* Description (non-diesel only) */}
                            {colVisible('description') && (
                              <td style={{ ...styles.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {editFields ? (
                                  <input
                                    value={f.description}
                                    onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                                    onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                    onClick={e => e.stopPropagation()}
                                    style={{ ...styles.cellInput, minWidth: 140 }}
                                    placeholder="Description"
                                  />
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }} title={inv.description}>
                                    {inv.description
                                      ? inv.description.length > 40 ? inv.description.slice(0, 40) + '…' : inv.description
                                      : '—'}
                                  </span>
                                )}
                              </td>
                            )}

                            {/* Amount */}
                            <td style={{
                              ...styles.td, fontWeight: 600,
                              ...(inv.verified3_by ? { background: 'rgba(253,224,71,0.55)' }
                                : invLocked ? { background: 'rgba(34,197,94,0.10)' } : {}),
                            }}>
                              {editFields && !f.is_multi_line ? (
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
                                </>
                              )}
                            </td>

                            {/* Deposit Paid */}
                            {colVisible('deposit') && (
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                {editFields ? (
                                  <input
                                    type="number" step="0.01" min="0" placeholder="0.00"
                                    value={f.deposit_paid || ''}
                                    onChange={e => setEditForm(p => ({ ...p, deposit_paid: e.target.value }))}
                                    onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                    onClick={e => e.stopPropagation()}
                                    style={{ ...styles.cellInput, width: 90, textAlign: 'right' }}
                                  />
                                ) : inv.deposit_paid ? (
                                  <span style={{ fontSize: 12 }}>{formatCurrency(inv.deposit_paid)}</span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                                )}
                              </td>
                            )}

                            {/* Outstanding Amount */}
                            {colVisible('outstanding') && (
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                {(() => {
                                  const amt = parseFloat(isEditing ? f.amount : inv.amount) || 0
                                  const dep = parseFloat(isEditing ? f.deposit_paid : inv.deposit_paid) || 0
                                  const outstanding = amt - dep
                                  if (dep === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>
                                  if (outstanding <= 0) return <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 600 }}>Paid</span>
                                  return <span style={{ fontSize: 12, fontWeight: 600, color: '#d97706' }}>{formatCurrency(outstanding)}</span>
                                })()}
                              </td>
                            )}

                            {/* Litres — diesel suppliers only (not WBG bulk-import) */}
                            {colVisible('litres') && (
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                {editFields ? (
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

                            {/* Rate/L — diesel suppliers only (not WBG bulk-import) */}
                            {colVisible('rate') && (
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                {editFields ? (
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
                            {colVisible('vat') && (
                              <td style={{ ...styles.td, textAlign: 'center' }}>
                                {inv.is_multi_line ? (
                                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>per line</span>
                                ) : editFields ? (
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
                            )}

                            {/* Bulk-select checkbox */}
                            <td style={{ ...styles.td, textAlign: 'center', width: 28 }} onClick={e => e.stopPropagation()}>
                              {canUserSelect(inv) && (
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(inv.id)}
                                  onChange={() => toggleSelect(inv.id)}
                                  title="Select"
                                  style={{ cursor: 'pointer' }}
                                />
                              )}
                            </td>

                            {/* Verified */}
                            {colVisible('verified') && (
                            <td style={styles.td}>
                              <VerifyBadge item={inv} onVerify={handleVerify} onFinalize={handleFinalize} currentUserId={user?.id} isAdmin={isAdmin} adminFinalizeAnytime />
                            </td>
                            )}

                            {/* Paid */}
                            {colVisible('paid') && (
                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              <button
                                onClick={e => handleMarkPaid(inv, e)}
                                title={inv.is_paid ? 'Mark unpaid' : 'Mark paid'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: inv.is_paid ? '#16a34a' : 'var(--border)' }}
                              >
                                <CheckCircle size={16} />
                              </button>
                            </td>
                            )}

                            {/* Paid Date — stamped when the tick is set */}
                            {colVisible('paid_date') && (
                            <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                              {inv.is_paid && inv.paid_date
                                ? <span style={{ fontSize: 12 }}>{formatDate(inv.paid_date)}</span>
                                : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                            )}

                            {/* Notes */}
                            {colVisible('notes') && (
                            <td style={{ ...styles.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {isEditing ? (
                                <input
                                  autoFocus={lockEdit}
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
                            )}

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
                                  {/* Physical invoice document — attachable even when locked */}
                                  {inv.has_attachment ? (
                                    <>
                                      <button
                                        className="btn-icon btn-ghost"
                                        onClick={e => { e.stopPropagation(); handleViewAttachment(inv) }}
                                        title={inv.attachment_filename ? `View ${inv.attachment_filename}` : 'View attached invoice'}
                                      >
                                        <Eye size={14} color="var(--accent)" />
                                      </button>
                                      <button
                                        className="btn-icon btn-ghost"
                                        disabled={attachBusyId === inv.id}
                                        onClick={e => { e.stopPropagation(); openAttachPicker(inv) }}
                                        title="Replace attached invoice"
                                      >
                                        <Upload size={12} />
                                      </button>
                                      <button
                                        className="btn-icon btn-ghost"
                                        disabled={attachBusyId === inv.id}
                                        onClick={e => { e.stopPropagation(); handleRemoveAttachment(inv) }}
                                        title="Remove attachment"
                                      >
                                        <X size={12} color="var(--danger)" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="btn-icon btn-ghost"
                                      disabled={attachBusyId === inv.id}
                                      onClick={e => { e.stopPropagation(); openAttachPicker(inv) }}
                                      title="Attach invoice document"
                                    >
                                      <Paperclip size={13} color="var(--text-muted)" />
                                    </button>
                                  )}
                                  {inv.is_multi_line && (
                                    <button
                                      className="btn-icon btn-ghost"
                                      onClick={e => { e.stopPropagation(); toggleInvoiceExpand(inv.id) }}
                                      title={isExpanded ? 'Collapse lines' : 'Expand lines'}
                                    >
                                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                    </button>
                                  )}
                                  {/* Invoice lock — closed off/reconciled; freezes everything on the row */}
                                  {invLocked ? (
                                    <button
                                      className="btn-icon btn-ghost"
                                      disabled={lockBusyId === inv.id}
                                      onClick={e => { e.stopPropagation(); handleUnlockInvoice(inv) }}
                                      title={`Locked by ${inv.locked_by_name || '—'} on ${formatDate(inv.locked_at)} — click to unlock`}
                                    >
                                      <Unlock size={13} color="#16a34a" />
                                    </button>
                                  ) : (
                                    <button
                                      className="btn-icon btn-ghost"
                                      disabled={lockBusyId === inv.id}
                                      onClick={e => { e.stopPropagation(); openLockModal([inv]) }}
                                      title="Lock this invoice — nothing can be added, changed or removed while locked"
                                    >
                                      <Lock size={13} color="var(--text-muted)" />
                                    </button>
                                  )}
                                  {invLocked ? (
                                    <span title="This invoice is locked — unlock it to delete" style={{ display: 'inline-flex', padding: 4 }}>
                                      <Lock size={13} color="var(--text-muted)" />
                                    </span>
                                  ) : (
                                    <button
                                      className="btn-icon btn-ghost"
                                      onClick={() => handleDelete(inv)}
                                      title="Delete"
                                    >
                                      <Trash2 size={13} color="var(--danger)" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>

                          {/* Expanded line items row */}
                          {inv.is_multi_line && isExpanded && (
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <td colSpan={totalCols} style={{ padding: '0 0 12px 0', background: 'var(--bg-base)' }}>
                                {editFields ? (
                                  isDiesel
                                    ? <DieselLineItemsEditor
                                        items={editForm.line_items || []}
                                        onChange={items => setEditForm(p => ({ ...p, line_items: items }))}
                                        vatApplicable={editForm.vat_applicable !== false}
                                        vatRate={entityVatRate(entities, editForm.entity_id ?? inv.entity_id)}
                                        subbies={subbies}
                                        trucks={trucks}
                                        fillups={dieselFillups}
                                        freeTextSlip={slipFreeText}
                                      />
                                    : <LineItemsEditor
                                        items={editForm.line_items || []}
                                        onChange={items => setEditForm(p => ({ ...p, line_items: items }))}
                                        showReg={showVehicleReg}
                                        trucks={trucks}
                                        amountInclOnly={amountInclOnly}
                                        vatRate={entityVatRate(entities, editForm.entity_id ?? inv.entity_id)}
                                      />
                                ) : (
                                  isDiesel
                                    ? <DieselLineItemsViewer items={inv.line_items || []} total={inv.amount} />
                                    : <LineItemsViewer items={inv.line_items || []} total={inv.amount} showReg={showVehicleReg} amountInclOnly={amountInclOnly}
                                        ownerForReg={ownerForReg}
                                        verif={lineVerif} verifTarget={li => lineTarget(inv.id, li.id)}
                                        onVerify={handleVerifyLine} onFinalize={handleFinalizeLine}
                                        currentUserId={user?.id} isAdmin={isAdmin} />
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
                        colSpan={amountColIdx}
                        style={{ ...styles.td, fontWeight: 700, textAlign: 'right' }}
                      >
                        Statement Total:
                      </td>
                      <td style={{ ...styles.td, fontWeight: 700 }}>{formatCurrency(group.subtotal)}</td>
                      <td colSpan={visibleCols.length - amountColIdx - 1} style={styles.td} />
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


function NewInvoiceCard({ form, setForm, saving, onSave, onCancel, entities, multiEntity, firstInputRef, onKeyDown, showVehicleReg, isDiesel, amountInclOnly = false, freeTextSlip = false, showReg = false, dieselRate, amountAutoFilled, onAmountEdit, trucks = [], subbies = [], fillups = [] }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const entityCode = entities.find(e => String(e.id) === String(form.entity_id))?.code || '—'
  const cardRef = useRef(null)

  // Move focus to the next visible input/select in the card when → is pressed
  const focusNext = (e) => {
    if (e.key !== 'ArrowRight') return
    e.preventDefault()
    if (!cardRef.current) return
    const els = Array.from(
      cardRef.current.querySelectorAll('input:not([disabled]):not([type=checkbox]), select:not([disabled])')
    ).filter(el => el.offsetParent !== null)
    const idx = els.indexOf(document.activeElement)
    if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus()
  }
  const handleField = (e) => { focusNext(e); onKeyDown(e, onSave, onCancel) }
  const lineTotal = (form.line_items || []).reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)
  const [splitMode, setSplitMode] = useState(false)
  const [splitDesc, setSplitDesc] = useState('')
  const [splitTotalExcl, setSplitTotalExcl] = useState('')
  const [splitSelected, setSplitSelected] = useState([]) // truck IDs
  const [splitSearch, setSplitSearch] = useState('')

  const currentMode = splitMode ? 'split' : form.is_multi_line ? 'multi' : 'single'
  const formVatRate = entityVatRate(entities, form.entity_id)
  const vatMult = form.vat_applicable !== false ? 1 + formVatRate : 1

  const setMode = (v) => {
    setSplitMode(v === 'split')
    setSplitDesc(''); setSplitTotalExcl(''); setSplitSelected([]); setSplitSearch('')
    setForm(f => ({ ...f, is_multi_line: v !== 'single', line_items: [] }))
  }

  // Recompute split line items and sync to form whenever desc/total/selection changes
  const applySplit = (desc, total, selected) => {
    const n = selected.length
    const totalNum = parseFloat(total) || 0
    const excl = n > 0 && totalNum > 0 ? Math.round(totalNum / n * 100) / 100 : 0
    const incl = Math.round(excl * vatMult * 100) / 100
    setForm(f => ({
      ...f,
      line_items: trucks
        .filter(t => selected.includes(t.id))
        .map((t, i) => ({
          _key: t.id,
          item_code: '',
          item_description: desc,
          unit: t.registration,
          quantity: 1,
          _rate: excl ? String(excl) : '',
          amount_excl_vat: excl || '',
          amount_incl_vat: incl || '',
          sort_order: i,
        })),
    }))
  }

  const setSplitDescVal = (v) => { setSplitDesc(v); applySplit(v, splitTotalExcl, splitSelected) }
  const setSplitTotalVal = (v) => { setSplitTotalExcl(v); applySplit(splitDesc, v, splitSelected) }
  const toggleSplitTruck = (id) => {
    const next = splitSelected.includes(id)
      ? splitSelected.filter(x => x !== id)
      : [...splitSelected, id]
    setSplitSelected(next)
    applySplit(splitDesc, splitTotalExcl, next)
  }

  const splitN = splitSelected.length
  const splitTotal = parseFloat(splitTotalExcl) || 0
  const perTruckExcl = splitN > 0 && splitTotal > 0 ? Math.round(splitTotal / splitN * 100) / 100 : 0
  const perTruckIncl = Math.round(perTruckExcl * vatMult * 100) / 100

  const filteredSplitTrucks = splitSearch
    ? trucks.filter(t => t.registration?.toLowerCase().includes(splitSearch.toLowerCase()) || t.fleet_number?.toLowerCase().includes(splitSearch.toLowerCase()))
    : trucks

  return (
    <div ref={cardRef} style={{
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
            {(isDiesel ? ['single', 'multi'] : ['single', 'multi', 'split']).map((v, i, arr) => (
              <button key={v}
                onClick={() => setMode(v)}
                style={{
                  padding: '5px 12px', border: 'none',
                  borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  background: currentMode === v ? 'var(--accent)' : 'var(--bg-card)',
                  color: currentMode === v ? '#fff' : 'var(--text)',
                  fontWeight: 600, fontSize: 11, cursor: 'pointer',
                }}>
                {v === 'single' ? 'Single' : v === 'multi' ? 'Multi-line' : 'Split'}
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
            onKeyDown={handleField}
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
              onKeyDown={handleField}
              style={{ ...CS.input, width: 68, flex: 'none' }} />
          </div>
        </div>

        <div style={CS.field(140)}>
          <label style={CS.label}>Invoice #</label>
          <input value={form.invoice_number} placeholder={isDiesel ? 'Fill in when received' : 'e.g. TM1794'}
            onChange={e => set('invoice_number', e.target.value)}
            onKeyDown={handleField}
            style={CS.input} />
        </div>

        {showVehicleReg && !isDiesel && !splitMode && (
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

        {!isDiesel && !splitMode && (
          <div style={CS.field(110)}>
            <label style={CS.label}>Litres</label>
            <input type="number" step="0.001" min="0" placeholder="0.000"
              value={form.litres}
              onChange={e => set('litres', e.target.value)}
              onKeyDown={handleField}
              style={{ ...CS.input, textAlign: 'right' }} />
          </div>
        )}

        {!isDiesel && !splitMode && (
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
              onKeyDown={handleField}
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
              {lineTotal > 0 ? `R ${lineTotal.toFixed(2)}` : '—'}
            </div>
          ) : (
            <input type="number" step="0.01" placeholder="0.00"
              value={form.amount}
              onChange={e => { set('amount', e.target.value); onAmountEdit?.() }}
              onKeyDown={handleField}
              style={{ ...CS.input, textAlign: 'right' }} />
          )}
        </div>

        {/* Deposits don't apply to diesel statements */}
        {!isDiesel && (
          <div style={CS.field(120)}>
            <label style={CS.label}>Deposit Paid</label>
            <input type="number" step="0.01" min="0" placeholder="0.00"
              value={form.deposit_paid || ''}
              onChange={e => set('deposit_paid', e.target.value)}
              onKeyDown={handleField}
              style={{ ...CS.input, textAlign: 'right' }} />
          </div>
        )}

        {/* Multi-line invoices set VAT per line, so the invoice-level toggle is
            hidden in that mode. Diesel is zero-rated (VAT sits on the admin fee),
            so it has no invoice-level toggle either. */}
        {!isDiesel && !(form.is_multi_line && !splitMode) && (
          <div style={{ ...CS.field(110), flex: 'none' }}>
            <label style={CS.label}>VAT</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 7 }}>
              <input type="checkbox" checked={form.vat_applicable}
                onChange={e => set('vat_applicable', e.target.checked)}
                style={{ cursor: 'pointer', width: 15, height: 15 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Applicable</span>
            </div>
          </div>
        )}

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
              onKeyDown={handleField}
              style={CS.input} />
          )}
        </div>

        <div style={{ ...CS.field(200), flex: '3 1 200px' }}>
          <label style={CS.label}>Notes</label>
          <input value={form.notes} placeholder="Optional notes"
            onChange={e => set('notes', e.target.value)}
            onKeyDown={handleField}
            style={CS.input} />
        </div>
      </div>

      {form.is_multi_line && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          {splitMode ? (
            /* ── Split mode: description + total + truck multi-select ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Description + Total */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ ...CS.field(), flex: '2 1 200px' }}>
                  <label style={CS.label}>Description</label>
                  <input value={splitDesc} onChange={e => setSplitDescVal(e.target.value)}
                    placeholder="e.g. Trailer Maintenance"
                    style={CS.input} />
                </div>
                <div style={{ ...CS.field(160), flex: '1 1 160px' }}>
                  <label style={CS.label}>Total excl. VAT (R)</label>
                  <input type="number" min="0" step="0.01"
                    value={splitTotalExcl} onChange={e => setSplitTotalVal(e.target.value)}
                    placeholder="0.00" style={CS.input} />
                </div>
              </div>

              {/* Truck picker */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={CS.label}>
                    Trucks
                    {splitN > 0 && (
                      <span style={{ marginLeft: 6, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
                        {splitN}
                      </span>
                    )}
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, padding: '2px 10px' }}
                      onClick={() => { const all = trucks.map(t => t.id); setSplitSelected(all); applySplit(splitDesc, splitTotalExcl, all) }}>
                      Select all
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, padding: '2px 10px' }}
                      onClick={() => { setSplitSelected([]); applySplit(splitDesc, splitTotalExcl, []) }}>
                      Clear
                    </button>
                  </div>
                </div>
                <input value={splitSearch} onChange={e => setSplitSearch(e.target.value)}
                  placeholder="Search registration or fleet number…"
                  style={{ ...CS.input, marginBottom: 6 }} />
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {/* Column header */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '32px 100px 70px 1fr',
                    padding: '5px 10px', borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-secondary)',
                    fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>
                    <span />
                    <span>Reg</span>
                    <span>Fleet #</span>
                    <span>Model</span>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {filteredSplitTrucks.length === 0
                      ? <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-muted)' }}>No trucks found</div>
                      : filteredSplitTrucks.map(t => {
                          const isSelected = splitSelected.includes(t.id)
                          return (
                            <label key={t.id} style={{
                              display: 'grid', gridTemplateColumns: '32px 100px 70px 1fr',
                              alignItems: 'center', padding: '7px 10px', cursor: 'pointer',
                              borderBottom: '1px solid var(--border)',
                              background: isSelected ? 'rgba(59,130,246,0.07)' : 'transparent',
                              borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                              transition: 'background 0.1s',
                            }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSplitTruck(t.id)}
                                style={{ width: 14, height: 14, cursor: 'pointer', margin: 0, accentColor: 'var(--accent)' }}
                              />
                              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                                {t.registration}
                              </span>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {t.fleet_number || '—'}
                              </span>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {t.model || ''}
                              </span>
                            </label>
                          )
                        })
                    }
                  </div>
                </div>
              </div>

              {/* Per-truck summary */}
              {splitN > 0 && splitTotal > 0 && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', fontSize: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    Per truck excl. VAT: <strong style={{ color: 'var(--text-primary)' }}>R&nbsp;{perTruckExcl.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</strong>
                  </span>
                  {form.vat_applicable !== false && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      Incl. VAT: <strong style={{ color: 'var(--text-primary)' }}>R&nbsp;{perTruckIncl.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</strong>
                    </span>
                  )}
                  <span style={{ color: 'var(--text-muted)' }}>
                    Total: <strong style={{ color: 'var(--accent)' }}>R&nbsp;{(perTruckIncl * splitN).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</strong>
                  </span>
                </div>
              )}
            </div>
          ) : isDiesel ? (
            <DieselLineItemsEditor
              items={form.line_items || []}
              onChange={items => setForm(f => ({ ...f, line_items: items }))}
              vatApplicable={form.vat_applicable !== false}
              vatRate={formVatRate}
              subbies={subbies}
              trucks={trucks}
              fillups={fillups}
              freeTextSlip={freeTextSlip}
            />
          ) : (
            <LineItemsEditor
              items={form.line_items || []}
              onChange={items => setForm(f => ({ ...f, line_items: items }))}
              showReg={showReg || (form.line_items || []).some(li => li.unit)}
              trucks={trucks}
              amountInclOnly={amountInclOnly}
              vatRate={formVatRate}
            />
          )}
        </div>
      )}
    </div>
  )
}


function LineItemsEditor({ items, onChange, showReg = false, trucks = [], amountInclOnly = false, vatRate = 0.15 }) {
  // Each line carries its own VAT flag (default on). incl == excl when off.
  const lineVat = (li) => li._vat !== false
  const multOf = (li) => (lineVat(li) ? 1 + vatRate : 1)
  const addLine = () => onChange([...items, blankLineItem()])
  const removeLine = (idx) => onChange(items.filter((_, i) => i !== idx))
  const r2 = (n) => Math.round(n * 100) / 100
  const updateLine = (idx, field, value) => {
    const updated = { ...items[idx], [field]: value }
    const vatMult = multOf(updated)
    // Qty × Rate drives the excl amount; typing excl or incl directly instead
    // back-derives the rate. Either way the dependent amount comes from the
    // line's own VAT flag. Other fields (code, reg, …) just store.
    if (field === 'quantity' || field === '_rate') {
      const qty = parseFloat(updated.quantity) || 0
      const rate = parseFloat(updated._rate) || 0
      if (qty && rate) {
        const excl = r2(qty * rate)
        updated.amount_excl_vat = String(excl)
        updated.amount_incl_vat = String(r2(excl * vatMult))
      }
    } else if (field === 'amount_excl_vat') {
      const excl = parseFloat(value) || 0
      updated.amount_incl_vat = excl ? String(r2(excl * vatMult)) : ''
      const qty = parseFloat(updated.quantity) || 0
      if (qty > 0) updated._rate = excl ? String(r2(excl / qty)) : ''
    } else if (field === 'amount_incl_vat') {
      const incl = parseFloat(value) || 0
      const excl = incl ? r2(incl / vatMult) : 0
      updated.amount_excl_vat = excl ? String(excl) : ''
      const qty = parseFloat(updated.quantity) || 0
      if (qty > 0) updated._rate = excl ? String(r2(excl / qty)) : ''
    }
    onChange(items.map((li, i) => i === idx ? updated : li))
  }
  // Flip a line's VAT and re-derive the dependent amount from the stable one
  // (the typed incl in incl-only mode, otherwise the qty×rate excl).
  const toggleVat = (idx) => {
    const updated = { ...items[idx], _vat: !lineVat(items[idx]) }
    const vatMult = updated._vat ? 1 + vatRate : 1
    if (amountInclOnly) {
      const incl = parseFloat(updated.amount_incl_vat) || 0
      updated.amount_excl_vat = incl ? String(Math.round(incl / vatMult * 100) / 100) : ''
    } else {
      const excl = parseFloat(updated.amount_excl_vat) || 0
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
          {showReg && <col style={{ width: 120 }} />}
          {!amountInclOnly && <col style={{ width: 70 }} />}
          {!amountInclOnly && <col style={{ width: 90 }} />}
          {!amountInclOnly && <col style={{ width: 110 }} />}
          <col style={{ width: amountInclOnly ? 130 : 110 }} />
          <col style={{ width: 44 }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Item Code</th>
            <th style={liStyles.th}>Description</th>
            {showReg && <th style={liStyles.th}>Reg</th>}
            {!amountInclOnly && <th style={{ ...liStyles.th, textAlign: 'right' }}>Qty</th>}
            {!amountInclOnly && <th style={{ ...liStyles.th, textAlign: 'right' }}>Rate</th>}
            {!amountInclOnly && <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>}
            <th style={{ ...liStyles.th, textAlign: 'right' }}>{amountInclOnly ? 'Amount (incl. VAT)' : 'Incl. VAT'}</th>
            <th style={{ ...liStyles.th, textAlign: 'center' }} title="VAT applies to this line">VAT</th>
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
              {showReg && (
                <td style={liStyles.td}>
                  {trucks.length > 0 ? (
                    <SearchableSelect
                      value={li.unit ?? ''}
                      onChange={v => updateLine(idx, 'unit', v)}
                      options={[{ id: '', registration: '', fleet_number: null }, ...trucks]}
                      getValue={t => t.registration}
                      getLabel={t => t.registration === '' ? '— Select —' : t.registration}
                      placeholder="Reg…"
                      style={{ minWidth: 110 }}
                    />
                  ) : (
                    <input value={li.unit ?? ''} placeholder="e.g. DDM652NC"
                      onChange={e => updateLine(idx, 'unit', e.target.value.toUpperCase())}
                      style={{ ...liStyles.input, width: '100%', textTransform: 'uppercase' }} />
                  )}
                </td>
              )}
              {!amountInclOnly && (
                <td style={liStyles.td}>
                  <input type="number" step="0.001" value={li.quantity ?? ''} placeholder="0"
                    onChange={e => updateLine(idx, 'quantity', e.target.value)}
                    style={{ ...liStyles.input, width: '100%', textAlign: 'right' }} />
                </td>
              )}
              {!amountInclOnly && (
                <td style={liStyles.td}>
                  <input type="number" step="0.01" value={li._rate ?? ''} placeholder="0.00"
                    onChange={e => updateLine(idx, '_rate', e.target.value)}
                    style={{ ...liStyles.input, width: '100%', textAlign: 'right' }} />
                </td>
              )}
              {!amountInclOnly && (
                <td style={liStyles.td}>
                  <input type="number" step="0.01" value={li.amount_excl_vat ?? ''} placeholder="0.00"
                    onChange={e => updateLine(idx, 'amount_excl_vat', e.target.value)}
                    style={{ ...liStyles.input, width: '100%', textAlign: 'right' }} />
                </td>
              )}
              <td style={liStyles.td}>
                <input type="number" step="0.01" value={li.amount_incl_vat ?? ''} placeholder="0.00"
                  onChange={e => updateLine(idx, 'amount_incl_vat', e.target.value)}
                  style={{ ...liStyles.input, width: '100%', textAlign: 'right', fontWeight: 600 }} />
              </td>
              <td style={{ ...liStyles.td, textAlign: 'center' }}>
                <input type="checkbox" checked={lineVat(li)}
                  onChange={() => toggleVat(idx)}
                  title={lineVat(li) ? 'VAT applies — uncheck for a non-VAT line' : 'Non-VAT line — check to add VAT'}
                  style={{ cursor: 'pointer', width: 14, height: 14, accentColor: 'var(--accent)' }} />
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
            <td colSpan={showReg ? 3 : 2} style={{ padding: '8px 6px' }}>
              <button onClick={addLine}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: 12, padding: 0 }}>
                <Plus size={13} /> Add line
              </button>
            </td>
            {!amountInclOnly && <td colSpan={2} style={{ ...liStyles.td, fontWeight: 700, textAlign: 'right' }}>Total:</td>}
            {!amountInclOnly && (
              <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                {totalExcl.toFixed(2)}
              </td>
            )}
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
              {totalIncl.toFixed(2)}
            </td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}


function LineItemsViewer({ items, total, showReg = false, amountInclOnly = false,
  ownerForReg = null, verif = {}, verifTarget = null, onVerify = null, onFinalize = null,
  currentUserId, isAdmin = false }) {
  if (!items || items.length === 0) {
    return <p style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>No line items.</p>
  }
  const totalExcl = items.reduce((s, li) => s + (parseFloat(li.amount_excl_vat) || 0), 0)

  // Equal split across trucks: every line has a reg and carries the same
  // amount. Show the owning subcontractor per line and group the lines so one
  // subcontractor's trucks sit together instead of mixed alphabetically.
  const isEqualSplit = !!ownerForReg && showReg && items.length > 1
    && items.every(li => (li.unit || '').trim())
    && new Set(items.map(li => (parseFloat(li.amount_incl_vat) || 0).toFixed(2))).size === 1
  const displayItems = isEqualSplit
    ? [...items].sort((a, b) => {
        const oa = (ownerForReg(a.unit) || '').toLowerCase()
        const ob = (ownerForReg(b.unit) || '').toLowerCase()
        if (oa !== ob) {
          if (!oa) return 1   // unknown owners last
          if (!ob) return -1
          return oa.localeCompare(ob)
        }
        return (a.unit || '').localeCompare(b.unit || '')
      })
    : items

  // Per-line verification (lines with a reg only): user ticks once the amount
  // is confirmed on that subcontractor's costing sheet
  const canVerify = (li) => !!(onVerify && verifTarget && (li.unit || '').trim())
  // Any table showing verify badges needs the wide left-aligned amount column
  // (not just equal splits) so the step ticks never run off the table
  const hasVerify = !!(onVerify && verifTarget) && items.some(li => (li.unit || '').trim())
  const badgeCol = isEqualSplit || hasVerify

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 80 }} />
          {/* Equal splits have short repeated descriptions (e.g. RENT) — cap the
              column and give the spare width to the Subcontractor column instead */}
          <col style={isEqualSplit ? { width: 140 } : undefined} />
          {showReg && <col style={{ width: 110 }} />}
          {isEqualSplit && <col />}
          {!isEqualSplit && <col style={{ width: 82 }} />}
          {!amountInclOnly && !isEqualSplit && <col style={{ width: 65 }} />}
          {!amountInclOnly && <col style={{ width: 105 }} />}
          {!amountInclOnly && <col style={{ width: 95 }} />}
          {/* Verify badges sit beside the amount — wider column, left-aligned
              so the ticks never run off the table */}
          <col style={{ width: badgeCol ? 200 : amountInclOnly ? 130 : 120 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Item Code</th>
            <th style={liStyles.th}>Description</th>
            {showReg && <th style={liStyles.th}>Reg</th>}
            {isEqualSplit && <th style={liStyles.th}>Subcontractor</th>}
            {/* Equal splits: every line shares the invoice date and qty is
                always 1 — drop both columns to make room */}
            {!isEqualSplit && <th style={liStyles.th}>Date</th>}
            {!amountInclOnly && !isEqualSplit && <th style={{ ...liStyles.th, textAlign: 'right' }}>Qty</th>}
            {!amountInclOnly && <th style={{ ...liStyles.th, textAlign: 'right' }}>Rate</th>}
            {!amountInclOnly && <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>}
            <th style={{ ...liStyles.th, textAlign: badgeCol ? 'left' : 'right' }}>{amountInclOnly ? 'Amount (incl. VAT)' : 'Incl. VAT'}</th>
          </tr>
        </thead>
        <tbody>
          {displayItems.map(li => {
            const qty = parseFloat(li.quantity) || 0
            const excl = parseFloat(li.amount_excl_vat) || 0
            const incl = parseFloat(li.amount_incl_vat) || 0
            const rate = qty > 0 ? excl / qty : null
            const noVat = excl > 0 && incl <= excl
            const inclFmt = (
              <>
                R&nbsp;{incl.toFixed(2)}
                {noVat && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>no&nbsp;VAT</span>}
              </>
            )
            return (
              <tr key={li.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={liStyles.td}>{li.item_code || '—'}</td>
                <td style={liStyles.td}>{li.item_description || '—'}</td>
                {showReg && (
                  <td style={liStyles.td}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{li.unit || '—'}</span>
                  </td>
                )}
                {isEqualSplit && (
                  <td style={{ ...liStyles.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ownerForReg(li.unit) || '—'}
                  </td>
                )}
                {!isEqualSplit && <td style={{ ...liStyles.td, color: 'var(--text-muted)' }}>{li.line_date ? String(li.line_date).slice(0, 10).split('-').reverse().join('-') : '—'}</td>}
                {!amountInclOnly && !isEqualSplit && <td style={{ ...liStyles.td, textAlign: 'right' }}>{qty || '—'}</td>}
                {!amountInclOnly && (
                  <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>
                    {rate != null ? rate.toFixed(2) : '—'}
                  </td>
                )}
                {!amountInclOnly && (
                  <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    R&nbsp;{excl.toFixed(2)}
                  </td>
                )}
                <td style={{ ...liStyles.td, textAlign: badgeCol ? 'left' : 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {canVerify(li) ? (
                    <VerifiableAmount target={verifTarget(li)} state={verif[verifTarget(li)]}
                      onVerify={onVerify} onFinalize={onFinalize}
                      currentUserId={currentUserId} isAdmin={isAdmin} inline>
                      {inclFmt}
                    </VerifiableAmount>
                  ) : inclFmt}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
            {/* Spans up to the Rate column: equal splits swap Date for
                Subcontractor (net 0) and drop Qty */}
            <td colSpan={(showReg ? 4 : 3) + (!amountInclOnly && !isEqualSplit ? 1 : 0)} style={liStyles.td} />
            {!amountInclOnly && <td style={{ ...liStyles.td, fontWeight: 700, textAlign: 'right' }}>Total:</td>}
            {!amountInclOnly && (
              <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>
                R&nbsp;{totalExcl.toFixed(2)}
              </td>
            )}
            <td style={{ ...liStyles.td, textAlign: badgeCol ? 'left' : 'right', fontWeight: 700, fontFamily: 'monospace' }}>
              R&nbsp;{parseFloat(total ?? 0).toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}


// Diesel sub-line columns mirror the main invoice table:
// Slip # | Slip Date | Vehicle Reg | Litres | Rate/L | Excl. VAT | Incl. VAT
// Stored as: item_code | line_date | unit | quantity | _rate(computed) | amount_excl_vat | amount_incl_vat

function DieselLineItemsEditor({ items, onChange, vatApplicable = true, subbies = [], trucks = [], fillups = [], freeTextSlip = false, vatRate = 0.15 }) {
  const vatMult = vatApplicable ? 1 + vatRate : 1
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
  // One option per slip number — the entity's fill-ups can repeat a slip# across
  // rows, which would otherwise produce duplicate-key warnings in the dropdown.
  const slipOptions = (() => {
    const seen = new Set()
    const out = []
    for (const f of fillups) {
      const s = f.slip_number ?? ''
      if (!s || seen.has(s)) continue
      seen.add(s)
      out.push(f)
    }
    return out
  })()
  const totalLitres = items.reduce((s, li) => s + (parseFloat(li.quantity) || 0), 0)
  const totalExcl = items.reduce((s, li) => s + (parseFloat(li.amount_excl_vat) || 0), 0)
  const totalIncl = items.reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)

  return (
    <div style={{ marginTop: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Slip Date</th>
            <th style={liStyles.th}>Slip #</th>
            <th style={liStyles.th}>Vehicle Reg</th>
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
                <DateInput value={li.line_date ?? ''}
                  onChange={e => updateLine(idx, 'line_date', e.target.value)}
                  style={{ ...liStyles.input, minWidth: 120 }} />
              </td>
              <td style={liStyles.td}>
                {(fillups.length > 0 || freeTextSlip) ? (
                  <SearchableSelect
                    value={li.item_code ?? ''}
                    onChange={v => selectSlip(idx, v)}
                    options={[{ slip_number: '' }, ...slipOptions]}
                    getValue={f => f.slip_number ?? ''}
                    getLabel={f => f.slip_number ? f.slip_number : '— Select —'}
                    placeholder={freeTextSlip ? 'Slip # / search…' : 'Select slip…'}
                    creatable={freeTextSlip}
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
            <th style={liStyles.th}>Date</th>
            <th style={liStyles.th}>Slip #</th>
            <th style={liStyles.th}>Vehicle Reg</th>
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
                <td style={{ ...liStyles.td, color: 'var(--text-muted)', fontSize: 11 }}>{li.line_date ? String(li.line_date).slice(0, 10).split('-').reverse().join('-') : '—'}</td>
                <td style={{ ...liStyles.td, fontWeight: 600 }}>{li.item_code || '—'}</td>
                <td style={liStyles.td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{li.unit || '—'}</span></td>
                <td style={{ ...liStyles.td, textAlign: 'right' }}>{litres ? `${litres.toFixed(1)}L` : '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>{rate != null ? rate.toFixed(4) : '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>R&nbsp;{excl.toFixed(2)}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>R&nbsp;{parseFloat(li.amount_incl_vat ?? 0).toFixed(2)}</td>
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
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>R&nbsp;{totalExcl.toFixed(2)}</td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>R&nbsp;{parseFloat(total ?? 0).toFixed(2)}</td>
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
  page: { padding: 'var(--page-pad)', flex: 1 },
  infoCard: {
    display: 'flex', flexWrap: 'wrap', gap: '6px 24px',
    padding: '12px 16px', marginBottom: 16,
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
    background: 'var(--bg-surface)', flexWrap: 'wrap', gap: '6px 12px',
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
  // nowrap keeps every cell on one line; narrow screens scroll the table
  // horizontally (wrappers have overflowX:auto) instead of stacking values.
  td: { padding: '7px 10px', fontSize: 13, verticalAlign: 'middle', whiteSpace: 'nowrap' },
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
