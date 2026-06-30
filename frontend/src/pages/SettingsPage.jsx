import { useState, useEffect } from 'react'
import { Settings, Save, Plus, Trash2, RefreshCw, Eraser } from 'lucide-react'
import { getSettings, updateSetting, getEntities, updateEntity, updateEntityInvoiceConfig, getRoles, createRole, deleteRole, cleanupDieselPlaceholders } from '../services/api'
import DeleteModal from '../components/DeleteModal'
import { errorMessage } from '../utils/helpers'

export default function SettingsPage() {
  const [settings, setSettings] = useState({})
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [savedOk, setSavedOk] = useState({})
  const [errors, setErrors] = useState({})
  // Local editable state
  const [vatRate, setVatRate] = useState('15')
  const [licenceWarnDays, setLicenceWarnDays] = useState('30')
  const [roles, setRoles] = useState([])
  const [newRoleKey, setNewRoleKey] = useState('')
  const [newRoleDisplay, setNewRoleDisplay] = useState('')
  // Diesel placeholder cleanup
  const [cleanupResult, setCleanupResult] = useState(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupError, setCleanupError] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [sRes, eRes, rRes] = await Promise.all([
        getSettings(),
        getEntities(),
        getRoles(),
      ])
      const map = {}
      sRes.data.forEach(item => { map[item.key] = item })
      setSettings(map)
      setEntities(eRes.data)
      setRoles(rRes.data)

      // Parse initial values
      if (map.vat_rate) setVatRate(String(parseFloat(map.vat_rate.value) * 100))
      if (map.fleet_licence_warn_days) setLicenceWarnDays(map.fleet_licence_warn_days.value)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const saveSetting = async (key, value, label = null) => {
    setSaving(p => ({ ...p, [key]: true }))
    setErrors(p => ({ ...p, [key]: null }))
    try {
      await updateSetting(key, { value: String(value), label })
      setSavedOk(p => ({ ...p, [key]: true }))
      setTimeout(() => setSavedOk(p => ({ ...p, [key]: false })), 2000)
    } catch (e) {
      setErrors(p => ({ ...p, [key]: errorMessage(e, 'Failed to save') }))
    } finally {
      setSaving(p => ({ ...p, [key]: false }))
    }
  }

  const handleVatSave = () => {
    const rate = parseFloat(vatRate) / 100
    if (isNaN(rate) || rate < 0 || rate > 1) {
      setErrors(p => ({ ...p, vat_rate: 'Enter a value between 0 and 100' }))
      return
    }
    saveSetting('vat_rate', rate.toFixed(4), 'Global VAT Rate')
  }

  const handleAddRole = async () => {
    const key = newRoleKey.trim().toLowerCase().replace(/\s+/g, '_')
    const displayName = newRoleDisplay.trim()
    if (!key || !displayName) {
      setErrors(p => ({ ...p, roles: 'Both a key and a display name are required' }))
      return
    }
    setSaving(p => ({ ...p, roles: true }))
    setErrors(p => ({ ...p, roles: null }))
    try {
      const res = await createRole({ key, display_name: displayName })
      setRoles(prev => [...prev, res.data])
      setNewRoleKey('')
      setNewRoleDisplay('')
    } catch (e) {
      setErrors(p => ({ ...p, roles: errorMessage(e, 'Failed to create role') }))
    } finally {
      setSaving(p => ({ ...p, roles: false }))
    }
  }

  const runCleanup = async (commit) => {
    setCleanupBusy(true)
    setCleanupError(null)
    try {
      const { data } = await cleanupDieselPlaceholders({ commit })
      setCleanupResult(data)
    } catch (e) {
      setCleanupError(errorMessage(e, 'Cleanup failed'))
    } finally {
      setCleanupBusy(false)
    }
  }

  const [deleteRoleTarget, setDeleteRoleTarget] = useState(null)
  const handleRemoveRole = (role) => setDeleteRoleTarget(role)

  const saveEntityInvoiceConfig = async (entity) => {
    setSaving(p => ({ ...p, [`entity_${entity.id}`]: true }))
    setErrors(p => ({ ...p, [`entity_${entity.id}`]: null }))
    try {
      const { data: saved } = await updateEntityInvoiceConfig(entity.id, {
        invoice_prefix: entity.invoice_prefix,
        invoice_counter: entity.invoice_counter,
        quote_prefix: entity.quote_prefix,
        quote_counter: entity.quote_counter,
        invoice_number_padding: entity.invoice_number_padding,
      })
      // Reflect exactly what the server stored, so a save can never *look* successful
      // while the value silently reverts on the next page load.
      setEntityConfigs(p => ({
        ...p,
        [saved.id]: {
          invoice_prefix: saved.invoice_prefix ?? '',
          invoice_counter: saved.invoice_counter ?? 0,
          quote_prefix: saved.quote_prefix ?? 'QT',
          quote_counter: saved.quote_counter ?? 0,
          invoice_number_padding: saved.invoice_number_padding ?? 5,
        },
      }))
      setSavedOk(p => ({ ...p, [`entity_${entity.id}`]: true }))
      setTimeout(() => setSavedOk(p => ({ ...p, [`entity_${entity.id}`]: false })), 2000)
    } catch (e) {
      setErrors(p => ({ ...p, [`entity_${entity.id}`]: errorMessage(e, 'Failed to save') }))
    } finally {
      setSaving(p => ({ ...p, [`entity_${entity.id}`]: false }))
    }
  }

  const [entityConfigs, setEntityConfigs] = useState({})

  useEffect(() => {
    const cfg = {}
    entities.forEach(e => {
      cfg[e.id] = {
        invoice_prefix: e.invoice_prefix || e.code,
        invoice_counter: e.invoice_counter || 0,
        quote_prefix: e.quote_prefix || 'QT',
        quote_counter: e.quote_counter || 0,
        invoice_number_padding: e.invoice_number_padding ?? 5,
      }
    })
    setEntityConfigs(cfg)
  }, [entities])

  const updateEntityConfig = (entityId, field, value) => {
    setEntityConfigs(p => ({ ...p, [entityId]: { ...p[entityId], [field]: value } }))
  }

  if (loading) {
    return <div style={{ padding: 'var(--page-pad)', color: 'var(--text-muted)' }}>Loading settings...</div>
  }

  return (
    <div style={{ padding: 'var(--page-pad)', maxWidth: 860 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: 13 }}>
          Global configuration — changes apply across the system
        </p>
      </div>

      {/* ── Billing & Tax ────────────────────────────────────────────── */}
      <Section title="Billing & Tax" subtitle="VAT and invoice financial settings">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="form-label">Global VAT Rate</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={vatRate}
                  onChange={e => setVatRate(e.target.value)}
                  style={{ width: 90, paddingRight: 28 }}
                />
                <span style={{ position: 'absolute', right: 10, color: 'var(--text-muted)', fontSize: 14 }}>%</span>
              </div>
              <SaveButton
                saving={saving.vat_rate}
                saved={savedOk.vat_rate}
                onClick={handleVatSave}
              />
            </div>
            {errors.vat_rate && <div style={errorStyle}>{errors.vat_rate}</div>}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              This is the default VAT rate applied to new invoices. Individual entities can override this in their profile.
              Currently: <strong>{vatRate}%</strong>
            </div>
          </div>
        </div>
      </Section>

      {/* ── User Roles ──────────────────────────────────────────────── */}
      <Section title="User Roles" subtitle="Manage the roles available when creating users">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {roles.map(role => (
              <div key={role.key} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: 20, padding: '4px 12px', fontSize: 13,
              }}>
                <div>
                  <span style={{ fontWeight: role.is_protected ? 700 : 500 }}>{role.display_name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6, fontFamily: 'monospace' }}>{role.key}</span>
                </div>
                {role.is_protected
                  ? <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>system</span>
                  : <button onClick={() => handleRemoveRole(role)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}>
                    <Trash2 size={12} />
                  </button>
                }
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="form-input"
              value={newRoleDisplay}
              onChange={e => setNewRoleDisplay(e.target.value)}
              placeholder="Display name (e.g. Accountant)"
              style={{ maxWidth: 200 }}
            />
            <input
              className="form-input"
              value={newRoleKey}
              onChange={e => setNewRoleKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddRole()}
              placeholder="Key (e.g. accountant)"
              style={{ maxWidth: 160 }}
            />
            <button className="btn-ghost btn-sm" onClick={handleAddRole} disabled={saving.roles}>
              <Plus size={13} /> Add Role
            </button>
          </div>
          {errors.roles && <div style={errorStyle}>{errors.roles}</div>}
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Roles marked "system" cannot be removed. New roles can be assigned to users when creating or editing accounts.
          </div>
        </div>
      </Section>

      {/* ── Invoice Numbering ────────────────────────────────────────── */}
      <Section title="Invoice Numbering" subtitle="Set each entity's counter to the LAST invoice number you used — the next invoice continues from there (see the Next Invoice preview). The app then increments automatically; you can still override the number on individual invoices.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                {['Entity', 'Invoice Prefix', 'Last Invoice #', 'Quote Prefix', 'Last Quote #', 'Digits', 'Next Invoice', ''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entities.map(entity => {
                const cfg = entityConfigs[entity.id] || {}
                const pad = Math.max(0, parseInt(cfg.invoice_number_padding) || 0)
                const nextInv = `${cfg.invoice_prefix || entity.code}${String((parseInt(cfg.invoice_counter) || 0) + 1).padStart(pad, '0')}`
                const isSaving = saving[`entity_${entity.id}`]
                const isSaved = savedOk[`entity_${entity.id}`]
                const saveError = errors[`entity_${entity.id}`]

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
                      <input className="form-input" value={cfg.invoice_prefix ?? ''} onChange={e => updateEntityConfig(entity.id, 'invoice_prefix', e.target.value.toUpperCase())}
                        style={{ width: 80, fontFamily: 'monospace', padding: '4px 8px', fontSize: 13 }} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input className="form-input" type="number" min={0} value={cfg.invoice_counter ?? 0} onChange={e => updateEntityConfig(entity.id, 'invoice_counter', parseInt(e.target.value) || 0)}
                        style={{ width: 90, padding: '4px 8px', fontSize: 13 }} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input className="form-input" value={cfg.quote_prefix ?? ''} onChange={e => updateEntityConfig(entity.id, 'quote_prefix', e.target.value.toUpperCase())}
                        style={{ width: 70, fontFamily: 'monospace', padding: '4px 8px', fontSize: 13 }} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input className="form-input" type="number" min={0} value={cfg.quote_counter ?? 0} onChange={e => updateEntityConfig(entity.id, 'quote_counter', parseInt(e.target.value) || 0)}
                        style={{ width: 90, padding: '4px 8px', fontSize: 13 }} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input className="form-input" type="number" min={0} max={10} value={cfg.invoice_number_padding ?? 5} onChange={e => updateEntityConfig(entity.id, 'invoice_number_padding', parseInt(e.target.value) || 0)}
                        title="Minimum digits. 0 = no leading zeros (BTP739); 5 = padded (OBHI03667)."
                        style={{ width: 60, padding: '4px 8px', fontSize: 13 }} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{nextInv}</span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <SaveButton
                        saving={isSaving}
                        saved={isSaved}
                        onClick={() => saveEntityInvoiceConfig({ ...entity, ...cfg })}
                        compact
                      />
                      {saveError && (
                        <div style={{ ...errorStyle, whiteSpace: 'normal', maxWidth: 180 }}>{saveError}</div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Fleet ───────────────────────────────────────────────────── */}
      <Section title="Fleet" subtitle="Licence and vehicle management settings">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="form-label">Licence Expiry Warning Window</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['30', '60', '90'].map(days => {
              const active = licenceWarnDays === days
              return (
                <button
                  key={days}
                  onClick={async () => {
                    setLicenceWarnDays(days)
                    await saveSetting('fleet_licence_warn_days', days, 'Licence Expiry Warning Window')
                  }}
                  style={{
                    padding: '6px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent)' : 'var(--bg-surface)',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {days} days
                </button>
              )
            })}
            {savedOk.fleet_licence_warn_days && (
              <span style={{ fontSize: 12, color: 'var(--success)', alignSelf: 'center' }}>✓ Saved</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            The orange warning icon on the Fleet page will show licences expiring within this window.
            Currently: <strong>{licenceWarnDays} days</strong>
          </div>
        </div>
      </Section>

      {/* ── Diesel Maintenance ──────────────────────────────────────── */}
      <Section title="Diesel Maintenance" subtitle="Clear duplicate 'Pending' placeholder invoices left behind when a diesel statement import didn't absorb a pre-logged slip">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            For every slip that now appears on a real statement, this re-links its fill-up onto that
            statement and archives the leftover single-line placeholder. Always preview first — the dry
            run saves nothing.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-ghost btn-sm" onClick={() => runCleanup(false)} disabled={cleanupBusy}>
              {cleanupBusy ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Eraser size={13} />}
              {cleanupBusy ? 'Working…' : 'Preview cleanup (dry run)'}
            </button>
            {cleanupResult && !cleanupResult.committed && cleanupResult.archived_count > 0 && (
              <button className="btn-primary btn-sm" onClick={() => runCleanup(true)} disabled={cleanupBusy}>
                Archive {cleanupResult.archived_count} placeholder{cleanupResult.archived_count === 1 ? '' : 's'}
              </button>
            )}
          </div>

          {cleanupError && <div style={errorStyle}>{cleanupError}</div>}

          {cleanupResult && (
            <div style={{ fontSize: 13 }}>
              {cleanupResult.committed ? (
                <div style={{ color: 'var(--success)', fontWeight: 600 }}>
                  ✓ Archived {cleanupResult.archived_count} placeholder{cleanupResult.archived_count === 1 ? '' : 's'}.
                </div>
              ) : cleanupResult.archived_count === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>Nothing to clean up — no stranded placeholders found.</div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>
                  <strong>{cleanupResult.archived_count}</strong> placeholder{cleanupResult.archived_count === 1 ? '' : 's'} would be archived. Review below, then Archive to apply.
                </div>
              )}

              {cleanupResult.archived_count > 0 && (
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        {['Placeholder #', 'Match', 'Slip / Reg', 'Absorbed into', ''].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cleanupResult.archived.map(a => (
                        <tr key={a.placeholder_invoice_id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{a.placeholder_number || `#${a.placeholder_invoice_id}`}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{a.match}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{a.slip || a.vehicle_reg || '—'}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{a.statement_number || `#${a.absorbed_into_invoice_id}`}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>#{a.placeholder_invoice_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── System ──────────────────────────────────────────────────── */}
      <Section title="System" subtitle="Technical and operational settings">
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Additional system settings will appear here as the application grows — email configuration, automated reports, backup settings, and more.
        </div>
      </Section>

      <DeleteModal
        isOpen={!!deleteRoleTarget}
        onClose={() => setDeleteRoleTarget(null)}
        title="Delete Role"
        description={deleteRoleTarget ? `"${deleteRoleTarget.display_name}" will be permanently removed. Users with this role will need to be reassigned.` : ''}
        onDelete={async () => {
          setSaving(p => ({ ...p, roles: true }))
          try {
            await deleteRole(deleteRoleTarget.key)
            setRoles(prev => prev.filter(r => r.key !== deleteRoleTarget.key))
          } catch (e) {
            setErrors(p => ({ ...p, roles: errorMessage(e, 'Failed to delete role') }))
          } finally {
            setSaving(p => ({ ...p, roles: false }))
          }
          setDeleteRoleTarget(null)
        }}
      />
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>{subtitle}</p>}
      </div>
      <div className="card" style={{ padding: '20px 22px' }}>
        {children}
      </div>
    </div>
  )
}

function SaveButton({ saving, saved, onClick, compact = false }) {
  return (
    <button
      className={saved ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
      onClick={onClick}
      disabled={saving}
      style={compact ? { padding: '4px 10px' } : {}}
    >
      {saving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
      {saved ? <><span style={{ color: 'white' }}>✓ Saved</span></> : saving ? 'Saving...' : <><Save size={13} /> Save</>}
    </button>
  )
}

const errorStyle = { fontSize: 12, color: '#dc2626', marginTop: 6 }
