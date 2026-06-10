import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import {
  getSuppliers, getDieselRates, createDieselRate, updateDieselRate,
  getDieselSettings, updateDieselSettings,
  getAdditionalLoadRates, createAdditionalLoadRate, updateAdditionalLoadRate, deleteAdditionalLoadRate,
} from '../services/api'
import { Plus, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Save, RefreshCw, Fuel, Package, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import DateInput from '../components/DateInput'
import { errorMessage } from '../utils/helpers'

const fmt = (n, d = 2) => Number(n || 0).toFixed(d)
const fmt2 = (n) => Number(n || 0).toFixed(2)
const fmtDate = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-ZA') : '—'

export default function DieselRatesPage() {
  const { isAdmin, entities } = useAuth()

  const [entityId, setEntityId] = useEntityFilter()
  const [suppliers, setSuppliers] = useState([])
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [showModal, setShowModal] = useState(false)
  const [editRate, setEditRate] = useState(null)
  const [form, setForm] = useState({
    supplier_id: '', rate_per_litre: '', additional_charge_per_ton: '0',
    effective_date: '', effective_to: '', notes: '', is_active: true,
  })
  const [saving, setSaving] = useState(false)

  // Diesel settings (admin fee) state
  const [dieselSettings, setDieselSettings] = useState([])
  const [dieselEdits, setDieselEdits] = useState({})
  const [savingFee, setSavingFee] = useState({})
  const [savedFee, setSavedFee] = useState({})
  const [feeErrors, setFeeErrors] = useState({})

  // Additional Load Rates (Safetec only)
  const safetecEntity = (entities || []).find(e => e.code === 'SFT')
  const [alRates, setAlRates]       = useState([])
  const [alForm, setAlForm]         = useState({ name: '', amount: '' })
  const [alEditId, setAlEditId]     = useState(null)
  const [alEditForm, setAlEditForm] = useState({ name: '', amount: '' })
  const [alSaving, setAlSaving]     = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  const loadData = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    try {
      const [suppRes, ratesRes, dsRes] = await Promise.all([
        getSuppliers({ entity_id: entityId, is_diesel_supplier: true, limit: 200 }),
        getDieselRates({ entity_id: entityId, limit: 500 }),
        getDieselSettings(),
      ])
      setSuppliers(suppRes.data || [])
      setRates(ratesRes.data || [])
      const ds = dsRes.data || []
      setDieselSettings(ds)
      const edits = {}
      ds.forEach(d => {
        edits[d.entity_id] = {
          admin_fee_pct: String(parseFloat(d.admin_fee_pct) * 100),
          apply_admin_fee: d.apply_admin_fee,
          additional_charge_per_ton: String(parseFloat(d.additional_charge_per_ton ?? 0)),
          subcontractor_monthly_admin_fee: String(parseFloat(d.subcontractor_monthly_admin_fee ?? 0)),
        }
      })
      setDieselEdits(edits)
    } catch {
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [entityId])

  useEffect(() => { loadData() }, [loadData])

  // ── Additional Load Rates (Safetec) ─────────────────────────────────────────
  const loadAlRates = useCallback(async () => {
    if (!safetecEntity) return
    try {
      const res = await getAdditionalLoadRates({ entity_id: safetecEntity.id })
      setAlRates(res.data || [])
    } catch { /* ignore */ }
  }, [safetecEntity?.id])

  useEffect(() => { loadAlRates() }, [loadAlRates])

  const handleAlAdd = async () => {
    if (!alForm.name.trim()) return toast.error('Enter a customer name')
    const amt = parseFloat(alForm.amount)
    if (isNaN(amt) || amt < 0) return toast.error('Enter a valid amount')
    setAlSaving(true)
    try {
      await createAdditionalLoadRate({ entity_id: safetecEntity.id, name: alForm.name.trim(), amount: amt })
      setAlForm({ name: '', amount: '' })
      toast.success('Customer rate added')
      loadAlRates()
    } catch (e) { toast.error(errorMessage(e, 'Failed to add')) }
    finally { setAlSaving(false) }
  }

  const handleAlSaveEdit = async (id) => {
    const amt = parseFloat(alEditForm.amount)
    if (!alEditForm.name.trim()) return toast.error('Enter a customer name')
    if (isNaN(amt) || amt < 0) return toast.error('Enter a valid amount')
    try {
      await updateAdditionalLoadRate(id, { name: alEditForm.name.trim(), amount: amt })
      setAlEditId(null)
      toast.success('Rate updated')
      loadAlRates()
    } catch (e) { toast.error(errorMessage(e, 'Failed to update')) }
  }

  const handleAlDelete = async (rate) => {
    if (!window.confirm(`Delete the rate for "${rate.name}"?`)) return
    try {
      await deleteAdditionalLoadRate(rate.id)
      setAlRates(prev => prev.filter(r => r.id !== rate.id))
      toast.success('Rate deleted')
    } catch (e) { toast.error(errorMessage(e, 'Failed to delete')) }
  }

  const ratesBySupplier = suppliers.map(s => ({
    supplier: s,
    rates: rates
      .filter(r => r.supplier_id === s.id)
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date)),
  }))

  const getCurrentRate = (supplierRates) =>
    supplierRates.find(r => r.is_active && r.effective_date <= today) || null

  const openAdd = () => {
    setEditRate(null)
    setForm({
      supplier_id: suppliers[0]?.id || '',
      rate_per_litre: '',
      additional_charge_per_ton: '0',
      effective_date: today,
      effective_to: '',
      notes: '',
      is_active: true,
    })
    setShowModal(true)
  }

  const openEdit = (rate) => {
    setEditRate(rate)
    setForm({
      supplier_id: rate.supplier_id,
      rate_per_litre: fmt(rate.rate_per_litre),
      additional_charge_per_ton: fmt2(rate.additional_charge_per_ton ?? 0),
      effective_date: rate.effective_date,
      effective_to: rate.effective_to || '',
      notes: rate.notes || '',
      is_active: rate.is_active,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.supplier_id) return toast.error('Select a supplier')
    if (!form.rate_per_litre || isNaN(form.rate_per_litre) || Number(form.rate_per_litre) <= 0)
      return toast.error('Enter a valid rate per litre')
    if (!form.effective_date) return toast.error('Select an effective date')
    setSaving(true)
    try {
      if (editRate) {
        await updateDieselRate(editRate.id, {
          notes: form.notes,
          is_active: form.is_active,
          effective_to: form.effective_to || null,
        })
        toast.success('Rate updated')
      } else {
        await createDieselRate({
          entity_id: Number(entityId),
          supplier_id: Number(form.supplier_id),
          rate_per_litre: Number(form.rate_per_litre),
          additional_charge_per_ton: Number(form.additional_charge_per_ton) || 0,
          effective_date: form.effective_date,
          effective_to: form.effective_to || null,
          notes: form.notes || null,
        })
        toast.success('Rate added')
      }
      setShowModal(false)
      loadData()
    } catch (e) {
      toast.error(errorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  const saveDieselFee = async (entityIdToSave) => {
    const key = entityIdToSave
    setSavingFee(p => ({ ...p, [key]: true }))
    setFeeErrors(p => ({ ...p, [key]: null }))
    const edit = dieselEdits[entityIdToSave] || {}
    const pct = parseFloat(edit.admin_fee_pct)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setFeeErrors(p => ({ ...p, [key]: 'Fee must be between 0 and 100' }))
      setSavingFee(p => ({ ...p, [key]: false }))
      return
    }
    try {
      const res = await updateDieselSettings(entityIdToSave, {
        admin_fee_pct: (pct / 100).toFixed(4),
        apply_admin_fee: edit.apply_admin_fee,
        additional_charge_per_ton: parseFloat(edit.additional_charge_per_ton) || 0,
        subcontractor_monthly_admin_fee: parseFloat(edit.subcontractor_monthly_admin_fee) || 0,
      })
      const loadsUpdated = res.data?.loads_updated ?? 0
      if (loadsUpdated > 0) {
        toast.success(`Settings saved · ${loadsUpdated} unpaid subcontractor load${loadsUpdated !== 1 ? 's' : ''} recalculated`)
      } else {
        setSavedFee(p => ({ ...p, [key]: true }))
        setTimeout(() => setSavedFee(p => ({ ...p, [key]: false })), 2000)
      }
      const dsRes = await getDieselSettings()
      const ds = dsRes.data || []
      setDieselSettings(ds)
    } catch (e) {
      setFeeErrors(p => ({ ...p, [key]: errorMessage(e, 'Failed to save') }))
    } finally {
      setSavingFee(p => ({ ...p, [key]: false }))
    }
  }

  const toggleExpand = (supplierId) => setExpanded(p => ({ ...p, [supplierId]: !p[supplierId] }))

  const isFuture = (date) => date > today

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Diesel Rate Management</h1>
          <p style={styles.subtitle}>Versioned rates per supplier — current rate auto-applied to new entries</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {isAdmin && (
            <select value={entityId} onChange={e => setEntityId(e.target.value)} style={styles.select}>
              <option value="">— Select Entity —</option>
              {(entities || []).map(e => (
                <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
              ))}
            </select>
          )}
          <button onClick={openAdd} style={styles.btnPrimary} disabled={!entityId}>
            <Plus size={15} /> Add Rate
          </button>
        </div>
      </div>

      {/* Rates table */}
      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : ratesBySupplier.length === 0 ? (
        <div style={styles.empty}>No diesel suppliers found for this entity. Mark suppliers as diesel suppliers first.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}></th>
                <th style={styles.th}>Supplier</th>
                <th style={styles.th}>Current Rate (R/L)</th>
                <th style={styles.th}>Additional Charge (R/ton)</th>
                <th style={styles.th}>Effective From</th>
                <th style={styles.th}>Effective To</th>
                <th style={styles.th}>History</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ratesBySupplier.map(({ supplier, rates: sRates }) => {
                const current = getCurrentRate(sRates)
                const isExp = expanded[supplier.id]
                return [
                  <tr key={supplier.id} style={styles.row}>
                    <td style={styles.td}>
                      <button
                        onClick={() => toggleExpand(supplier.id)}
                        style={styles.expandBtn}
                        disabled={sRates.length === 0}
                      >
                        {isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{supplier.name}</span>
                    </td>
                    <td style={styles.td}>
                      {current ? (
                        <span style={styles.rateChip}>R&nbsp;{fmt(current.rate_per_litre)}/L</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No active rate</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {current && Number(current.additional_charge_per_ton) > 0 ? (
                        <span style={styles.chargeChip}>R&nbsp;{fmt2(current.additional_charge_per_ton)}/ton</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {current ? fmtDate(current.effective_date) : '—'}
                    </td>
                    <td style={styles.td}>
                      {current?.effective_to ? fmtDate(current.effective_to) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Open</span>}
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {sRates.length} {sRates.length === 1 ? 'entry' : 'entries'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button
                        onClick={() => { setForm(f => ({ ...f, supplier_id: supplier.id })); openAdd() }}
                        style={styles.btnSm}
                      >
                        <Plus size={12} /> New Rate
                      </button>
                    </td>
                  </tr>,
                  isExp && sRates.length > 0 && (
                    <tr key={`${supplier.id}-history`}>
                      <td colSpan={8} style={{ padding: '0 0 4px 32px', background: 'var(--bg-hover)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              {['Effective From', 'Effective To', 'Rate (R/L)', 'Additional Charge (R/ton)', 'Status', 'Notes', 'Actions'].map(h => (
                                <th key={h} style={{ ...styles.th, fontSize: 11, background: 'transparent', padding: '6px 10px' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sRates.map(r => {
                              const isCurrent = current?.id === r.id
                              const future = isFuture(r.effective_date)
                              return (
                                <tr key={r.id} style={{
                                  background: isCurrent ? 'rgba(34,197,94,0.06)' : future ? 'rgba(234,179,8,0.06)' : 'transparent',
                                }}>
                                  <td style={{ ...styles.td, fontSize: 12 }}>
                                    {fmtDate(r.effective_date)}
                                    {future && (
                                      <span style={styles.futureBadge}><AlertTriangle size={10} /> Future</span>
                                    )}
                                    {isCurrent && (
                                      <span style={styles.currentBadge}><CheckCircle size={10} /> Current</span>
                                    )}
                                  </td>
                                  <td style={{ ...styles.td, fontSize: 12 }}>
                                    {r.effective_to ? fmtDate(r.effective_to) : <span style={{ color: 'var(--text-muted)' }}>Open</span>}
                                  </td>
                                  <td style={{ ...styles.td, fontSize: 12, fontWeight: 600 }}>
                                    R&nbsp;{fmt(r.rate_per_litre)}
                                  </td>
                                  <td style={{ ...styles.td, fontSize: 12 }}>
                                    {Number(r.additional_charge_per_ton) > 0 ? `R ${fmt2(r.additional_charge_per_ton)}` : '—'}
                                  </td>
                                  <td style={{ ...styles.td, fontSize: 12 }}>
                                    <span style={{
                                      ...styles.statusChip,
                                      background: r.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(100,100,100,0.12)',
                                      color: r.is_active ? '#16a34a' : 'var(--text-muted)',
                                    }}>
                                      {r.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td style={{ ...styles.td, fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200 }}>
                                    {r.notes || '—'}
                                  </td>
                                  <td style={styles.td}>
                                    <button onClick={() => openEdit(r)} style={styles.btnSm}>Edit</button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Diesel Admin Fee ─────────────────────────────────────────────────── */}
      <div style={{ marginTop: 32 }}>
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Diesel Admin Fee</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>
            Admin fee % applied on top of diesel costs per entity. Entities with &apos;Apply: Off&apos; are exempt.
          </p>
        </div>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Fuel size={13} /> Rate entered as a percentage (e.g. enter <strong>1</strong> for 1%). Snapshots onto each entry at entry time — historical records are not affected by future changes.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 160 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 90 }} />
              </colgroup>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  {['Entity', 'Admin Fee %', 'Additional Charge (R/ton)', 'Sub Admin Fee', 'Apply Fee', ''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(entities || []).map(entity => {
                  const ds = dieselSettings.find(d => d.entity_id === entity.id)
                  const edit = dieselEdits[entity.id] || { admin_fee_pct: '0', apply_admin_fee: true, additional_charge_per_ton: '0', subcontractor_monthly_admin_fee: '0' }
                  const key = entity.id
                  return (
                    <tr key={entity.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 22, height: 22, borderRadius: 5, background: entity.primary_color || '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: 'white', flexShrink: 0 }}>
                            {entity.code?.[0]}
                          </div>
                          <span style={{ fontWeight: 600 }}>{entity.code}</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="number" min="0" max="100" step="0.1"
                            value={edit.admin_fee_pct}
                            onChange={e => setDieselEdits(p => ({ ...p, [entity.id]: { ...edit, admin_fee_pct: e.target.value } }))}
                            disabled={!edit.apply_admin_fee}
                            style={feeInputStyle}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>%</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>R</span>
                          <input
                            type="number" min="0" step="0.01"
                            value={edit.additional_charge_per_ton}
                            onChange={e => setDieselEdits(p => ({ ...p, [entity.id]: { ...edit, additional_charge_per_ton: e.target.value } }))}
                            style={feeInputStyle}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>/ton</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}>R</span>
                          <input
                            type="number" min="0" step="0.01"
                            value={edit.subcontractor_monthly_admin_fee}
                            onChange={e => setDieselEdits(p => ({ ...p, [entity.id]: { ...edit, subcontractor_monthly_admin_fee: e.target.value } }))}
                            style={{ ...feeInputStyle, width: 120 }}
                          />
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={edit.apply_admin_fee}
                            onChange={e => setDieselEdits(p => ({ ...p, [entity.id]: { ...edit, apply_admin_fee: e.target.checked } }))}
                          />
                          <span style={{ fontSize: 12, color: edit.apply_admin_fee ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {edit.apply_admin_fee ? 'Applied' : 'Exempt'}
                          </span>
                        </label>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <button
                          className={savedFee[key] ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                          onClick={() => saveDieselFee(entity.id)}
                          disabled={savingFee[key]}
                          style={{ padding: '4px 10px' }}
                        >
                          {savingFee[key] ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                          {savedFee[key] ? <><span style={{ color: 'white' }}>✓ Saved</span></> : savingFee[key] ? 'Saving...' : <><Save size={13} /> Save</>}
                        </button>
                        {feeErrors[key] && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{feeErrors[key]}</div>}
                        {ds?.updated_at && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                            Updated {new Date(ds.updated_at).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Additional Load Rates (Safetec) ──────────────────────────────────── */}
      {safetecEntity && (
        <div style={{ marginTop: 32 }}>
          <div style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={15} style={{ color: 'var(--accent)' }} /> Additional Load Rates — Safetec
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>
              Per-customer flat rates for Safetec additional loads. Selecting a customer when adding an additional load auto-fills this amount.
            </p>
          </div>
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Customer</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 180 }}>Rate (R / load)</th>
                    <th style={{ padding: '8px 10px', width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {alRates.length === 0 && (
                    <tr><td colSpan={3} style={{ padding: '14px 10px', color: 'var(--text-muted)', fontSize: 13 }}>No customer rates yet — add one below.</td></tr>
                  )}
                  {alRates.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      {alEditId === r.id ? (
                        <>
                          <td style={{ padding: '6px 10px' }}>
                            <input className="form-input" value={alEditForm.name}
                              onChange={e => setAlEditForm(f => ({ ...f, name: e.target.value }))} style={{ width: '100%' }} />
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ color: 'var(--text-muted)' }}>R</span>
                              <input className="form-input" type="number" step="0.01" min="0" value={alEditForm.amount}
                                onChange={e => setAlEditForm(f => ({ ...f, amount: e.target.value }))} style={{ width: 110 }} />
                            </div>
                          </td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                            <button className="btn-icon" title="Save" onClick={() => handleAlSaveEdit(r.id)} style={{ marginRight: 4 }}><Save size={14} /></button>
                            <button className="btn-icon" title="Cancel" onClick={() => setAlEditId(null)}><X size={14} /></button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '9px 10px', fontWeight: 600, cursor: 'pointer' }}
                            onClick={() => { setAlEditId(r.id); setAlEditForm({ name: r.name, amount: String(parseFloat(r.amount)) }) }}>
                            {r.name}
                          </td>
                          <td style={{ padding: '9px 10px' }}>
                            <span style={styles.rateChip}>R&nbsp;{fmt2(r.amount)}</span>
                          </td>
                          <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                            <button className="btn-ghost btn-sm" onClick={() => { setAlEditId(r.id); setAlEditForm({ name: r.name, amount: String(parseFloat(r.amount)) }) }} style={{ marginRight: 4 }}>Edit</button>
                            <button className="btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleAlDelete(r)}>
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {/* Add new row */}
                  <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <input className="form-input" placeholder="e.g. KOUGA CONSTRUCTION" value={alForm.name}
                        onChange={e => setAlForm(f => ({ ...f, name: e.target.value }))} style={{ width: '100%' }} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>R</span>
                        <input className="form-input" type="number" step="0.01" min="0" placeholder="200.00" value={alForm.amount}
                          onChange={e => setAlForm(f => ({ ...f, amount: e.target.value }))} style={{ width: 110 }} />
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <button className="btn-primary btn-sm" onClick={handleAlAdd} disabled={alSaving}>
                        <Plus size={13} /> Add
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Rate Modal */}
      {showModal && (
        <div style={styles.overlay} onClick={() => setShowModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>{editRate ? 'Edit Rate' : 'Add Diesel Rate'}</h2>

            {editRate && (
              <div style={styles.infoBox}>
                <strong>Note:</strong> Rate value, additional charge, and effective date cannot be changed after creation. Only notes and active status are editable.
              </div>
            )}

            <div style={styles.field}>
              <label style={styles.label}>Supplier</label>
              <select
                value={form.supplier_id}
                onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}
                style={styles.input}
                disabled={!!editRate}
              >
                <option value="">— Select —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div style={styles.row2}>
              <div style={styles.field}>
                <label style={styles.label}>Rate per Litre (R)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.rate_per_litre}
                  onChange={e => setForm(f => ({ ...f, rate_per_litre: e.target.value }))}
                  style={styles.input}
                  disabled={!!editRate}
                  placeholder="e.g. 24.50"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Additional Charge (R per ton)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.additional_charge_per_ton}
                  onChange={e => setForm(f => ({ ...f, additional_charge_per_ton: e.target.value }))}
                  style={styles.input}
                  disabled={!!editRate}
                  placeholder="e.g. 5.00"
                />
              </div>
            </div>

            <div style={styles.row2}>
              <div style={styles.field}>
                <label style={styles.label}>Effective From</label>
                <DateInput
                  value={form.effective_date}
                  onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))}
                  style={styles.input}
                  disabled={!!editRate}
                />
                {form.effective_date > today && (
                  <span style={{ fontSize: 11, color: '#d97706', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={11} /> Future date
                  </span>
                )}
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Effective To <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                <DateInput
                  value={form.effective_to}
                  onChange={e => setForm(f => ({ ...f, effective_to: e.target.value }))}
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                style={styles.input}
                placeholder="Optional notes"
              />
            </div>

            {editRate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <input
                  type="checkbox"
                  id="is_active"
                  checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                />
                <label htmlFor="is_active" style={styles.label}>Active</label>
              </div>
            )}

            <div style={styles.modalActions}>
              <button onClick={() => setShowModal(false)} style={styles.btnSecondary}>Cancel</button>
              <button onClick={handleSave} style={styles.btnPrimary} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  page: { padding: 'var(--page-pad)', flex: 1 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: 13, color: 'var(--text-muted)', marginTop: 4 },
  empty: { textAlign: 'center', color: 'var(--text-muted)', padding: 60, fontSize: 14 },
  tableWrap: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
    background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)',
  },
  row: { borderBottom: '1px solid var(--border)', transition: 'background 0.1s' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-secondary)', verticalAlign: 'middle' },
  expandBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
    padding: 2, display: 'flex', alignItems: 'center',
  },
  rateChip: {
    background: 'rgba(34,197,94,0.12)', color: '#16a34a', fontWeight: 700,
    fontSize: 13, padding: '3px 10px', borderRadius: 20,
  },
  chargeChip: {
    background: 'rgba(99,102,241,0.10)', color: '#4f46e5', fontWeight: 600,
    fontSize: 12, padding: '3px 10px', borderRadius: 20,
  },
  statusChip: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20 },
  futureBadge: {
    marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#d97706',
    background: 'rgba(234,179,8,0.12)', padding: '1px 6px', borderRadius: 10,
    display: 'inline-flex', alignItems: 'center', gap: 3,
  },
  currentBadge: {
    marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#16a34a',
    background: 'rgba(34,197,94,0.12)', padding: '1px 6px', borderRadius: 10,
    display: 'inline-flex', alignItems: 'center', gap: 3,
  },
  btnPrimary: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
    background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8,
    fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
  btnSecondary: {
    padding: '8px 16px', background: 'var(--bg-hover)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
  btnSm: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
    background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
  },
  select: {
    padding: '7px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 28, width: '100%', maxWidth: 520, boxShadow: 'var(--shadow)',
  },
  modalTitle: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 18px' },
  infoBox: {
    background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)',
    borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400e', marginBottom: 16,
  },
  field: { marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' },
  input: {
    padding: '8px 12px', background: 'var(--bg-input)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
  },
  row2: { display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: 12 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
}

const feeInputStyle = {
  width: 80, padding: '4px 8px', fontSize: 13, borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-card)',
  color: 'var(--text-primary)', outline: 'none',
}
