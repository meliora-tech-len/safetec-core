import { useState, useEffect, useCallback } from 'react'
import { getSuppliers, getEntities, createSupplier, updateSupplier, deleteSupplier } from '../services/api'
import { errorMessage, formatDate } from '../utils/helpers'
import toast from 'react-hot-toast'
import { Plus, Search, Edit2, Trash2, User, X, Building2 } from 'lucide-react'

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [modal, setModal] = useState(null) // null | { mode: 'create'|'edit', supplier?: {} }

  const load = useCallback(() => {
    setLoading(true)
    const params = {}
    if (filterEntity) params.entity_id = filterEntity
    if (search) params.search = search
    getSuppliers(params).then(r => setSuppliers(r.data)).finally(() => setLoading(false))
  }, [filterEntity, search])

  useEffect(() => { load() }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  const openCreate = () => setModal({ mode: 'create' })
  const openEdit = (supplier) => setModal({ mode: 'edit', supplier })
  const closeModal = () => setModal(null)

  const handleSave = async (formData) => {
    try {
      if (modal.mode === 'create') {
        await createSupplier(formData)
        toast.success('Supplier created')
      } else {
        await updateSupplier(modal.supplier.id, formData)
        toast.success('Supplier updated')
      }
      closeModal()
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const handleDelete = async (supplier) => {
    if (!confirm(`Deactivate "${supplier.name}"?`)) return
    try {
      await deleteSupplier(supplier.id)
      toast.success('Supplier deactivated')
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const entityName = (id) => entities.find(e => e.id === id)?.name || '—'
  const entityCode = (id) => entities.find(e => e.id === id)?.code || ''

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-subtitle">{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={15} /> New Supplier
        </button>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <Search size={14} />
          <input
            placeholder="Search suppliers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="btn-icon" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 180 }}>
          <option value="">All Entities</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact Person</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Entity</th>
              <th>Created</th>
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={7}>
                <div className="empty-state"><User size={32} /><p>No suppliers found</p></div>
              </td></tr>
            ) : suppliers.map(supplier => (
              <tr key={supplier.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{supplier.name}</div>
                  {supplier.trading_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{supplier.trading_name}</div>}
                </td>
                <td>{supplier.contact_person || '—'}</td>
                <td>{supplier.email || '—'}</td>
                <td>{supplier.phone || '—'}</td>
                <td>
                  <span style={styles.entityChip}>{entityCode(supplier.entity_id)}</span>
                </td>
                <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(supplier.created_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-icon btn-ghost" onClick={() => openEdit(supplier)} title="Edit">
                      <Edit2 size={13} />
                    </button>
                    <button className="btn-icon btn-ghost" onClick={() => handleDelete(supplier)} title="Deactivate">
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
        <SupplierModal
          mode={modal.mode}
          supplier={modal.supplier}
          entities={entities}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

function SupplierModal({ mode, supplier, entities, onSave, onClose }) {
  const [form, setForm] = useState({
    entity_id: supplier?.entity_id || (entities[0]?.id || ''),
    name: supplier?.name || '',
    trading_name: supplier?.trading_name || '',
    registration_number: supplier?.registration_number || '',
    vat_number: supplier?.vat_number || '',
    contact_person: supplier?.contact_person || '',
    email: supplier?.email || '',
    phone: supplier?.phone || '',
    address: supplier?.address || '',
    city: supplier?.city || '',
    postal_code: supplier?.postal_code || '',
    notes: supplier?.notes || '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    await onSave({ ...form, entity_id: parseInt(form.entity_id) })
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>{mode === 'create' ? 'New Supplier' : 'Edit Supplier'}</h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Business Entity *</label>
              <select value={form.entity_id} onChange={e => set('entity_id', e.target.value)} required>
                <option value="">Select entity...</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Company / Supplier Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} required placeholder="Registered company name" />
              </div>
              <div className="form-group">
                <label>Trading Name</label>
                <input value={form.trading_name} onChange={e => set('trading_name', e.target.value)} placeholder="If different from above" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Registration No.</label>
                <input value={form.registration_number} onChange={e => set('registration_number', e.target.value)} />
              </div>
              <div className="form-group">
                <label>VAT Number</label>
                <input value={form.vat_number} onChange={e => set('vat_number', e.target.value)} />
              </div>
            </div>
            <hr />
            <div className="form-row">
              <div className="form-group">
                <label>Contact Person</label>
                <input value={form.contact_person} onChange={e => set('contact_person', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Phone</label>
                <input value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div className="form-group">
                <label>City</label>
                <input value={form.city} onChange={e => set('city', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Address</label>
              <textarea value={form.address} onChange={e => set('address', e.target.value)} rows={2} />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : mode === 'create' ? 'Create Supplier' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const styles = {
  page: { padding: '28px 32px', flex: 1 },
  filters: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' },
  entityChip: {
    background: 'var(--accent-dim)', color: 'var(--accent)',
    fontSize: 10, fontWeight: 700, padding: '2px 7px',
    borderRadius: 4, letterSpacing: 0.5,
  },
}
