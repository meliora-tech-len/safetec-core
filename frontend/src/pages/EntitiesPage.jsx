import { useState, useEffect, useRef } from 'react'
import {
  Building2, Plus, Edit2, Archive, RotateCcw, Upload,
  ChevronDown, ChevronRight, X, Check, Palette
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

function api(path, opts = {}) {
  const token = localStorage.getItem('token')
  return fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers },
    ...opts,
  }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
}

const TABS = ['General', 'Banking', 'Branding', 'Invoice Config']

const DEFAULT_FORM = {
  code: '', name: '', trading_name: '', registration_number: '',
  vat_number: '', address: '', phone: '', email: '',
  bank_name: '', bank_branch: '', bank_account_number: '', bank_branch_code: '', bank_reference: '',
  primary_color: '#2563eb',
  invoice_prefix: '', invoice_counter: 0, quote_prefix: 'QT', quote_counter: 0,
  vat_rate: '0.15',
}

const PRESET_COLORS = [
  '#2563eb', '#1d4ed8', '#7c3aed', '#db2777', '#dc2626',
  '#ea580c', '#d97706', '#16a34a', '#0891b2', '#1a1a2e',
  '#374151', '#1f2937',
]

export default function EntitiesPage() {
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [modal, setModal] = useState(null) // null | { mode: 'create'|'edit', entity? }
  const [tab, setTab] = useState('General')
  const [form, setForm] = useState(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const fileInputRef = useRef()

  const load = async () => {
    setLoading(true)
    try {
      const data = await api(`/api/entities/?include_inactive=${showArchived}`)
      setEntities(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [showArchived])

  const openCreate = () => {
    setForm(DEFAULT_FORM)
    setLogoFile(null)
    setLogoPreview(null)
    setTab('General')
    setError('')
    setModal({ mode: 'create' })
  }

  const openEdit = (entity) => {
    setForm({
      code: entity.code || '',
      name: entity.name || '',
      trading_name: entity.trading_name || '',
      registration_number: entity.registration_number || '',
      vat_number: entity.vat_number || '',
      address: entity.address || '',
      phone: entity.phone || '',
      email: entity.email || '',
      bank_name: entity.bank_name || '',
      bank_branch: entity.bank_branch || '',
      bank_account_number: entity.bank_account_number || '',
      bank_branch_code: entity.bank_branch_code || '',
      bank_reference: entity.bank_reference || '',
      primary_color: entity.primary_color || '#2563eb',
      invoice_prefix: entity.invoice_prefix || '',
      invoice_counter: entity.invoice_counter || 0,
      quote_prefix: entity.quote_prefix || 'QT',
      quote_counter: entity.quote_counter || 0,
      vat_rate: String(entity.vat_rate || '0.15'),
    })
    setLogoFile(null)
    setLogoPreview(entity.logo_url || null)
    setTab('General')
    setError('')
    setModal({ mode: 'edit', entity })
  }

  const handleLogoSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setLogoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!form.code || !form.name) {
      setError('Code and Name are required')
      setTab('General')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        invoice_counter: parseInt(form.invoice_counter) || 0,
        quote_counter: parseInt(form.quote_counter) || 0,
        vat_rate: parseFloat(form.vat_rate) || 0.15,
      }

      let saved
      if (modal.mode === 'create') {
        saved = await api('/api/entities/', { method: 'POST', body: JSON.stringify(payload) })
      } else {
        const { code, ...updatePayload } = payload // code is not editable on update
        saved = await api(`/api/entities/${modal.entity.id}`, {
          method: 'PUT', body: JSON.stringify(updatePayload),
        })
      }

      // Upload logo if selected
      if (logoFile && saved.id) {
        const formData = new FormData()
        formData.append('file', logoFile)
        const token = localStorage.getItem('token')
        await fetch(`${API}/api/entities/${saved.id}/logo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
      }

      await load()
      setModal(null)
    } catch (e) {
      setError(e.detail || 'Failed to save entity')
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (entity) => {
    if (!confirm(`Archive "${entity.name}"? It will be hidden from normal use.`)) return
    try {
      await api(`/api/entities/${entity.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e.detail || 'Failed to archive entity')
    }
  }

  const handleRestore = async (entity) => {
    try {
      await api(`/api/entities/${entity.id}/restore`, { method: 'POST' })
      await load()
    } catch (e) {
      alert(e.detail || 'Failed to restore entity')
    }
  }

  const nextInvoice = `${form.invoice_prefix || form.code || 'INV'}${String((parseInt(form.invoice_counter) || 0) + 1).padStart(5, '0')}`
  const nextQuote = `${form.quote_prefix || 'QT'}${String((parseInt(form.quote_counter) || 0) + 1).padStart(5, '0')}`

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960 }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Business Entities</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: 13 }}>
            Manage your business entities, branding and invoice configuration
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className={showArchived ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
            onClick={() => setShowArchived(v => !v)}
          >
            <Archive size={13} /> {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
          <button className="btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} /> Add Entity
          </button>
        </div>
      </div>

      {/* Entity cards */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entities.map(entity => (
            <EntityCard
              key={entity.id}
              entity={entity}
              onEdit={() => openEdit(entity)}
              onArchive={() => handleArchive(entity)}
              onRestore={() => handleRestore(entity)}
            />
          ))}
          {entities.length === 0 && (
            <div style={{ color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>
              No entities found
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={overlay}>
          <div style={modalBox}>
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                {modal.mode === 'create' ? 'Add New Entity' : `Edit — ${modal.entity.name}`}
              </h2>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
              {TABS.map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '7px 14px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
                  background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer', marginBottom: -1,
                }}>
                  {t}
                </button>
              ))}
            </div>

            {error && <div style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626', padding: '8px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{error}</div>}

            {/* Tab: General */}
            {tab === 'General' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div>
                    <label className="form-label">Entity Code *</label>
                    <input className="form-input" value={form.code} disabled={modal.mode === 'edit'}
                      onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                      placeholder="e.g. SFT" style={{ fontFamily: 'monospace', opacity: modal.mode === 'edit' ? 0.6 : 1 }} />
                    {modal.mode === 'edit' && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Code cannot be changed after creation</div>}
                  </div>
                  <div>
                    <label className="form-label">Legal Name *</label>
                    <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Legal registered name" />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <label className="form-label">Trading Name</label>
                    <input className="form-input" value={form.trading_name} onChange={e => setForm(p => ({ ...p, trading_name: e.target.value }))} placeholder="If different from legal name" />
                  </div>
                  <div>
                    <label className="form-label">Registration Number</label>
                    <input className="form-input" value={form.registration_number} onChange={e => setForm(p => ({ ...p, registration_number: e.target.value }))} placeholder="YYYY/NNNNNN/NN" />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <label className="form-label">VAT Number</label>
                    <input className="form-input" value={form.vat_number} onChange={e => setForm(p => ({ ...p, vat_number: e.target.value }))} placeholder="10-digit VAT number" />
                  </div>
                  <div>
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="Business email address" />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <label className="form-label">Phone</label>
                    <input className="form-input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="Business phone number" />
                  </div>
                </div>
                <div>
                  <label className="form-label">Address</label>
                  <textarea className="form-input" rows={3} value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Street address, city, postal code" />
                </div>
              </div>
            )}

            {/* Tab: Banking */}
            {tab === 'Banking' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div>
                    <label className="form-label">Bank Name</label>
                    <input className="form-input" value={form.bank_name} onChange={e => setForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="e.g. Standard Bank" />
                  </div>
                  <div>
                    <label className="form-label">Branch Name</label>
                    <input className="form-input" value={form.bank_branch} onChange={e => setForm(p => ({ ...p, bank_branch: e.target.value }))} placeholder="Branch name or description" />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <label className="form-label">Account Number</label>
                    <input className="form-input" value={form.bank_account_number} onChange={e => setForm(p => ({ ...p, bank_account_number: e.target.value }))} placeholder="Bank account number" />
                  </div>
                  <div>
                    <label className="form-label">Branch Code</label>
                    <input className="form-input" value={form.bank_branch_code} onChange={e => setForm(p => ({ ...p, bank_branch_code: e.target.value }))} placeholder="6-digit branch code" />
                  </div>
                </div>
                <div>
                  <label className="form-label">Payment Reference</label>
                  <input className="form-input" value={form.bank_reference} onChange={e => setForm(p => ({ ...p, bank_reference: e.target.value }))} placeholder="Invoice number / Company name" />
                </div>
              </div>
            )}

            {/* Tab: Branding */}
            {tab === 'Branding' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Logo upload */}
                <div>
                  <label className="form-label">Company Logo</label>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginTop: 6 }}>
                    {/* Preview */}
                    <div style={{
                      width: 100, height: 80, border: '1px solid var(--border)', borderRadius: 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--bg-secondary)', overflow: 'hidden', flexShrink: 0,
                    }}>
                      {logoPreview
                        ? <img src={logoPreview} alt="logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                        : <Building2 size={28} color="var(--text-muted)" />
                      }
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button className="btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
                        <Upload size={13} /> {logoPreview ? 'Replace Logo' : 'Upload Logo'}
                      </button>
                      {logoFile && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{logoFile.name}</div>}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        PNG, JPG, SVG or WebP<br />Max 2MB
                      </div>
                      {logoPreview && !logoFile && (
                        <button className="btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                          onClick={() => { setLogoPreview(null); setLogoFile(null) }}>
                          Remove
                        </button>
                      )}
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoSelect} />
                  </div>
                </div>

                {/* Color */}
                <div>
                  <label className="form-label">Brand Color</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    <input type="color" value={form.primary_color}
                      onChange={e => setForm(p => ({ ...p, primary_color: e.target.value }))}
                      style={{ width: 44, height: 36, padding: 2, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                    <input className="form-input" value={form.primary_color}
                      onChange={e => setForm(p => ({ ...p, primary_color: e.target.value }))}
                      placeholder="#2563eb" style={{ width: 110, fontFamily: 'monospace' }} />
                  </div>
                  {/* Presets */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {PRESET_COLORS.map(c => (
                      <button key={c} onClick={() => setForm(p => ({ ...p, primary_color: c }))}
                        style={{
                          width: 26, height: 26, borderRadius: 6, background: c, border: 'none',
                          cursor: 'pointer', outline: form.primary_color === c ? `2px solid ${c}` : 'none',
                          outlineOffset: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                        {form.primary_color === c && <Check size={12} color="white" />}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                    This color is used on the dashboard header and invoice PDF
                  </div>
                </div>

                {/* Preview badge */}
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Preview</div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    background: form.primary_color, borderRadius: 8, width: 'fit-content',
                  }}>
                    {logoPreview
                      ? <img src={logoPreview} alt="" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
                      : <Building2 size={20} color="white" />
                    }
                    <span style={{ color: 'white', fontWeight: 700, fontSize: 14 }}>
                      {form.trading_name || form.name || 'Entity Name'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Invoice Config */}
            {tab === 'Invoice Config' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Invoice numbers are formatted as <strong>PREFIX</strong> + padded counter (e.g. SFT03510).
                  The counter increments automatically with each new invoice. You can edit the number on individual invoices if needed.
                </div>

                {/* Invoice prefix/counter */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Invoices</div>
                  <div className="form-row">
                    <div>
                      <label className="form-label">Invoice Prefix</label>
                      <input className="form-input" value={form.invoice_prefix}
                        onChange={e => setForm(p => ({ ...p, invoice_prefix: e.target.value.toUpperCase() }))}
                        placeholder={form.code || 'SFT'} style={{ fontFamily: 'monospace' }} />
                    </div>
                    <div>
                      <label className="form-label">Current Counter</label>
                      <input className="form-input" type="number" min={0} value={form.invoice_counter}
                        onChange={e => setForm(p => ({ ...p, invoice_counter: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    Next invoice: <strong style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{nextInvoice}</strong>
                  </div>
                </div>

                {/* Quote prefix/counter */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Quotes</div>
                  <div className="form-row">
                    <div>
                      <label className="form-label">Quote Prefix</label>
                      <input className="form-input" value={form.quote_prefix}
                        onChange={e => setForm(p => ({ ...p, quote_prefix: e.target.value.toUpperCase() }))}
                        placeholder="QT" style={{ fontFamily: 'monospace' }} />
                    </div>
                    <div>
                      <label className="form-label">Current Counter</label>
                      <input className="form-input" type="number" min={0} value={form.quote_counter}
                        onChange={e => setForm(p => ({ ...p, quote_counter: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    Next quote: <strong style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{nextQuote}</strong>
                  </div>
                </div>

                {/* VAT rate override */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>VAT</div>
                  <div style={{ maxWidth: 200 }}>
                    <label className="form-label">Entity VAT Rate (%)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input className="form-input" type="number" step="0.01" min="0" max="1"
                        value={parseFloat(form.vat_rate) * 100}
                        onChange={e => setForm(p => ({ ...p, vat_rate: String(parseFloat(e.target.value) / 100 || 0) }))}
                        placeholder="15" style={{ width: 80 }} />
                      <span style={{ color: 'var(--text-secondary)' }}>%</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Override entity-specific VAT rate. Leave as global setting if unsure.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Modal footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button className="btn-ghost btn-sm" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
              <button className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : modal.mode === 'create' ? 'Create Entity' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EntityCard({ entity, onEdit, onArchive, onRestore }) {
  const isArchived = !entity.is_active
  const color = entity.primary_color || '#2563eb'
  const nextInv = `${entity.invoice_prefix || entity.code}${String((entity.invoice_counter || 0) + 1).padStart(5, '0')}`

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
      opacity: isArchived ? 0.65 : 1,
      borderLeft: `4px solid ${isArchived ? 'var(--text-muted)' : color}`,
    }}>
      {/* Color / Logo */}
      <div style={{
        width: 44, height: 44, borderRadius: 8, background: isArchived ? '#aaa' : color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden',
      }}>
        {entity.logo_url
          ? <img src={entity.logo_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span style={{ color: 'white', fontWeight: 800, fontSize: 16 }}>{entity.code?.[0] || '?'}</span>
        }
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{entity.name}</span>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 4 }}>
            {entity.code}
          </span>
          {isArchived && <span style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '1px 6px', borderRadius: 4 }}>Archived</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {[entity.vat_number && `VAT: ${entity.vat_number}`, `Next invoice: ${nextInv}`].filter(Boolean).join('  ·  ')}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-ghost btn-sm" onClick={onEdit}><Edit2 size={13} /> Edit</button>
        {isArchived
          ? <button className="btn-ghost btn-sm" onClick={onRestore}><RotateCcw size={13} /> Restore</button>
          : <button className="btn-ghost btn-sm" style={{ color: 'var(--text-muted)' }} onClick={onArchive}><Archive size={13} /> Archive</button>
        }
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}

const modalBox = {
  background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 620,
  maxHeight: '90vh', overflowY: 'auto', padding: '24px 28px',
  border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
}
