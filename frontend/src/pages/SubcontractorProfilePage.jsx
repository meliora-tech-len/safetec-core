import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  getSubcontractor, getSuppliers, getFleetTrucks,
  createSubcontractorInvoice, createSupplierInvoice,
  updateSupplierInvoice, deleteSupplierInvoice, archiveSupplierInvoice,
  getSubcontractorInvoices, getSubcontractorCosting,
} from '../services/api'
import { formatCurrency, formatDate, errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Plus, Trash2, ChevronLeft, ChevronRight,
  Building2, X, Save, CheckCircle, ChevronDown, ChevronUp,
} from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import DeleteModal from '../components/DeleteModal'

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const now = new Date()
const todayStr = now.toISOString().slice(0, 10)

function fmtC(v) { return v != null ? formatCurrency(v) : '—' }
function fmtT(v) { return v != null ? Number(v).toFixed(3) : '—' }

const tblStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const thStyle  = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }
const tdStyle  = { padding: '8px 12px', borderBottom: '1px solid var(--border)' }

// ── Blank forms ───────────────────────────────────────────────────────────────

const blankInvoiceForm = () => ({
  invoice_date:   todayStr,
  invoice_number: '',
  amount:         '',
  vat_applicable: true,
  vehicle_reg:    '',
  description:    '',
})

const blankExpenseForm = (truckReg = '') => ({
  invoice_date:   todayStr,
  invoice_number: '',
  supplier_id:    '',
  amount:         '',
  vat_applicable: true,
  vehicle_reg:    truckReg,
  description:    '',
})

// ── Component ─────────────────────────────────────────────────────────────────

export default function SubcontractorProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { entities } = useAuth()

  const [subcontractor, setSubcontractor] = useState(null)
  const [activeTab, setActiveTab]         = useState('invoices')
  const [month, setMonth]                 = useState(now.getMonth() + 1)
  const [year, setYear]                   = useState(now.getFullYear())

  // Invoice tab state
  const [groups, setGroups]               = useState([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [showNew, setShowNew]             = useState(false)
  const [newForm, setNewForm]             = useState(blankInvoiceForm())
  const [editingId, setEditingId]         = useState(null)
  const [editForm, setEditForm]           = useState({})
  const [saving, setSaving]               = useState(false)
  const [collapsed, setCollapsed]         = useState({})
  const [deleteTarget, setDeleteTarget]   = useState(null)
  const firstInputRef = useRef(null)

  // Costing tab state
  const [costing, setCosting]             = useState(null)
  const [costingLoading, setCostingLoading] = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [expenseForm, setExpenseForm]     = useState(blankExpenseForm())
  const [expenseSaving, setExpenseSaving] = useState(false)
  const [expenseDeleteTarget, setExpenseDeleteTarget] = useState(null)

  const [suppliers, setSuppliers] = useState([])
  const [trucks, setTrucks]       = useState([])

  useEffect(() => {
    getSubcontractor(id).then(r => setSubcontractor(r.data)).catch(() => {})
  }, [id])

  useEffect(() => {
    if (!subcontractor) return
    getSuppliers({ entity_id: subcontractor.entity_id }).then(r => setSuppliers(r.data))
    getFleetTrucks({ subcontractor_id: id }).then(r => setTrucks(r.data))
  }, [id, subcontractor?.entity_id])

  // Focus first input when inline new row or edit row appears
  useEffect(() => {
    if ((showNew || editingId) && firstInputRef.current)
      firstInputRef.current.focus()
  }, [showNew, editingId])

  const loadInvoices = useCallback(() => {
    setInvoicesLoading(true)
    getSubcontractorInvoices(id)
      .then(r => setGroups(r.data))
      .catch(() => setGroups([]))
      .finally(() => setInvoicesLoading(false))
  }, [id])

  const loadCosting = useCallback(() => {
    setCostingLoading(true)
    getSubcontractorCosting(id, { month, year })
      .then(r => setCosting(r.data))
      .catch(() => setCosting(null))
      .finally(() => setCostingLoading(false))
  }, [id, month, year])

  useEffect(() => { if (activeTab === 'invoices') loadInvoices() }, [activeTab, loadInvoices])
  useEffect(() => { if (activeTab === 'costing')  loadCosting()  }, [activeTab, loadCosting])

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }

  const toggleCollapse = (key) => setCollapsed(s => ({ ...s, [key]: !s[key] }))

  // ── Invoice tab handlers ─────────────────────────────────────────────────────

  const handleAddClick = () => {
    setEditingId(null)
    setNewForm(blankInvoiceForm())
    setShowNew(true)
  }

  const cancelNew = () => { setShowNew(false); setNewForm(blankInvoiceForm()) }

  const startEdit = (inv) => {
    if (editingId !== null) return
    setShowNew(false)
    setEditingId(inv.id)
    setEditForm({
      invoice_date:   inv.invoice_date?.slice(0, 10) || todayStr,
      invoice_number: inv.invoice_number || '',
      amount:         String(inv.amount || ''),
      vat_applicable: inv.vat_applicable !== false,
      vehicle_reg:    inv.vehicle_reg || '',
      description:    inv.description || '',
    })
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({}) }

  const handleKeyDown = (e, saveFn, cancelFn) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveFn() }
    if (e.key === 'Escape') cancelFn()
  }

  const validateInvoiceForm = (form) => {
    if (!form.invoice_date)          return 'Invoice date is required'
    if (!form.invoice_number.trim()) return 'Invoice number is required'
    if (!form.amount || isNaN(form.amount) || parseFloat(form.amount) <= 0)
      return 'Valid amount is required'
    return null
  }

  const saveNew = async () => {
    const err = validateInvoiceForm(newForm)
    if (err) return toast.error(err)
    setSaving(true)
    try {
      await createSubcontractorInvoice(id, {
        invoice_date:   new Date(newForm.invoice_date + 'T12:00:00').toISOString(),
        invoice_number: newForm.invoice_number.trim(),
        amount:         parseFloat(newForm.amount),
        vat_applicable: newForm.vat_applicable,
        vehicle_reg:    newForm.vehicle_reg || null,
        description:    newForm.description.trim() || null,
      })
      toast.success('Invoice added')
      setShowNew(false)
      setNewForm(blankInvoiceForm())
      await loadInvoices()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    const err = validateInvoiceForm(editForm)
    if (err) return toast.error(err)
    setSaving(true)
    try {
      await updateSupplierInvoice(editingId, {
        invoice_date:   new Date(editForm.invoice_date + 'T12:00:00').toISOString(),
        invoice_number: editForm.invoice_number.trim(),
        amount:         parseFloat(editForm.amount),
        vat_applicable: editForm.vat_applicable,
        vehicle_reg:    editForm.vehicle_reg.trim() || null,
        description:    editForm.description.trim() || null,
      })
      toast.success('Saved')
      setEditingId(null)
      await loadInvoices()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const togglePaid = async (inv, e) => {
    e.stopPropagation()
    try {
      await updateSupplierInvoice(inv.id, {
        is_paid:   !inv.is_paid,
        paid_date: inv.is_paid ? null : new Date().toISOString(),
      })
      loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  // ── Expense modal handlers (costing tab) ─────────────────────────────────────

  const openExpenseModal = (truckReg = '') => {
    setExpenseForm(blankExpenseForm(truckReg))
    setShowExpenseModal(true)
  }

  const setEF = (k, v) => setExpenseForm(f => ({ ...f, [k]: v }))

  const saveExpense = async (e) => {
    e.preventDefault()
    if (!expenseForm.supplier_id) { toast.error('Select a supplier'); return }
    if (!expenseForm.invoice_number.trim()) { toast.error('Invoice number is required'); return }
    if (!expenseForm.amount || parseFloat(expenseForm.amount) <= 0) { toast.error('Enter a valid amount'); return }
    setExpenseSaving(true)
    try {
      await createSupplierInvoice({
        entity_id:      subcontractor.entity_id,
        supplier_id:    parseInt(expenseForm.supplier_id),
        invoice_date:   new Date(expenseForm.invoice_date + 'T12:00:00').toISOString(),
        invoice_number: expenseForm.invoice_number.trim(),
        amount:         parseFloat(expenseForm.amount),
        vat_applicable: expenseForm.vat_applicable,
        vehicle_reg:    expenseForm.vehicle_reg || null,
        description:    expenseForm.description.trim() || null,
      })
      toast.success('Expense added')
      setShowExpenseModal(false)
      loadCosting()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setExpenseSaving(false)
    }
  }

  if (!subcontractor) {
    return <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
  }

  const allInvoices = groups.flatMap(g => g.invoices)

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>

      {/* ── Header ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-icon btn-ghost" onClick={() => navigate('/subcontractors')} style={{ marginRight: 4 }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Building2 size={22} style={{ color: 'var(--accent)' }} />
              {subcontractor.name}
            </h1>
            {subcontractor.trading_name && (
              <p className="page-subtitle">{subcontractor.trading_name}</p>
            )}
          </div>
        </div>
        {activeTab === 'invoices' && (
          <button className="btn-primary" onClick={handleAddClick} disabled={showNew}>
            <Plus size={15} /> Add Invoice
          </button>
        )}
      </div>

      {/* ── Operations card (Re Ama / subcontractor entities) ── */}
      {subcontractor.linked_entity_id && entities?.find(e => e.id === subcontractor.entity_id)?.code === 'OBHI' && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 20px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Operations
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-ghost btn-sm"
              onClick={() => navigate(`/fleet?entity_id=${subcontractor.linked_entity_id}`)}>
              Fleet
            </button>
            <button className="btn-ghost btn-sm"
              onClick={() => navigate(`/drivers?entity_id=${subcontractor.linked_entity_id}`)}>
              Drivers
            </button>
            <button className="btn-ghost btn-sm"
              onClick={() => navigate(`/truck-loads?entity_id=${subcontractor.linked_entity_id}`)}>
              Truck Loads
            </button>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
        {[['invoices', 'Invoices'], ['costing', 'Costing']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 14,
              color: activeTab === key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -2, transition: 'color 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── INVOICES TAB ── */}
      {activeTab === 'invoices' && (
        invoicesLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : (
          <>
            {/* Empty state (no groups yet) */}
            {groups.length === 0 && (
              <div style={styles.group}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <InvoiceTableHead />
                  <tbody>
                    {showNew
                      ? <NewInvoiceRow
                          form={newForm} setForm={setNewForm} saving={saving}
                          onSave={saveNew} onCancel={cancelNew}
                          firstInputRef={firstInputRef} onKeyDown={handleKeyDown}
                          trucks={trucks}
                        />
                      : <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0' }}>
                          No invoices yet — click "Add Invoice" to start
                        </td></tr>
                    }
                  </tbody>
                </table>
              </div>
            )}

            {groups.map((group, groupIndex) => {
              const key     = `${group.statement_year}-${group.statement_month}`
              const isOpen  = !collapsed[key]
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
                        {MONTHS[group.statement_month]} {group.statement_year}
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
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <InvoiceTableHead />
                        <tbody>
                          {groupIndex === 0 && showNew && (
                            <NewInvoiceRow
                              form={newForm} setForm={setNewForm} saving={saving}
                              onSave={saveNew} onCancel={cancelNew}
                              firstInputRef={firstInputRef} onKeyDown={handleKeyDown}
                              trucks={trucks}
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

                                {/* Truck Reg */}
                                <td style={styles.td}>
                                  {isEditing ? (
                                    <div onClick={e => e.stopPropagation()}>
                                      <SearchableSelect
                                        value={f.vehicle_reg}
                                        onChange={v => setEditForm(p => ({ ...p, vehicle_reg: v }))}
                                        options={[{ id: '', registration: '', fleet_number: null }, ...trucks]}
                                        getValue={t => t.registration}
                                        getLabel={t => t.registration === '' ? '— Clear —' : t.fleet_number ? `#${t.fleet_number} · ${t.registration}` : t.registration}
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
                                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
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

                                {/* Paid */}
                                <td style={{ ...styles.td, textAlign: 'center' }}>
                                  <button
                                    onClick={e => togglePaid(inv, e)}
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
                                    <button className="btn-icon btn-ghost" onClick={() => setDeleteTarget(inv)} title="Delete">
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
                            <td colSpan={4} style={{ ...styles.td, fontWeight: 700, textAlign: 'right' }}>
                              Statement Total:
                            </td>
                            <td style={{ ...styles.td, fontWeight: 700 }}>{formatCurrency(group.subtotal)}</td>
                            <td colSpan={3} style={styles.td} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )
      )}

      {/* ── COSTING TAB ── */}
      {activeTab === 'costing' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <button className="btn-ghost btn-sm" onClick={prevMonth}><ChevronLeft size={15} /></button>
            <span style={{ fontWeight: 700, fontSize: 15, minWidth: 130, textAlign: 'center' }}>
              {MONTHS[month]} {year}
            </span>
            <button className="btn-ghost btn-sm" onClick={nextMonth}><ChevronRight size={15} /></button>
          </div>

          {costingLoading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : !costing || costing.trucks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
              No loads found for {MONTHS[month]} {year}
            </div>
          ) : (
            <>
              {costing.trucks.map(td => (
                <TruckCostingCard
                  key={td.truck.id}
                  truckData={td}
                  onAddExpense={() => openExpenseModal(td.truck.registration)}
                  onDeleteInvoice={setExpenseDeleteTarget}
                />
              ))}
              <SummaryCard summary={costing.summary} />
            </>
          )}
        </div>
      )}

      {/* ── Invoice DeleteModal ── */}
      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Invoice"
        description={deleteTarget ? `${deleteTarget.invoice_number}${deleteTarget.amount ? ` — ${fmtC(deleteTarget.amount)}` : ''}` : ''}
        onArchive={async () => {
          try {
            await archiveSupplierInvoice(deleteTarget.id)
            toast.success('Invoice archived')
            setDeleteTarget(null)
            loadInvoices()
          } catch (e) { toast.error(errorMessage(e)) }
        }}
        onDelete={async () => {
          try {
            await deleteSupplierInvoice(deleteTarget.id)
            toast.success('Invoice deleted')
            setDeleteTarget(null)
            loadInvoices()
          } catch (e) { toast.error(errorMessage(e)) }
        }}
      />

      {/* ── Expense Modal (costing tab) ── */}
      {showExpenseModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowExpenseModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2>Add Expense</h2>
              <button className="btn-icon btn-ghost" onClick={() => setShowExpenseModal(false)}><X size={16} /></button>
            </div>
            <form onSubmit={saveExpense}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label>Date *</label>
                    <input type="date" value={expenseForm.invoice_date} onChange={e => setEF('invoice_date', e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label>Invoice # *</label>
                    <input value={expenseForm.invoice_number} onChange={e => setEF('invoice_number', e.target.value)} required placeholder="e.g. INV-001" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Supplier *</label>
                  <SearchableSelect
                    value={String(expenseForm.supplier_id)}
                    onChange={v => setEF('supplier_id', v)}
                    options={suppliers}
                    getValue={o => String(o.id)}
                    getLabel={o => o.name}
                    placeholder="Search suppliers…"
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Amount *</label>
                    <input type="number" step="0.01" min="0" value={expenseForm.amount} onChange={e => setEF('amount', e.target.value)} required placeholder="0.00" />
                  </div>
                  <div className="form-group">
                    <label>Truck Reg</label>
                    <select value={expenseForm.vehicle_reg} onChange={e => setEF('vehicle_reg', e.target.value)}>
                      <option value="">— None —</option>
                      {trucks.map(t => (
                        <option key={t.id} value={t.registration}>
                          {t.registration}{t.fleet_number ? ` (${t.fleet_number})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input value={expenseForm.description} onChange={e => setEF('description', e.target.value)} placeholder="Optional" />
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={expenseForm.vat_applicable}
                      onChange={e => setEF('vat_applicable', e.target.checked)}
                    />
                    VAT Applicable (amount is VAT-exclusive)
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-ghost" onClick={() => setShowExpenseModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={expenseSaving}>
                  {expenseSaving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Expense DeleteModal (costing tab) ── */}
      <DeleteModal
        isOpen={!!expenseDeleteTarget}
        onClose={() => setExpenseDeleteTarget(null)}
        title="Delete Expense"
        description={expenseDeleteTarget ? `${expenseDeleteTarget.invoice_number}${expenseDeleteTarget.amount ? ` — ${fmtC(expenseDeleteTarget.amount)}` : ''}` : ''}
        onArchive={async () => {
          try {
            await archiveSupplierInvoice(expenseDeleteTarget.id)
            toast.success('Expense archived')
            setExpenseDeleteTarget(null)
            loadCosting()
          } catch (e) { toast.error(errorMessage(e)) }
        }}
        onDelete={async () => {
          try {
            await deleteSupplierInvoice(expenseDeleteTarget.id)
            toast.success('Expense deleted')
            setExpenseDeleteTarget(null)
            loadCosting()
          } catch (e) { toast.error(errorMessage(e)) }
        }}
      />
    </div>
  )
}

// ── Invoice table header ───────────────────────────────────────────────────────

function InvoiceTableHead() {
  return (
    <thead>
      <tr style={{ background: 'var(--bg-surface)' }}>
        <th style={styles.th}>Date</th>
        <th style={styles.th}>Invoice #</th>
        <th style={styles.th}>Truck Reg</th>
        <th style={styles.th}>Description</th>
        <th style={styles.th}>Amount</th>
        <th style={{ ...styles.th, textAlign: 'center' }}>VAT</th>
        <th style={{ ...styles.th, textAlign: 'center' }}>Paid</th>
        <th style={styles.th}></th>
      </tr>
    </thead>
  )
}

// ── Inline new invoice row ─────────────────────────────────────────────────────

function NewInvoiceRow({ form, setForm, saving, onSave, onCancel, firstInputRef, onKeyDown, trucks }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <tr style={{ background: 'var(--accent-subtle)', borderBottom: '1px solid var(--border-accent)' }}>
      <td style={styles.td}>
        <input ref={firstInputRef} type="date" value={form.invoice_date}
          onChange={e => set('invoice_date', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)} style={styles.cellInput} />
      </td>
      <td style={styles.td}>
        <input value={form.invoice_number} placeholder="e.g. INV-001"
          onChange={e => set('invoice_number', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)}
          style={{ ...styles.cellInput, minWidth: 90 }} />
      </td>
      <td style={styles.td}>
        <SearchableSelect
          value={form.vehicle_reg}
          onChange={v => set('vehicle_reg', v)}
          options={[{ id: '', registration: '', fleet_number: null }, ...trucks]}
          getValue={t => t.registration}
          getLabel={t => t.registration === '' ? '— None —' : t.fleet_number ? `#${t.fleet_number} · ${t.registration}` : t.registration}
          placeholder="Vehicle reg…"
          style={{ width: 150 }}
        />
      </td>
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
      <td style={styles.td} />{/* Paid — n/a for new */}
      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
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

// ── Truck Costing Card ─────────────────────────────────────────────────────────

function TruckCostingCard({ truckData, onAddExpense, onDeleteInvoice }) {
  const {
    truck, loads,
    income_excl_vat, income_incl_vat,
    admin_fee, supplier_invoices,
    total_expenses_excl_vat, total_expenses_incl_vat,
    net_payable,
  } = truckData

  const loadCount   = loads.length
  const totalTonnes = loads.reduce((s, l) => s + (l.tonnes ? parseFloat(l.tonnes) : 0), 0)
  const netNum      = parseFloat(net_payable)

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 10, marginBottom: 24, overflow: 'hidden',
    }}>
      {/* Truck header */}
      <div style={{
        padding: '12px 20px', background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{truck.registration}</span>
        {truck.fleet_number && (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{truck.fleet_number}</span>
        )}
        <span style={{ color: 'var(--border)', fontSize: 12 }}>|</span>
        <span style={{ fontSize: 13 }}>{loadCount} load{loadCount !== 1 ? 's' : ''}</span>
        <span style={{ color: 'var(--border)', fontSize: 12 }}>|</span>
        <span style={{ fontSize: 13 }}>{totalTonnes.toFixed(3)} t</span>
      </div>

      <div style={{ padding: '16px 20px' }}>

        {/* Income table */}
        <SectionLabel>Income</SectionLabel>
        <table style={tblStyle}>
          <thead>
            <tr style={{ background: 'var(--bg-surface)' }}>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Slip #</th>
              <th style={thStyle}>Mine</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Tonnes</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Sub Rate/t</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Sub Excl VAT</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Sub Incl VAT</th>
            </tr>
          </thead>
          <tbody>
            {loads.map(l => (
              <tr key={l.id}>
                <td style={tdStyle}>{formatDate(l.load_date)}</td>
                <td style={tdStyle}>{l.slip_number || '—'}</td>
                <td style={tdStyle}>{l.mine_name || '—'}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtT(l.tonnes)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(l.subcontractor_rate)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(l.subcontractor_amount_excl_vat)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>
                  {fmtC(l.subcontractor_amount_incl_vat)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
              <td style={tdStyle} colSpan={5}>Total</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(income_excl_vat)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)' }}>{fmtC(income_incl_vat)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Expenses table */}
        <SectionLabel style={{ marginTop: 20 }}>Expenses</SectionLabel>
        <table style={tblStyle}>
          <thead>
            <tr style={{ background: 'var(--bg-surface)' }}>
              <th style={thStyle}>Description</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Excl VAT</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Incl VAT</th>
              <th style={{ ...thStyle, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdStyle, color: 'var(--accent)', fontWeight: 600 }}>Admin Fee</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>{fmtC(admin_fee)}</td>
              <td style={tdStyle}></td>
            </tr>
            {supplier_invoices.map(inv => (
              <tr key={inv.id}>
                <td style={tdStyle}>{inv.supplier_name || `Supplier #${inv.supplier_id}`}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {inv.vat_applicable ? fmtC(inv.amount) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {!inv.vat_applicable ? fmtC(inv.amount) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={tdStyle}>
                  <button className="btn-icon btn-ghost" onClick={() => onDeleteInvoice(inv)}>
                    <Trash2 size={12} color="var(--danger)" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
              <td style={tdStyle}>Total Expenses</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(total_expenses_excl_vat)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(total_expenses_incl_vat)}</td>
              <td style={tdStyle}></td>
            </tr>
          </tfoot>
        </table>
        <button
          className="btn-ghost"
          style={{ fontSize: 12, marginTop: 8, padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={onAddExpense}
        >
          <Plus size={13} /> Add Expense
        </button>

        {/* Net Payable */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16,
          marginTop: 16, padding: '12px 16px',
          background: 'var(--bg-surface)', borderRadius: 8,
          border: '1px solid var(--border)',
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Net Payable</span>
          <span style={{
            fontWeight: 700, fontSize: 18,
            color: netNum >= 0 ? 'var(--accent)' : 'var(--danger)',
          }}>
            {fmtC(net_payable)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Monthly Summary Card ───────────────────────────────────────────────────────

function SummaryCard({ summary }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--accent)',
      borderRadius: 10, padding: '16px 20px', marginTop: 8, marginBottom: 24,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 12 }}>
        Monthly Summary — All Trucks
      </div>
      <table style={tblStyle}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={thStyle}></th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Income Excl VAT</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Income Incl VAT</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Exp Excl VAT</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Exp Incl VAT</th>
            <th style={{ ...thStyle, textAlign: 'right', color: 'var(--accent)' }}>Net Payable</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ fontWeight: 700 }}>
            <td style={tdStyle}>TOTAL</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(summary.income_excl_vat)}</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(summary.income_incl_vat)}</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(summary.total_expenses_excl_vat)}</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(summary.total_expenses_incl_vat)}</td>
            <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)', fontSize: 15 }}>{fmtC(summary.net_payable)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 8, ...style,
    }}>
      {children}
    </div>
  )
}

const styles = {
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
  noVatTag: {
    marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 10,
    fontWeight: 700, background: 'rgba(156,163,175,0.2)', color: 'var(--text-muted)',
  },
}
