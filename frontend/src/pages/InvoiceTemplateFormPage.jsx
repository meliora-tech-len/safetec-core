import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, AlertCircle, ArrowLeft, Save } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  getEntities, getSuppliers, getCustomers,
  getInvoiceTemplate, createInvoiceTemplate, updateInvoiceTemplate,
} from '../services/api'
import toast from 'react-hot-toast'

const LINE_TYPES = [
  { value: 'item',   label: 'Item',   color: 'var(--accent)' },
  { value: 'header', label: 'Header', color: '#7c3aed' },
  { value: 'note',   label: 'Note',   color: 'var(--text-muted)' },
  { value: 'spacer', label: 'Space',  color: 'var(--border)' },
]

const emptyLine = (type = 'item') => ({
  _id: Math.random().toString(36).slice(2),
  description: '',
  quantity: '',
  unit_price: '',
  amount: '',
  is_vat_exempt: false,
  sort_order: 0,
  line_type: type,
})

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

function fmt(val) {
  const n = parseFloat(val) || 0
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function InvoiceTemplateFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { activeEntity } = useAuth()
  const isEdit = !!id

  const [entities, setEntities] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [entityId, setEntityId] = useState('')
  const [recipientType, setRecipientType] = useState('customer')
  const [supplierId, setSupplierId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [docType, setDocType] = useState('invoice')
  const [isVatExempt, setIsVatExempt] = useState(false)
  const [vatRate, setVatRate] = useState(0.15)
  const [notes, setNotes] = useState('')
  const [printNote, setPrintNote] = useState(false)
  const [terms, setTerms] = useState('')
  const [lines, setLines] = useState([emptyLine()])

  useEffect(() => {
    let ignore = false
    const init = async () => {
      setLoading(true)
      try {
        const entsRes = await getEntities()
        if (ignore) return
        setEntities(entsRes.data)

        if (isEdit) {
          const tmpl = (await getInvoiceTemplate(id)).data
          if (ignore) return
          setName(tmpl.name)
          setEntityId(String(tmpl.entity_id))
          setDocType(tmpl.document_type)
          setIsVatExempt(tmpl.is_vat_exempt || false)
          setVatRate(parseFloat(tmpl.vat_rate) || 0.15)
          setNotes(tmpl.notes || '')
          setPrintNote(tmpl.print_note || false)
          setTerms(tmpl.terms || '')
          if (tmpl.customer_id) {
            setRecipientType('customer')
            setCustomerId(String(tmpl.customer_id))
          } else {
            setRecipientType('supplier')
            setSupplierId(String(tmpl.supplier_id || ''))
          }
          setLines(
            tmpl.line_items.length > 0
              ? tmpl.line_items.map(li => ({
                  _id: String(li.id),
                  description: li.description || '',
                  quantity: li.quantity != null ? String(li.quantity) : '',
                  unit_price: li.unit_price != null ? String(li.unit_price) : '',
                  amount: li.amount != null ? String(li.amount) : '',
                  is_vat_exempt: li.is_vat_exempt || false,
                  sort_order: li.sort_order,
                  line_type: li.line_type || 'item',
                }))
              : [emptyLine()]
          )
        } else {
          const defaultEntity = activeEntity || entsRes.data[0]
          if (defaultEntity) {
            setEntityId(String(defaultEntity.id))
            setVatRate(parseFloat(defaultEntity.vat_rate) || 0.15)
          }
        }
      } catch {
        if (!ignore) setError('Failed to load data')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    init()
    return () => { ignore = true }
  }, [id])

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

  useEffect(() => {
    if (!isEdit) { setSupplierId(''); setCustomerId('') }
  }, [entityId])

  useEffect(() => {
    if (isEdit) return
    const entity = entities.find(e => String(e.id) === entityId)
    if (entity) setVatRate(parseFloat(entity.vat_rate) || 0.15)
  }, [entityId, entities])

  const updateLine = (idx, field, value) => {
    setLines(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [field]: value }
      if (field === 'line_type' && value !== 'item') {
        updated[idx].quantity = ''
        updated[idx].unit_price = ''
        updated[idx].amount = ''
        updated[idx].is_vat_exempt = false
      }
      if ((field === 'quantity' || field === 'unit_price') && updated[idx].line_type === 'item') {
        const qty   = field === 'quantity'   ? value : updated[idx].quantity
        const price = field === 'unit_price' ? value : updated[idx].unit_price
        if (qty !== '' && price !== '') {
          updated[idx].amount = String((parseFloat(qty) * parseFloat(price)).toFixed(2))
        }
      }
      return updated
    })
  }

  const addLine = (type = 'item') => setLines(prev => [...prev, emptyLine(type)])
  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx))

  // Totals
  const subtotal = lines
    .filter(l => (l.line_type || 'item') === 'item')
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
  const vatBase = isVatExempt ? 0 : lines
    .filter(l => (l.line_type || 'item') === 'item' && !l.is_vat_exempt)
    .reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
  const vatAmount = vatBase * vatRate
  const total = subtotal + vatAmount
  const vatPct = Math.round(vatRate * 100)

  const handleSave = async () => {
    if (!name.trim()) { setError('Template name is required'); return }
    if (!entityId) { setError('Entity is required'); return }

    setSaving(true)
    setError('')
    try {
      const payload = {
        entity_id: parseInt(entityId),
        supplier_id: recipientType === 'supplier' && supplierId ? parseInt(supplierId) : null,
        customer_id: recipientType === 'customer' && customerId ? parseInt(customerId) : null,
        name: name.trim(),
        document_type: docType,
        is_vat_exempt: isVatExempt,
        vat_rate: vatRate,
        notes: notes || null,
        print_note: printNote,
        terms: terms || null,
        line_items: lines.map((l, i) => ({
          description: l.description || null,
          is_vat_exempt: l.is_vat_exempt,
          sort_order: i,
          line_type: l.line_type,
          quantity: l.line_type === 'item' && l.quantity !== '' ? parseFloat(l.quantity) : null,
          unit_price: l.line_type === 'item' && l.unit_price !== '' ? parseFloat(l.unit_price) : null,
          amount: l.line_type === 'item' && l.amount !== '' ? parseFloat(l.amount) : null,
        })),
      }

      if (isEdit) {
        await updateInvoiceTemplate(id, payload)
        toast.success('Template updated')
      } else {
        await createInvoiceTemplate(payload)
        toast.success('Template created')
      }
      navigate('/invoice-templates')
    } catch (e) {
      const msg = e?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 'var(--page-pad)', color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <button className="btn-ghost btn-sm" onClick={() => navigate('/invoice-templates')}>
          <ArrowLeft size={14} /> Templates
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {isEdit ? 'Edit Template' : 'New Template'}
        </h1>
        <div style={{ width: 100 }} />
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(220,38,38,0.08)', color: '#dc2626', padding: '10px 14px', borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <div style={styles.grid}>
        {/* ── Left ─────────────────────────────────────────────── */}
        <div style={styles.main}>

          {/* Template Details */}
          <div className="card">
            <h3 style={styles.sectionTitle}>Template Details</h3>

            <div style={{ marginTop: 16 }}>
              <label className="form-label">Template Name *</label>
              <input
                className="form-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. OBHI - Alex JTH936EC Diesel"
                style={{ marginTop: 6 }}
                autoFocus={!isEdit}
              />
            </div>

            <div className="form-row" style={{ marginTop: 14 }}>
              <div>
                <label className="form-label">Entity *</label>
                <select
                  className="form-input"
                  style={{ marginTop: 6 }}
                  value={entityId}
                  onChange={e => setEntityId(e.target.value)}
                  disabled={isEdit}
                >
                  <option value="">Select entity...</option>
                  {entities.map(e => (
                    <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Bill To</label>
                <div style={{ display: 'flex', gap: 4, marginTop: 6, marginBottom: 8 }}>
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
                  <select className="form-input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                    <option value="">Select customer...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
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
              <div style={{ ...styles.lineHeader, paddingLeft: 62 }}>
                <span style={{ flex: 3 }}>Description</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Qty</span>
                <span style={{ flex: 1.5, textAlign: 'right' }}>Rate</span>
                <span style={{ flex: 1.5, textAlign: 'right' }}>Amount</span>
                <span style={{ width: 54, textAlign: 'center' }}>No VAT</span>
                <span style={{ width: 30 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lines.map((line, idx) => {
                  const lt = line.line_type || 'item'
                  const isItem = lt === 'item'
                  const isSpacer = lt === 'spacer'
                  return (
                    <div
                      key={line._id}
                      style={{
                        ...styles.lineRow,
                        background: lt === 'header'
                          ? 'rgba(124,58,237,0.05)'
                          : (line.is_vat_exempt && !isVatExempt && isItem) ? 'rgba(217,119,6,0.04)' : 'transparent',
                        minHeight: isSpacer ? 28 : undefined,
                        opacity: isSpacer ? 0.6 : 1,
                        alignItems: 'center',
                      }}
                    >
                      <LineTypeChip value={lt} onChange={v => updateLine(idx, 'line_type', v)} />

                      {!isSpacer ? (
                        <input
                          className="form-input"
                          style={{
                            flex: isItem ? 3 : 10,
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
                        <span style={{ flex: 7, fontSize: 11, color: 'var(--text-muted)', paddingLeft: 8, fontStyle: 'italic' }}>
                          — spacer row —
                        </span>
                      )}

                      {isItem && (<>
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
                          style={{ flex: 1.5, fontSize: 13, textAlign: 'right' }}
                          placeholder="0.00"
                          value={line.unit_price}
                          onChange={e => updateLine(idx, 'unit_price', e.target.value)}
                          min="0" step="any"
                        />
                        <input
                          className="form-input"
                          type="number"
                          style={{ flex: 1.5, fontSize: 13, textAlign: 'right', fontWeight: line.amount ? 600 : 400 }}
                          placeholder="0.00"
                          value={line.amount}
                          onChange={e => updateLine(idx, 'amount', e.target.value)}
                          min="0" step="any"
                        />
                        <div style={{ width: 54, display: 'flex', justifyContent: 'center' }}>
                          <label title={isVatExempt ? 'Whole invoice is VAT exempt' : 'Exclude this line from VAT'} style={{ cursor: isVatExempt ? 'default' : 'pointer' }}>
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

                      {!isItem && !isSpacer && <div style={{ flex: 4 }} />}

                      <button
                        onClick={() => removeLine(idx)}
                        disabled={lines.length === 1}
                        style={{
                          width: 30, background: 'none', border: 'none',
                          cursor: lines.length > 1 ? 'pointer' : 'default',
                          color: 'var(--text-muted)', display: 'flex', justifyContent: 'center',
                          padding: 4, flexShrink: 0,
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: sidebar ───────────────────────────────────── */}
        <div style={styles.sidebar}>

          {/* Totals */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={styles.sectionTitle}>Summary</h3>
            <div style={styles.totalRow}>
              <span style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
              <span>{fmt(subtotal)}</span>
            </div>
            <div style={styles.totalRow}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {isVatExempt ? 'VAT (Exempt)' : `VAT (${vatPct}%)`}
                {!isVatExempt && lines.some(l => l.is_vat_exempt) && (
                  <span style={{ fontSize: 10, color: '#d97706', marginLeft: 4 }}>some lines excluded</span>
                )}
              </span>
              <span style={{ color: isVatExempt ? 'var(--text-muted)' : undefined }}>
                {isVatExempt ? '—' : fmt(vatAmount)}
              </span>
            </div>
            <hr style={{ margin: '10px 0', border: 'none', borderTop: '1px solid var(--border)' }} />
            <div style={{ ...styles.totalRow, fontWeight: 700, fontSize: 15 }}>
              <span>Total</span>
              <span style={{ color: 'var(--accent)' }}>{fmt(total)}</span>
            </div>
            {!isVatExempt && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>VAT Rate:</span>
                <input
                  type="number"
                  value={vatPct}
                  onChange={e => setVatRate((parseFloat(e.target.value) || 0) / 100)}
                  style={{ width: 50, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12 }}
                  min="0" max="100"
                />
                <span style={{ color: 'var(--text-muted)' }}>%</span>
              </div>
            )}
          </div>

          {/* Document Type + VAT */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={styles.sectionTitle}>Settings</h3>

            <div style={{ marginTop: 14 }}>
              <label className="form-label">Document Type</label>
              <select
                className="form-input"
                style={{ marginTop: 6 }}
                value={docType}
                onChange={e => setDocType(e.target.value)}
              >
                <option value="invoice">Invoice</option>
                <option value="quote">Quote</option>
                <option value="purchase_order">Purchase Order</option>
              </select>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={isVatExempt}
                  onChange={e => setIsVatExempt(e.target.checked)}
                  style={{ width: 14, height: 14 }}
                />
                VAT Exempt invoice
              </label>
              {isVatExempt && (
                <div style={{ fontSize: 11, color: '#d97706', marginTop: 4, marginLeft: 22 }}>
                  No VAT will be added
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={styles.sectionTitle}>Notes (optional)</h3>
            <textarea
              className="form-input"
              rows={4}
              placeholder="Internal reminders or notes..."
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

          {/* Terms */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={styles.sectionTitle}>Terms (optional)</h3>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Payment terms, conditions..."
              value={terms}
              onChange={e => setTerms(e.target.value)}
              style={{ marginTop: 12, resize: 'vertical' }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={saving}
              style={{ justifyContent: 'center', height: 42 }}
            >
              {saving ? 'Saving...' : <><Save size={14} /> Save Template</>}
            </button>
            <button
              className="btn-ghost"
              onClick={() => navigate('/invoice-templates')}
              disabled={saving}
              style={{ justifyContent: 'center' }}
            >
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
