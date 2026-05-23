import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getSupplier, getEntities,
  getSupplierInvoices, createSupplierInvoice,
  updateSupplierInvoice, deleteSupplierInvoice, archiveSupplierInvoice, markStatementPaid,
  verifySupplierInvoice, getCurrentDieselRate, getTruckLoads, getFleetTrucks,
  addInvoiceLineItem, updateInvoiceLineItem, deleteInvoiceLineItem,
} from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, Save, X, CheckCircle, Fuel } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import VerifyBadge from '../components/VerifyBadge'
import DeleteModal from '../components/DeleteModal'
import SearchableSelect from '../components/SearchableSelect'

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
  litres: '',
  vehicle_reg: '',
  description: '',
  vat_applicable: true,
  notes: '',
  is_multi_line: false,
  line_items: [],
})

const blankLineItem = () => ({
  _key: Math.random(),
  item_code: '',
  item_description: '',
  quantity: '',
  unit: '',
  amount_excl_vat: '',
  amount_incl_vat: '',
  sort_order: 0,
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
  const [deleteTarget, setDeleteTarget] = useState(null)  // invoice pending deletion
  const [openInvoiceIds, setOpenInvoiceIds] = useState(new Set())
  const firstInputRef = useRef(null)

  // Diesel rate auto-fill state (for diesel suppliers)
  const [dieselRate, setDieselRate] = useState(null)
  const [amountAutoFilled, setAmountAutoFilled] = useState(false)

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

  // Focus first input whenever new row appears or edit row opens
  useEffect(() => {
    if ((showNew || editingId) && firstInputRef.current)
      firstInputRef.current.focus()
  }, [showNew, editingId])

  // Fetch the diesel rate for this supplier's entity when the form opens or date changes
  useEffect(() => {
    if (!supplier?.is_diesel_supplier || !showNew || !supplier?.entity_id) {
      setDieselRate(null)
      return
    }
    const date = newForm.invoice_date || today
    getCurrentDieselRate(supplier.id, { entity_id: supplier.entity_id, on_date: date })
      .then(r => setDieselRate(r.data || null))
      .catch(() => setDieselRate(null))
  }, [supplier?.id, supplier?.entity_id, supplier?.is_diesel_supplier, newForm.invoice_date, showNew])

  // Auto-fill amount when litres change and a diesel rate has been loaded
  useEffect(() => {
    if (!dieselRate || !newForm.litres) return
    const litres = parseFloat(newForm.litres)
    if (isNaN(litres) || litres <= 0) return
    if (newForm.amount && !amountAutoFilled) return
    const calculated = (litres * parseFloat(dieselRate.rate_per_litre)).toFixed(2)
    setNewForm(f => ({ ...f, amount: calculated }))
    setAmountAutoFilled(true)
  }, [newForm.litres, dieselRate])

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
      vehicle_reg: inv.vehicle_reg || '',
      description: inv.description || '',
      vat_applicable: inv.vat_applicable !== false,
      notes: inv.notes || '',
      is_multi_line: inv.is_multi_line || false,
      line_items: inv.line_items ? inv.line_items.map(li => ({ ...li, _key: li.id })) : [],
    })
    if (inv.is_multi_line) {
      setOpenInvoiceIds(s => { const n = new Set(s); n.add(inv.id); return n })
    }
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({}) }
  const cancelNew = () => { setShowNew(false); setNewForm(blankForm(supplier?.entity_id)); setAmountAutoFilled(false) }

  const handleAddClick = () => {
    setEditingId(null)
    setNewForm(blankForm(supplier?.entity_id))
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
    if (!form.invoice_number.trim()) return 'Invoice number is required'
    if (!form.is_multi_line && (form.amount === '' || isNaN(form.amount))) return 'Valid amount is required'
    return null
  }

  const saveNew = async () => {
    const err = validate(newForm)
    if (err) return toast.error(err)
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
            const totalTonnes = group.loads.reduce((s, l) => s + parseFloat(l.tonnes || 0), 0)
            const totalAmt    = group.loads.reduce((s, l) => s + parseFloat(l.amount_excl_vat || 0), 0)
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
                {isDiesel && <th style={{ ...styles.th, textAlign: 'right' }}>Litres</th>}
                <th style={{ ...styles.th, textAlign: 'center' }}>VAT</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>Verified</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>Paid</th>
                <th style={styles.th}>Notes</th>
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
                    isDiesel={isDiesel}
                    dieselRate={dieselRate}
                    amountAutoFilled={amountAutoFilled}
                    onAmountEdit={() => setAmountAutoFilled(false)}
                    trucks={trucks}
                  />
                : <tr>
                    <td
                      colSpan={9 + (multiEntity ? 1 : 0) + (showVehicleReg ? 1 : 0) + (isDiesel ? 1 : 0)}
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

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Supplier Invoice"
        description={deleteTarget ? `Invoice ${deleteTarget.invoice_number}${deleteTarget.amount ? ` — ${formatCurrency(deleteTarget.amount)}` : ''}` : ''}
        onArchive={async () => {
          try { await archiveSupplierInvoice(deleteTarget.id); toast.success('Invoice archived'); setDeleteTarget(null); loadInvoices() }
          catch (e) { toast.error(errorMessage(e)) }
        }}
        onDelete={async () => {
          try { await deleteSupplierInvoice(deleteTarget.id); toast.success('Invoice deleted'); setDeleteTarget(null); loadInvoices() }
          catch (e) { toast.error(errorMessage(e)) }
        }}
      />

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
                      {isDiesel && <th style={{ ...styles.th, textAlign: 'right' }}>Litres</th>}
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
                        showVehicleReg={showVehicleReg}
                        isDiesel={isDiesel}
                        dieselRate={dieselRate}
                        amountAutoFilled={amountAutoFilled}
                        onAmountEdit={() => setAmountAutoFilled(false)}
                        trucks={trucks}
                      />
                    )}
                    {group.invoices.map(inv => {
                      const isEditing = editingId === inv.id
                      const f = editForm
                      const isExpanded = openInvoiceIds.has(inv.id)
                      const totalCols = 9 + (multiEntity ? 1 : 0) + (showVehicleReg ? 1 : 0) + (isDiesel ? 1 : 0)

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
                                  {!inv.vat_applicable && <span style={styles.noVatTag}>NON VAT</span>}
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
                                    onChange={e => setEditForm(p => ({ ...p, litres: e.target.value }))}
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
                              <VerifyBadge item={inv} onVerify={handleVerify} currentUserId={user?.id} isAdmin={isAdmin} />
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
                                  <LineItemsEditor
                                    items={editForm.line_items || []}
                                    onChange={items => setEditForm(p => ({ ...p, line_items: items }))}
                                  />
                                ) : (
                                  <LineItemsViewer items={inv.line_items || []} total={inv.amount} />
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
                      <td colSpan={5 + (isDiesel ? 1 : 0)} style={styles.td} />
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


function NewRow({ form, setForm, saving, onSave, onCancel, entities, multiEntity, firstInputRef, onKeyDown, showVehicleReg, isDiesel, dieselRate, amountAutoFilled, onAmountEdit, trucks = [] }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const entityCode = entities.find(e => String(e.id) === String(form.entity_id))?.code || '—'
  const totalCols = 9 + (multiEntity ? 1 : 0) + (showVehicleReg ? 1 : 0) + (isDiesel ? 1 : 0)
  const lineTotal = (form.line_items || []).reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)

  const formRow = (
    <tr style={{ background: 'var(--accent-subtle)', borderBottom: form.is_multi_line ? 'none' : '1px solid var(--border-accent)' }}>
      {multiEntity && (
        <td style={styles.td}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{entityCode}</span>
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
          <SearchableSelect
            value={form.vehicle_reg}
            onChange={v => set('vehicle_reg', v)}
            options={[{ id: '', registration: '', fleet_number: null }, ...trucks]}
            getValue={t => t.registration}
            getLabel={t => t.registration === '' ? '— Clear —' : t.fleet_number ? `#${t.fleet_number} · ${t.registration}` : t.registration}
            placeholder="Vehicle reg…"
            style={{ width: 150 }}
          />
        </td>
      )}
      <td style={styles.td}>
        <input value={form.description} placeholder="Description"
          onChange={e => set('description', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)}
          style={{ ...styles.cellInput, minWidth: 140 }} />
      </td>
      {/* Amount */}
      <td style={styles.td}>
        {form.is_multi_line ? (
          <span style={{ fontWeight: 700, fontSize: 13 }}>{lineTotal > 0 ? `R ${lineTotal.toFixed(2)}` : '—'}</span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input type="number" step="0.01" placeholder="0.00" value={form.amount}
              onChange={e => { set('amount', e.target.value); onAmountEdit?.() }}
              onKeyDown={e => onKeyDown(e, onSave, onCancel)}
              style={{ ...styles.cellInput, width: 90, textAlign: 'right' }} />
            {amountAutoFilled && dieselRate && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', whiteSpace: 'nowrap' }} title={`Auto-calculated: R${parseFloat(dieselRate.rate_per_litre).toFixed(2)}/L`}>
                auto
              </span>
            )}
          </div>
        )}
      </td>
      {isDiesel && (
        <td style={styles.td}>
          <input type="number" step="0.001" min="0" placeholder="0.000"
            value={form.litres}
            onChange={e => set('litres', e.target.value)}
            onKeyDown={e => onKeyDown(e, onSave, onCancel)}
            style={{ ...styles.cellInput, width: 80, textAlign: 'right' }}
            title="Litres of diesel"
          />
        </td>
      )}
      <td style={{ ...styles.td, textAlign: 'center' }}>
        <input type="checkbox" checked={form.vat_applicable}
          onChange={e => set('vat_applicable', e.target.checked)} style={{ cursor: 'pointer' }} />
      </td>
      <td style={styles.td} />
      <td style={styles.td} />
      <td style={styles.td}>
        <input value={form.notes} placeholder="Notes"
          onChange={e => set('notes', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)}
          style={{ ...styles.cellInput, minWidth: 120 }} />
      </td>
      <td style={{ ...styles.td, whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: 10 }}>
        {/* Single/Multi toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {['single', 'multi'].map(v => (
            <button key={v}
              onClick={() => setForm(f => ({ ...f, is_multi_line: v === 'multi', line_items: [] }))}
              style={{
                padding: '2px 8px', borderRadius: 12, border: '1px solid var(--border)',
                background: (form.is_multi_line ? v === 'multi' : v === 'single') ? 'var(--accent)' : 'var(--bg-card)',
                color: (form.is_multi_line ? v === 'multi' : v === 'single') ? '#fff' : 'var(--text)',
                fontWeight: 600, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {v === 'single' ? 'Single' : 'Multi'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onSave} disabled={saving} className="btn btn-icon btn-primary" title="Save (Enter)"><Save size={14} /></button>
          <button onClick={onCancel} className="btn btn-icon btn-ghost" title="Cancel (Esc)"><X size={14} /></button>
        </div>
      </td>
    </tr>
  )

  if (!form.is_multi_line) return formRow

  return (
    <>
      {formRow}
      <tr style={{ background: 'var(--accent-subtle)', borderBottom: '1px solid var(--border-accent)' }}>
        <td colSpan={totalCols} style={{ padding: '0 12px 12px 12px' }}>
          <LineItemsEditor
            items={form.line_items || []}
            onChange={items => setForm(f => ({ ...f, line_items: items }))}
          />
        </td>
      </tr>
    </>
  )
}


function LineItemsEditor({ items, onChange }) {
  const addLine = () => onChange([...items, blankLineItem()])
  const removeLine = (idx) => onChange(items.filter((_, i) => i !== idx))
  const updateLine = (idx, field, value) => {
    onChange(items.map((li, i) => i === idx ? { ...li, [field]: value } : li))
  }

  const totalExcl = items.reduce((s, li) => s + (parseFloat(li.amount_excl_vat) || 0), 0)
  const totalIncl = items.reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)

  return (
    <div style={{ marginTop: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 90 }} />
          <col />
          <col style={{ width: 70 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 32 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Item Code</th>
            <th style={liStyles.th}>Description</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Qty</th>
            <th style={liStyles.th}>Unit</th>
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
                <input value={li.unit ?? ''} placeholder="each"
                  onChange={e => updateLine(idx, 'unit', e.target.value)}
                  style={{ ...liStyles.input, width: '100%' }} />
              </td>
              <td style={liStyles.td}>
                <input type="number" step="0.01" value={li.amount_excl_vat ?? ''} placeholder="0.00"
                  onChange={e => updateLine(idx, 'amount_excl_vat', e.target.value)}
                  style={{ ...liStyles.input, width: '100%', textAlign: 'right' }} />
              </td>
              <td style={liStyles.td}>
                <input type="number" step="0.01" value={li.amount_incl_vat ?? ''} placeholder="0.00"
                  onChange={e => updateLine(idx, 'amount_incl_vat', e.target.value)}
                  style={{ ...liStyles.input, width: '100%', textAlign: 'right' }} />
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
          <col style={{ width: 90 }} />
          <col />
          <col style={{ width: 70 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 110 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Item Code</th>
            <th style={liStyles.th}>Description</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Qty</th>
            <th style={liStyles.th}>Unit</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Incl. VAT</th>
          </tr>
        </thead>
        <tbody>
          {items.map(li => (
            <tr key={li.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={liStyles.td}>{li.item_code || '—'}</td>
              <td style={liStyles.td}>{li.item_description || '—'}</td>
              <td style={{ ...liStyles.td, textAlign: 'right' }}>{li.quantity != null ? li.quantity : '—'}</td>
              <td style={liStyles.td}>{li.unit || '—'}</td>
              <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>
                R {parseFloat(li.amount_excl_vat ?? 0).toFixed(2)}
              </td>
              <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>
                R {parseFloat(li.amount_incl_vat ?? 0).toFixed(2)}
              </td>
            </tr>
          ))}
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
