import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Plus, Trash2, AlertCircle, ArrowLeft, Save, X, FileText, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { getEntities, getSuppliers, getCustomers, createCustomer, getInvoice, getNextInvoiceNumber, createInvoice, updateInvoice } from '../services/api'
import DateInput from '../components/DateInput'
import { errorMessage } from '../utils/helpers'

const LINE_TYPES = [
  { value: 'item',   label: 'Item',   color: 'var(--accent)' },
  { value: 'header', label: 'Header', color: '#7c3aed' },
  { value: 'note',   label: 'Note',   color: 'var(--text-muted)' },
  { value: 'spacer', label: 'Space',  color: 'var(--border)' },
]

const emptyLine = (type = 'item') => ({
  _id: Math.random().toString(36).slice(2),
  description: '', quantity: '', unit_price: '', amount: '',
  is_vat_exempt: false, sort_order: 0,
  line_type: type,
  loading_number: '', offloading_number: '',
  // When the document carries a quantity adjustment, `quantity` holds the
  // captured (net) figure and the billed figure is derived — see billedQty().
  qty_adjusted: false,
})

// ── Quantity adjustment ───────────────────────────────────────────────────────
// Some documents bill the captured quantity plus a fixed percentage (Border
// Trade Post's POs bill weighbridge net mass +1.53%: 32.56 t → 33.06 t). The
// user captures the net figure once and the percentage once; these two helpers
// are the only place the uplift is applied, so the preview, the saved line and
// the PDF can't drift apart. Mirrors services/qty_adjustment.py on the backend.
const lineTakesAdj = (line, pct, scope) =>
  pct != null && pct !== 0 &&
  (line.line_type || 'item') === 'item' &&
  (scope === 'all' || !!line.qty_adjusted)

// The EXACT adjusted tonnage — what the line is billed on. Rounding the
// tonnage to 2 dp before multiplying by the rate puts the amount a few cents
// out against the customer's sheet, so the rounding happens once, on the rands.
const exactBilledQty = (line, pct, scope) => {
  if (line.quantity === '' || line.quantity == null) return null
  const base = parseFloat(line.quantity)
  if (isNaN(base)) return null
  return lineTakesAdj(line, pct, scope) ? base * (1 + pct / 100) : base
}

// The DISPLAYED/printed tonnage, rounded to 2 dp. An adjusted line therefore
// does not always multiply out to its printed amount — same as the source sheet.
const billedQty = (line, pct, scope) => {
  const exact = exactBilledQty(line, pct, scope)
  return exact == null ? null : +exact.toFixed(2)
}

// ── Quantity input formatting ─────────────────────────────────────────────────
// Quantities are held canonically with a dot decimal ('32.56') so parseFloat
// works, but SA tonnage sheets write 32,56 — so a typed comma has to mean
// "decimal point". Thousands are therefore grouped with a non-breaking space,
// never a comma: if grouping used commas we couldn't tell a typed decimal
// comma from a grouping one, which is exactly what broke the value before.
const QTY_GROUP = ' '

const parseQtyInput = (v) =>
  String(v)
    .replace(/[\s ]/g, '')   // drop grouping spaces
    .replace(/,/g, '.')           // a comma is always a decimal point
    .replace(/[^0-9.-]/g, '')     // ignore anything else

const formatQtyInput = (raw) => {
  if (raw === '' || raw == null) return ''
  const s = String(raw)
  const neg = s.startsWith('-')
  // Keep the decimal portion exactly as typed, so "7082." and trailing digits
  // like ".358"/".3580" survive mid-edit instead of being normalised away.
  const [intPart, ...rest] = s.replace('-', '').split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, QTY_GROUP)
  const decPart = s.includes('.') ? '.' + rest.join('') : ''
  return (neg ? '-' : '') + grouped + decPart
}

// Re-derive a line's amount from its billed quantity. Used whenever the qty,
// the rate, the percentage or the line's selection changes.
const withAmount = (line, pct, scope) => {
  if ((line.line_type || 'item') !== 'item') return line
  if (line.quantity === '' || line.unit_price === '') return line
  const q = exactBilledQty(line, pct, scope)   // exact, not the printed 2 dp figure
  if (q == null) return line
  const rate = parseFloat(line.unit_price)
  if (isNaN(rate)) return line
  return { ...line, amount: String((q * rate).toFixed(2)) }
}

function LineTypeChip({ value, onChange }) {
  const t = LINE_TYPES.find(x => x.value === value) || LINE_TYPES[0]
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      title="Row type"
      style={{
        fontSize: 9, fontWeight: 700, padding: '2px 3px',
        border: `1px solid ${t.color}`, color: t.color,
        background: 'transparent', borderRadius: 4,
        cursor: 'pointer', width: 54, flexShrink: 0,
        textTransform: 'uppercase', letterSpacing: 0.3,
      }}
    >
      {LINE_TYPES.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

function formatCurrency(val) {
  const n = parseFloat(val) || 0
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function InvoiceFormPage({ docType = 'invoice' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, activeEntity } = useAuth()
  const isEdit = !!id
  const templatePayload = !isEdit ? location.state?.templatePayload : null
  const poImportPayload = !isEdit ? location.state?.poImportPayload : null
  const isInvoice = docType === 'invoice'
  const isPO      = docType === 'purchase_order'
  const docLabel  = isInvoice ? 'Invoice' : isPO ? 'Purchase Order' : 'Quote'
  const docPath   = isInvoice ? 'invoices' : isPO ? 'purchase-orders' : 'quotes'

  const [entities, setEntities] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [entityId, setEntityId] = useState('')
  const [recipientType, setRecipientType] = useState('supplier') // 'supplier' | 'customer'
  const [supplierId, setSupplierId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceNumberEdited, setInvoiceNumberEdited] = useState(false) // track if user manually edited
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [printNote, setPrintNote] = useState(false)
  const [isVatExempt, setIsVatExempt] = useState(false) // whole invoice non-VAT
  const [vatRate, setVatRate] = useState(0.15)
  const [lines, setLines] = useState([emptyLine()])

  // Quantity adjustment (Additional Settings). Available on every document
  // type — POs are what prompted it, but an invoice billed off the same
  // weighbridge tonnage needs the identical treatment.
  const [adjEnabled, setAdjEnabled] = useState(false)
  const [adjPct, setAdjPct]         = useState('')     // string as typed, e.g. '1.53'
  const [adjScope, setAdjScope]     = useState('all')  // 'all' | 'selected'

  const adjPctNum = adjEnabled && adjPct !== '' && !isNaN(parseFloat(adjPct))
    ? parseFloat(adjPct) : null
  const adjOn = adjPctNum != null && adjPctNum !== 0
  const adjSelectable = adjOn && adjScope === 'selected'

  // PO-import invoices use a different column layout.
  // Primary detection: any item line has loading/offloading numbers in DB.
  // Fallback for older imports: notes field contains "PO Ref:" (set by ImportPOModal).
  const isPOLayout =
    notes.includes('PO Ref:') ||
    lines.some(l => (l.line_type === 'item' || !l.line_type) && (l.loading_number || l.offloading_number))

  // ── Load initial data ─────────────────────────────────────────────
  useEffect(() => {
    let ignore = false
    const init = async () => {
      setLoading(true)
      try {
        const entsRes = await getEntities()
        if (ignore) return
        setEntities(entsRes.data)

        if (isEdit) {
          const inv = (await getInvoice(id)).data
          if (ignore) return
          setEntityId(String(inv.entity_id))
          if (inv.customer_id) {
            setRecipientType('customer')
            setCustomerId(String(inv.customer_id))
          } else {
            setRecipientType('supplier')
            setSupplierId(String(inv.supplier_id || ''))
          }
          setInvoiceNumber(inv.invoice_number)
          setIssueDate(inv.issue_date?.slice(0, 10) || new Date().toISOString().slice(0, 10))
          setDueDate(inv.due_date?.slice(0, 10) || '')
          setNotes(inv.notes || '')
          setPrintNote(inv.print_note || false)
          setIsVatExempt(inv.is_vat_exempt || false)
          setVatRate(inv.vat_rate != null ? parseFloat(inv.vat_rate) : 0.15)
          setAdjEnabled(inv.qty_adjustment_pct != null)
          setAdjPct(inv.qty_adjustment_pct != null ? String(parseFloat(inv.qty_adjustment_pct)) : '')
          setAdjScope(inv.qty_adjustment_scope || 'all')
          setLines(inv.line_items.map(li => ({
            _id: String(li.id),
            description: li.description || '',
            // An adjusted line stores both figures — put the captured (net)
            // one back in the input, since that's what the user typed.
            quantity: li.base_quantity != null
              ? String(li.base_quantity)
              : (li.quantity != null ? String(li.quantity) : ''),
            unit_price: li.unit_price != null ? String(li.unit_price) : '',
            amount: String(li.amount),
            is_vat_exempt: li.is_vat_exempt || false,
            sort_order: li.sort_order,
            line_type: li.line_type || 'item',
            loading_number: li.loading_number || '',
            offloading_number: li.offloading_number || '',
            qty_adjusted: li.qty_adjusted || false,
          })))
        } else if (templatePayload) {
          // Pre-fill from template clone
          setEntityId(String(templatePayload.entity_id))
          setIsVatExempt(templatePayload.is_vat_exempt || false)
          setVatRate(templatePayload.vat_rate != null ? parseFloat(templatePayload.vat_rate) : 0.15)
          setNotes(templatePayload.notes || '')
          setPrintNote(templatePayload.print_note || false)
          if (templatePayload.customer_id) {
            setRecipientType('customer')
            setCustomerId(String(templatePayload.customer_id))
          } else if (templatePayload.supplier_id) {
            setRecipientType('supplier')
            setSupplierId(String(templatePayload.supplier_id))
          }
          setLines(templatePayload.line_items.map((li, i) => ({
            _id: `tpl-${i}`,
            description: li.description || '',
            quantity: li.quantity != null ? String(li.quantity) : '',
            unit_price: li.unit_price != null ? String(li.unit_price) : '',
            amount: li.amount != null ? String(li.amount) : '',
            is_vat_exempt: li.is_vat_exempt || false,
            sort_order: i,
            line_type: li.line_type || 'item',
            loading_number: '',
            offloading_number: '',
            qty_adjusted: false,
          })))
        } else if (poImportPayload) {
          // Match entity from supplier_code prefix (e.g. SFT003 → SFT entity)
          let matchedEntity = null
          if (poImportPayload.supplier_code) {
            matchedEntity = entsRes.data.find(e =>
              poImportPayload.supplier_code.toUpperCase().startsWith(e.code?.toUpperCase() ?? '')
            )
          }
          const defaultEntity = matchedEntity || activeEntity || entsRes.data[0]
          if (defaultEntity) {
            setEntityId(String(defaultEntity.id))
            setVatRate(defaultEntity.vat_rate != null ? parseFloat(defaultEntity.vat_rate) : 0.15)
            if (defaultEntity.vat_registered === false) setIsVatExempt(true)
          }
          if (poImportPayload.po_date) setIssueDate(poImportPayload.po_date)
          const noteParts = []
          if (poImportPayload.po_number) noteParts.push(`PO Ref: ${poImportPayload.po_number}`)
          if (poImportPayload.project_code) noteParts.push(`Project: ${poImportPayload.project_code}`)
          if (noteParts.length) setNotes(noteParts.join(' | '))
          setLines(poImportPayload.line_items.map((li, i) => ({
            _id: `po-${i}`,
            description: li.description || '',
            quantity: li.quantity || '',
            unit_price: li.unit_price || '',
            amount: li.amount || '',
            is_vat_exempt: false,
            sort_order: i,
            line_type: li.line_type || 'item',
            loading_number: li.loading_number || '',
            offloading_number: li.offloading_number || '',
            qty_adjusted: false,
          })))
        } else {
          const defaultEntity = activeEntity || entsRes.data[0]
          if (defaultEntity) {
            setEntityId(String(defaultEntity.id))
            setVatRate(defaultEntity.vat_rate != null ? parseFloat(defaultEntity.vat_rate) : 0.15)
            if (defaultEntity.vat_registered === false) setIsVatExempt(true)
          }
        }
      } catch (e) {
        if (!ignore) {
          console.error(e)
          setError('Failed to load data')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    init()
    return () => { ignore = true }
  }, [id])

  // ── Fetch suppliers and customers for selected entity ────────────
  useEffect(() => {
    if (!entityId) { setSuppliers([]); setCustomers([]); return }
    let ignore = false
    getSuppliers({ entity_id: parseInt(entityId), limit: 500 })
      .then(res => { if (!ignore) setSuppliers(res.data) })
      .catch(() => {})
    getCustomers({ entity_id: parseInt(entityId), limit: 500 })
      .then(res => { if (!ignore) setCustomers(res.data) })
      .catch(() => {})
    return () => { ignore = true }
  }, [entityId])

  // Auto-select Tradekor as customer when this is a PO import and customers have loaded
  useEffect(() => {
    if (!poImportPayload || !customers.length || customerId) return
    const match = customers.find(c => c.name?.toLowerCase().includes('tradekor'))
    if (match) { setRecipientType('customer'); setCustomerId(String(match.id)) }
  }, [customers, customerId])

  // ── Fetch next invoice number when entity changes (new only) ──────
  useEffect(() => {
    if (isEdit || !entityId || invoiceNumberEdited) return
    getNextInvoiceNumber(entityId, docType)
      .then(res => setInvoiceNumber(res.data.next_number))
      .catch(() => {})
  }, [entityId, isEdit, invoiceNumberEdited])

  // ── Entity VAT rate when entity changes ───────────────────────────
  useEffect(() => {
    if (isEdit || !entityId) return
    const entity = entities.find(e => String(e.id) === entityId)
    if (entity) {
      setVatRate(entity.vat_rate != null ? parseFloat(entity.vat_rate) : 0.15)
      if (entity.vat_registered === false) setIsVatExempt(true)
    }
  }, [entityId, entities])

  // ── Line helpers ──────────────────────────────────────────────────
  const updateLine = (idx, field, value) => {
    setLines(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [field]: value }
      // When switching away from item, clear financial fields
      if (field === 'line_type' && value !== 'item') {
        updated[idx].quantity   = ''
        updated[idx].unit_price = ''
        updated[idx].amount     = ''
        updated[idx].is_vat_exempt = false
      }
      // Auto-calc amount only for item rows with both qty and price filled.
      // Bills off the adjusted quantity when the line takes the adjustment.
      if ((field === 'quantity' || field === 'unit_price') && updated[idx].line_type === 'item') {
        updated[idx] = withAmount(updated[idx], adjPctNum, adjScope)
      }
      return updated
    })
  }

  // ── Quantity adjustment handlers ──────────────────────────────────
  // Changing the percentage, the scope or a line's selection re-bills every
  // affected line, so the amounts on screen always match the setting shown.
  const recalcAll = (pct, scope) =>
    setLines(prev => prev.map(l => withAmount(l, pct, scope)))

  const setAdjustmentEnabled = (on) => {
    setAdjEnabled(on)
    const pct = on && adjPct !== '' && !isNaN(parseFloat(adjPct)) ? parseFloat(adjPct) : null
    recalcAll(pct, adjScope)
  }

  const changeAdjPct = (raw) => {
    setAdjPct(raw)
    const pct = adjEnabled && raw !== '' && !isNaN(parseFloat(raw)) ? parseFloat(raw) : null
    recalcAll(pct, adjScope)
  }

  const changeAdjScope = (scope) => {
    setAdjScope(scope)
    recalcAll(adjPctNum, scope)
  }

  const toggleLineAdj = (idx) =>
    setLines(prev => prev.map((l, i) =>
      i === idx ? withAmount({ ...l, qty_adjusted: !l.qty_adjusted }, adjPctNum, adjScope) : l
    ))

  const addLine = (type = 'item') => setLines(prev => [...prev, emptyLine(type)])
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx))

  // Click-to-sort on the Description column: reorders only the item-type rows
  // (header/note/spacer rows keep their positions). Cycles asc → desc → original
  // (original = the loaded/imported sort_order, so it's always recoverable).
  const [descSort, setDescSort] = useState(null) // null | 'asc' | 'desc'
  const toggleDescSort = () => {
    const next = descSort === null ? 'asc' : descSort === 'asc' ? 'desc' : null
    setDescSort(next)
    setLines(prev => {
      const itemEntries = prev.map((l, i) => ({ l, i })).filter(x => (x.l.line_type || 'item') === 'item')
      const sortedLines = [...itemEntries].sort((a, b) => next === null
        ? (a.l.sort_order ?? 0) - (b.l.sort_order ?? 0)
        : (next === 'asc' ? 1 : -1) * (a.l.description || '').localeCompare(b.l.description || '', undefined, { numeric: true, sensitivity: 'base' })
      ).map(x => x.l)
      const result = [...prev]
      itemEntries.forEach(({ i }, k) => { result[i] = sortedLines[k] })
      return result
    })
  }

  // ── Totals (item rows only) ───────────────────────────────────────
  const subtotal = lines
    .filter(l => (l.line_type || 'item') === 'item')
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
  const vatBase = isVatExempt ? 0 : lines
    .filter(l => (l.line_type || 'item') === 'item' && !l.is_vat_exempt)
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
  const vatAmount = vatBase * vatRate
  const total = subtotal + vatAmount

  // ── Save ──────────────────────────────────────────────────────────
  const handleSave = async (statusOverride = null) => {
    const hasRecipient = recipientType === 'supplier' ? !!supplierId : !!customerId
    if (!entityId || !hasRecipient || !invoiceNumber) {
      setError(`Entity, ${recipientType}, and invoice number are required`)
      return
    }
    const hasContent = lines.some(l =>
      l.line_type === 'spacer' ||
      l.description ||
      parseFloat(l.amount)
    )
    if (!hasContent) {
      setError('Add at least one line item')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        entity_id: parseInt(entityId),
        supplier_id: recipientType === 'supplier' && supplierId ? parseInt(supplierId) : null,
        customer_id: recipientType === 'customer' && customerId ? parseInt(customerId) : null,
        document_type: docType,
        invoice_number: invoiceNumber,
        is_vat_exempt: isVatExempt,
        issue_date: issueDate ? new Date(issueDate).toISOString() : null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        vat_rate: vatRate,
        notes: notes || null,
        print_note: printNote,
        status: statusOverride || 'draft',
        // Explicit null (not omitted) so clearing the adjustment sticks.
        qty_adjustment_pct: adjPctNum,
        qty_adjustment_scope: adjScope,
        line_items: lines
          .filter(l => l.line_type === 'spacer' || l.description || parseFloat(l.amount))
          .map((l, i) => {
            const isItem = (l.line_type || 'item') === 'item'
            const takesAdj = isItem && lineTakesAdj(l, adjPctNum, adjScope) && l.quantity !== ''
            return {
              description: l.description || null,
              // `quantity` is always the BILLED figure; base_quantity keeps the
              // net figure the user actually captured. The server re-derives
              // the billed value from these two, so it stays authoritative.
              quantity:    isItem && l.quantity   !== '' ? billedQty(l, adjPctNum, adjScope) : null,
              base_quantity: takesAdj ? parseFloat(l.quantity) : null,
              qty_adjusted:  takesAdj,
              unit_price:  isItem && l.unit_price !== '' ? parseFloat(l.unit_price) : null,
              amount:      isItem ? (parseFloat(l.amount) || 0) : 0,
              is_vat_exempt: l.is_vat_exempt,
              sort_order: i,
              line_type: l.line_type || 'item',
              loading_number: l.loading_number || null,
              offloading_number: l.offloading_number || null,
            }
          }),
      }

      if (isEdit) {
        await updateInvoice(id, payload)
      } else {
        await createInvoice(payload)
      }
      navigate(`/${docPath}`)
    } catch (e) {
      setError(errorMessage(e, 'Failed to save invoice'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 'var(--page-pad)', color: 'var(--text-muted)' }}>Loading...</div>

  const selectedEntity   = entities.find(e => String(e.id) === entityId)
  const selectedCustomer = recipientType === 'customer' && customerId
    ? customers.find(c => String(c.id) === customerId) : null
  const vatPct = Math.round(vatRate * 100)

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <button className="btn-ghost btn-sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {isEdit ? `Edit ${docLabel}` : `New ${docLabel}`}
        </h1>
        <div style={{ width: 60 }} />
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(220,38,38,0.08)', color: '#dc2626', padding: '10px 14px', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {poImportPayload && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(16,185,129,0.08)', color: '#059669', padding: '10px 14px', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
          <FileText size={15} />
          <span>
            Imported from PO: <strong>{poImportPayload.po_number}</strong>
            {poImportPayload.project_code && <> | Project: <strong>{poImportPayload.project_code}</strong></>}
            {' — '}Verify entity and select customer, then save.
          </span>
        </div>
      )}

      <div style={styles.grid}>
        {/* ── Left: main content ────────────────────────────────── */}
        <div style={styles.main}>

          {/* Document Details */}
          <div className="card">
            <h3 style={styles.sectionTitle}>Document Details</h3>
            <div className="form-row" style={{ marginTop: 16 }}>
              <div>
                <label className="form-label">Entity *</label>
                <select className="form-input" value={entityId} onChange={e => { setEntityId(e.target.value); setInvoiceNumberEdited(false) }} disabled={isEdit}>
                  <option value="">Select entity...</option>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Bill To *</label>
                {/* Toggle */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  {['supplier', 'customer'].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setRecipientType(t)}
                      style={{
                        padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', border: '1px solid var(--border)',
                        background: recipientType === t ? 'var(--accent)' : 'var(--bg-secondary)',
                        color: recipientType === t ? '#fff' : 'var(--text-secondary)',
                        textTransform: 'capitalize',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {recipientType === 'supplier' ? (
                  <select className="form-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                    <option value="">Select supplier...</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select className="form-input" style={{ flex: 1 }} value={customerId} onChange={e => setCustomerId(e.target.value)}>
                      <option value="">Select customer...</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => setQuickAddOpen(true)}
                      title="Quick-add customer"
                      style={{
                        padding: '0 12px', border: '1px solid var(--border)', borderRadius: 6,
                        background: 'var(--bg-secondary)', color: 'var(--accent)',
                        cursor: 'pointer', fontSize: 18, lineHeight: 1, fontWeight: 700,
                        display: 'flex', alignItems: 'center',
                      }}
                    >+</button>
                  </div>
                )}
              </div>
            </div>

            {/* Customer company details — shown when a customer is selected */}
            {selectedCustomer && (selectedCustomer.registration_number || selectedCustomer.vat_number || selectedCustomer.address || selectedCustomer.city) && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {selectedCustomer.registration_number && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Reg No: </span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedCustomer.registration_number}</span>
                  </div>
                )}
                {selectedCustomer.vat_number && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>VAT No: </span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedCustomer.vat_number}</span>
                  </div>
                )}
                {(selectedCustomer.address || selectedCustomer.city) && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Address: </span>
                    <span>{[selectedCustomer.address, selectedCustomer.city, selectedCustomer.postal_code].filter(Boolean).join(', ')}</span>
                  </div>
                )}
              </div>
            )}

            <div className="form-row" style={{ marginTop: 12 }}>
              <div>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {docLabel} Number *
                  <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 10 }}>
                    editable
                  </span>
                </label>
                <input
                  className="form-input"
                  value={invoiceNumber}
                  onChange={e => { setInvoiceNumber(e.target.value); setInvoiceNumberEdited(true) }}
                  placeholder="Auto-generated"
                  style={{ fontFamily: 'monospace', fontWeight: 600 }}
                />
                {!invoiceNumberEdited && invoiceNumber && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                    Auto-generated — edit if needed
                  </div>
                )}
              </div>
              <div>
                <label className="form-label">Issue Date</label>
                <DateInput className="form-input" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Due Date</label>
                <DateInput className="form-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, marginTop: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
                <input type="checkbox" checked={isVatExempt} onChange={e => setIsVatExempt(e.target.checked)} style={{ width: 15, height: 15 }} />
                This is a non-VAT invoice (VAT exempt — whole invoice)
              </label>
              {isVatExempt && (
                <span style={{ fontSize: 12, color: '#d97706', background: 'rgba(217,119,6,0.1)', padding: '2px 8px', borderRadius: 10 }}>
                  No VAT will be calculated
                </span>
              )}
            </div>
          </div>

          {/* Line Items */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <h3 style={styles.sectionTitle}>Line Items</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn-ghost btn-sm" onClick={() => addLine('item')}>
                  <Plus size={13} /> Add Line
                </button>
                <button className="btn-ghost btn-sm" onClick={() => addLine('header')}
                  style={{ fontSize: 11, color: '#7c3aed', borderColor: '#7c3aed33' }}>
                  + Header
                </button>
                <button className="btn-ghost btn-sm" onClick={() => addLine('note')}
                  style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  + Note
                </button>
                <button className="btn-ghost btn-sm" onClick={() => addLine('spacer')}
                  style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  + Spacer
                </button>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              {/* Column labels — only relevant for item rows */}
              <div style={{ ...styles.lineHeader, paddingLeft: 62 }}>
                {isPOLayout ? (
                  <span
                    onClick={toggleDescSort}
                    title="Sort line items by description"
                    style={{ flex: 2.5, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}
                  >
                    Description
                    {descSort === 'asc' ? <ArrowUp size={12} /> : descSort === 'desc' ? <ArrowDown size={12} /> : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                  </span>
                ) : (
                  <span style={{ flex: 2.5 }}>Description</span>
                )}
                {isPOLayout && <span style={{ flex: 1.5, textAlign: 'right' }}>Loading #</span>}
                {isPOLayout && <span style={{ flex: 1.5, textAlign: 'right' }}>Offloading #</span>}
                {adjSelectable && <span style={{ width: 40, textAlign: 'center' }} title="Apply the adjustment to this line">Adj</span>}
                <span style={{ flex: 1, textAlign: 'right' }}>Qty</span>
                {adjOn && (
                  <span style={{ flex: 1.1, textAlign: 'right', color: 'var(--accent)' }}
                    title={`Net quantity +${adjPct}% — this is what gets billed and printed`}>
                    Billed
                  </span>
                )}
                <span style={{ flex: 2, textAlign: 'right' }}>Rate</span>
                <span style={{ flex: 2, textAlign: 'right' }}>Amount</span>
                <span style={{ width: 54, textAlign: 'center' }}>No VAT</span>
                <span style={{ width: 30 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lines.map((line, idx) => {
                  const lt      = line.line_type || 'item'
                  const isItem  = lt === 'item'
                  const isSpacer = lt === 'spacer'
                  return (
                    <div key={line._id} style={{
                      ...styles.lineRow,
                      background: lt === 'header'
                        ? 'rgba(124,58,237,0.05)'
                        : (line.is_vat_exempt && !isVatExempt && isItem) ? 'rgba(217,119,6,0.04)' : 'transparent',
                      minHeight: isSpacer ? 28 : undefined,
                      opacity: isSpacer ? 0.6 : 1,
                      alignItems: 'center',
                    }}>
                      {/* Type chip */}
                      <LineTypeChip value={lt} onChange={v => updateLine(idx, 'line_type', v)} />

                      {/* Description — shown for all except spacer */}
                      {!isSpacer ? (
                        <input
                          className="form-input"
                          style={{
                            flex: isItem ? 2.5 : 12,
                            fontSize: 13,
                            fontWeight: lt === 'header' ? 700 : 400,
                            fontStyle: lt === 'note' ? 'italic' : 'normal',
                          }}
                          placeholder={
                            lt === 'header' ? 'Section heading…' :
                            lt === 'note'   ? 'Note or additional detail…' :
                            'Description of service or goods'
                          }
                          value={line.description}
                          onChange={e => updateLine(idx, 'description', e.target.value)}
                        />
                      ) : (
                        <span style={{ flex: 9, fontSize: 11, color: 'var(--text-muted)', paddingLeft: 8, fontStyle: 'italic' }}>
                          — spacer row —
                        </span>
                      )}

                      {/* Financial columns — item rows only */}
                      {isItem && (<>
                        {isPOLayout && (
                          <input
                            className="form-input"
                            style={{ flex: 1.5, fontSize: 13, textAlign: 'right' }}
                            placeholder="—"
                            value={line.loading_number}
                            onChange={e => updateLine(idx, 'loading_number', e.target.value)}
                          />
                        )}
                        {isPOLayout && (
                          <input
                            className="form-input"
                            style={{ flex: 1.5, fontSize: 13, textAlign: 'right' }}
                            placeholder="—"
                            value={line.offloading_number}
                            onChange={e => updateLine(idx, 'offloading_number', e.target.value)}
                          />
                        )}
                        {adjSelectable && (
                          <div style={{ width: 40, display: 'flex', justifyContent: 'center' }}>
                            <input
                              type="checkbox"
                              checked={!!line.qty_adjusted}
                              onChange={() => toggleLineAdj(idx)}
                              title={`Bill this line at net +${adjPct}%`}
                              style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                            />
                          </div>
                        )}
                        <input
                          className="form-input"
                          type="text"
                          inputMode="decimal"
                          style={{ flex: 1, fontSize: 13, textAlign: 'right' }}
                          placeholder="—"
                          value={formatQtyInput(line.quantity)}
                          onChange={e => updateLine(idx, 'quantity', parseQtyInput(e.target.value))}
                        />
                        {adjOn && (() => {
                          // Read-only: the billed figure is always derived, never typed.
                          const applies = lineTakesAdj(line, adjPctNum, adjScope)
                          const q = billedQty(line, adjPctNum, adjScope)
                          return (
                            <div style={{
                              flex: 1.1, fontSize: 13, textAlign: 'right', padding: '0 8px',
                              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                              fontVariantNumeric: 'tabular-nums',
                              color: applies ? 'var(--accent)' : 'var(--text-muted)',
                              fontWeight: applies ? 600 : 400,
                            }}
                              title={applies ? `${line.quantity} + ${adjPct}%` : 'No adjustment on this line'}>
                              {q == null ? '—' : q.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          )
                        })()}
                        <input
                          className="form-input"
                          type="number"
                          style={{ flex: 2, fontSize: 13, textAlign: 'right' }}
                          value={line.unit_price}
                          onChange={e => updateLine(idx, 'unit_price', e.target.value)}
                          placeholder="0.00"
                          min="0" step="any"
                        />
                        <input
                          className="form-input"
                          type="number"
                          style={{ flex: 2, fontSize: 13, textAlign: 'right' }}
                          value={line.amount}
                          onChange={e => updateLine(idx, 'amount', e.target.value)}
                          min="0" step="any"
                        />
                        <div style={{ width: 54, display: 'flex', justifyContent: 'center' }}>
                          <label title={isVatExempt ? 'Whole invoice is already non-VAT' : 'Exclude this line from VAT'} style={{ cursor: isVatExempt ? 'default' : 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={line.is_vat_exempt || isVatExempt}
                              disabled={isVatExempt}
                              onChange={e => updateLine(idx, 'is_vat_exempt', e.target.checked)}
                              style={{ width: 15, height: 15, accentColor: '#d97706' }}
                            />
                          </label>
                        </div>
                      </>)}

                      <button onClick={() => removeLine(idx)} disabled={lines.length === 1}
                        style={{ width: 30, background: 'none', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'default', color: 'var(--text-muted)', display: 'flex', justifyContent: 'center', padding: 4, flexShrink: 0 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: sidebar ────────────────────────────────────── */}
        <div style={styles.sidebar}>

          {/* Summary */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={styles.sectionTitle}>Summary</h3>
            <div style={styles.totalRow}>
              <span style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div style={styles.totalRow}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {isVatExempt ? 'VAT (Exempt)' : `VAT (${vatPct}%)`}
                {!isVatExempt && lines.some(l => l.is_vat_exempt) && (
                  <span style={{ fontSize: 10, color: '#d97706', marginLeft: 4 }}>some lines excluded</span>
                )}
              </span>
              <span style={{ color: isVatExempt ? 'var(--text-muted)' : undefined }}>
                {isVatExempt ? '—' : formatCurrency(vatAmount)}
              </span>
            </div>
            <hr style={{ margin: '10px 0', border: 'none', borderTop: '1px solid var(--border)' }} />
            <div style={{ ...styles.totalRow, fontWeight: 700, fontSize: 15 }}>
              <span>Total Due</span>
              <span style={{ color: 'var(--accent)' }}>{formatCurrency(total)}</span>
            </div>
            {!isVatExempt && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>VAT Rate:</span>
                <input
                  type="number"
                  value={Math.round(vatRate * 100)}
                  onChange={e => setVatRate((parseFloat(e.target.value) || 0) / 100)}
                  style={{ width: 50, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12 }}
                  min="0" max="100"
                />
                <span style={{ color: 'var(--text-muted)' }}>%</span>
              </div>
            )}
          </div>

          {/* Additional Settings — quantity adjustment */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={styles.sectionTitle}>Additional Settings</h3>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, cursor: 'pointer', fontSize: 12.5, fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={adjEnabled}
                onChange={e => setAdjustmentEnabled(e.target.checked)}
                style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0 }}
              />
              <span>
                Quantity adjustment
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
                  Capture the net figure — the billed quantity is worked out for you.
                </span>
              </span>
            </label>

            {adjEnabled && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <label className="form-label">Adjustment</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>+</span>
                  <input
                    type="number"
                    value={adjPct}
                    onChange={e => changeAdjPct(e.target.value)}
                    placeholder="1.53"
                    step="any"
                    style={{
                      width: 80, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13,
                      textAlign: 'right', fontWeight: 600,
                    }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>%</span>
                </div>

                <label className="form-label" style={{ marginTop: 12, display: 'block' }}>Apply to</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { value: 'all',      label: 'All line items' },
                    { value: 'selected', label: 'Selected lines only' },
                  ].map(opt => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5 }}>
                      <input
                        type="radio"
                        name="adj-scope"
                        checked={adjScope === opt.value}
                        onChange={() => changeAdjScope(opt.value)}
                        style={{ width: 14, height: 14 }}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>

                {adjSelectable && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    Tick the <strong>Adj</strong> box on each line that takes the adjustment
                    {' — '}
                    <strong style={{ color: 'var(--accent)' }}>
                      {lines.filter(l => (l.line_type || 'item') === 'item' && l.qty_adjusted).length} selected
                    </strong>
                  </div>
                )}

                {adjOn && (
                  <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Example: <strong>32.56</strong> captured is billed as{' '}
                    <strong style={{ color: 'var(--accent)' }}>
                      {(32.56 * (1 + adjPctNum / 100)).toFixed(2)}
                    </strong>
                    <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)' }}>
                      The printed {docLabel.toLowerCase()} shows the billed figure.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={styles.sectionTitle}>Notes (optional)</h3>
            <textarea
              className="form-input"
              rows={5}
              placeholder="Payment terms, reference numbers, or any additional information..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{ marginTop: 12, resize: 'vertical' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={printNote}
                onChange={e => setPrintNote(e.target.checked)}
                style={{ width: 14, height: 14 }}
              />
              Include note in printed PDF
            </label>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn-primary" onClick={() => handleSave('draft')} disabled={saving}
              style={{ justifyContent: 'center', height: 42 }}>
              {saving ? 'Saving...' : <><Save size={14} /> Save {docLabel}</>}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => navigate(-1)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </div>

      {quickAddOpen && (
        <QuickAddCustomerModal
          entityId={entityId}
          onCreated={(newCustomer) => {
            setCustomers(prev => [...prev, newCustomer])
            setCustomerId(String(newCustomer.id))
            setQuickAddOpen(false)
          }}
          onClose={() => setQuickAddOpen(false)}
        />
      )}
    </div>
  )
}

function QuickAddCustomerModal({ entityId, onCreated, onClose }) {
  const [form, setForm] = useState({
    name: '', trading_name: '', contact_person: '', email: '', phone: '',
    registration_number: '', vat_number: '', address: '', city: '', postal_code: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name.trim()) { setErr('Name is required'); return }
    setSaving(true)
    setErr('')
    try {
      const res = await createCustomer({ ...form, entity_id: parseInt(entityId) })
      onCreated(res.data)
    } catch (e) {
      setErr(errorMessage(e, 'Failed to create customer'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Quick-Add Customer</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={17} /></button>
        </div>

        {err && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="form-label">Name *</label>
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Customer name" autoFocus />
          </div>
          <div>
            <label className="form-label">Trading Name</label>
            <input className="form-input" value={form.trading_name} onChange={e => set('trading_name', e.target.value)} />
          </div>
          <div className="form-row">
            <div>
              <label className="form-label">Registration Number</label>
              <input className="form-input" value={form.registration_number} onChange={e => set('registration_number', e.target.value)} placeholder="e.g. 2024/123456/07" />
            </div>
            <div>
              <label className="form-label">VAT Number</label>
              <input className="form-input" value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="e.g. 4123456789" />
            </div>
          </div>
          <div>
            <label className="form-label">Address</label>
            <input className="form-input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street address" />
          </div>
          <div className="form-row">
            <div>
              <label className="form-label">City</label>
              <input className="form-input" value={form.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Postal Code</label>
              <input className="form-input" value={form.postal_code} onChange={e => set('postal_code', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="form-label">Contact Person</label>
            <input className="form-input" value={form.contact_person} onChange={e => set('contact_person', e.target.value)} />
          </div>
          <div className="form-row">
            <div>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input className="form-input" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={handleSubmit} disabled={saving || !form.name.trim()}>
            {saving ? 'Creating…' : 'Create & Select'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: { padding: '20px 28px', flex: 1 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' },
  main: { display: 'flex', flexDirection: 'column', gap: 16 },
  sidebar: { display: 'flex', flexDirection: 'column', position: 'sticky', top: 20 },
  sectionTitle: { fontSize: 12, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)' },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' },
  lineHeader: {
    display: 'flex', gap: 8, paddingBottom: 8,
    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)', marginBottom: 6,
  },
  lineRow: { display: 'flex', gap: 8, alignItems: 'center', borderRadius: 6 },
}
