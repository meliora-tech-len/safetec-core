import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSubcontractors, getSubcontractorFinancialSummary, getEntities, createSubcontractorBulk, updateSubcontractor, deleteSubcontractor, permanentlyDeleteSubcontractor } from '../services/api'
import { errorMessage, formatDate, formatCurrency } from '../utils/helpers'
import toast from 'react-hot-toast'
import { Plus, Search, Edit2, Trash2, Building2, X, Copy } from 'lucide-react'
import ExportButton from '../components/ExportButton'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import FinancialPeriodFilter, { defaultFinancialPeriod, financialPeriodLabel } from '../components/FinancialPeriodFilter'
import DeleteModal from '../components/DeleteModal'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

export default function SubcontractorsPage() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [subcontractors, setSubcontractors] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterEntity, setFilterEntity] = useEntityFilter()
  const [modal, setModal] = useState(null)
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
    getSubcontractors(params)
      .then(r => { if (loadSeqRef.current === seq) setSubcontractors(r.data) })
      .finally(() => { if (loadSeqRef.current === seq) setLoading(false) })
  }, [filterEntity, debouncedSearch])

  useEffect(() => { load(); return () => { loadSeqRef.current++ } }, [load])
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  // Income / Outgoing / Profit per subcontractor for the selected period.
  // Shares its session key with the Suppliers overview so flipping between the
  // two pages keeps the same view.
  const [finPeriod, setFinPeriod] = useSessionState('overview-fin-period', defaultFinancialPeriod)
  const [finSummary, setFinSummary] = useState(null)
  useEffect(() => {
    let cancelled = false
    setFinSummary(null)
    const params = { period: finPeriod.mode }
    if (finPeriod.mode !== 'lifetime') params.year = finPeriod.year
    if (finPeriod.mode === 'month') params.month = finPeriod.month
    if (filterEntity) params.entity_id = filterEntity
    getSubcontractorFinancialSummary(params)
      .then(r => {
        if (cancelled) return
        const map = {}
        for (const row of r.data) map[row.subcontractor_id] = row
        setFinSummary(map)
      })
      .catch(() => { if (!cancelled) setFinSummary({}) })
    return () => { cancelled = true }
  }, [filterEntity, finPeriod])

  const { sort, onSort } = useSort('name', 'asc', 'subcontractors')
  const enriched = useMemo(() => subcontractors.map(s => ({
    ...s,
    income_total: finSummary?.[s.id]?.income ?? 0,
    outgoing_total: finSummary?.[s.id]?.outgoing ?? 0,
    profit_total: finSummary?.[s.id]?.profit ?? 0,
  })), [subcontractors, finSummary])
  const sortedSubs = useMemo(() => applySort(enriched, sort), [enriched, sort])

  // When a reg was searched, carry it into the profile so it jumps to that truck.
  const regQuery = debouncedSearch.trim()
  const subLink = (sub) => `/subcontractors/${sub.id}${regQuery ? `?reg=${encodeURIComponent(regQuery)}` : ''}`

  // Enter in the search box opens the first match (jumping to the searched reg)
  const openFirstMatch = () => {
    const term = search.trim()
    if (!term || sortedSubs.length === 0) return
    navigate(`/subcontractors/${sortedSubs[0].id}?reg=${encodeURIComponent(term)}`)
  }

  const openCreate = () => setModal({ mode: 'create' })
  const openEdit   = (sub) => setModal({ mode: 'edit', sub })
  const closeModal = () => setModal(null)

  const handleSave = async (formData) => {
    try {
      if (modal.mode === 'create') {
        await createSubcontractorBulk(formData)
        const count = formData.entity_ids.length
        toast.success(`Subcontractor created for ${count} entit${count === 1 ? 'y' : 'ies'}`)
      } else {
        const { copyEntityIds, ...updateData } = formData
        await updateSubcontractor(modal.sub.id, updateData)
        if (copyEntityIds?.length > 0) {
          await createSubcontractorBulk({ entity_ids: copyEntityIds, ...updateData })
          toast.success(`Subcontractor updated and copied to ${copyEntityIds.length} entit${copyEntityIds.length === 1 ? 'y' : 'ies'}`)
        } else {
          toast.success('Subcontractor updated')
        }
      }
      closeModal()
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const [deleteTarget, setDeleteTarget] = useState(null)

  const entityCode = (id) => entities.find(e => e.id === id)?.code || ''

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Building2 size={22} style={{ color: 'var(--accent)' }} />
            Subcontractors
          </h1>
          <p className="page-subtitle">{subcontractors.length} subcontractor{subcontractors.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButton
            title={`Subcontractors — ${financialPeriodLabel(finPeriod)}`}
            filename="subcontractors"
            data={sortedSubs}
            columns={[
              { header: 'Name',           key: 'name' },
              { header: 'Trading Name',   key: 'trading_name' },
              { header: 'Contact Person', key: 'contact_person' },
              { header: 'Email',          key: 'email' },
              { header: 'Phone',          key: 'phone' },
              { header: 'Income',         value: r => formatCurrency(r.income_total) },
              { header: 'Outgoing',       value: r => formatCurrency(r.outgoing_total) },
              { header: 'Profit',         value: r => formatCurrency(r.profit_total) },
              { header: 'Entity',         value: r => entityCode(r.entity_id) },
              { header: 'Reg No.',        key: 'registration_number' },
              { header: 'VAT No.',        key: 'vat_number' },
            ]}
          />
          <button className="btn-primary" onClick={openCreate}>
            <Plus size={15} /> New Subcontractor
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <Search size={14} />
          <input
            placeholder="Search name or truck reg… (Enter to open)"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); openFirstMatch() } }}
          />
          {search && <button className="btn-icon" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        <FinancialPeriodFilter value={finPeriod} onChange={setFinPeriod} />
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
              <SortableHeader label="Income" col="income_total" sort={sort} onSort={onSort} style={{ textAlign: 'right' }} />
              <SortableHeader label="Outgoing" col="outgoing_total" sort={sort} onSort={onSort} style={{ textAlign: 'right' }} />
              <SortableHeader label="Profit" col="profit_total" sort={sort} onSort={onSort} style={{ textAlign: 'right' }} />
              <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={onSort} />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
            ) : sortedSubs.length === 0 ? (
              <tr><td colSpan={6}>
                <div className="empty-state"><Building2 size={32} /><p>No subcontractors found</p></div>
              </td></tr>
            ) : sortedSubs.map(sub => (
              <tr key={sub.id}>
                <td>
                  <Link to={subLink(sub)} style={{ fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
                    {sub.name}
                  </Link>
                  {sub.trading_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub.trading_name}</div>}
                  {sub.end_date && <div style={{ fontSize: 11, color: 'var(--warning, #b45309)' }}>Ends {formatDate(sub.end_date)}</div>}
                </td>
                <td style={styles.amountCell}>
                  {finSummary === null ? '…' : formatCurrency(sub.income_total)}
                </td>
                <td style={styles.amountCell}>
                  {finSummary === null ? '…' : formatCurrency(sub.outgoing_total)}
                </td>
                <td style={styles.amountCell}>
                  {finSummary === null ? '…' : (
                    <span style={{ color: sub.profit_total > 0 ? 'var(--success)' : sub.profit_total < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {formatCurrency(sub.profit_total)}
                    </span>
                  )}
                </td>
                <td><span style={styles.entityChip}>{entityCode(sub.entity_id)}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-icon btn-ghost" onClick={() => openEdit(sub)} title="Edit"><Edit2 size={13} /></button>
                    <button className="btn-icon btn-ghost" onClick={() => setDeleteTarget(sub)} title="Delete"><Trash2 size={13} color="var(--danger)" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <SubcontractorModal
          mode={modal.mode}
          sub={modal.sub}
          entities={entities}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Subcontractor"
        description={deleteTarget ? `"${deleteTarget.name}"` : ''}
        onArchive={async () => {
          try { await deleteSubcontractor(deleteTarget.id); toast.success('Subcontractor deactivated'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
        onDelete={async () => {
          try { await permanentlyDeleteSubcontractor(deleteTarget.id); toast.success('Subcontractor permanently deleted'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

// ── Multi-entity selector (same pattern as SuppliersPage) ─────────────────────
function MultiEntitySelect({ entities, selected, onChange }) {
  const [open, setOpen] = useState(false)

  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  const label =
    selected.length === 0 ? 'Select entities…'
    : selected.length === entities.length ? 'All entities selected'
    : entities.filter(e => selected.includes(e.id)).map(e => e.name).join(', ')

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 6, color: selected.length === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
          fontSize: 13, cursor: 'pointer', textAlign: 'left', gap: 8,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ flexShrink: 0, opacity: 0.5, fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {entities.filter(e => selected.includes(e.id)).map(e => (
            <span key={e.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'var(--accent-dim)', color: 'var(--accent)',
              fontSize: 11, fontWeight: 600, padding: '2px 8px 2px 10px', borderRadius: 999,
            }}>
              {e.name}
              <button type="button" onClick={() => toggle(e.id)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 13 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)', overflow: 'hidden',
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
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff',
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

// ── Subcontractor modal ───────────────────────────────────────────────────────
function SubcontractorModal({ mode, sub, entities, onSave, onClose }) {
  const [copyMode, setCopyMode]       = useState(false)
  const [copyEntityIds, setCopyEntityIds] = useState([])
  const [saving, setSaving]           = useState(false)

  const [form, setForm] = useState({
    entity_ids: [],
    entity_id:  sub?.entity_id || (entities[0]?.id || ''),
    name:                sub?.name                || '',
    trading_name:        sub?.trading_name        || '',
    contact_person:      sub?.contact_person      || '',
    email:               sub?.email               || '',
    phone:               sub?.phone               || '',
    registration_number: sub?.registration_number || '',
    vat_number:          sub?.vat_number          || '',
    notes:               sub?.notes               || '',
    end_date:            sub?.end_date            || '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (mode === 'create' && form.entity_ids.length === 0) {
      toast.error('Select at least one entity')
      return
    }
    setSaving(true)
    if (mode === 'create') {
      const { entity_id, entity_ids, end_date, ...fields } = form
      await onSave({ entity_ids, end_date: end_date || null, ...fields })
    } else {
      const { entity_id, entity_ids, end_date, ...fields } = form
      const clearing = !end_date && !!sub?.end_date
      await onSave({
        ...fields,
        entity_id: parseInt(entity_id),
        ...(end_date ? { end_date } : {}),
        ...(clearing ? { clear_end_date: true } : {}),
        copyEntityIds: copyMode ? copyEntityIds : [],
      })
    }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>{mode === 'create' ? 'New Subcontractor' : 'Edit Subcontractor'}</h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Business Entities *</label>
              {mode === 'create' ? (
                <MultiEntitySelect entities={entities} selected={form.entity_ids} onChange={ids => set('entity_ids', ids)} />
              ) : (
                <>
                  <select value={form.entity_id} onChange={e => set('entity_id', e.target.value)} required>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>

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
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff',
                        }}>
                          {copyMode && '✓'}
                        </span>
                        <Copy size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>Copy this subcontractor to other entities</span>
                      </div>
                      {copyMode && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Select which entities to copy to:</div>
                          <MultiEntitySelect
                            entities={entities.filter(e => e.id !== parseInt(form.entity_id))}
                            selected={copyEntityIds}
                            onChange={setCopyEntityIds}
                          />
                          {copyEntityIds.length > 0 && (
                            <div style={{ fontSize: 12, marginTop: 8, padding: '6px 10px', background: 'var(--accent-dim)', borderRadius: 6, color: 'var(--accent)' }}>
                              A copy will be created for {copyEntityIds.length} entit{copyEntityIds.length === 1 ? 'y' : 'ies'} when you save.
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
                <label>Company Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} required placeholder="Registered company name" />
              </div>
              <div className="form-group">
                <label>Trading Name</label>
                <input value={form.trading_name} onChange={e => set('trading_name', e.target.value)} placeholder="If different from above" />
              </div>
            </div>

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
                <label>Registration No.</label>
                <input value={form.registration_number} onChange={e => set('registration_number', e.target.value)} placeholder="e.g. 2003/012345/07" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>VAT Number</label>
                <input value={form.vat_number} onChange={e => set('vat_number', e.target.value)} placeholder="e.g. 4720123456" />
              </div>
              <div className="form-group">
                <label>End Date</label>
                <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Last day of engagement. Once passed, this subcontractor and their truck(s) stop appearing in pickers for new loads/diesel/invoices — past records and costing are untouched.
                </div>
              </div>
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving...</>
                : mode === 'create' ? 'Create Subcontractor' : 'Save Changes'}
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
    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.5,
  },
  amountCell: { textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 },
}
