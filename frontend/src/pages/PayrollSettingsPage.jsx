import { useState, useEffect } from 'react'
import { Settings, Plus, Edit2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import DeleteModal from '../components/DeleteModal'

const API = import.meta.env.VITE_API_URL || ''

function useApi() {
  const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` })
  const get  = (p)    => fetch(`${API}${p}`, { headers: h() }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  const post = (p, b) => fetch(`${API}${p}`, { method: 'POST', headers: h(), body: JSON.stringify(b) }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  const put  = (p, b) => fetch(`${API}${p}`, { method: 'PUT',  headers: h(), body: JSON.stringify(b) }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  const del  = (p)    => fetch(`${API}${p}`, { method: 'DELETE', headers: h() }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  return { get, post, put, del }
}

const fmt = (n) => `R ${parseFloat(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n) => `${(parseFloat(n || 0) * 100).toFixed(4)}%`

// Statutory deduction fields — unchanged
const DEDUCTION_FIELDS = [
  { key: 'nbcrfli_rate',              label: 'NBCRFLI rate',           type: 'rate' },
  { key: 'provident_rate',            label: 'Provident rate',         type: 'rate' },
  { key: 'wellness_rate',             label: 'Wellness rate',          type: 'rate' },
  { key: 'sick_fund_rate',            label: 'Sick fund rate',         type: 'rate' },
  { key: 'holiday_fund_rate',         label: 'Holiday fund rate',      type: 'rate' },
  { key: 'leave_pay_rate',            label: 'Leave pay rate',         type: 'rate' },
  { key: 'paye_fixed',                label: 'PAYE (fixed amount)',    type: 'currency' },
]

// ── Mine group form (add / edit) ──────────────────────────────────────────────

const BLANK_GROUP = { name: '', base_salary: '', incentive_per_load: '', subs_per_load: '', base_loads: 7, notes: '' }

function GroupForm({ group, onSave, onCancel }) {
  const api = useApi()
  const isEdit = !!group?.id
  const [form, setForm] = useState(isEdit ? {
    name: group.name,
    base_salary: group.base_salary,
    incentive_per_load: group.incentive_per_load,
    subs_per_load: group.subs_per_load,
    base_loads: group.base_loads,
    notes: group.notes || '',
  } : { ...BLANK_GROUP })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        base_salary: parseFloat(form.base_salary),
        incentive_per_load: parseFloat(form.incentive_per_load) || 0,
        subs_per_load: parseFloat(form.subs_per_load) || 0,
        base_loads: parseInt(form.base_loads) || 7,
        notes: form.notes || null,
      }
      if (isEdit) {
        await api.put(`/api/payroll-mine-groups/${group.id}`, payload)
        toast.success('Mine group updated')
      } else {
        await api.post('/api/payroll-mine-groups', payload)
        toast.success('Mine group added')
      }
      onSave()
    } catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Route Group Name *</label>
          <input className="form-control" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Lohatla" required />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Base Loads (full week) *</label>
          <input type="number" className="form-control" value={form.base_loads} onChange={e => set('base_loads', e.target.value)} required min={1} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Base Salary *</label>
          <input type="number" step="0.01" className="form-control" value={form.base_salary} onChange={e => set('base_salary', e.target.value)} placeholder="16481.55" required />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Incentive per Extra Load</label>
          <input type="number" step="0.01" className="form-control" value={form.incentive_per_load} onChange={e => set('incentive_per_load', e.target.value)} placeholder="2610.00" />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Subsistence per Load</label>
          <input type="number" step="0.01" className="form-control" value={form.subs_per_load} onChange={e => set('subs_per_load', e.target.value)} placeholder="459.66" />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Notes</label>
          <input className="form-control" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Update' : 'Add Group'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ── Mine group card ───────────────────────────────────────────────────────────

function GroupCard({ group, onRefresh }) {
  const api = useApi()
  const [editing, setEditing] = useState(false)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const handleDeactivate = () => setShowDeleteModal(true)
  const confirmDeactivate = async () => {
    try {
      await api.del(`/api/payroll-mine-groups/${group.id}`)
      toast.success('Mine group removed')
      setShowDeleteModal(false)
      onRefresh()
    } catch { toast.error('Failed to remove') }
  }

  return (
    <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
      {editing ? (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Edit — {group.name}
          </div>
          <GroupForm group={group} onSave={() => { setEditing(false); onRefresh() }} onCancel={() => setEditing(false)} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {group.name}
            </h3>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} title="Edit"><Edit2 size={13} /></button>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={handleDeactivate} title="Remove"><X size={13} /></button>
            </div>
          </div>

          {[
            { label: `Base salary (${group.base_loads} loads)`, value: fmt(group.base_salary) },
            { label: 'Incentive per extra load',                value: fmt(group.incentive_per_load) },
            { label: 'Subsistence per load',                    value: fmt(group.subs_per_load) },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span className="form-label" style={{ margin: 0 }}>{row.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{row.value}</span>
            </div>
          ))}
        </>
      )}

      <DeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Remove Mine Group"
        description={`"${group.name}" will be deactivated and hidden from payroll calculations.`}
        onArchive={confirmDeactivate}
      />
    </div>
  )
}

// ── Reference table ───────────────────────────────────────────────────────────

function calcRow(group, totalLoads) {
  const base = Math.min(totalLoads, group.base_loads)
  const extra = totalLoads - base
  const basic = base > 0 ? parseFloat(group.base_salary) : 0
  const subs  = parseFloat(group.subs_per_load) * totalLoads
  const inc   = parseFloat(group.incentive_per_load) * extra
  return { basic, subs, inc, gross: basic + subs + inc }
}

function ReferenceTable({ groups }) {
  const active = groups.filter(g => g.is_active)
  if (!active.length) return null

  const loadCounts = [7, 8, 9, 10, 11, 12]

  return (
    <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Gross Income Reference Table</h3>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
        Auto-calculated from current rates above. Updates live as you edit.
      </p>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th rowSpan={2} style={{ verticalAlign: 'bottom' }}>Loads</th>
              {active.map(g => (
                <th key={g.id} colSpan={3} style={{ textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                  {g.name}
                </th>
              ))}
            </tr>
            <tr>
              {active.flatMap(g => (
                ['Basic', 'Subs', 'Gross'].map(h => (
                  <th key={`${g.id}-${h}`} style={{ textAlign: 'right', fontWeight: 500 }}>{h}</th>
                ))
              ))}
            </tr>
          </thead>
          <tbody>
            {loadCounts.map(n => (
              <tr key={n}>
                <td style={{ fontWeight: 600, textAlign: 'center' }}>{n}</td>
                {active.flatMap(g => {
                  const r = calcRow(g, n)
                  return [
                    <td key={`${g.id}-b`} style={{ textAlign: 'right', fontSize: 12 }}>{fmt(r.basic)}</td>,
                    <td key={`${g.id}-s`} style={{ textAlign: 'right', fontSize: 12 }}>{fmt(r.subs)}</td>,
                    <td key={`${g.id}-g`} style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{fmt(r.gross)}</td>,
                  ]
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PayrollSettingsPage() {
  const api = useApi()
  const [settings, setSettings]   = useState(null)
  const [form, setForm]           = useState({})
  const [groups, setGroups]       = useState([])
  const [saving, setSaving]       = useState(false)
  const [loading, setLoading]     = useState(true)
  const [showAddGroup, setShowAddGroup] = useState(false)

  const loadAll = async () => {
    try {
      const [s, g] = await Promise.all([
        api.get('/api/payroll-settings'),
        api.get('/api/payroll-mine-groups'),
      ])
      setSettings(s)
      setForm(s)
      setGroups(g)
    } catch { toast.error('Failed to load payroll settings') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await api.put('/api/payroll-settings', {
        ...form,
        effective_date: new Date().toISOString(),
      })
      setSettings(updated)
      setForm(updated)
      toast.success('Payroll rates saved')
    } catch { toast.error('Save failed') }
    finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 40 }}><div className="spinner" /></div>

  const activeGroups = groups.filter(g => g.is_active)

  return (
    <div style={{ padding: '28px 32px', flex: 1, maxWidth: 1100 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={20} /> Payroll Rates
          </h1>
          {settings && (
            <p className="page-subtitle">
              Effective: {new Date(settings.effective_date).toLocaleDateString('en-ZA')}
              {settings.updated_by && ` · Updated by user #${settings.updated_by}`}
            </p>
          )}
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save rates'}
        </button>
      </div>

      {/* ── Mine Route Groups ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Mine Route Groups</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Each group has its own base salary and incentive structure.
            </div>
          </div>
          {!showAddGroup && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAddGroup(true)}>
              <Plus size={13} /> Add Route Group
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {activeGroups.map(g => (
            <GroupCard key={g.id} group={g} onRefresh={loadAll} />
          ))}

          {showAddGroup && (
            <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                New Route Group
              </div>
              <GroupForm onSave={() => { setShowAddGroup(false); loadAll() }} onCancel={() => setShowAddGroup(false)} />
            </div>
          )}
        </div>
      </div>

      {/* ── Casual Rate · Assmang Bonus · Payroll Factor ──────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Casual Driver Rate
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-muted)' }}>
            Lohatla only. Applied per load, no basic salary.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <label className="form-label" style={{ margin: 0 }}>Rate per load</label>
            <input
              className="form-input" type="number" step="0.01"
              value={form.lohatla_casual_rate_per_load ?? ''}
              onChange={e => set('lohatla_casual_rate_per_load', e.target.value)}
              style={{ width: 140, textAlign: 'right' }}
            />
          </div>
        </div>

        <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Assmang Bonus
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <label className="form-label" style={{ margin: 0 }}>Bonus per load</label>
            <input
              className="form-input" type="number" step="0.01"
              value={form.assmang_bonus_per_load ?? ''}
              onChange={e => set('assmang_bonus_per_load', e.target.value)}
              style={{ width: 140, textAlign: 'right' }}
            />
          </div>
        </div>

        {/* ── Payroll Factor ──────────────────────────────────────────────── */}
        <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Payroll Factor
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <label className="form-label" style={{ margin: 0 }}>Weekly → monthly factor</label>
            <input
              className="form-input" type="number" step="0.0001"
              value={form.weekly_to_monthly_factor ?? ''}
              onChange={e => set('weekly_to_monthly_factor', e.target.value)}
              style={{ width: 140, textAlign: 'right' }}
            />
          </div>
        </div>
      </div>

      {/* ── Statutory Deductions ──────────────────────────────────────────── */}
      <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Statutory Deduction Rates
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 32px' }}>
          {DEDUCTION_FIELDS.map(f => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 }}>
              <label className="form-label" style={{ margin: 0 }}>{f.label}</label>
              <input
                className="form-input" type="number"
                step={f.type === 'rate' ? '0.0001' : '0.01'}
                value={form[f.key] ?? ''}
                onChange={e => set(f.key, e.target.value)}
                style={{ width: 140, textAlign: 'right' }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Reference table ────────────────────────────────────────────────── */}
      <ReferenceTable groups={activeGroups} />
    </div>
  )
}
