import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, AlertCircle, ArrowLeft, Save } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { getEntities, getSuppliers, getInvoice, getNextInvoiceNumber, createInvoice, updateInvoice } from '../services/api'

const emptyLine = () => ({
  _id: Math.random().toString(36).slice(2),
  description: '', quantity: '', unit_price: '', amount: '',
  is_vat_exempt: false, sort_order: 0,
})

function formatCurrency(val) {
  const n = parseFloat(val) || 0
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function InvoiceFormPage({ docType = 'invoice' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, activeEntity } = useAuth()
  const isEdit = !!id
  const isInvoice = docType === 'invoice'
  const isPO      = docType === 'purchase_order'
  const docLabel  = isInvoice ? 'Invoice' : isPO ? 'Purchase Order' : 'Quote'
  const docPath   = isInvoice ? 'invoices' : isPO ? 'purchase-orders' : 'quotes'

  const [entities, setEntities] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [entityId, setEntityId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceNumberEdited, setInvoiceNumberEdited] = useState(false) // track if user manually edited
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [printNote, setPrintNote] = useState(false)
  const [isVatExempt, setIsVatExempt] = useState(false) // whole invoice non-VAT
  const [vatRate, setVatRate] = useState(0.15)
  const [lines, setLines] = useState([emptyLine()])

  // ── Load initial data ─────────────────────────────────────────────
  useEffect(() => {
    let ignore = false
    const init = async () => {
      setLoading(true)
      try {
        const [entsRes, supsRes] = await Promise.all([getEntities(), getSuppliers()])
        if (ignore) return
        setEntities(entsRes.data)
        setSuppliers(supsRes.data)

        if (isEdit) {
          const inv = (await getInvoice(id)).data
          if (ignore) return
          setEntityId(String(inv.entity_id))
          setSupplierId(String(inv.supplier_id))
          setInvoiceNumber(inv.invoice_number)
          setIssueDate(inv.issue_date?.slice(0, 10) || new Date().toISOString().slice(0, 10))
          setDueDate(inv.due_date?.slice(0, 10) || '')
          setNotes(inv.notes || '')
          setPrintNote(inv.print_note || false)
          setIsVatExempt(inv.is_vat_exempt || false)
          setVatRate(parseFloat(inv.vat_rate) || 0.15)
          setLines(inv.line_items.map(li => ({
            _id: String(li.id),
            description: li.description || '',
            quantity: li.quantity != null ? String(li.quantity) : '',
            unit_price: li.unit_price != null ? String(li.unit_price) : '',
            amount: String(li.amount),
            is_vat_exempt: li.is_vat_exempt || false,
            sort_order: li.sort_order,
          })))
        } else {
          const defaultEntity = activeEntity || entsRes.data[0]
          if (defaultEntity) {
            setEntityId(String(defaultEntity.id))
            setVatRate(parseFloat(defaultEntity.vat_rate) || 0.15)
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
    if (entity) setVatRate(parseFloat(entity.vat_rate) || 0.15)
  }, [entityId, entities])

  // ── Line helpers ──────────────────────────────────────────────────
  const updateLine = (idx, field, value) => {
    setLines(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [field]: value }
      // Auto-calc amount only when both qty and price are filled
      if (field === 'quantity' || field === 'unit_price') {
        const qty   = field === 'quantity'   ? value : updated[idx].quantity
        const price = field === 'unit_price' ? value : updated[idx].unit_price
        if (qty !== '' && price !== '') {
          updated[idx].amount = String((parseFloat(qty) * parseFloat(price)).toFixed(2))
        }
      }
      return updated
    })
  }

  const addLine = () => setLines(prev => [...prev, emptyLine()])
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx))

  // ── Totals ────────────────────────────────────────────────────────
  const subtotal = lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
  const vatBase = isVatExempt ? 0 : lines.reduce((sum, l) => {
    if (l.is_vat_exempt) return sum
    return sum + (parseFloat(l.amount) || 0)
  }, 0)
  const vatAmount = vatBase * vatRate
  const total = subtotal + vatAmount

  const filteredSuppliers = suppliers.filter(s => !entityId || String(s.entity_id) === entityId)

  // ── Save ──────────────────────────────────────────────────────────
  const handleSave = async (statusOverride = null) => {
    if (!entityId || !supplierId || !invoiceNumber) {
      setError('Entity, supplier, and invoice number are required')
      return
    }
    if (lines.every(l => !l.description && !parseFloat(l.amount))) {
      setError('Add at least one line item')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        entity_id: parseInt(entityId),
        supplier_id: parseInt(supplierId),
        document_type: docType,
        invoice_number: invoiceNumber,
        is_vat_exempt: isVatExempt,
        issue_date: issueDate ? new Date(issueDate).toISOString() : null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        vat_rate: vatRate,
        notes: notes || null,
        print_note: printNote,
        status: statusOverride || 'draft',
        line_items: lines
          .filter(l => l.description || parseFloat(l.amount))
          .map((l, i) => ({
            description: l.description,
            quantity: l.quantity !== '' ? parseFloat(l.quantity) : null,
            unit_price: l.unit_price !== '' ? parseFloat(l.unit_price) : null,
            amount: parseFloat(l.amount) || 0,
            is_vat_exempt: l.is_vat_exempt,
            sort_order: i,
          })),
      }

      if (isEdit) {
        await updateInvoice(id, payload)
      } else {
        await createInvoice(payload)
      }
      navigate(`/${docPath}`)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to save invoice')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: '28px 32px', color: 'var(--text-muted)' }}>Loading...</div>

  const selectedEntity = entities.find(e => String(e.id) === entityId)
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
                <label className="form-label">Supplier *</label>
                <select className="form-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">Select supplier...</option>
                  {filteredSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

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
                <input className="form-input" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Due Date</label>
                <input className="form-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={styles.sectionTitle}>Line Items</h3>
              <button className="btn-ghost btn-sm" onClick={addLine}>
                <Plus size={13} /> Add Line
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={styles.lineHeader}>
                <span style={{ flex: 4 }}>Description</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Qty</span>
                <span style={{ flex: 2, textAlign: 'right' }}>Rate</span>
                <span style={{ flex: 2, textAlign: 'right' }}>Amount</span>
                <span style={{ width: 54, textAlign: 'center' }}>No VAT</span>
                <span style={{ width: 30 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lines.map((line, idx) => (
                  <div key={line._id} style={{
                    ...styles.lineRow,
                    background: line.is_vat_exempt && !isVatExempt ? 'rgba(217,119,6,0.04)' : 'transparent',
                  }}>
                    <input
                      className="form-input"
                      style={{ flex: 4, fontSize: 13 }}
                      placeholder="Description of service or goods"
                      value={line.description}
                      onChange={e => updateLine(idx, 'description', e.target.value)}
                    />
                    <input
                      className="form-input"
                      type="number"
                      style={{ flex: 1, fontSize: 13, textAlign: 'right' }}
                      placeholder="—"
                      value={line.quantity}
                      onChange={e => updateLine(idx, 'quantity', e.target.value)}
                      min="0" step="any"
                    />
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
                    <button onClick={() => removeLine(idx)} disabled={lines.length === 1}
                      style={{ width: 30, background: 'none', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'default', color: 'var(--text-muted)', display: 'flex', justifyContent: 'center', padding: 4 }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
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
