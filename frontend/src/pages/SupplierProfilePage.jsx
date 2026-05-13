import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getSupplier, getEntities,
  getSupplierInvoices, createSupplierInvoice,
  updateSupplierInvoice, deleteSupplierInvoice, markStatementPaid,
  verifySupplierInvoice,
} from '../services/api'
import { formatCurrency, formatDate, errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, Save, X } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import VerifyBadge from '../components/VerifyBadge'

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const today = new Date().toISOString().slice(0, 10)

const blankForm = (entityId) => ({
  entity_id: entityId || '',
  invoice_date: today,
  invoice_number: '',
  amount: '',
  vehicle_reg: '',
  description: '',
  vat_applicable: true,
  notes: '',
})

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

  const [supplier, setSupplier] = useState(null)
  const [entities, setEntities] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState({})

  // Inline editing state
  const [editingId, setEditingId] = useState(null)   // invoice id being edited
  const [editForm, setEditForm] = useState({})
  const [showNew, setShowNew] = useState(false)       // new inline row visible
  const [newForm, setNewForm] = useState(blankForm(''))
  const [saving, setSaving] = useState(false)
  const firstInputRef = useRef(null)

  const loadInvoices = useCallback(() =>
    getSupplierInvoices({ supplier_id: supplierId }).then(r => setGroups(r.data))
  , [supplierId])

  useEffect(() => {
    Promise.all([
      getSupplier(supplierId).then(r => {
        setSupplier(r.data)
        setNewForm(blankForm(r.data.entity_id))
      }),
      getEntities().then(r => setEntities(r.data)),
    ]).then(() => setLoading(false))
  }, [supplierId])

  useEffect(() => { if (!loading) loadInvoices() }, [loading, loadInvoices])

  // Focus first input whenever new row appears or edit row opens
  useEffect(() => {
    if ((showNew || editingId) && firstInputRef.current)
      firstInputRef.current.focus()
  }, [showNew, editingId])

  const toggleCollapse = (key) => setCollapsed(s => ({ ...s, [key]: !s[key] }))

  const startEdit = (inv) => {
    if (editingId !== null) return   // intentional exit required (Esc or X) before switching rows
    setShowNew(false)
    setEditingId(inv.id)
    setEditForm({
      entity_id: inv.entity_id,
      invoice_date: inv.invoice_date?.slice(0, 10) || today,
      invoice_number: inv.invoice_number || '',
      amount: String(inv.amount || ''),
      vehicle_reg: inv.vehicle_reg || '',
      description: inv.description || '',
      vat_applicable: inv.vat_applicable !== false,
      notes: inv.notes || '',
    })
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({}) }
  const cancelNew = () => { setShowNew(false); setNewForm(blankForm(supplier?.entity_id)) }

  const handleAddClick = () => {
    setEditingId(null)
    setNewForm(blankForm(supplier?.entity_id))
    setShowNew(true)
  }

  const buildPayload = (form) => ({
    entity_id: parseInt(form.entity_id),
    invoice_date: new Date(form.invoice_date + 'T12:00:00').toISOString(),
    invoice_number: form.invoice_number.trim(),
    amount: parseFloat(form.amount),
    vat_applicable: form.vat_applicable,
    vehicle_reg: form.vehicle_reg.trim() || null,
    description: form.description.trim() || null,
    notes: form.notes.trim() || null,
  })

  const validate = (form) => {
    if (!form.invoice_date) return 'Invoice date is required'
    if (!form.invoice_number.trim()) return 'Invoice number is required'
    if (!form.amount || isNaN(form.amount) || parseFloat(form.amount) <= 0) return 'Valid amount is required'
    return null
  }

  const saveNew = async () => {
    const err = validate(newForm)
    if (err) return toast.error(err)
    setSaving(true)
    try {
      await createSupplierInvoice({ ...buildPayload(newForm), supplier_id: parseInt(supplierId) })
      toast.success('Invoice added')
      setShowNew(false)
      setNewForm(blankForm(supplier?.entity_id))
      await loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }

  const saveEdit = async () => {
    const err = validate(editForm)
    if (err) return toast.error(err)
    setSaving(true)
    try {
      await updateSupplierInvoice(editingId, buildPayload(editForm))
      toast.success('Saved')
      setEditingId(null)
      await loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }

  const handleDelete = async (inv) => {
    if (!confirm(`Delete invoice ${inv.invoice_number}?`)) return
    try {
      await deleteSupplierInvoice(inv.id)
      toast.success('Invoice deleted')
      loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const handleVerify = async (inv) => {
    try {
      await verifySupplierInvoice(inv.id)
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

  const allInvoices = groups.flatMap(g => g.invoices)
  const multiEntity = entities.length > 1
  // Suppliers with requires_registration=false (e.g. Axxess) don't use vehicle regs on invoices
  const showVehicleReg = supplier?.requires_registration !== false

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
              { header: 'VAT Applicable',  value: r => r.vat_applicable ? 'Yes' : 'No' },
              { header: 'Statement Month', value: r => `${MONTH_NAMES[r.statement_month]} ${r.statement_year}` },
              { header: 'Due Date',        value: r => formatDate(r.payment_due_date) },
              { header: 'Verified',        value: r => r.is_verified ? 'Yes' : '' },
              { header: 'Paid',            value: r => r.is_paid ? 'Yes' : '' },
              { header: 'Paid Date',       value: r => formatDate(r.paid_date) },
              { header: 'Payment Ref',     key: 'payment_reference' },
              { header: 'Notes',           key: 'notes' },
            ]}
          />
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
      </div>

      {/* ── Shared table columns helper ── */}
      {/* ── Statement groups (always rendered, new row injected at top of first group) ── */}
      {groups.length === 0 ? (
        <div style={styles.group}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)' }}>
                {multiEntity && <th style={styles.th}>Entity</th>}
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Invoice #</th>
                {showVehicleReg && <th style={styles.th}>Vehicle Reg</th>}
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Amount</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>VAT</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>Verified</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>Paid</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {showNew
                ? <NewRow
                    form={newForm} setForm={setNewForm} saving={saving}
                    onSave={saveNew} onCancel={cancelNew}
                    entities={entities} multiEntity={multiEntity}
                    firstInputRef={firstInputRef}
                    onKeyDown={handleKeyDown}
                    showVehicleReg={showVehicleReg}
                  />
                : <tr>
                    <td
                      colSpan={multiEntity ? 10 : 9}
                      style={{ ...styles.td, textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0' }}
                    >
                      No invoices yet — click "Add Invoice" to start
                    </td>
                  </tr>
              }
            </tbody>
          </table>
        </div>
      ) : null}

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
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Invoice #</th>
                      {showVehicleReg && <th style={styles.th}>Vehicle Reg</th>}
                      <th style={styles.th}>Description</th>
                      <th style={styles.th}>Amount</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>VAT</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Verified</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Paid</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupIndex === 0 && showNew && (
                      <NewRow
                        form={newForm} setForm={setNewForm} saving={saving}
                        onSave={saveNew} onCancel={cancelNew}
                        entities={entities} multiEntity={multiEntity}
                        firstInputRef={firstInputRef}
                        onKeyDown={handleKeyDown}
                      />
                    )}
                    {group.invoices.map(inv => {
                      const isEditing = editingId === inv.id
                      const f = editForm

                      return (
                        <tr
                          key={inv.id}
                          onClick={() => !isEditing && startEdit(inv)}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            background: isEditing ? 'var(--accent-subtle)' : 'transparent',
                            opacity: inv.is_paid && !isEditing ? 0.6 : 1,
                            cursor: isEditing ? 'default' : 'pointer',
                            transition: 'background 0.1s',
                          }}
                        >
                          {/* Entity cell */}
                          {multiEntity && (
                            <td style={styles.td}>
                              {isEditing ? (
                                <select
                                  value={f.entity_id}
                                  onChange={e => setEditForm(p => ({ ...p, entity_id: e.target.value }))}
                                  onClick={e => e.stopPropagation()}
                                  style={styles.cellSelect}
                                >
                                  {entities.map(en => <option key={en.id} value={en.id}>{en.code}</option>)}
                                </select>
                              ) : (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {entities.find(e => e.id === inv.entity_id)?.code || '—'}
                                </span>
                              )}
                            </td>
                          )}

                          {/* Date */}
                          <td style={styles.td}>
                            {isEditing ? (
                              <input
                                ref={firstInputRef}
                                type="date" value={f.invoice_date}
                                onChange={e => setEditForm(p => ({ ...p, invoice_date: e.target.value }))}
                                onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                onClick={e => e.stopPropagation()}
                                style={styles.cellInput}
                              />
                            ) : formatDate(inv.invoice_date)}
                          </td>

                          {/* Invoice # */}
                          <td style={{ ...styles.td, fontWeight: isEditing ? 400 : 600 }}>
                            {isEditing ? (
                              <input
                                value={f.invoice_number}
                                onChange={e => setEditForm(p => ({ ...p, invoice_number: e.target.value }))}
                                onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                onClick={e => e.stopPropagation()}
                                style={{ ...styles.cellInput, minWidth: 90 }}
                              />
                            ) : inv.invoice_number}
                          </td>

                          {/* Vehicle Reg */}
                          {showVehicleReg && (
                            <td style={styles.td}>
                              {isEditing ? (
                                <input
                                  value={f.vehicle_reg}
                                  onChange={e => setEditForm(p => ({ ...p, vehicle_reg: e.target.value }))}
                                  onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                  onClick={e => e.stopPropagation()}
                                  style={{ ...styles.cellInput, width: 90 }}
                                  placeholder="KDJ034EC"
                                />
                              ) : (
                                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                  {inv.vehicle_reg || '—'}
                                </span>
                              )}
                            </td>
                          )}

                          {/* Description */}
                          <td style={{ ...styles.td, maxWidth: 200 }}>
                            {isEditing ? (
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

                          {/* Amount */}
                          <td style={{ ...styles.td, fontWeight: 600 }}>
                            {isEditing ? (
                              <input
                                type="number" step="0.01" min="0"
                                value={f.amount}
                                onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))}
                                onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                onClick={e => e.stopPropagation()}
                                style={{ ...styles.cellInput, width: 90, textAlign: 'right' }}
                              />
                            ) : (
                              <>
                                {formatCurrency(inv.amount)}
                                {!inv.vat_applicable && <span style={styles.noVatTag}>NON VAT</span>}
                              </>
                            )}
                          </td>

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
                                ? <span style={{ color: '#16a34a', fontSize: 13 }}>✓</span>
                                : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                            )}
                          </td>

                          {/* Verified */}
                          <td style={styles.td}>
                            <VerifyBadge item={inv} onVerify={handleVerify} />
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
                              <button
                                className="btn-icon btn-ghost"
                                onClick={() => handleDelete(inv)}
                                title="Delete"
                              >
                                <Trash2 size={13} color="var(--danger)" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-surface)' }}>
                      <td colSpan={multiEntity ? 5 : 4} style={{ ...styles.td, fontWeight: 700, textAlign: 'right' }}>
                        Statement Total:
                      </td>
                      <td style={{ ...styles.td, fontWeight: 700 }}>{formatCurrency(group.subtotal)}</td>
                      <td colSpan={4} style={styles.td} />
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


function NewRow({ form, setForm, saving, onSave, onCancel, entities, multiEntity, firstInputRef, onKeyDown, showVehicleReg }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <tr style={{ background: 'var(--accent-subtle)', borderBottom: '1px solid var(--border-accent)' }}>
      {multiEntity && (
        <td style={styles.td}>
          <select value={form.entity_id} onChange={e => set('entity_id', e.target.value)} style={styles.cellSelect}>
            {entities.map(en => <option key={en.id} value={en.id}>{en.code}</option>)}
          </select>
        </td>
      )}
      <td style={styles.td}>
        <input ref={firstInputRef} type="date" value={form.invoice_date}
          onChange={e => set('invoice_date', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)} style={styles.cellInput} />
      </td>
      <td style={styles.td}>
        <input value={form.invoice_number} placeholder="e.g. TM1794"
          onChange={e => set('invoice_number', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)}
          style={{ ...styles.cellInput, minWidth: 90 }} />
      </td>
      {showVehicleReg && (
        <td style={styles.td}>
          <input value={form.vehicle_reg} placeholder="KDJ034EC"
            onChange={e => set('vehicle_reg', e.target.value)}
            onKeyDown={e => onKeyDown(e, onSave, onCancel)}
            style={{ ...styles.cellInput, width: 90 }} />
        </td>
      )}
      <td style={styles.td}>
        <input value={form.description} placeholder="Description"
          onChange={e => set('description', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)}
          style={{ ...styles.cellInput, minWidth: 140 }} />
      </td>
      <td style={styles.td}>
        <input type="number" step="0.01" min="0" placeholder="0.00" value={form.amount}
          onChange={e => set('amount', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)}
          style={{ ...styles.cellInput, width: 90, textAlign: 'right' }} />
      </td>
      <td style={{ ...styles.td, textAlign: 'center' }}>
        <input type="checkbox" checked={form.vat_applicable}
          onChange={e => set('vat_applicable', e.target.checked)} style={{ cursor: 'pointer' }} />
      </td>
      <td style={styles.td} />{/* Verified — n/a for new */}
      <td style={styles.td} />{/* Paid — n/a for new */}
      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
        <button onClick={onSave} disabled={saving} className="btn btn-icon btn-primary" style={{ marginRight: 4 }} title="Save (Enter)"><Save size={14} /></button>
        <button onClick={onCancel} className="btn btn-icon btn-ghost" title="Cancel (Esc)"><X size={14} /></button>
      </td>
    </tr>
  )
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
