import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getSuppliers, getEntities, createSupplierBulk, updateSupplier, deleteSupplier, permanentlyDeleteSupplier } from '../services/api'
import { errorMessage, formatDate } from '../utils/helpers'
import toast from 'react-hot-toast'
import { Plus, Search, Edit2, Trash2, User, X, Copy, AlertCircle } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { usePendingInvoices } from '../hooks/usePendingInvoices'
import PendingInvoicesModal from '../components/PendingInvoicesModal'
import DeleteModal from '../components/DeleteModal'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

export default function SuppliersPage() {
  const { isAdmin } = useAuth()
  const [suppliers, setSuppliers] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterEntity, setFilterEntity] = useEntityFilter()
  const [modal, setModal] = useState(null) // null | { mode: 'create'|'edit', supplier?: {} }
  const [showPending, setShowPending] = useState(false)
  const pending = usePendingInvoices(isAdmin)
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
    getSuppliers(params)
      .then(r => { if (loadSeqRef.current === seq) setSuppliers(r.data) })
      .finally(() => { if (loadSeqRef.current === seq) setLoading(false) })
  }, [filterEntity, debouncedSearch])

  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  const { sort, onSort } = useSort('name', 'asc')
  const sortedSuppliers = useMemo(() => applySort(suppliers, sort), [suppliers, sort])

  const openCreate = () => setModal({ mode: 'create' })
  const openEdit = (supplier) => setModal({ mode: 'edit', supplier })
  const closeModal = () => setModal(null)

  const handleSave = async (formData) => {
    try {
      if (modal.mode === 'create') {
        await createSupplierBulk(formData)
        const count = formData.entity_ids.length
        toast.success(`Supplier created for ${count} entit${count === 1 ? 'y' : 'ies'}`)
      } else {
        const { copyEntityIds, ...updateData } = formData
        await updateSupplier(modal.supplier.id, updateData)
        if (copyEntityIds?.length > 0) {
          await createSupplierBulk({ entity_ids: copyEntityIds, ...updateData })
          toast.success(`Supplier updated and copied to ${copyEntityIds.length} entit${copyEntityIds.length === 1 ? 'y' : 'ies'}`)
        } else {
          toast.success('Supplier updated')
        }
      }
      closeModal()
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const [deleteTarget, setDeleteTarget] = useState(null)
  const handleDelete = (supplier) => setDeleteTarget(supplier)

  const entityName = (id) => entities.find(e => e.id === id)?.name || '—'
  const entityCode = (id) => entities.find(e => e.id === id)?.code || ''

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-subtitle">{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && pending.count > 0 && (
            <button
              className="btn-secondary"
              onClick={() => setShowPending(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'var(--warning)', color: 'var(--warning)' }}
              title="Recently-created supplier invoices not yet final-locked"
            >
              <AlertCircle size={15} /> {pending.count} to verify
            </button>
          )}
          <ExportButton
            title="Suppliers Report"
            filename="suppliers"
            data={suppliers}
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
          <button className="btn-primary" onClick={openCreate}>
            <Plus size={15} /> New Supplier
          </button>
        </div>
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
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 180 }}>
            <option value="">All Entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <SortableHeader label="Name" col="name" sort={sort} onSort={onSort} />
              <SortableHeader label="Payment Term" col="payment_term" sort={sort} onSort={onSort} />
              <SortableHeader label="Contact Person" col="contact_person" sort={sort} onSort={onSort} />
              <SortableHeader label="Email" col="email" sort={sort} onSort={onSort} />
              <th>Phone</th>
              <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={onSort} />
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : sortedSuppliers.length === 0 ? (
              <tr><td colSpan={7}>
                <div className="empty-state"><User size={32} /><p>No suppliers found</p></div>
              </td></tr>
            ) : sortedSuppliers.map(supplier => (
              <tr key={supplier.id}>
                <td>
                  <Link to={`/suppliers/${supplier.id}`} style={{ fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
                    {supplier.name}
                  </Link>
                  {supplier.trading_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{supplier.trading_name}</div>}
                  {supplier.is_diesel_supplier && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#d97706', background: 'rgba(234,179,8,0.12)', padding: '1px 6px', borderRadius: 4, marginTop: 3, display: 'inline-block' }}>
                      Diesel
                    </span>
                  )}
                </td>
                <td>
                  <PaymentTermBadge term={supplier.payment_term} />
                </td>
                <td>{supplier.contact_person || '—'}</td>
                <td>{supplier.email || '—'}</td>
                <td>{supplier.phone || '—'}</td>
                <td>
                  <span style={styles.entityChip}>{entityCode(supplier.entity_id)}</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-icon btn-ghost" onClick={() => openEdit(supplier)} title="Edit">
                      <Edit2 size={13} />
                    </button>
                    <button className="btn-icon btn-ghost" onClick={() => handleDelete(supplier)} title="Delete">
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

      {showPending && (
        <PendingInvoicesModal
          invoices={pending.invoices}
          loading={pending.loading}
          onClose={() => setShowPending(false)}
        />
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Supplier"
        description={deleteTarget ? `"${deleteTarget.name}"` : ''}
        onArchive={async () => {
          try { await deleteSupplier(deleteTarget.id); toast.success('Supplier deactivated'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
        onDelete={async () => {
          try { await permanentlyDeleteSupplier(deleteTarget.id); toast.success('Supplier permanently deleted'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

function PaymentTermBadge({ term }) {
  const is30 = term === '30_days'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      background: is30 ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
      color: is30 ? '#d97706' : '#16a34a',
    }}>
      {is30 ? '30 Days' : 'Current / Cash'}
    </span>
  )
}

function MultiEntitySelect({ entities, selected, onChange }) {
  const [open, setOpen] = useState(false)

  const toggle = (id) => {
    onChange(
      selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
    )
  }

  const label =
    selected.length === 0
      ? 'Select entities…'
      : selected.length === entities.length
      ? 'All entities selected'
      : entities
          .filter(e => selected.includes(e.id))
          .map(e => e.name)
          .join(', ')

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: selected.length === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
          fontSize: 13,
          cursor: 'pointer',
          textAlign: 'left',
          gap: 8,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span style={{ flexShrink: 0, opacity: 0.5, fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {entities.filter(e => selected.includes(e.id)).map(e => (
            <span key={e.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'var(--accent-dim)', color: 'var(--accent)',
              fontSize: 11, fontWeight: 600, padding: '2px 8px 2px 10px',
              borderRadius: 999,
            }}>
              {e.name}
              <button
                type="button"
                onClick={() => toggle(e.id)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 13 }}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            zIndex: 20, marginTop: 4,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            overflow: 'hidden',
          }}>
            {entities.map(e => {
              const checked = selected.includes(e.id)
              return (
                <div
                  key={e.id}
                  onClick={() => toggle(e.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                    background: checked ? 'var(--accent-dim)' : 'transparent',
                    color: checked ? 'var(--accent)' : 'var(--text-primary)',
                  }}
                  onMouseEnter={e2 => { if (!checked) e2.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e2 => { if (!checked) e2.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                    background: checked ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff',
                  }}>
                    {checked && '✓'}
                  </span>
                  {e.name}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function SupplierModal({ mode, supplier, entities, onSave, onClose }) {
  const [copyMode, setCopyMode] = useState(false)
  const [copyEntityIds, setCopyEntityIds] = useState([])

  const [form, setForm] = useState({
    entity_ids: [],
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
    payment_term: supplier?.payment_term || 'current',
    is_diesel_supplier: supplier?.is_diesel_supplier || false,
    is_intercompany: supplier?.is_intercompany || false,
    requires_registration: supplier?.requires_registration !== false,
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (mode === 'create' && form.entity_ids.length === 0) {
      toast.error('Select at least one entity')
      return
    }
    setSaving(true)
    // Clear reg number when supplier doesn't require one
    const cleanedForm = {
      ...form,
      registration_number: form.requires_registration ? form.registration_number : '',
    }
    if (mode === 'create') {
      const { entity_id, entity_ids, ...fields } = cleanedForm
      await onSave({ entity_ids, ...fields })
    } else {
      const { entity_id, entity_ids, ...fields } = cleanedForm
      await onSave({ ...fields, entity_id: parseInt(entity_id), copyEntityIds: copyMode ? copyEntityIds : [] })
    }
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
              <label>Business Entities *</label>
              {mode === 'create' ? (
                <MultiEntitySelect
                  entities={entities}
                  selected={form.entity_ids}
                  onChange={ids => set('entity_ids', ids)}
                />
              ) : (
                <>
                  <select value={form.entity_id} onChange={e => set('entity_id', e.target.value)} required>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>

                  {/* Copy to other entities */}
                  {entities.filter(e => e.id !== parseInt(form.entity_id)).length > 0 && (
                    <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => { setCopyMode(m => !m); setCopyEntityIds([]) }}
                      >
                        <span style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          border: `1.5px solid ${copyMode ? 'var(--accent)' : 'var(--border)'}`,
                          background: copyMode ? 'var(--accent)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, color: '#fff',
                        }}>
                          {copyMode && '✓'}
                        </span>
                        <Copy size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>Copy this supplier to other entities</span>
                      </div>

                      {copyMode && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                            Select which entities to copy to:
                          </div>
                          <MultiEntitySelect
                            entities={entities.filter(e => e.id !== parseInt(form.entity_id))}
                            selected={copyEntityIds}
                            onChange={setCopyEntityIds}
                          />
                          {copyEntityIds.length > 0 && (
                            <div style={{ fontSize: 12, marginTop: 8, padding: '6px 10px', background: 'var(--accent-dim)', borderRadius: 6, color: 'var(--accent)' }}>
                              A copy of this supplier will be created for {copyEntityIds.length} entit{copyEntityIds.length === 1 ? 'y' : 'ies'} when you save.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
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
            <div className="form-group">
              <label>Payment Terms *</label>
              <select value={form.payment_term} onChange={e => set('payment_term', e.target.value)}>
                <option value="current">Current / Cash</option>
                <option value="30_days">30 Days</option>
              </select>
            </div>
            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <input
                type="checkbox"
                id="is_diesel_supplier"
                checked={form.is_diesel_supplier}
                onChange={e => set('is_diesel_supplier', e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
              />
              <label htmlFor="is_diesel_supplier" style={{ margin: 0, cursor: 'pointer', fontWeight: 500 }}>
                Diesel supplier — appears in diesel rate management
              </label>
            </div>
            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <input
                type="checkbox"
                id="is_intercompany"
                checked={form.is_intercompany}
                onChange={e => set('is_intercompany', e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
              />
              <label htmlFor="is_intercompany" style={{ margin: 0, cursor: 'pointer', fontWeight: 500 }}>
                Intercompany — grouped separately on the SARS/VAT report
              </label>
            </div>
            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <input
                type="checkbox"
                id="requires_registration"
                checked={form.requires_registration}
                onChange={e => set('requires_registration', e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
              />
              <label htmlFor="requires_registration" style={{ margin: 0, cursor: 'pointer', fontWeight: 500 }}>
                Has company registration number
              </label>
            </div>
            <div className="form-row">
              {form.requires_registration && (
                <div className="form-group">
                  <label>Registration No.</label>
                  <input
                    value={form.registration_number}
                    onChange={e => set('registration_number', e.target.value)}
                    placeholder="e.g. 2003/012345/07"
                  />
                </div>
              )}
              <div className="form-group">
                <label>VAT Number</label>
                <input value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="e.g. 4720123456" />
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
  page: { padding: 'var(--page-pad)', flex: 1 },
  filters: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' },
  entityChip: {
    background: 'var(--accent-dim)', color: 'var(--accent)',
    fontSize: 10, fontWeight: 700, padding: '2px 7px',
    borderRadius: 4, letterSpacing: 0.5,
  },
}