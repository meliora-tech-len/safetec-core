import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useSessionState } from '../hooks/useSessionState'
import {
  getSubcontractor, getSuppliers, getFleetTrucks,
  createSubcontractorInvoice, createSupplierInvoice,
  updateSupplierInvoice, deleteSupplierInvoice, archiveSupplierInvoice,
  getSubcontractorInvoices, getSubcontractorCosting,
  downloadSubcontractorCostingPdf, downloadSubcontractorCostingExcel,
  getVerifications, verifyValue, finalizeValue,
} from '../services/api'
import { formatCurrency, formatDate, errorMessage } from '../utils/helpers'
import VerifiableAmount from '../components/VerifiableAmount'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Plus, Trash2, ChevronLeft, ChevronRight,
  Building2, X, Save, CheckCircle, ChevronDown, ChevronUp, FileSpreadsheet,
  FileDown, Sheet,
} from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import DeleteModal from '../components/DeleteModal'
import DateInput from '../components/DateInput'

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
  litres:         '',
  rate_per_litre: '',
})

// ── Component ─────────────────────────────────────────────────────────────────

export default function SubcontractorProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { entities, user, isAdmin } = useAuth()

  const [subcontractor, setSubcontractor] = useState(null)
  const [activeTab, setActiveTab]         = useState('costing')
  const [month, setMonth]                 = useSessionState('period:costing:month', now.getMonth() + 1)
  const [year, setYear]                   = useSessionState('period:costing:year', now.getFullYear())

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
  const [sortCol, setSortCol]             = useState('invoice_date')
  const [sortDir, setSortDir]             = useState('asc')
  const firstInputRef = useRef(null)

  // Costing tab state
  const [costing, setCosting]             = useState(null)
  const [costingLoading, setCostingLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(null)  // 'pdf' | 'excel' | null
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

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortArrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const sortInvoices = (invoices) => [...invoices].sort((a, b) => {
    let av, bv
    switch (sortCol) {
      case 'invoice_date':   av = a.invoice_date || '';   bv = b.invoice_date || '';   break
      case 'invoice_number': av = (a.invoice_number || '').toLowerCase(); bv = (b.invoice_number || '').toLowerCase(); break
      case 'vehicle_reg':    av = (a.vehicle_reg || '').toUpperCase(); bv = (b.vehicle_reg || '').toUpperCase(); break
      case 'amount':         av = parseFloat(a.amount) || 0; bv = parseFloat(b.amount) || 0; break
      default:               av = ''; bv = ''
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  // Guard against out-of-order responses: when the month changes while a
  // request is still in flight, the slower stale response must never
  // overwrite the data for the month currently on screen.
  const costingReqId = useRef(0)
  const loadCosting = useCallback(() => {
    const reqId = ++costingReqId.current
    setCostingLoading(true)
    getSubcontractorCosting(id, { month, year })
      .then(r => { if (reqId === costingReqId.current) setCosting(r.data) })
      .catch(() => { if (reqId === costingReqId.current) setCosting(null) })
      .finally(() => { if (reqId === costingReqId.current) setCostingLoading(false) })
  }, [id, month, year])

  // ── Per-value verification overlay (costing) ────────────────────────────────
  const [verif, setVerif] = useState({})
  const costingPrefix = `costing:${id}:${year}-${String(month).padStart(2, '0')}`
  const verifReqId = useRef(0)
  const loadVerif = useCallback(() => {
    const reqId = ++verifReqId.current
    getVerifications(costingPrefix)
      .then(r => {
        if (reqId !== verifReqId.current) return
        const map = {}
        for (const v of r.data) map[v.target] = v
        setVerif(map)
      })
      .catch(() => { if (reqId === verifReqId.current) setVerif({}) })
  }, [costingPrefix])

  const handleVerifyValue = async (target, intent) => {
    try { const { data } = await verifyValue(target, subcontractor?.entity_id, intent); setVerif(prev => ({ ...prev, [data.target]: data })) }
    catch (e) { toast.error(errorMessage(e, 'Verification failed')) }
  }
  const handleFinalizeValue = async (target, intent) => {
    try { const { data } = await finalizeValue(target, subcontractor?.entity_id, intent); setVerif(prev => ({ ...prev, [data.target]: data })) }
    catch (e) { toast.error(errorMessage(e, 'Lock failed')) }
  }

  useEffect(() => { if (activeTab === 'invoices') loadInvoices() }, [activeTab, loadInvoices])
  useEffect(() => { if (activeTab === 'costing')  { loadCosting(); loadVerif() } }, [activeTab, loadCosting, loadVerif])

  const handleExport = async (type) => {
    setExportLoading(type)
    try {
      const fn = type === 'pdf' ? downloadSubcontractorCostingPdf : downloadSubcontractorCostingExcel
      const r  = await fn(id, { month, year })
      const ext  = type === 'pdf' ? 'pdf' : 'xlsx'
      const mime = type === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const url  = URL.createObjectURL(new Blob([r.data], { type: mime }))
      const a    = document.createElement('a')
      a.href     = url
      a.download = `costing-${subcontractor?.name?.replace(/\s+/g, '-').toLowerCase() || id}-${year}-${String(month).padStart(2, '0')}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(`Failed to export ${type.toUpperCase()}`)
    } finally {
      setExportLoading(null)
    }
  }

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

  const isDieselExpenseSupplier = suppliers.find(
    s => String(s.id) === String(expenseForm.supplier_id)
  )?.is_diesel_supplier || false

  const saveExpense = async (e) => {
    e.preventDefault()
    if (!expenseForm.supplier_id) { toast.error('Select a supplier'); return }
    if (!expenseForm.invoice_number.trim()) { toast.error('Invoice number is required'); return }

    const litresVal = parseFloat(expenseForm.litres) || 0
    const rateVal   = parseFloat(expenseForm.rate_per_litre) || 0
    let amount = parseFloat(expenseForm.amount) || 0

    if (isDieselExpenseSupplier) {
      if (litresVal <= 0) { toast.error('Enter litres for diesel invoice'); return }
      if (rateVal <= 0)   { toast.error('Enter rate per litre for diesel invoice'); return }
      if (amount <= 0) amount = +(litresVal * rateVal).toFixed(2)
    } else {
      if (amount <= 0) { toast.error('Enter a valid amount'); return }
    }

    setExpenseSaving(true)
    try {
      await createSupplierInvoice({
        entity_id:      subcontractor.entity_id,
        supplier_id:    parseInt(expenseForm.supplier_id),
        invoice_date:   new Date(expenseForm.invoice_date + 'T12:00:00').toISOString(),
        invoice_number: expenseForm.invoice_number.trim(),
        amount,
        vat_applicable: expenseForm.vat_applicable,
        vehicle_reg:    expenseForm.vehicle_reg || null,
        description:    expenseForm.description.trim() || null,
        ...(isDieselExpenseSupplier && litresVal > 0 && { litres: litresVal }),
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
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>

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
              onClick={() => navigate(`/truck-loads?entity_id=${subcontractor.linked_entity_id}`)}>
              Truck Loads
            </button>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
        {[/* ['invoices', 'Invoices'], */ ['costing', 'Costing']].map(([key, label]) => (
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
                  <InvoiceTableHead onSort={handleSort} sortArrow={sortArrow} />
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
                        <InvoiceTableHead onSort={handleSort} sortArrow={sortArrow} />
                        <tbody>
                          {groupIndex === 0 && showNew && (
                            <NewInvoiceRow
                              form={newForm} setForm={setNewForm} saving={saving}
                              onSave={saveNew} onCancel={cancelNew}
                              firstInputRef={firstInputRef} onKeyDown={handleKeyDown}
                              trucks={trucks}
                            />
                          )}
                          {sortInvoices(group.invoices).map(inv => {
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
                                    <DateInput
                                      ref={firstInputRef} value={f.invoice_date}
                                      onChange={e => setEditForm(p => ({ ...p, invoice_date: e.target.value }))}
                                      onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                      onClick={e => e.stopPropagation()}
                                      inputStyle={styles.cellInput}
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
                                      ? <span style={{ color: '#16a34a', fontSize: 15, fontWeight: 700 }}>✓</span>
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
            {costing && costing.trucks.length > 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => handleExport('excel')}
                  disabled={!!exportLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
                  title="Export Excel"
                >
                  <Sheet size={14} />
                  {exportLoading === 'excel' ? 'Exporting…' : 'Excel'}
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => handleExport('pdf')}
                  disabled={!!exportLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
                  title="Export PDF"
                >
                  <FileDown size={14} />
                  {exportLoading === 'pdf' ? 'Exporting…' : 'PDF'}
                </button>
              </div>
            )}
          </div>

          {costingLoading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : !costing || costing.trucks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
              No trucks linked to this subcontractor
            </div>
          ) : (
            <>
              {costing.trucks.map(td => (
                <TruckCostingCard
                  key={td.truck.id}
                  truckData={td}
                  templateSuppliers={costing.diesel_suppliers || []}
                  onAddExpense={() => openExpenseModal(td.truck.registration)}
                  onDeleteInvoice={setExpenseDeleteTarget}
                  isVatRegistered={costing.is_vat_registered !== false}
                  verifPrefix={costingPrefix}
                  verif={verif}
                  onVerify={handleVerifyValue}
                  onFinalize={handleFinalizeValue}
                  currentUserId={user?.id}
                  isAdmin={isAdmin}
                />
              ))}
              <SummaryCard summary={costing.summary} trucks={costing.trucks} isVatRegistered={costing.is_vat_registered !== false}
                verifPrefix={costingPrefix} verif={verif}
                onVerify={handleVerifyValue} onFinalize={handleFinalizeValue}
                currentUserId={user?.id} isAdmin={isAdmin} />
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
                    <DateInput className="form-input" value={expenseForm.invoice_date} onChange={e => setEF('invoice_date', e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label>Invoice # *</label>
                    <input value={expenseForm.invoice_number} onChange={e => setEF('invoice_number', e.target.value)} required placeholder="e.g. INV-001" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Supplier *</label>
                  <select value={expenseForm.supplier_id || ''} onChange={e => setEF('supplier_id', e.target.value)} required>
                    <option value="">— Select supplier —</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Amount {isDieselExpenseSupplier ? '(auto-calc)' : '*'}</label>
                    <input type="number" step="0.01" min="0" value={expenseForm.amount} onChange={e => setEF('amount', e.target.value)} placeholder="0.00" />
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
                {isDieselExpenseSupplier && (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Litres *</label>
                      <input type="number" step="0.01" min="0" value={expenseForm.litres} onChange={e => setEF('litres', e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="form-group">
                      <label>Rate/L *</label>
                      <input type="number" step="0.0001" min="0" value={expenseForm.rate_per_litre} onChange={e => setEF('rate_per_litre', e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                )}
                <div className="form-group">
                  <label>Description</label>
                  <input value={expenseForm.description} onChange={e => setEF('description', e.target.value)} placeholder="Optional" />
                </div>
                <div className="form-group">
                  <label>VAT</label>
                  <div style={{ display: 'flex', gap: 0, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--border)', width: 'fit-content' }}>
                    <button
                      type="button"
                      onClick={() => setEF('vat_applicable', false)}
                      style={{ padding: '7px 18px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: !expenseForm.vat_applicable ? 'var(--accent)' : 'var(--bg-surface)', color: !expenseForm.vat_applicable ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s' }}
                    >
                      Excl VAT
                    </button>
                    <button
                      type="button"
                      onClick={() => setEF('vat_applicable', true)}
                      style={{ padding: '7px 18px', fontSize: 13, fontWeight: 600, border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', background: expenseForm.vat_applicable ? 'var(--accent)' : 'var(--bg-surface)', color: expenseForm.vat_applicable ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s' }}
                    >
                      Incl VAT
                    </button>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, display: 'block' }}>
                    {expenseForm.vat_applicable ? 'Amount is VAT-inclusive → goes to Expenses Incl VAT' : 'Amount is VAT-exclusive → goes to Expenses Excl VAT'}
                  </span>
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

function InvoiceTableHead({ onSort, sortArrow }) {
  const sortableTh = { ...styles.th, cursor: 'pointer', userSelect: 'none' }
  return (
    <thead>
      <tr style={{ background: 'var(--bg-surface)' }}>
        <th style={sortableTh} onClick={() => onSort('invoice_date')}>Date{sortArrow('invoice_date')}</th>
        <th style={sortableTh} onClick={() => onSort('invoice_number')}>Invoice #{sortArrow('invoice_number')}</th>
        <th style={sortableTh} onClick={() => onSort('vehicle_reg')}>Truck Reg{sortArrow('vehicle_reg')}</th>
        <th style={styles.th}>Description</th>
        <th style={sortableTh} onClick={() => onSort('amount')}>Amount{sortArrow('amount')}</th>
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
        <DateInput ref={firstInputRef} value={form.invoice_date}
          onChange={e => set('invoice_date', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)} inputStyle={styles.cellInput} />
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

// ── Diesel Group Table ─────────────────────────────────────────────────────────

function DieselGroupTable({ group, truckReg, V }) {
  const dTh = (label, right = false) => (
    <th key={label} style={{ ...thStyle, textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{label}</th>
  )
  const W = V || (({ children }) => children)  // no-op when verification not wired
  const sKey = (group.supplier_name || '').toUpperCase()
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={{ ...tblStyle, minWidth: 900 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            {dTh('Reg')}
            {dTh('Date')}
            {dTh('Trans ID')}
            {dTh('Delivery Note')}
            {dTh('Depot')}
            {dTh('Litres', true)}
            {dTh('R/Lt', true)}
            {dTh('Amt Excl', true)}
            {dTh('Amt Incl', true)}
            {dTh('1% Fee Excl', true)}
            {dTh('Fee VAT', true)}
            {dTh('1% Fee Incl', true)}
            {dTh('Grand Total', true)}
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r, i) => {
            const dk = r.fillup_id != null ? `diesel:${r.fillup_id}` : `dieselrow:${sKey}:${i}`
            return (
            <tr key={i}>
              <td style={tdStyle}>{truckReg}</td>
              <td style={tdStyle}>{r.fillup_date}</td>
              <td style={tdStyle}>{r.slip_number || '—'}</td>
              <td style={tdStyle}>{r.invoice_number || '—'}</td>
              <td style={tdStyle}>{r.supplier_name || '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtT(r.litres)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(r.rate_per_litre)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}><W field={`${dk}:amt_excl`}>{fmtC(r.amount_excl)}</W></td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(r.amount_excl)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(r.admin_fee_excl)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(r.admin_fee_vat)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(r.admin_fee_incl)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{fmtC(r.grand_total)}</td>
            </tr>
          )})}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
            <td style={tdStyle} colSpan={11} align="right">TOT ADMIN FEE</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}><W field={`dieselsupplier:${sKey}:fee_incl`}>{fmtC(group.tot_admin_fee_incl)}</W></td>
            <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)' }}><W field={`dieselsupplier:${sKey}:grand_total`}>{fmtC(group.tot_grand_total)}</W></td>
          </tr>
          <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
            <td style={tdStyle} colSpan={12} align="right">TOT EXCL ADMIN FEE</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}><W field={`dieselsupplier:${sKey}:excl`}>{fmtC(group.tot_excl_admin_fee)}</W></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function DieselGroupSection({ groups, truckReg, activeDieselTab, setActiveDieselTab, V }) {
  const effectiveTab = activeDieselTab ?? (groups[0]?.supplier_name ?? null)
  const activeGroup = groups.find(g => g.supplier_name === effectiveTab) ?? groups[0] ?? null

  const pillBase = {
    padding: '4px 14px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    transition: 'background 0.15s, color 0.15s',
  }
  const pillActive = { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }
  const pillInactive = { background: 'transparent', color: 'var(--text-muted)' }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>Diesel</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {groups.map(g => {
          const isActive = g.supplier_name === effectiveTab
          return (
            <button
              key={g.supplier_name}
              onClick={() => setActiveDieselTab(g.supplier_name)}
              style={{ ...pillBase, ...(isActive ? pillActive : pillInactive) }}
            >
              {g.supplier_name}
            </button>
          )
        })}
      </div>
      {activeGroup && <DieselGroupTable group={activeGroup} truckReg={truckReg} V={V} />}
    </div>
  )
}

// ── Truck Costing Card ─────────────────────────────────────────────────────────

function TruckCostingCard({ truckData, templateSuppliers = [], onAddExpense, onDeleteInvoice, isVatRegistered = true,
  verifPrefix, verif = {}, onVerify, onFinalize, currentUserId, isAdmin = false }) {
  const [expanded, setExpanded] = useState(false)
  const [showLoadDetail, setShowLoadDetail] = useState(false)
  const [activeDieselTab, setActiveDieselTab] = useState(null)
  const {
    truck, loads,
    income_excl_vat, income_incl_vat,
    admin_fee, supplier_invoices,
    total_expenses_excl_vat, total_expenses_incl_vat,
    net_payable,
    diesel_groups = [],
  } = truckData

  // Per-value verification helper for this truck's amounts
  const vKey = (field) => `${verifPrefix}:truck:${truck.id}:${field}`
  const V = ({ field, children }) => (
    onVerify
      ? <VerifiableAmount target={vKey(field)} state={verif[vKey(field)]}
          onVerify={onVerify} onFinalize={onFinalize} currentUserId={currentUserId} isAdmin={isAdmin}>
          {children}
        </VerifiableAmount>
      : children
  )

  const loadCount   = loads.length
  const totalTonnes = loads.reduce((s, l) => s + (l.tonnes ? parseFloat(l.tonnes) : 0), 0)
  const netNum      = parseFloat(net_payable)
  const incomeExcl  = parseFloat(income_excl_vat) || 0
  const incomeIncl  = parseFloat(income_incl_vat) || 0
  const vat         = incomeIncl - incomeExcl

  // Build lookup: supplier_name (upper) → { diesel: inv|null, fee: inv|null }
  const invBySupplier = {}
  for (const inv of supplier_invoices) {
    const key = (inv.supplier_name || `Supplier #${inv.supplier_id}`).toUpperCase()
    if (!invBySupplier[key]) invBySupplier[key] = { diesel: null, fee: null, dieselAll: [], feeAll: [] }
    if (!inv.vat_applicable) invBySupplier[key].dieselAll.push(inv)
    else invBySupplier[key].feeAll.push(inv)
  }

  // Build lookup: supplier_name (upper) → diesel_group totals
  const dieselGroupMap = {}
  for (const g of diesel_groups) {
    dieselGroupMap[g.supplier_name.toUpperCase()] = g
  }
  // Any invoices from suppliers not in the template (custom additions)
  const extraInvoices = supplier_invoices.filter(inv => {
    const key = (inv.supplier_name || `Supplier #${inv.supplier_id}`).toUpperCase()
    return !templateSuppliers.map(s => s.toUpperCase()).includes(key)
  })

  const colHdr = (label, right = false) => (
    <th key={label} style={{ ...thStyle, textAlign: right ? 'right' : 'left' }}>{label}</th>
  )
  const dash = <span style={{ color: 'var(--text-muted)' }}>—</span>

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 24, overflow: 'hidden' }}>
      {/* Truck header — click to expand */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ padding: '12px 20px', background: 'var(--bg-surface)', borderBottom: expanded ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: -8 }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{truck.registration}</span>
        {truck.fleet_number && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{truck.fleet_number}</span>}
        <span style={{ color: 'var(--border)', fontSize: 12 }}>|</span>
        <span style={{ fontSize: 13 }}>{loadCount} load{loadCount !== 1 ? 's' : ''}</span>
        <span style={{ color: 'var(--border)', fontSize: 12 }}>|</span>
        <span style={{ fontSize: 13 }}>{totalTonnes.toFixed(3)} t</span>
        {!expanded && parseFloat(net_payable) !== 0 && (
          <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13, color: parseFloat(net_payable) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
            Net: {fmtC(net_payable)}
          </span>
        )}
      </div>

      {expanded && <div style={{ padding: '16px 20px' }}>
        {/* 6-column costing template */}
        <table style={{ ...tblStyle, tableLayout: 'auto' }}>
          <thead>
            <tr style={{ background: 'var(--bg-surface)' }}>
              {colHdr('')}
              {colHdr('Income Excl VAT', true)}
              {colHdr('VAT', true)}
              {colHdr('Income Incl VAT', true)}
              {colHdr('Expenses Incl VAT', true)}
              {colHdr('Expenses Excl VAT', true)}
              <th style={{ ...thStyle, width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {/* Income / loads row — standard template (greyed) */}
            <tr>
              <td style={tdStyle}>
                <button
                  onClick={e => { e.stopPropagation(); setShowLoadDetail(v => !v) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <FileSpreadsheet size={13} style={{ color: showLoadDetail ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: showLoadDetail ? 'var(--accent)' : 'var(--text-primary)', letterSpacing: '0.02em', textDecoration: showLoadDetail ? 'none' : 'underline dotted', textUnderlineOffset: 3 }}>
                    See Spreadsheet with Loads
                  </span>
                  {diesel_groups.length > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: showLoadDetail ? 'var(--accent)' : 'rgba(59,130,246,0.12)', color: showLoadDetail ? '#fff' : 'var(--accent)', borderRadius: 10, padding: '1px 6px' }}>
                      {diesel_groups.length} supplier{diesel_groups.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </button>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', color: isVatRegistered ? 'var(--text-muted)' : undefined, fontWeight: isVatRegistered ? undefined : 700 }}>{fmtC(incomeExcl)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{isVatRegistered ? fmtC(vat) : dash}</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{isVatRegistered ? fmtC(incomeIncl) : dash}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
              <td style={tdStyle}></td>
            </tr>

            {/* Admin Fee — standard template (greyed) */}
            <tr>
              <td style={{ ...tdStyle, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Admin Fee</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}><V field="admin_fee">{fmtC(admin_fee)}</V></td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
              <td style={tdStyle}></td>
            </tr>

            {/* Template supplier rows — greyed, always present, no delete */}
            {templateSuppliers.map(supplierName => {
              const key = supplierName.toUpperCase()
              const dg = dieselGroupMap[key]
              const dieselExcl = dg ? parseFloat(dg.tot_excl_admin_fee) : 0
              const feeIncl   = dg ? parseFloat(dg.tot_admin_fee_incl)  : 0
              const hasDiesel = dieselExcl !== 0
              const hasFee    = feeIncl !== 0
              return (
                <React.Fragment key={supplierName}>
                  <tr>
                    <td style={{ ...tdStyle, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{key} DIESEL</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: hasDiesel ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: hasDiesel ? 600 : 400 }}>
                      {hasDiesel ? <V field={`dieselsupplier:${key}:excl`}>{fmtC(dieselExcl)}</V> : dash}
                    </td>
                    <td style={tdStyle}></td>
                  </tr>
                  <tr>
                    <td style={{ ...tdStyle, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{key} DIESEL ADMIN FEE</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: hasFee ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: hasFee ? 600 : 400 }}>
                      {hasFee ? <V field={`dieselsupplier:${key}:fee_incl`}>{fmtC(feeIncl)}</V> : dash}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={tdStyle}></td>
                  </tr>
                </React.Fragment>
              )
            })}

            {/* Supplier Invoices heading */}
            <tr>
              <td colSpan={7} style={{ padding: '10px 10px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                Supplier Invoices
              </td>
            </tr>

            {/* Actual linked supplier invoices — all of them, with delete */}
            {supplier_invoices.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 12 }}>No invoices linked</td>
              </tr>
            ) : (
              supplier_invoices.map(inv => {
                const label = (inv.supplier_name || `Supplier #${inv.supplier_id}`)
                return (
                  <tr key={inv.id}>
                    <td style={{ ...tdStyle, fontSize: 12 }}>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span>{label}</span>
                        {inv.invoice_number && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{inv.invoice_number}</span>
                        )}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{dash}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {inv.vat_applicable ? <V field={`invoice:${inv.id}:amount`}>{fmtC(inv.amount)}</V> : dash}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {inv.vat_applicable ? dash : <V field={`invoice:${inv.id}:amount`}>{fmtC(inv.amount)}</V>}
                    </td>
                    <td style={tdStyle}>
                      <button className="btn-icon btn-ghost" onClick={() => onDeleteInvoice(inv)}>
                        <Trash2 size={12} color="var(--danger)" />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
              <td style={tdStyle}>Totals</td>
              {/* Non-VAT entities (BKMO): the Incl VAT column is dashed out, so the
                  verification tick lives on the Excl VAT total instead */}
              <td style={{ ...tdStyle, textAlign: 'right' }}>{isVatRegistered ? fmtC(incomeExcl) : <V field="income_excl">{fmtC(incomeExcl)}</V>}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{isVatRegistered ? fmtC(vat) : dash}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)' }}>{isVatRegistered ? <V field="income_incl">{fmtC(incomeIncl)}</V> : dash}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--danger)' }}>{fmtC(total_expenses_incl_vat)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--danger)' }}>{fmtC(total_expenses_excl_vat)}</td>
              <td style={tdStyle}></td>
            </tr>
          </tfoot>
        </table>

        {/* Calculations */}
        {(() => {
          const totalExp = (parseFloat(total_expenses_incl_vat) || 0) + (parseFloat(total_expenses_excl_vat) || 0)
          return (
            <div style={{ display: 'flex', gap: 0, marginTop: 12, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ flex: 1, padding: '10px 16px', borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 2 }}>To Be Invoiced</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>
                  <V field={isVatRegistered ? 'income_incl' : 'income_excl'}>{fmtC(isVatRegistered ? incomeIncl : incomeExcl)}</V>
                </div>
              </div>
              <div style={{ flex: 1, padding: '10px 16px', borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 2 }}>Total Expenses</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--danger)' }}>
                  <V field="total_expenses">{fmtC(totalExp)}</V>
                </div>
              </div>
              <div style={{ flex: 1, padding: '10px 16px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 2 }}>To Be Paid Out</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: netNum >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                  <V field="net_payable">{fmtC(net_payable)}</V>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Add Expense */}
        <button
          className="btn-ghost"
          style={{ fontSize: 12, marginTop: 12, padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={onAddExpense}
        >
          <Plus size={13} /> Add Expense
        </button>

        {/* Collapsible loads detail */}
        {showLoadDetail && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>Load Detail</div>
            <table style={tblStyle}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)' }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Slip #</th>
                  <th style={thStyle}>Mine</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Tonnes</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Rate/t</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Excl VAT</th>
                  {isVatRegistered && <th style={{ ...thStyle, textAlign: 'right' }}>Incl VAT</th>}
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
                    {isVatRegistered && <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>{fmtC(l.subcontractor_amount_incl_vat)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
                  <td style={tdStyle} colSpan={5}>Total</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{isVatRegistered ? fmtC(income_excl_vat) : <V field="income_excl">{fmtC(income_excl_vat)}</V>}</td>
                  {isVatRegistered && <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)' }}><V field="income_incl">{fmtC(income_incl_vat)}</V></td>}
                </tr>
              </tfoot>
            </table>

            {/* Diesel supplier tabs */}
            {diesel_groups.length > 0 && (
              <DieselGroupSection
                groups={diesel_groups}
                truckReg={truck.registration}
                activeDieselTab={activeDieselTab}
                setActiveDieselTab={setActiveDieselTab}
                V={V}
              />
            )}
          </div>
        )}
      </div>}
    </div>
  )
}

// ── Monthly Summary Card ───────────────────────────────────────────────────────

function SummaryCard({ summary, trucks = [], isVatRegistered = true,
  verifPrefix, verif = {}, onVerify, onFinalize, currentUserId, isAdmin = false }) {
  const [expanded, setExpanded] = useState(false)

  const sKey = (field) => `${verifPrefix}:summary:${field}`
  const SV = ({ field, children }) => (
    onVerify
      ? <VerifiableAmount target={sKey(field)} state={verif[sKey(field)]}
          onVerify={onVerify} onFinalize={onFinalize} currentUserId={currentUserId} isAdmin={isAdmin}>
          {children}
        </VerifiableAmount>
      : children
  )

  const th = (label, right = false) => (
    <th key={label} style={{ ...thStyle, textAlign: right ? 'right' : 'left' }}>{label}</th>
  )

  const truckRows = trucks.filter(td => parseFloat(isVatRegistered ? td.income_incl_vat : td.income_excl_vat) !== 0 || parseFloat(td.total_expenses_excl_vat) !== 0 || parseFloat(td.total_expenses_incl_vat) !== 0)

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 10, marginTop: 8, marginBottom: 24, overflow: 'hidden' }}>
      {/* Header — click to expand */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ padding: '14px 20px', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: -4 }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', flex: 1 }}>
          Monthly Summary — All Trucks
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>
          {fmtC(summary.net_payable)}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '0 0 16px' }}>
          <table style={tblStyle}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)' }}>
                {th('Vehicle')}
                {th('Income', true)}
                {th('Diesel', true)}
                {th('Admin', true)}
                {th('To Be Paid Out', true)}
              </tr>
            </thead>
            <tbody>
              {truckRows.map(td => (
                <tr key={td.truck.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{td.truck.registration}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(isVatRegistered ? td.income_incl_vat : td.income_excl_vat)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(td.total_expenses_excl_vat)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtC(td.total_expenses_incl_vat)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: parseFloat(td.net_payable) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {fmtC(td.net_payable)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
                <td style={tdStyle}>TOTAL</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <SV field={isVatRegistered ? 'income_incl' : 'income_excl'}>{fmtC(isVatRegistered ? summary.income_incl_vat : summary.income_excl_vat)}</SV>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <SV field="total_expenses_excl">{fmtC(summary.total_expenses_excl_vat)}</SV>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <SV field="total_expenses_incl">{fmtC(summary.total_expenses_incl_vat)}</SV>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--accent)', fontSize: 15 }}>
                  <SV field="net_payable">{fmtC(summary.net_payable)}</SV>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
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
