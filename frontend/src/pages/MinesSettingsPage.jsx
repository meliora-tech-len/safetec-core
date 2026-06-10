import { useState, useEffect } from 'react'
import { Plus, Edit2, ChevronDown, ChevronRight, X } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getMines, createMine, updateMine, deleteMine,
  getMineRates, addMineRate, getEntities, getPayrollSettings,
} from '../services/api'
import { errorMessage } from '../utils/helpers'
import DateInput from '../components/DateInput'

const fmt = (n) =>
  n == null
    ? '—'
    : `R ${parseFloat(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-ZA') : 'current')

// ── Mine add/edit form ────────────────────────────────────────────────────────

function MineForm({ mine, onSave, onCancel, casualRates }) {
  const [form, setForm] = useState({
    name: mine?.name || '',
    code: mine?.code || '',
    casual_group: mine?.casual_group || '',
    notes: mine?.notes || '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (mine?.id) {
        await updateMine(mine.id, form)
        toast.success('Mine updated')
      } else {
        await createMine(form)
        toast.success('Mine created')
      }
      onSave()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save mine'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="form-group" style={{ margin: 0, minWidth: 160 }}>
        <label className="form-label">Name *</label>
        <input
          className="form-control"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="ASSMANG"
          required
        />
      </div>
      <div className="form-group" style={{ margin: 0, minWidth: 90 }}>
        <label className="form-label">Code *</label>
        <input
          className="form-control"
          value={form.code}
          onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
          placeholder="ASS"
          required
          maxLength={30}
        />
      </div>
      <div className="form-group" style={{ margin: 0, minWidth: 120 }}>
        <label className="form-label">Casual group</label>
        <select
          className="form-control"
          value={form.casual_group}
          onChange={e => setForm(f => ({ ...f, casual_group: e.target.value || null }))}
        >
          <option value="">None</option>
          <option value="A">Group A{casualRates?.a ? ` — ${fmt(casualRates.a)}/load` : ''}</option>
          <option value="B">Group B{casualRates?.b ? ` — ${fmt(casualRates.b)}/load` : ''}</option>
        </select>
      </div>
      <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 130 }}>
        <label className="form-label">Notes</label>
        <input
          className="form-control"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, paddingBottom: 2 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving…' : mine?.id ? 'Update' : 'Add Mine'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ── Inline rate set form ──────────────────────────────────────────────────────

function InlineRateForm({ mineId, entityId, currentRate, onSave, onCancel }) {
  const [rate, setRate] = useState(currentRate != null ? String(currentRate) : '')
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await addMineRate(mineId, {
        entity_id: entityId,
        rate_per_ton: parseFloat(rate),
        effective_from: new Date(effectiveFrom).toISOString(),
        notes: null,
      })
      toast.success('Rate updated')
      onSave()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to update rate'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      onClick={e => e.stopPropagation()}>
      <input
        type="number"
        step="0.01"
        className="form-control"
        style={{ width: 100, padding: '4px 8px', fontSize: 13 }}
        value={rate}
        onChange={e => setRate(e.target.value)}
        placeholder="0.00"
        required
        autoFocus
      />
      <DateInput
        className="form-control"
        style={{ width: 130, padding: '4px 8px', fontSize: 12 }}
        value={effectiveFrom}
        onChange={e => setEffectiveFrom(e.target.value)}
        required
      />
      <button type="submit" className="btn btn-primary btn-sm" disabled={saving} style={{ whiteSpace: 'nowrap' }}>
        {saving ? '…' : 'Set'}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
        <X size={12} />
      </button>
    </form>
  )
}

// ── Rate history panel ────────────────────────────────────────────────────────

function RateHistory({ mineId, entities, selectedEntityId }) {
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getMineRates(mineId, selectedEntityId ? { entity_id: selectedEntityId } : {})
      .then(r => setRates(r.data))
      .catch(() => toast.error('Failed to load rate history'))
      .finally(() => setLoading(false))
  }, [mineId, selectedEntityId])

  if (loading) return <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>Loading…</p>
  if (rates.length === 0) return <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>No rate history.</p>

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Entity</th>
          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Rate / ton</th>
          <th style={{ textAlign: 'left', padding: '4px 8px' }}>From</th>
          <th style={{ textAlign: 'left', padding: '4px 8px' }}>To</th>
          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Notes</th>
        </tr>
      </thead>
      <tbody>
        {rates.map(r => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: '5px 8px', fontWeight: 500 }}>
              {entities.find(e => e.id === r.entity_id)?.code || r.entity_id}
            </td>
            <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(r.rate_per_ton)}
              {!r.effective_to && (
                <span style={{
                  marginLeft: 6, fontSize: 10, background: 'var(--accent)',
                  color: '#fff', borderRadius: 4, padding: '1px 5px',
                }}>active</span>
              )}
            </td>
            <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{fmtDate(r.effective_from)}</td>
            <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{fmtDate(r.effective_to)}</td>
            <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Mine table row ────────────────────────────────────────────────────────────

function MineRow({ mine, entities, selectedEntityId, onRefresh, casualRates }) {
  const [expanded, setExpanded] = useState(false)
  const [editingMine, setEditingMine] = useState(false)
  const [editingRate, setEditingRate] = useState(false)

  // Find the active rate for the selected entity from the mine's rates array
  const activeRate = selectedEntityId
    ? mine.rates?.find(r => r.entity_id === parseInt(selectedEntityId) && !r.effective_to)
    : null

  const handleDeactivate = async (e) => {
    e.stopPropagation()
    if (!window.confirm(`Deactivate mine "${mine.name}"?`)) return
    try {
      await deleteMine(mine.id)
      toast.success('Mine deactivated')
      onRefresh()
    } catch {
      toast.error('Failed to deactivate')
    }
  }

  if (editingMine) {
    return (
      <tr>
        <td colSpan={6} style={{ padding: '12px 16px', background: 'var(--bg-base)' }}>
          <MineForm
            mine={mine}
            onSave={() => { setEditingMine(false); onRefresh() }}
            onCancel={() => setEditingMine(false)}
            casualRates={casualRates}
          />
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        {/* Expand toggle */}
        <td style={{ width: 28, paddingRight: 0, color: 'var(--text-muted)' }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>

        {/* Mine name */}
        <td style={{ fontWeight: 600 }}>{mine.name}</td>

        {/* Code */}
        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{mine.code}</td>

        {/* Casual group badge */}
        <td>
          {mine.casual_group ? (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              background: mine.casual_group === 'A' ? 'rgba(22,163,74,0.12)' : 'rgba(59,130,246,0.12)',
              color: mine.casual_group === 'A' ? '#16a34a' : '#2563eb',
            }}>
              Group {mine.casual_group}
            </span>
          ) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
        </td>

        {/* Rate column */}
        <td onClick={e => e.stopPropagation()}>
          {editingRate ? (
            <InlineRateForm
              mineId={mine.id}
              entityId={parseInt(selectedEntityId)}
              currentRate={activeRate?.rate_per_ton}
              onSave={() => { setEditingRate(false); onRefresh() }}
              onCancel={() => setEditingRate(false)}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {selectedEntityId ? (
                <>
                  <span style={{
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: activeRate ? 600 : 400,
                    color: activeRate ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}>
                    {activeRate ? fmt(activeRate.rate_per_ton) : '—'}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => setEditingRate(true)}
                    title={activeRate ? 'Update rate' : 'Set rate'}
                  >
                    {activeRate ? <Edit2 size={11} /> : <Plus size={11} />}
                    {activeRate ? 'Edit' : 'Set rate'}
                  </button>
                </>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Select entity to see rate</span>
              )}
            </div>
          )}
        </td>

        {/* Status */}
        <td>
          <span className={`badge ${mine.is_active ? 'badge-paid' : 'badge-cancelled'}`}>
            {mine.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>

        {/* Actions */}
        <td onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditingMine(true)} title="Edit mine">
              <Edit2 size={13} />
            </button>
            {mine.is_active && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger)' }}
                onClick={handleDeactivate}
                title="Deactivate"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded rate history */}
      {expanded && (
        <tr>
          <td colSpan={6} style={{
            background: 'var(--bg-base)',
            padding: '0 24px 14px 40px',
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ paddingTop: 10 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 8,
              }}>
                Rate History {selectedEntityId
                  ? `— ${entities.find(e => e.id === parseInt(selectedEntityId))?.code}`
                  : '— All Entities'}
              </div>
              <RateHistory
                mineId={mine.id}
                entities={entities}
                selectedEntityId={selectedEntityId}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MinesSettingsPage() {
  const [mines, setMines] = useState([])
  const [entities, setEntities] = useState([])
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [casualRates, setCasualRates] = useState(null)

  const fetchMines = async () => {
    setLoading(true)
    try {
      const res = await getMines()
      setMines(res.data)
    } catch {
      toast.error('Failed to load mines')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMines()
    getEntities().then(r => {
      const active = r.data.filter(e => e.is_active)
      setEntities(active)
      if (active.length > 0) setSelectedEntityId(String(active[0].id))
    }).catch(() => {})
    getPayrollSettings().then(r => {
      setCasualRates({ a: r.data.casual_rate_group_a, b: r.data.casual_rate_group_b })
    }).catch(() => {})
  }, [])

  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mine Management</h1>
          <p className="page-subtitle">Manage mine sites and hauling rates per entity</p>
        </div>
        {!showAddForm && (
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
            <Plus size={15} /> Add Mine
          </button>
        )}
      </div>

      {/* Add mine form */}
      {showAddForm && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>New Mine</div>
          <MineForm
            onSave={() => { setShowAddForm(false); fetchMines() }}
            onCancel={() => setShowAddForm(false)}
            casualRates={casualRates}
          />
        </div>
      )}

      {/* Entity filter */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>View rates for:</label>
        <select
          className="form-control"
          style={{ width: 200 }}
          value={selectedEntityId}
          onChange={e => setSelectedEntityId(e.target.value)}
        >
          <option value="">— All entities —</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Select an entity to view and edit its rates inline
        </span>
      </div>

      {/* Mines table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : mines.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No mines yet. Add one above.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Mine Name</th>
                <th>Code</th>
                <th>
                  Rate / ton (excl VAT)
                  {selectedEntityId && (
                    <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                      — {entities.find(e => e.id === parseInt(selectedEntityId))?.code}
                    </span>
                  )}
                </th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mines.map(mine => (
                <MineRow
                  key={mine.id}
                  mine={mine}
                  entities={entities}
                  selectedEntityId={selectedEntityId}
                  onRefresh={fetchMines}
                  casualRates={casualRates}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
