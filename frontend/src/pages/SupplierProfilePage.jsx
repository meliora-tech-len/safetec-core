import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getSupplier, getEntities,
  getSupplierInvoices, createSupplierInvoice,
  updateSupplierInvoice, deleteSupplierInvoice, archiveSupplierInvoice, markStatementPaid,
  verifySupplierInvoice, getCurrentDieselRate, getTruckLoads, getFleetTrucks,
  addInvoiceLineItem, updateInvoiceLineItem, deleteInvoiceLineItem,
  getSubcontractors,
  finalizeSupplierInvoice,
} from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, Save, X, CheckCircle, Fuel } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import VerifyBadge from '../components/VerifyBadge'
import DeleteModal from '../components/DeleteModal'
import SearchableSelect from '../components/SearchableSelect'
import DateInput from '../components/DateInput'

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const today = new Date().toISOString().slice(0, 10)
const currentMonth = () => new Date().getMonth() + 1
const currentYear  = () => new Date().getFullYear()

const blankForm = (entityId, isDieselSupplier = false) => ({
  entity_id: entityId || '',
  invoice_date: today,
  invoice_number: '',
  amount: '',
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
  const [subbies, setSubbies] = useState([])
  const [sortCol, setSortCol] = useState('vehicle_reg')
  const [sortDir, setSortDir] = useState('asc')
  const [filterText, setFilterText] = useState('')

  const loadInvoices = useCallback(() =>
    getSupplierInvoices({ supplier_id: supplierId }).then(r => setGroups(r.data))
  , [supplierId])

  useEffect(() => {
    Promise.all([
      getSupplier(supplierId).then(r => {
        setSupplier(r.data)
        setNewForm(blankForm(r.data.entity_id, r.data.is_diesel_supplier))
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

  // Fetch subcontractors for diesel supplier's entity (used for Subbie Name dropdown)
  useEffect(() => {
    if (!supplier?.is_diesel_supplier || !supplier?.entity_id) { setSubbies([]); return }
    getSubcontractors({ entity_id: supplier.entity_id, limit: 500 })
      .then(r => setSubbies(r.data || []))
      .catch(() => setSubbies([]))
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
    setEditForm({
      entity_id: inv.entity_id,
      invoice_date: inv.invoice_date?.slice(0, 10) || today,
      invoice_number: inv.invoice_number || '',
      amount: String(inv.amount || ''),
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
        return { ...li, _key: li.id, _rate: qty > 0 ? String(Math.round(excl / qty * 10000) / 10000) : '' }
      }) : [],
      statement_month: inv.statement_month || currentMonth(),
      statement_year: inv.statement_year || currentYear(),
    })
    if (inv.is_multi_line) {
      setOpenInvoiceIds(s => { const n = new Set(s); n.add(inv.id); return n })
    }
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({}) }
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
      setNewForm(blankForm(supplier?.entity_id))
      setAmountAutoFilled(false)
      await loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }

  const saveEdit = async () => {
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

  const handleVerify = async (inv) => {
    try {
      await verifySupplierInvoice(inv.id)
      loadInvoices()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const handleFinalize = async (inv) => {
    try {
      await finalizeSupplierInvoice(inv.id)
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
                    R {parseFloat(dieselRate.rate_per_litre).toFixed(4)}/L
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

      {/* ── Shared table columns helper ── */}
      {/* ── Statement groups (always rendered, new row injected at top of first group) ── */}
      {groups.length === 0 ? (
        <div style={styles.group}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)' }}>
                {multiEntity && <th style={styles.th}>Entity</th>}
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Period</th>
                <th style={styles.th}>Invoice #</th>
                {isDiesel && <th style={styles.th}>Slip #</th>}
                {showVehicleReg && <th style={styles.th}>Vehicle Reg</th>}
                <th style={styles.th}>{isDiesel ? 'Subbie Name' : 'Description'}</th>
                <th style={styles.th}>Amount</th>
                {isDiesel && <th style={{ ...styles.th, textAlign: 'right' }}>Litres</th>}
                {isDiesel && <th style={{ ...styles.th, textAlign: 'right' }}>Rate/L</th>}
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
                    subbies={subbies}
                  />
                : <tr>
                    <td
                      colSpan={10 + (multiEntity ? 1 : 0) + (showVehicleReg ? 1 : 0) + (isDiesel ? 3 : 0)}
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

      {/* ── Filter bar ── */}
      {groups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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
        </div>
      )}

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
                      <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('invoice_date')}>
                        Date{sortArrow('invoice_date')}
                      </th>
                      <th style={styles.th}>Period</th>
                      <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('invoice_number')}>
                        Invoice #{sortArrow('invoice_number')}
                      </th>
                      {isDiesel && (
                        <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('slip_number')}>
                          Slip #{sortArrow('slip_number')}
                        </th>
                      )}
                      {showVehicleReg && (
                        <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('vehicle_reg')}>
                          Vehicle Reg{sortArrow('vehicle_reg')}
                        </th>
                      )}
                      <th style={styles.th}>{isDiesel ? 'Subbie Name' : 'Description'}</th>
                      <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('amount')}>
                        Amount{sortArrow('amount')}
                      </th>
                      {isDiesel && (
                        <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('litres')}>
                          Litres{sortArrow('litres')}
                        </th>
                      )}
                      {isDiesel && <th style={{ ...styles.th, textAlign: 'right' }}>Rate/L</th>}
                      <th style={{ ...styles.th, textAlign: 'center' }}>VAT</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Verified</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Paid</th>
                      <th style={styles.th}>Notes</th>
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
                        subbies={subbies}
                      />
                    )}
                    {processInvoices(group.invoices).map(inv => {
                      const isEditing = editingId === inv.id
                      const f = editForm
                      const isExpanded = openInvoiceIds.has(inv.id)
                      const totalCols = 10 + (multiEntity ? 1 : 0) + (showVehicleReg ? 1 : 0) + (isDiesel ? 3 : 0)

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
                                <DateInput
                                  ref={firstInputRef} value={f.invoice_date}
                                  onChange={e => setEditForm(p => ({ ...p, invoice_date: e.target.value }))}
                                  onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                  onClick={e => e.stopPropagation()}
                                  inputStyle={styles.cellInput}
                                />
                              ) : formatDate(inv.invoice_date)}
                            </td>

                            {/* Period */}
                            <td style={styles.td}>
                              {isEditing ? (
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
                                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {MONTH_NAMES[inv.statement_month]?.slice(0, 3)} {inv.statement_year}
                                </span>
                              )}
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

                            {/* Slip # — diesel only, read-only from linked DieselFillUp */}
                            {isDiesel && (
                              <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11 }}>
                                {inv.slip_number ? (
                                  <span>{inv.slip_number}</span>
                                ) : (
                                  <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 10 }}>⚠ missing</span>
                                )}
                              </td>
                            )}

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

                            {/* Description / Subbie Name */}
                            <td style={{ ...styles.td, maxWidth: 200 }}>
                              {isEditing ? (
                                isDiesel && subbies.length > 0 ? (
                                  <div onClick={e => e.stopPropagation()}>
                                    <SearchableSelect
                                      value={f.description}
                                      onChange={v => setEditForm(p => ({ ...p, description: v }))}
                                      options={[{ id: '', name: '' }, ...subbies]}
                                      getValue={s => s.name}
                                      getLabel={s => s.name || '— None —'}
                                      placeholder="Subbie name…"
                                      style={{ width: 160 }}
                                    />
                                  </div>
                                ) : (
                                  <input
                                    value={f.description}
                                    onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                                    onKeyDown={e => handleKeyDown(e, saveEdit, cancelEdit)}
                                    onClick={e => e.stopPropagation()}
                                    style={{ ...styles.cellInput, minWidth: 140 }}
                                    placeholder={isDiesel ? 'Subbie name…' : 'Description'}
                                  />
                                )
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

                            {/* Rate/L — diesel suppliers only */}
                            {isDiesel && (
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                {isEditing ? (
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

                            {/* Verified */}
                            <td style={styles.td}>
                              <VerifyBadge item={inv} onVerify={handleVerify} onFinalize={handleFinalize} currentUserId={user?.id} isAdmin={isAdmin} />
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
                                  isDiesel
                                    ? <DieselLineItemsEditor
                                        items={editForm.line_items || []}
                                        onChange={items => setEditForm(p => ({ ...p, line_items: items }))}
                                        vatApplicable={editForm.vat_applicable !== false}
                                        subbies={subbies}
                                      />
                                    : <LineItemsEditor
                                        items={editForm.line_items || []}
                                        onChange={items => setEditForm(p => ({ ...p, line_items: items }))}
                                        vatApplicable={editForm.vat_applicable !== false}
                                      />
                                ) : (
                                  isDiesel
                                    ? <DieselLineItemsViewer items={inv.line_items || []} total={inv.amount} />
                                    : <LineItemsViewer items={inv.line_items || []} total={inv.amount} />
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
                      <td colSpan={5 + (isDiesel ? 2 : 0)} style={styles.td} />
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


function NewRow({ form, setForm, saving, onSave, onCancel, entities, multiEntity, firstInputRef, onKeyDown, showVehicleReg, isDiesel, dieselRate, amountAutoFilled, onAmountEdit, trucks = [], subbies = [] }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const entityCode = entities.find(e => String(e.id) === String(form.entity_id))?.code || '—'
  const totalCols = 10 + (multiEntity ? 1 : 0) + (showVehicleReg ? 1 : 0) + (isDiesel ? 3 : 0)
  const lineTotal = (form.line_items || []).reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)

  const formRow = (
    <tr style={{ background: 'var(--accent-subtle)', borderBottom: form.is_multi_line ? 'none' : '1px solid var(--border-accent)' }}>
      {multiEntity && (
        <td style={styles.td}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{entityCode}</span>
        </td>
      )}
      <td style={styles.td}>
        <DateInput ref={firstInputRef} value={form.invoice_date}
          onChange={e => set('invoice_date', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)} inputStyle={styles.cellInput} />
      </td>
      <td style={styles.td}>
        <div style={{ display: 'flex', gap: 3 }}>
          <select
            value={form.statement_month}
            onChange={e => set('statement_month', parseInt(e.target.value))}
            style={{ ...styles.cellInput, width: 72, padding: '2px 2px' }}
          >
            {MONTH_NAMES.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>{m.slice(0, 3)}</option>
            ))}
          </select>
          <input
            type="number" min="2020" max="2099"
            value={form.statement_year}
            onChange={e => set('statement_year', parseInt(e.target.value))}
            style={{ ...styles.cellInput, width: 52 }}
          />
        </div>
      </td>
      <td style={styles.td}>
        <input value={form.invoice_number} placeholder="e.g. TM1794"
          onChange={e => set('invoice_number', e.target.value)}
          onKeyDown={e => onKeyDown(e, onSave, onCancel)}
          style={{ ...styles.cellInput, minWidth: 90 }} />
      </td>
      {isDiesel && <td style={styles.td} />}
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
        {isDiesel && subbies.length > 0 ? (
          <SearchableSelect
            value={form.description}
            onChange={v => set('description', v)}
            options={[{ id: '', name: '' }, ...subbies]}
            getValue={s => s.name}
            getLabel={s => s.name || '— None —'}
            placeholder="Subbie name…"
            style={{ width: 160 }}
            formInput
          />
        ) : (
          <input value={form.description} placeholder={isDiesel ? 'Subbie name…' : 'Description'}
            onChange={e => set('description', e.target.value)}
            onKeyDown={e => onKeyDown(e, onSave, onCancel)}
            style={{ ...styles.cellInput, minWidth: 140 }} />
        )}
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
            {amountAutoFilled && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', whiteSpace: 'nowrap' }}>auto</span>
            )}
          </div>
        )}
      </td>
      {isDiesel && (
        <td style={{ ...styles.td, textAlign: 'right' }}>
          <input type="number" step="0.001" min="0" placeholder="0.000"
            value={form.litres}
            onChange={e => set('litres', e.target.value)}
            onKeyDown={e => onKeyDown(e, onSave, onCancel)}
            style={{ ...styles.cellInput, width: 80, textAlign: 'right' }}
          />
        </td>
      )}
      {isDiesel && (
        <td style={{ ...styles.td, textAlign: 'right' }}>
          <input type="number" step="0.0001" min="0" placeholder="0.0000"
            value={form._rate || ''}
            onChange={e => { set('_rate', e.target.value); onAmountEdit?.() }}
            onKeyDown={e => onKeyDown(e, onSave, onCancel)}
            style={{ ...styles.cellInput, width: 80, textAlign: 'right' }}
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
          {isDiesel
            ? <DieselLineItemsEditor
                items={form.line_items || []}
                onChange={items => setForm(f => ({ ...f, line_items: items }))}
                vatApplicable={form.vat_applicable !== false}
                subbies={subbies}
              />
            : <LineItemsEditor
                items={form.line_items || []}
                onChange={items => setForm(f => ({ ...f, line_items: items }))}
                vatApplicable={form.vat_applicable !== false}
              />
          }
        </td>
      </tr>
    </>
  )
}


function LineItemsEditor({ items, onChange, vatApplicable = true }) {
  const vatMult = vatApplicable ? 1.15 : 1
  const addLine = () => onChange([...items, blankLineItem()])
  const removeLine = (idx) => onChange(items.filter((_, i) => i !== idx))
  const updateLine = (idx, field, value) => {
    const updated = { ...items[idx], [field]: value }
    const qty = parseFloat(field === 'quantity' ? value : updated.quantity) || 0
    const rate = parseFloat(field === '_rate' ? value : updated._rate) || 0
    if (field === 'quantity' || field === '_rate') {
      const excl = qty && rate ? Math.round(qty * rate * 100) / 100 : 0
      updated.amount_excl_vat = excl || ''
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
          <col style={{ width: 65 }} />
          <col style={{ width: 105 }} />
          <col style={{ width: 95 }} />
          <col style={{ width: 95 }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Item Code</th>
            <th style={liStyles.th}>Description</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Qty</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Rate</th>
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
                <input type="number" step="0.0001" value={li._rate || ''} placeholder="0.00"
                  onChange={e => updateLine(idx, '_rate', e.target.value)}
                  style={{ ...liStyles.input, width: '100%', textAlign: 'right' }} />
              </td>
              <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 11 }}>
                {parseFloat(li.amount_excl_vat) ? parseFloat(li.amount_excl_vat).toFixed(2) : '—'}
              </td>
              <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                {parseFloat(li.amount_incl_vat) ? parseFloat(li.amount_incl_vat).toFixed(2) : '—'}
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
          <col style={{ width: 80 }} />
          <col />
          <col style={{ width: 65 }} />
          <col style={{ width: 105 }} />
          <col style={{ width: 95 }} />
          <col style={{ width: 95 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Item Code</th>
            <th style={liStyles.th}>Description</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Qty</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Rate</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Incl. VAT</th>
          </tr>
        </thead>
        <tbody>
          {items.map(li => {
            const qty = parseFloat(li.quantity) || 0
            const excl = parseFloat(li.amount_excl_vat) || 0
            const rate = qty > 0 ? excl / qty : null
            return (
              <tr key={li.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={liStyles.td}>{li.item_code || '—'}</td>
                <td style={liStyles.td}>{li.item_description || '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right' }}>{qty || '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>
                  {rate != null ? rate.toFixed(4) : '—'}
                </td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  R {excl.toFixed(2)}
                </td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>
                  R {parseFloat(li.amount_incl_vat ?? 0).toFixed(2)}
                </td>
              </tr>
            )
          })}
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


// Diesel sub-line columns mirror the main invoice table:
// Invoice # | Vehicle Reg | Subbie Name | Litres | Rate/L | Excl. VAT | Incl. VAT
// Stored as: item_code | unit | item_description | quantity | _rate(computed) | amount_excl_vat | amount_incl_vat

function DieselLineItemsEditor({ items, onChange, vatApplicable = true, subbies = [] }) {
  const vatMult = vatApplicable ? 1.15 : 1
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
  const totalLitres = items.reduce((s, li) => s + (parseFloat(li.quantity) || 0), 0)
  const totalExcl = items.reduce((s, li) => s + (parseFloat(li.amount_excl_vat) || 0), 0)
  const totalIncl = items.reduce((s, li) => s + (parseFloat(li.amount_incl_vat) || 0), 0)

  return (
    <div style={{ marginTop: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={liStyles.th}>Invoice #</th>
            <th style={liStyles.th}>Vehicle Reg</th>
            <th style={liStyles.th}>Subbie Name</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Litres</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Rate/L</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Excl. VAT</th>
            <th style={{ ...liStyles.th, textAlign: 'right' }}>Incl. VAT</th>
            <th style={liStyles.th} />
          </tr>
        </thead>
        <tbody>
          {items.map((li, idx) => (
            <tr key={li._key ?? li.id ?? idx} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={liStyles.td}>
                <input value={li.item_code ?? ''} placeholder="e.g. TM1794"
                  onChange={e => updateLine(idx, 'item_code', e.target.value)}
                  style={{ ...liStyles.input, minWidth: 90 }} />
              </td>
              <td style={liStyles.td}>
                <input value={li.unit ?? ''} placeholder="e.g. DDM652NC"
                  onChange={e => updateLine(idx, 'unit', e.target.value.toUpperCase())}
                  style={{ ...liStyles.input, minWidth: 100, textTransform: 'uppercase' }} />
              </td>
              <td style={liStyles.td}>
                {subbies.length > 0 ? (
                  <SearchableSelect
                    value={li.item_description ?? ''}
                    onChange={v => updateLine(idx, 'item_description', v)}
                    options={[{ id: '', name: '' }, ...subbies]}
                    getValue={s => s.name}
                    getLabel={s => s.name || '— None —'}
                    placeholder="Subbie name…"
                    style={{ width: 140 }}
                    formInput
                  />
                ) : (
                  <input value={li.item_description ?? ''} placeholder="Subbie name…"
                    onChange={e => updateLine(idx, 'item_description', e.target.value)}
                    style={{ ...liStyles.input, minWidth: 120 }} />
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
            <th style={liStyles.th}>Invoice #</th>
            <th style={liStyles.th}>Vehicle Reg</th>
            <th style={liStyles.th}>Subbie Name</th>
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
                <td style={{ ...liStyles.td, fontWeight: 600 }}>{li.item_code || '—'}</td>
                <td style={liStyles.td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{li.unit || '—'}</span></td>
                <td style={{ ...liStyles.td, color: 'var(--text-muted)' }}>{li.item_description || '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right' }}>{litres ? `${litres.toFixed(1)}L` : '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>{rate != null ? rate.toFixed(4) : '—'}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>R {excl.toFixed(2)}</td>
                <td style={{ ...liStyles.td, textAlign: 'right', fontFamily: 'monospace' }}>R {parseFloat(li.amount_incl_vat ?? 0).toFixed(2)}</td>
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
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>R {totalExcl.toFixed(2)}</td>
            <td style={{ ...liStyles.td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>R {parseFloat(total ?? 0).toFixed(2)}</td>
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
