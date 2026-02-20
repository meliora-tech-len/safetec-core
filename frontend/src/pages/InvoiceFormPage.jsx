import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getEntities, getClients, getInvoice, createInvoice, updateInvoice } from '../services/api'
import { formatCurrency, errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import { Plus, Trash2, ArrowLeft, Save } from 'lucide-react'

const EMPTY_LINE = { description: '', quantity: '1', unit_price: '0', sort_order: 0 }

export default function InvoiceFormPage({ docType = 'invoice' }) {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const isInvoice = docType === 'invoice'

  const [entities, setEntities] = useState([])
  const [clients, setClients] = useState([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  const [form, setForm] = useState({
    entity_id: '',
    client_id: '',
    document_type: docType,
    status: 'draft',
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: '',
    notes: '',
    terms: '',
  })
  const [lineItems, setLineItems] = useState([{ ...EMPTY_LINE }])
  const [vatRate, setVatRate] = useState(0.15)

  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  useEffect(() => {
    if (form.entity_id) {
      getClients({ entity_id: form.entity_id }).then(r => setClients(r.data))
      const entity = entities.find(e => e.id === parseInt(form.entity_id))
      if (entity) setVatRate(parseFloat(entity.vat_rate) || 0.15)
    }
  }, [form.entity_id, entities])

  useEffect(() => {
    if (isEdit) {
      getInvoice(id).then(r => {
        const inv = r.data
        setForm({
          entity_id: inv.entity_id,
          client_id: inv.client_id,
          document_type: inv.document_type,
          status: inv.status,
          issue_date: inv.issue_date?.slice(0, 10) || '',
          due_date: inv.due_date?.slice(0, 10) || '',
          notes: inv.notes || '',
          terms: inv.terms || '',
        })
        setLineItems(inv.line_items.map(li => ({
          description: li.description,
          quantity: String(li.quantity),
          unit_price: String(li.unit_price),
          sort_order: li.sort_order,
        })))
        setVatRate(parseFloat(inv.vat_rate) || 0.15)
      }).finally(() => setLoading(false))
    }
  }, [id, isEdit])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const addLine = () => setLineItems(li => [...li, { ...EMPTY_LINE, sort_order: li.length }])
  const removeLine = (i) => setLineItems(li => li.filter((_, idx) => idx !== i))
  const setLine = (i, k, v) => setLineItems(li => li.map((item, idx) => idx === i ? { ...item, [k]: v } : item))

  const subtotal = lineItems.reduce((s, li) => s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0), 0)
  const vatAmount = subtotal * vatRate
  const total = subtotal + vatAmount

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.entity_id) return toast.error('Select an entity')
    if (!form.client_id) return toast.error('Select a client')

    setSaving(true)
    try {
      const payload = {
        ...form,
        entity_id: parseInt(form.entity_id),
        client_id: parseInt(form.client_id),
        issue_date: form.issue_date ? new Date(form.issue_date).toISOString() : null,
        due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
        line_items: lineItems.map((li, i) => ({
          description: li.description,
          quantity: parseFloat(li.quantity) || 0,
          unit_price: parseFloat(li.unit_price) || 0,
          sort_order: i,
        })),
      }
      if (isEdit) {
        await updateInvoice(id, payload)
        toast.success('Updated successfully')
      } else {
        const res = await createInvoice(payload)
        toast.success(`${isInvoice ? 'Invoice' : 'Quote'} created: ${res.data.invoice_number}`)
        navigate(`/${isInvoice ? 'invoices' : 'quotes'}/${res.data.id}`)
        return
      }
      navigate(-1)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <button className="btn-ghost btn-sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>
          {isEdit ? `Edit ${isInvoice ? 'Invoice' : 'Quote'}` : `New ${isInvoice ? 'Invoice' : 'Quote'}`}
        </h1>
        <div style={{ width: 60 }} />
      </div>

      <form onSubmit={handleSubmit}>
        <div style={styles.grid}>
          {/* Left: Main form */}
          <div style={styles.main}>
            {/* Entity & Client */}
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={styles.sectionTitle}>Document Details</h3>
              <div className="form-row" style={{ marginTop: 16 }}>
                <div className="form-group">
                  <label>Business Entity *</label>
                  <select value={form.entity_id} onChange={e => set('entity_id', e.target.value)} required>
                    <option value="">Select entity...</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Client *</label>
                  <select value={form.client_id} onChange={e => set('client_id', e.target.value)} required disabled={!form.entity_id}>
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row" style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label>Issue Date</label>
                  <input type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={form.status} onChange={e => set('status', e.target.value)}>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={styles.sectionTitle}>Line Items</h3>
                <button type="button" className="btn-ghost btn-sm" onClick={addLine}>
                  <Plus size={13} /> Add Line
                </button>
              </div>

              <div style={{ marginTop: 16 }}>
                {/* Header row */}
                <div style={styles.lineHeader}>
                  <span style={{ flex: 4 }}>Description</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Qty</span>
                  <span style={{ flex: 2, textAlign: 'right' }}>Unit Price</span>
                  <span style={{ flex: 2, textAlign: 'right' }}>Amount</span>
                  <span style={{ width: 30 }} />
                </div>

                {lineItems.map((li, i) => {
                  const amount = (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0)
                  return (
                    <div key={i} style={styles.lineRow}>
                      <input
                        style={{ flex: 4 }}
                        placeholder="Description of goods/services"
                        value={li.description}
                        onChange={e => setLine(i, 'description', e.target.value)}
                        required
                      />
                      <input
                        style={{ flex: 1, textAlign: 'right' }}
                        type="number" min="0" step="0.01"
                        value={li.quantity}
                        onChange={e => setLine(i, 'quantity', e.target.value)}
                      />
                      <input
                        style={{ flex: 2, textAlign: 'right' }}
                        type="number" min="0" step="0.01"
                        value={li.unit_price}
                        onChange={e => setLine(i, 'unit_price', e.target.value)}
                      />
                      <div style={{ flex: 2, textAlign: 'right', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                        {formatCurrency(amount)}
                      </div>
                      <button type="button" className="btn-icon btn-ghost" onClick={() => removeLine(i)} disabled={lineItems.length === 1}>
                        <Trash2 size={12} color="var(--danger)" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right: Summary + Notes */}
          <div style={styles.sidebar}>
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={styles.sectionTitle}>Summary</h3>
              <div style={styles.totalRow}>
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div style={styles.totalRow}>
                <span>VAT ({Math.round(vatRate * 100)}%)</span>
                <span>{formatCurrency(vatAmount)}</span>
              </div>
              <hr style={{ margin: '10px 0' }} />
              <div style={{ ...styles.totalRow, fontWeight: 700, fontSize: 16 }}>
                <span>Total Due</span>
                <span style={{ color: 'var(--accent)' }}>{formatCurrency(total)}</span>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={styles.sectionTitle}>Notes</h3>
              <textarea
                style={{ marginTop: 12 }}
                rows={3}
                placeholder="Additional notes for the client..."
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
              />
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={styles.sectionTitle}>Terms</h3>
              <textarea
                style={{ marginTop: 12 }}
                rows={2}
                placeholder="Payment terms, e.g. Payment due within 30 days"
                value={form.terms}
                onChange={e => set('terms', e.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={saving}
              style={{ justifyContent: 'center', height: 42 }}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : <><Save size={14} /> {isEdit ? 'Save Changes' : `Create ${isInvoice ? 'Invoice' : 'Quote'}`}</>}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

const styles = {
  page: { padding: '20px 28px', flex: 1 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'flex-start' },
  main: {},
  sidebar: { position: 'sticky', top: 20 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 },
  lineHeader: {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '6px 8px',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 0.5, color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)', marginBottom: 6,
  },
  lineRow: {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '4px 0', borderBottom: '1px solid var(--border)',
  },
  totalRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '6px 0', fontSize: 13,
  },
}
