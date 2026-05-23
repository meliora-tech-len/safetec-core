import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getSuppliers, getEntities, createSupplierBulk, updateSupplier } from '../services/api'
import { errorMessage, formatDate } from '../utils/helpers'
import toast from 'react-hot-toast'
import { Plus, Search, Edit2, Users, X } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import { useAuth } from '../hooks/useAuth'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

/**
 * Clients — a billing-focused view of the suppliers table.
 * Same data, surfaced separately because "clients" = who you invoice,
 * "suppliers" = who you purchase from (even if the same party can be both).
 */
export default function ClientsPage() {
  const { activeEntity, isAdmin } = useAuth()
  const [clients, setClients]   = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterEntity, setFilterEntity] = useState(activeEntity?.id?.toString() || '')
  const [modal, setModal]       = useState(null)
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
      .then(r => { if (loadSeqRef.current === seq) setClients(r.data) })
      .finally(() => { if (loadSeqRef.current === seq) setLoading(false) })
  }, [filterEntity, debouncedSearch])

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])
  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  const entityCode = (id) => entities.find(e => e.id === id)?.code || ''
  const entityName = (id) => entities.find(e => e.id === id)?.name || '—'

  const { sort, onSort } = useSort('name', 'asc')
  const sortedClients = useMemo(() => applySort(clients, sort), [clients, sort])

  const handleSave = async (formData) => {
    try {
      if (modal.mode === 'create') {
        await createSupplierBulk(formData)
        toast.success('Client created')
      } else {
        await updateSupplier(modal.client.id, formData)
        toast.success('Client updated')
      }
      setModal(null)
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title="Clients Report"
            filename="clients"
            data={clients}
            columns={[
              { header: 'Name',           key: 'name' },
              { header: 'Trading Name',   key: 'trading_name' },
              { header: 'Contact Person', key: 'contact_person' },
              { header: 'Email',          key: 'email' },
              { header: 'Phone',          key: 'phone' },
              { header: 'City',           key: 'city' },
              { header: 'Entity',         value: r => entityCode(r.entity_id) },
              { header: 'Reg No.',        key: 'registration_number' },
              { header: 'VAT No.',        key: 'vat_number' },
              { header: 'Created',        value: r => formatDate(r.created_at) },
            ]}
          />
          <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={15} /> New Client
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <Search size={14} />
          <input
            placeholder="Search clients..."
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
              <SortableHeader label="Contact Person" col="contact_person" sort={sort} onSort={onSort} />
              <SortableHeader label="Email" col="email" sort={sort} onSort={onSort} />
              <th>Phone</th>
              <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={onSort} />
              <SortableHeader label="Created" col="created_at" sort={sort} onSort={onSort} />
              <th style={{ width: 60 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : sortedClients.length === 0 ? (
              <tr><td colSpan={7}>
                <div className="empty-state"><Users size={32} /><p>No clients found</p></div>
              </td></tr>
            ) : sortedClients.map(client => (
              <tr key={client.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{client.name}</div>
                  {client.trading_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{client.trading_name}</div>}
                </td>
                <td>{client.contact_person || '—'}</td>
                <td>{client.email || '—'}</td>
                <td>{client.phone || '—'}</td>
                <td>
                  <span style={{ background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.5 }}>
                    {entityCode(client.entity_id)}
                  </span>
                </td>
                <td className="text-muted" style={{ fontSize: 12 }}>{formatDate(client.created_at)}</td>
                <td>
                  <button className="btn-icon btn-ghost" onClick={() => setModal({ mode: 'edit', client })} title="Edit">
                    <Edit2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <ClientModal
          mode={modal.mode}
          client={modal.client}
          entities={entities}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function ClientModal({ mode, client, entities, onSave, onClose }) {
  const [form, setForm] = useState({
    entity_ids: entities.map(e => e.id),
    entity_id:  client?.entity_id || (entities[0]?.id || ''),
    name:               client?.name               || '',
    trading_name:       client?.trading_name       || '',
    registration_number:client?.registration_number|| '',
    vat_number:         client?.vat_number         || '',
    contact_person:     client?.contact_person     || '',
    email:              client?.email              || '',
    phone:              client?.phone              || '',
    address:            client?.address            || '',
    city:               client?.city               || '',
    notes:              client?.notes              || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    if (mode === 'create') {
      const { entity_id, entity_ids, ...fields } = form
      await onSave({ entity_ids, ...fields })
    } else {
      const { entity_id, entity_ids, ...fields } = form
      await onSave({ ...fields, entity_id: parseInt(entity_id) })
    }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>{mode === 'create' ? 'New Client' : 'Edit Client'}</h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Entity *</label>
              {mode === 'create' ? (
                <select value={form.entity_ids[0] || ''} onChange={e => set('entity_ids', [Number(e.target.value)])} required>
                  <option value="">Select entity…</option>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              ) : (
                <select value={form.entity_id} onChange={e => set('entity_id', e.target.value)} required>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Client Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Trading Name</label>
                <input value={form.trading_name} onChange={e => set('trading_name', e.target.value)} />
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
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : mode === 'create' ? 'Create Client' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
