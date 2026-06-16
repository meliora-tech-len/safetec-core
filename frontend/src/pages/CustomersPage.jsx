import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getCustomers, getEntities, createCustomer, updateCustomer, deleteCustomer, permanentlyDeleteCustomer } from '../services/api'
import { errorMessage, formatDate } from '../utils/helpers'
import toast from 'react-hot-toast'
import { Plus, Search, Edit2, Trash2, UserCheck, X } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import DeleteModal from '../components/DeleteModal'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

const BLANK = {
  entity_id: '',
  name: '',
  trading_name: '',
  contact_person: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  postal_code: '',
  vat_number: '',
  registration_number: '',
  notes: '',
}

export default function CustomersPage() {
  const { activeEntity, isAdmin } = useAuth()
  const [customers, setCustomers] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterEntity, setFilterEntity] = useEntityFilter()
  const [modal, setModal] = useState(null) // null | { mode: 'create'|'edit', customer?: {} }
  const [deleteTarget, setDeleteTarget] = useState(null)
  const loadSeqRef = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    const params = {}
    if (filterEntity) params.entity_id = filterEntity
    if (debouncedSearch) params.search = debouncedSearch
    getCustomers(params)
      .then(r => { if (loadSeqRef.current === seq) setCustomers(r.data) })
      .finally(() => { if (loadSeqRef.current === seq) setLoading(false) })
  }, [filterEntity, debouncedSearch])

  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  const entityCode = (id) => entities.find(e => e.id === id)?.code || ''

  const { sort, onSort } = useSort('name', 'asc')
  const sortedCustomers = useMemo(() => applySort(customers, sort), [customers, sort])

  const handleSave = async (formData) => {
    try {
      if (modal.mode === 'create') {
        await createCustomer({ ...formData, entity_id: parseInt(formData.entity_id) })
        toast.success('Customer created')
      } else {
        await updateCustomer(modal.customer.id, formData)
        toast.success('Customer updated')
      }
      setModal(null)
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">{customers.length} customer{customers.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title="Customers Report"
            filename="customers"
            data={customers}
            columns={[
              { header: 'Name',                key: 'name' },
              { header: 'Trading Name',        key: 'trading_name' },
              { header: 'Contact Person',      key: 'contact_person' },
              { header: 'Email',               key: 'email' },
              { header: 'Phone',               key: 'phone' },
              { header: 'City',                key: 'city' },
              { header: 'Entity',              value: r => entityCode(r.entity_id) },
              { header: 'Reg No.',             key: 'registration_number' },
              { header: 'VAT No.',             key: 'vat_number' },
              { header: 'Created',             value: r => formatDate(r.created_at) },
            ]}
          />
          <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={15} /> New Customer
          </button>
        </div>
      </div>

      <div style={styles.filters}>
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <Search size={14} />
          <input
            placeholder="Search customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="btn-icon" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 180 }}>
            <option value="">All Entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <SortableHeader label="Name" col="name" sort={sort} onSort={onSort} />
              <SortableHeader label="Contact Person" col="contact_person" sort={sort} onSort={onSort} />
              <SortableHeader label="Email" col="email" sort={sort} onSort={onSort} />
              <th>Phone</th>
              <SortableHeader label="City" col="city" sort={sort} onSort={onSort} />
              <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={onSort} />
              <SortableHeader label="Created" col="created_at" sort={sort} onSort={onSort} />
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : sortedCustomers.length === 0 ? (
              <tr><td colSpan={8}>
                <div className="empty-state"><UserCheck size={32} /><p>No customers found</p></div>
              </td></tr>
            ) : sortedCustomers.map(customer => (
              <tr key={customer.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{customer.name}</div>
                  {customer.trading_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{customer.trading_name}</div>}
                </td>
                <td>{customer.contact_person || '—'}</td>
                <td>{customer.email || '—'}</td>
                <td>{customer.phone || '—'}</td>
                <td>{customer.city || '—'}</td>
                <td>
                  <span style={styles.entityChip}>{entityCode(customer.entity_id)}</span>
                </td>
                <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(customer.created_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-icon btn-ghost" onClick={() => setModal({ mode: 'edit', customer })} title="Edit">
                      <Edit2 size={13} />
                    </button>
                    <button className="btn-icon btn-ghost" onClick={() => setDeleteTarget(customer)} title="Delete">
                      <Trash2 size={13} color="var(--danger)" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <CustomerModal
          mode={modal.mode}
          customer={modal.customer}
          entities={entities}
          activeEntity={activeEntity}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Customer"
        description={deleteTarget ? `"${deleteTarget.name}"` : ''}
        onArchive={async () => {
          try { await deleteCustomer(deleteTarget.id); toast.success('Customer deactivated'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
        onDelete={async () => {
          try { await permanentlyDeleteCustomer(deleteTarget.id); toast.success('Customer permanently deleted'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

function CustomerModal({ mode, customer, entities, activeEntity, onSave, onClose }) {
  const defaultEntityId = customer?.entity_id?.toString() || activeEntity?.id?.toString() || ''
  const [form, setForm] = useState({
    ...BLANK,
    ...(customer || {}),
    entity_id: defaultEntityId,
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.name.trim()) return
    if (!form.entity_id) return
    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{mode === 'create' ? 'New Customer' : 'Edit Customer'}</span>
          <button onClick={onClose} style={styles.closeBtn}><X size={17} /></button>
        </div>

        <div style={styles.modalBody}>
          <div className="form-row">
            <div>
              <label className="form-label">Entity *</label>
              <select className="form-input" value={form.entity_id} onChange={e => set('entity_id', e.target.value)} disabled={mode === 'edit'}>
                <option value="">Select entity...</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="form-label">Name *</label>
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Customer name" autoFocus />
            </div>
            <div>
              <label className="form-label">Trading Name</label>
              <input className="form-input" value={form.trading_name || ''} onChange={e => set('trading_name', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="form-label">Contact Person</label>
              <input className="form-input" value={form.contact_person || ''} onChange={e => set('contact_person', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input className="form-input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div style={{ flex: 2 }}>
              <label className="form-label">Address</label>
              <input className="form-input" value={form.address || ''} onChange={e => set('address', e.target.value)} />
            </div>
            <div>
              <label className="form-label">City</label>
              <input className="form-input" value={form.city || ''} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Postal Code</label>
              <input className="form-input" value={form.postal_code || ''} onChange={e => set('postal_code', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="form-label">VAT Number</label>
              <input className="form-input" value={form.vat_number || ''} onChange={e => set('vat_number', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Registration Number</label>
              <input className="form-input" value={form.registration_number || ''} onChange={e => set('registration_number', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={3} value={form.notes || ''} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} />
          </div>
        </div>

        <div style={styles.modalFooter}>
          <button className="btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={handleSubmit} disabled={saving || !form.name.trim() || !form.entity_id}>
            {saving ? 'Saving…' : mode === 'create' ? 'Create Customer' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: { padding: '20px 28px', flex: 1 },
  filters: { display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' },
  entityChip: { fontSize: 11, fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 7px', borderRadius: 4 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 0, width: '100%', maxWidth: 680, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border)' },
  modalBody: { padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border)' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex' },
}
