import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, Save, ChevronDown, ChevronUp, FileSpreadsheet, FileText, ArrowLeft, ListChecks, X, CreditCard, CalendarRange, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { parseISO, isValid, format, isWithinInterval } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import SearchableSelect from '../components/SearchableSelect'
import DateInput from '../components/DateInput'
import {
  getStatement, createStatement, updateStatement,
  getInvoices, getCustomers,
  exportStatementPdf, exportStatementExcel, saveBlob,
} from '../services/api'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function today()  { return new Date().toISOString().slice(0, 10) }
function uid()    { return Math.random().toString(36).slice(2) }

function fmtDateDot(val) {
  if (!val) return ''
  try {
    const d = typeof val === 'string' ? parseISO(val) : val
    return isValid(d) ? format(d, 'dd.MM.yyyy') : ''
  } catch { return '' }
}
function fmtAmt(val) {
  const n = parseFloat(val) || 0
  return n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Pull the POH reference out of an invoice. Tradekor invoices carry it in the
// notes ("PO Ref: POH…") and in the header line item ("ASSMANG POH … - TDK/…").
function extractPOH(inv) {
  if (!inv) return ''
  const sources = [inv.notes]
  const header = (inv.line_items || []).find(li => li.line_type === 'header')
  if (header) sources.push(header.description)
  for (const src of sources) {
    if (!src) continue
    const m = String(src).match(/POH\s*\d+/i)
    if (m) return m[0].replace(/\s+/g, '').toUpperCase()
  }
  return ''
}

// True when an invoice came from a Tradekor PO import (Obhi/Safetec). The
// importer stamps the notes with "PO Ref: POH…" and a header line item with the
// POH reference, so either signal marks it apart from a manually-keyed Tradekor
// invoice. Used to flag these rows in the statement picker.
function isPoImport(inv) {
  return /PO\s*Ref/i.test(inv?.notes || '') || !!extractPOH(inv)
}

// Mine name sits at the start of the header line item, before "POH"
// (e.g. "ASSMANG  POH 10126050000191 - TDK/…" → "ASSMANG"). May be absent.
function extractMine(inv) {
  const header = (inv?.line_items || []).find(li => li.line_type === 'header')
  if (!header?.description) return ''
  const m = String(header.description).match(/^(.*?)\s*POH/i)
  return m && m[1].trim() ? m[1].trim().toUpperCase() : ''
}

// A picked invoice → an "outstanding" row. For Tradekor we pre-fill the
// (editable) description with "MINE - POH" (mine only if present); otherwise
// it's left blank so the export auto-builds "date - invoice #".
function invoiceRow(inv, withPoh) {
  const row = {
    _id: uid(),
    kind:           'invoice',
    line_date:      inv.issue_date ? inv.issue_date.slice(0, 10) : '',
    description:    '',
    invoice_number: inv.invoice_number || '',
    amount:         String(parseFloat(inv.total) || 0),
  }
  if (withPoh) {
    const poh = extractPOH(inv)
    if (poh) row.description = [extractMine(inv), poh].filter(Boolean).join(' - ')
  }
  return row
}

function blankRow()        { return { _id: uid(), kind: 'invoice', line_date: today(), description: '', invoice_number: '', amount: '' } }
function blankPaymentRow() { return { _id: uid(), kind: 'payment', line_date: today(), description: 'PAYMENT RECEIVED', invoice_number: '', amount: '' } }


export default function StatementEditorPage() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const isNew     = !id
  const { isAdmin, activeEntity, entities } = useAuth()

  // ─── header state ──────────────────────────────────────────────────────────
  const [entityId,    setEntityId]    = useState(activeEntity?.id?.toString() || '')
  const [customerId,  setCustomerId]  = useState('')
  const [customers,   setCustomers]   = useState([])
  const [stmtDate,    setStmtDate]    = useState(today())
  const [title,       setTitle]       = useState('')
  const [rows,        setRows]        = useState([blankRow()])
  const [saving,      setSaving]      = useState(false)
  const [exporting,   setExporting]   = useState(false)
  const [loading,     setLoading]     = useState(!isNew)

  // ─── invoice picker ─────────────────────────────────────────────────────────
  const [pickerOpen,     setPickerOpen]     = useState(false)
  const [pickerLoading,  setPickerLoading]  = useState(false)
  const [pickerInvoices, setPickerInvoices] = useState([])
  const [pickerSelected, setPickerSelected] = useState(() => new Set())
  const [pickerSearch,   setPickerSearch]   = useState('')

  // ─── date-range loader (Tradekor) ───────────────────────────────────────────
  const [rangeFrom,    setRangeFrom]    = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })
  const [rangeTo,      setRangeTo]      = useState(today())
  const [rangeLoading, setRangeLoading] = useState(false)

  // ─── cancel-confirm modal ────────────────────────────────────────────────────
  const [cancelOpen, setCancelOpen] = useState(false)

  // ─── load existing statement ───────────────────────────────────────────────
  useEffect(() => {
    if (isNew) return
    setLoading(true)
    getStatement(id)
      .then(res => {
        const s = res.data
        setEntityId(String(s.entity_id))
        setCustomerId(s.customer_id ? String(s.customer_id) : '')
        setStmtDate(s.statement_date ? s.statement_date.slice(0, 10) : today())
        setTitle(s.title || '')
        setRows((s.lines || []).map(l => ({
          _id:            uid(),
          kind:           (parseFloat(l.amount) || 0) < 0 ? 'payment' : 'invoice',
          line_date:      l.line_date ? l.line_date.slice(0, 10) : '',
          description:    l.description || '',
          invoice_number: l.invoice_number || '',
          amount:         String(parseFloat(l.amount) ?? ''),
        })))
      })
      .catch(() => toast.error('Failed to load statement'))
      .finally(() => setLoading(false))
  }, [id])

  // ─── load customers when entity changes ───────────────────────────────────
  useEffect(() => {
    setCustomers([])
    if (!entityId) return
    getCustomers({ entity_id: entityId, limit: 500 })
      .then(r => setCustomers(r.data || []))
      .catch(() => {})
  }, [entityId])

  // ─── row helpers ──────────────────────────────────────────────────────────
  function setRow(id, field, value) {
    setRows(prev => prev.map(r => r._id === id ? { ...r, [field]: value } : r))
  }
  function addRow()       { setRows(prev => [...prev, blankRow()]) }
  function addPayment()   { setRows(prev => [...prev, blankPaymentRow()]) }
  function removeRow(_id) { setRows(prev => prev.length > 1 ? prev.filter(r => r._id !== _id) : prev) }
  function moveRow(_id, dir) {
    setRows(prev => {
      const i = prev.findIndex(r => r._id === _id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = prev.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // ─── invoice picker ─────────────────────────────────────────────────────────
  async function openPicker() {
    if (!entityId || !customerId) { toast.error('Select entity and customer first'); return }
    setPickerOpen(true)
    setPickerSearch('')
    setPickerSelected(new Set())
    setPickerLoading(true)
    try {
      const res = await getInvoices({
        entity_id: entityId, customer_id: customerId, document_type: 'invoice', limit: 1000,
      })
      const invs = (res.data || [])
        .filter(inv => String(inv.customer?.id ?? inv.customer_id) === String(customerId))
        .sort((a, b) => (a.issue_date || '') < (b.issue_date || '') ? 1 : -1)
      setPickerInvoices(invs)
    } catch {
      toast.error('Failed to load invoices')
      setPickerInvoices([])
    } finally {
      setPickerLoading(false)
    }
  }
  function togglePick(id) {
    setPickerSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function addSelectedInvoices() {
    const chosen = pickerInvoices.filter(inv => pickerSelected.has(inv.id))
    if (chosen.length === 0) { toast.error('No invoices selected'); return }
    const existing = new Set(rows.map(r => r.invoice_number).filter(Boolean))
    const fresh = chosen.filter(inv => !existing.has(inv.invoice_number)).map(inv => invoiceRow(inv, isTradekor))
    if (fresh.length === 0) { toast.error('Those invoices are already on the statement'); setPickerOpen(false); return }
    setRows(prev => {
      // Drop the initial empty placeholder row if it's still untouched
      const base = (prev.length === 1 && !prev[0].invoice_number && !prev[0].amount && !prev[0].description)
        ? [] : prev
      return [...base, ...fresh]
    })
    const skipped = chosen.length - fresh.length
    toast.success(`Added ${fresh.length} invoice${fresh.length !== 1 ? 's' : ''}${skipped ? ` (${skipped} already added)` : ''}`)
    setPickerOpen(false)
  }

  // ─── date-range loader (Tradekor) ───────────────────────────────────────────
  // Pull every invoice issued in the selected range straight into the statement.
  async function loadDateRange() {
    if (!entityId || !customerId) { toast.error('Select entity and customer first'); return }
    if (!rangeFrom || !rangeTo)   { toast.error('Set a date range'); return }
    setRangeLoading(true)
    try {
      const res  = await getInvoices({ entity_id: entityId, customer_id: customerId, document_type: 'invoice', limit: 1000 })
      const from = parseISO(rangeFrom)
      const to   = parseISO(rangeTo + 'T23:59:59')
      const invs = (res.data || [])
        .filter(inv => String(inv.customer?.id ?? inv.customer_id) === String(customerId))
        .filter(inv => {
          const d = inv.issue_date ? parseISO(inv.issue_date) : null
          return d && isValid(d) && isWithinInterval(d, { start: from, end: to })
        })
        .sort((a, b) => (a.issue_date || '') < (b.issue_date || '') ? -1 : 1)
      if (invs.length === 0) { toast.error('No invoices found in that range'); return }

      const existing = new Set(rows.map(r => r.invoice_number).filter(Boolean))
      const fresh = invs.filter(inv => !existing.has(inv.invoice_number)).map(inv => invoiceRow(inv, isTradekor))
      if (fresh.length === 0) { toast.error('Those invoices are already on the statement'); return }
      setRows(prev => {
        const base = (prev.length === 1 && !prev[0].invoice_number && !prev[0].amount && !prev[0].description)
          ? [] : prev
        return [...base, ...fresh]
      })
      const skipped = invs.length - fresh.length
      toast.success(`Added ${fresh.length} invoice${fresh.length !== 1 ? 's' : ''}${skipped ? ` (${skipped} already added)` : ''}`)
    } catch {
      toast.error('Failed to load invoices')
    } finally {
      setRangeLoading(false)
    }
  }

  // Force the sign by row kind (payment = negative outstanding/paid).
  function signedAmount(r) {
    const n = parseFloat(r.amount) || 0
    return r.kind === 'payment' ? -Math.abs(n) : Math.abs(n)
  }

  // ─── cancel / discard ───────────────────────────────────────────────────────
  function handleCancel() {
    const hasData = customerId || rows.some(r => r.amount || r.description || r.invoice_number)
    if (hasData) setCancelOpen(true)
    else navigate('/statements')
  }

  // ─── save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!entityId)   { toast.error('Select an entity');  return }
    if (!customerId) { toast.error('Select a customer'); return }
    if (!stmtDate)   { toast.error('Set a date');        return }
    setSaving(true)
    const payload = {
      entity_id:      Number(entityId),
      customer_id:    customerId ? Number(customerId) : null,
      statement_type: 'generic',
      statement_date: stmtDate,
      title:          title || null,
      lines: rows.map((r, i) => ({
        line_date:      r.line_date || null,
        description:    r.description || null,
        invoice_number: r.invoice_number || null,
        amount:         signedAmount(r),
        sort_order:     i,
      })),
    }
    try {
      if (isNew) {
        const res = await createStatement(payload)
        toast.success('Statement saved')
        navigate(`/statements/${res.data.id}`, { replace: true })
      } else {
        await updateStatement(id, payload)
        toast.success('Changes saved')
      }
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ─── export (server-side: letterhead + entity branding) ─────────────────────
  function exportPayload() {
    return {
      entity_id:      Number(entityId),
      customer_id:    customerId ? Number(customerId) : null,
      statement_type: 'generic',
      statement_date: stmtDate,
      title:          title || null,
      lines: rows.map((r, i) => ({
        line_date:      r.line_date || null,
        description:    r.description || null,
        invoice_number: r.invoice_number || null,
        amount:         signedAmount(r),
        sort_order:     i,
      })),
    }
  }

  async function handleExport(fmt) {
    if (!entityId)   { toast.error('Select an entity');   return }
    if (!customerId) { toast.error('Select a customer');  return }
    setExporting(true)
    try {
      const base = (title || 'STATEMENT').replace(/\s+/g, '_')
      if (fmt === 'excel') {
        const res = await exportStatementExcel(exportPayload())
        saveBlob(res.data, XLSX_MIME, `${base}.xlsx`)
      } else {
        const res = await exportStatementPdf(exportPayload())
        saveBlob(res.data, 'application/pdf', `${base}.pdf`)
      }
      toast.success('Downloaded')
    } catch (e) {
      console.error(e); toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  // ─── computed ─────────────────────────────────────────────────────────────
  const selectedCustomer = customers.find(c => String(c.id) === String(customerId)) || null
  const isTradekor       = (selectedCustomer?.name || '').toLowerCase().includes('tradekor')
  const total            = rows.reduce((s, r) => s + signedAmount(r), 0)
  const outstandingTotal = rows.reduce((s, r) => { const n = signedAmount(r); return s + (n > 0 ? n : 0) }, 0)
  const paidTotal        = rows.reduce((s, r) => { const n = signedAmount(r); return s + (n < 0 ? n : 0) }, 0)

  if (loading) return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>
      <div className="loading-center"><div className="spinner" /></div>
    </div>
  )

  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>

      <style>{`
        .stmt-cell-input { border: 1px solid transparent; border-radius: 4px; transition: border-color .12s, background .12s; }
        .stmt-cell-input:hover:not(:disabled) { border-color: var(--border); }
        .stmt-cell-input:focus { border-color: var(--accent); background: var(--bg-surface); outline: none; }
      `}</style>

      {/* ── Page header ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost btn-sm" onClick={() => navigate('/statements')} style={{ padding: '5px 10px' }}>
            <ArrowLeft size={14} /> Statements
          </button>
          <div>
            <div className="page-title">{isNew ? 'New Statement' : (title || 'Edit Statement')}</div>
            <div className="page-subtitle">{isNew ? 'Build and save a statement' : 'Edit rows, then save or export'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost btn-sm" onClick={() => handleExport('pdf')} disabled={exporting}>
            <FileText size={14} style={{ color: 'var(--danger)' }} />
            PDF
          </button>
          <button className="btn-ghost btn-sm" onClick={() => handleExport('excel')} disabled={exporting}>
            <FileSpreadsheet size={14} style={{ color: '#16a34a' }} />
            Excel
          </button>
          <button className="btn-ghost btn-sm" onClick={handleCancel} disabled={saving}>
            <X size={14} />
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Header fields ── */}
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isAdmin && (
              <div className="form-row">
                <div className="form-group">
                  <label>Entity</label>
                  <select value={entityId} onChange={e => { setEntityId(e.target.value); setCustomerId('') }}>
                    <option value="">Select entity…</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Customer <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchableSelect
                    formInput
                    options={customers} value={customerId} onChange={setCustomerId}
                    getValue={c => String(c.id)} getLabel={c => c.name} placeholder="Search customer…"
                  />
                </div>
              </div>
            )}
            {!isAdmin && (
              <div className="form-group">
                <label>Customer <span style={{ color: 'var(--danger)' }}>*</span></label>
                <SearchableSelect
                  formInput
                  options={customers} value={customerId} onChange={setCustomerId}
                  getValue={c => String(c.id)} getLabel={c => c.name} placeholder="Search customer…"
                />
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label>Statement Date</label>
                <DateInput value={stmtDate} onChange={e => setStmtDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Title</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. MAY 2026" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Pick invoices + add payment ── */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn-primary btn-sm" onClick={openPicker} disabled={!entityId || !customerId}>
            <ListChecks size={14} /> Select Invoices
          </button>
          <button className="btn-ghost btn-sm" onClick={addPayment}>
            <CreditCard size={14} style={{ color: 'var(--success)' }} /> Add Payment Line
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
            Pick the customer's invoices, then add any payments received. Use the ⇅ arrows to order rows.
          </span>
        </div>

        {/* ── Tradekor: load invoices by date range ── */}
        {isTradekor && (
          <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarRange size={15} style={{ color: 'var(--accent)' }} />
              Tradekor — Load invoices by date range
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                <label>From</label>
                <DateInput value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
                <label>To</label>
                <DateInput value={rangeTo} onChange={e => setRangeTo(e.target.value)} />
              </div>
              <button className="btn-primary btn-sm" onClick={loadDateRange} disabled={rangeLoading} style={{ marginBottom: 0 }}>
                {rangeLoading ? 'Loading…' : 'Load Invoices in Range'}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              Pulls every Tradekor invoice issued in this range into the statement. You can still edit, reorder, or remove rows afterwards.
            </p>
          </div>
        )}

        {/* ── Rows table ── */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Rows <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({rows.length})</span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-ghost btn-sm" onClick={addPayment}>
                <CreditCard size={13} style={{ color: 'var(--success)' }} /> Add Payment
              </button>
              <button className="btn-ghost btn-sm" onClick={addRow}>
                <Plus size={13} /> Add Invoice Row
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)' }}>
                  <th style={{ ...thStyle, width: 70 }} />
                  <th style={thStyle}>Date</th>
                  <th style={{ ...thStyle, width: '36%' }}>Description</th>
                  <th style={thStyle}>Invoice #</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                  <th style={{ ...thStyle, width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isPayment = row.kind === 'payment'
                  return (
                    <tr
                      key={row._id}
                      style={{ background: isPayment ? 'rgba(34,197,94,0.04)' : undefined }}
                    >
                      <td style={{ ...tdStyle, padding: '4px 6px', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          title={isPayment ? 'Payment line — click to make an invoice line' : 'Invoice line — click to make a payment line'}
                          onClick={() => setRow(row._id, 'kind', isPayment ? 'invoice' : 'payment')}
                          style={{
                            border: 'none', borderRadius: 4, cursor: 'pointer', padding: '2px 6px',
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.03em',
                            color: isPayment ? 'var(--success)' : 'var(--accent)',
                            background: isPayment ? 'rgba(34,197,94,0.12)' : 'rgba(37,99,235,0.10)',
                          }}
                        >
                          {isPayment ? 'PAID' : 'INV'}
                        </button>
                        <span style={{ display: 'inline-flex', flexDirection: 'column', marginLeft: 4, verticalAlign: 'middle' }}>
                          <button className="btn-icon" onClick={() => moveRow(row._id, -1)} disabled={idx === 0}
                            style={{ padding: 0, height: 12, color: 'var(--text-muted)', opacity: idx === 0 ? 0.3 : 1 }} title="Move up">
                            <ChevronUp size={12} />
                          </button>
                          <button className="btn-icon" onClick={() => moveRow(row._id, 1)} disabled={idx === rows.length - 1}
                            style={{ padding: 0, height: 12, color: 'var(--text-muted)', opacity: idx === rows.length - 1 ? 0.3 : 1 }} title="Move down">
                            <ChevronDown size={12} />
                          </button>
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <input
                          className="stmt-cell-input"
                          type="date"
                          value={row.line_date}
                          onChange={e => setRow(row._id, 'line_date', e.target.value)}
                          style={{ ...inputStyle, width: 130 }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          className="stmt-cell-input"
                          type="text"
                          value={row.description}
                          onChange={e => setRow(row._id, 'description', e.target.value)}
                          onFocus={isPayment ? e => e.target.select() : undefined}
                          placeholder={isPayment ? 'Payment message…' : 'Auto: date - invoice #'}
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          className="stmt-cell-input"
                          type="text"
                          value={row.invoice_number}
                          onChange={e => setRow(row._id, 'invoice_number', e.target.value)}
                          placeholder="Inv #"
                          disabled={isPayment}
                          style={{ ...inputStyle, width: 110, opacity: isPayment ? 0.4 : 1 }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <input
                          className="stmt-cell-input"
                          type="number"
                          value={row.amount}
                          onChange={e => setRow(row._id, 'amount', e.target.value)}
                          placeholder="0.00"
                          style={{
                            ...inputStyle, width: 130, textAlign: 'right',
                            color: isPayment ? 'var(--success)' : undefined,
                          }}
                        />
                      </td>
                      <td style={{ ...tdStyle, padding: '0 8px' }}>
                        <button
                          className="btn-icon"
                          onClick={() => removeRow(row._id)}
                          style={{ color: 'var(--text-muted)', opacity: rows.length === 1 ? 0.3 : 1 }}
                          disabled={rows.length === 1}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Total footer */}
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 20,
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Outstanding:
              <strong style={{ marginLeft: 6, fontFamily: 'monospace', color: 'var(--text-primary)' }}>R&nbsp;{fmtAmt(outstandingTotal)}</strong>
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Paid:
              <strong style={{ marginLeft: 6, fontFamily: 'monospace', color: 'var(--success)' }}>R&nbsp;{fmtAmt(paidTotal)}</strong>
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Amount Due:
              <strong style={{ marginLeft: 6, fontFamily: 'monospace', color: 'var(--text-primary)' }}>R&nbsp;{fmtAmt(total)}</strong>
            </span>
          </div>
        </div>

      </div>

      {/* ── Invoice picker modal ── */}
      {pickerOpen && (
        <div
          onClick={() => setPickerOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card, #fff)', borderRadius: 10, width: 'min(720px, 100%)',
              maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Select Invoices</div>
                {selectedCustomer && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    for {selectedCustomer.name}
                  </div>
                )}
              </div>
              <button className="btn-icon" onClick={() => setPickerOpen(false)}><X size={16} /></button>
            </div>

            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
              <input
                type="text"
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                placeholder="Search invoice # or amount…"
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6 }}
              />
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {pickerLoading ? (
                <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
              ) : (() => {
                const term = pickerSearch.trim().toLowerCase()
                const visible = pickerInvoices.filter(inv =>
                  !term ||
                  (inv.invoice_number || '').toLowerCase().includes(term) ||
                  String(inv.total || '').includes(term)
                )
                if (visible.length === 0) return (
                  <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No invoices found for this customer.
                  </div>
                )
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-surface)' }}>
                        <th style={{ ...thStyle, width: 36 }} />
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>Invoice #</th>
                        <th style={thStyle}>Type</th>
                        <th style={thStyle}>Status</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Total (R)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(inv => {
                        const checked = pickerSelected.has(inv.id)
                        return (
                          <tr key={inv.id} onClick={() => togglePick(inv.id)} style={{ cursor: 'pointer', background: checked ? 'rgba(37,99,235,0.06)' : undefined }}>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              <input type="checkbox" checked={checked} readOnly />
                            </td>
                            <td style={{ ...tdStyle, fontSize: 13 }}>{fmtDateDot(inv.issue_date)}</td>
                            <td style={{ ...tdStyle, fontSize: 13, fontWeight: 500 }}>{inv.invoice_number}</td>
                            <td style={{ ...tdStyle, fontSize: 12 }}>
                              {isPoImport(inv)
                                ? <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#92400e', background: 'rgba(245,158,11,0.18)' }}>PO</span>
                                : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                            <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{inv.status}</td>
                            <td style={{ ...tdStyle, fontSize: 13, textAlign: 'right', fontFamily: 'monospace' }}>{fmtAmt(inv.total)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              })()}
            </div>

            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pickerSelected.size} selected</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ghost btn-sm" onClick={() => setPickerOpen(false)}>Cancel</button>
                <button className="btn-primary btn-sm" onClick={addSelectedInvoices} disabled={pickerSelected.size === 0}>
                  Add Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Discard confirmation modal ── */}
      {cancelOpen && (
        <div className="modal-overlay" onClick={() => setCancelOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <AlertTriangle size={18} color="var(--danger)" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Discard statement?</span>
            </div>
            <div style={{ padding: '20px' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {isNew
                  ? 'This statement hasn’t been saved yet. '
                  : 'Any unsaved changes to this statement will be lost. '}
                Are you sure you want to leave and discard your changes?
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn-ghost" onClick={() => setCancelOpen(false)}>Keep editing</button>
              <button
                onClick={() => { setCancelOpen(false); navigate('/statements') }}
                style={{
                  padding: '7px 18px', borderRadius: 7, border: 'none',
                  background: 'var(--danger)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const thStyle = {
  padding: '9px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'left', whiteSpace: 'nowrap',
}
const tdStyle = { padding: '6px 8px', borderTop: '1px solid var(--border)' }
const inputStyle = {
  background: 'transparent', border: '1px solid transparent', borderRadius: 4,
  padding: '5px 8px', fontSize: 13, color: 'var(--text-primary)', width: '100%',
  outline: 'none', transition: 'border-color 0.12s',
  fontFamily: 'inherit',
}
