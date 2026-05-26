import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInvoiceTemplates, getEntities, deleteInvoiceTemplate, cloneInvoiceTemplatePayload } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { Plus, Copy, Edit2, Trash2, Search, X, LayoutTemplate } from 'lucide-react'
import DeleteModal from '../components/DeleteModal'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

const DOC_TYPE_PATH = {
  invoice:        'invoices',
  quote:          'quotes',
  purchase_order: 'purchase-orders',
}

function DocTypeBadge({ type }) {
  if (type === 'quote')          return <span className="badge badge-quote">Quote</span>
  if (type === 'purchase_order') return <span className="badge" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>PO</span>
  return <span className="badge badge-invoice">Invoice</span>
}

export default function InvoiceTemplatesPage() {
  const { activeEntity, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEntity, setFilterEntity] = useState(activeEntity?.id?.toString() || '')
  const [filterDocType, setFilterDocType] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [cloningId, setCloningId] = useState(null)
  const loadSeqRef = useRef(0)

  const load = useCallback(() => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    const params = {}
    if (filterEntity) params.entity_id = filterEntity
    if (filterDocType) params.document_type = filterDocType
    getInvoiceTemplates(params)
      .then(r => { if (loadSeqRef.current === seq) setTemplates(r.data) })
      .finally(() => { if (loadSeqRef.current === seq) setLoading(false) })
  }, [filterEntity, filterDocType])

  useEffect(() => { setFilterEntity(activeEntity?.id?.toString() || '') }, [activeEntity])
  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  const { sort, onSort } = useSort('name', 'asc')

  const displayed = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q
      ? templates.filter(t =>
          t.name.toLowerCase().includes(q) ||
          (t.supplier?.name || t.customer?.name || '').toLowerCase().includes(q)
        )
      : templates
    return applySort(filtered, sort, (item, col) => {
      if (col === 'entity') return item.entity?.code || ''
      if (col === 'recipient') return item.supplier?.name || item.customer?.name || ''
      return item[col]
    })
  }, [templates, search, sort])

  const handleClone = async (tmpl) => {
    setCloningId(tmpl.id)
    try {
      const res = await cloneInvoiceTemplatePayload(tmpl.id)
      const payload = res.data
      const path = DOC_TYPE_PATH[payload.document_type] || 'invoices'
      navigate(`/${path}/new`, { state: { templatePayload: payload } })
    } catch {
      toast.error('Failed to clone template')
    } finally {
      setCloningId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteInvoiceTemplate(deleteTarget.id)
      toast.success('Template deleted')
      setDeleteTarget(null)
      load()
    } catch {
      toast.error('Failed to delete template')
    }
  }

  return (
    <div style={{ padding: '20px 28px', flex: 1 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoice Templates</h1>
          <p className="page-subtitle">{templates.length} template{templates.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/invoice-templates/new')}>
          <Plus size={15} /> New Template
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <Search size={14} />
          <input
            placeholder="Search templates..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="btn-icon" style={{ padding: 2 }} onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 190 }}>
            <option value="">All Entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
          </select>
        )}
        <select value={filterDocType} onChange={e => setFilterDocType(e.target.value)} style={{ width: 150 }}>
          <option value="">All Types</option>
          <option value="invoice">Invoice</option>
          <option value="quote">Quote</option>
          <option value="purchase_order">Purchase Order</option>
        </select>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <SortableHeader col="name" label="Template Name" sort={sort} onSort={onSort} />
              <SortableHeader col="entity" label="Entity" sort={sort} onSort={onSort} style={{ width: 90 }} />
              <SortableHeader col="document_type" label="Type" sort={sort} onSort={onSort} style={{ width: 120 }} />
              <SortableHeader col="recipient" label="Bill To" sort={sort} onSort={onSort} />
              <th style={{ width: 70 }}>Lines</th>
              <th style={{ width: 110 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 40 }}>
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </td>
              </tr>
            ) : displayed.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <LayoutTemplate size={32} />
                    <p>{search || filterDocType ? 'No templates match your filters' : 'No templates yet'}</p>
                    {!search && !filterDocType && (
                      <button className="btn-primary btn-sm" onClick={() => navigate('/invoice-templates/new')}>
                        <Plus size={13} /> Create template
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : displayed.map(tmpl => {
              const recipient = tmpl.supplier?.name || tmpl.customer?.name || '—'
              return (
                <tr key={tmpl.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{tmpl.name}</div>
                    {tmpl.notes && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tmpl.notes}
                      </div>
                    )}
                  </td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 7px', borderRadius: 4 }}>
                      {tmpl.entity?.code || '—'}
                    </span>
                  </td>
                  <td><DocTypeBadge type={tmpl.document_type} /></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{recipient}</td>
                  <td style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                    {tmpl.line_items?.length || 0}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn-icon btn-ghost"
                        title={cloningId === tmpl.id ? 'Cloning…' : 'Clone to new invoice'}
                        disabled={cloningId === tmpl.id}
                        onClick={() => handleClone(tmpl)}
                        style={{ color: 'var(--accent)' }}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="btn-icon btn-ghost"
                        title="Edit template"
                        onClick={() => navigate(`/invoice-templates/${tmpl.id}/edit`)}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        className="btn-icon btn-ghost"
                        title="Delete template"
                        onClick={() => setDeleteTarget(tmpl)}
                      >
                        <Trash2 size={13} color="var(--danger)" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Template"
        description={deleteTarget ? `Delete template "${deleteTarget.name}"? This cannot be undone.` : ''}
        onArchive={handleDelete}
      />
    </div>
  )
}
