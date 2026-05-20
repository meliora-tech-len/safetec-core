import { useState, useEffect } from 'react'
import { Users, Plus, Edit2, Key, Shield, UserX, UserCheck, X, Check, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getUsers, getEntities, getRoles,
  createUser, updateUser, deleteUser,
  updateUserPermissions, resetUserPassword, reactivateUser,
} from '../services/api'
import DeleteModal from '../components/DeleteModal'

const ALL_MODULES = [
  { key: 'suppliers',   label: 'Suppliers',             description: 'Supplier records & management' },
  { key: 'invoices',    label: 'Billing & Invoices',    description: 'Quotes, invoices & purchase orders' },
  { key: 'fleet',       label: 'Fleet & Vehicles',      description: 'Trucks, trailers & personal vehicles' },
  { key: 'drivers',     label: 'Drivers & Assignments', description: 'Driver records & truck assignments' },
  { key: 'truck_loads', label: 'Truck Loads',           description: 'Truck load records & route management' },
  { key: 'diesel',      label: 'Diesel',                description: 'Diesel fill-ups, consumption & rates' },
]

const TABS_USER = ['Details', 'Password', 'Permissions']

const DEFAULT_FORM = { full_name: '', email: '', role: 'standard', is_active: true }

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [entities, setEntities] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | { mode, user? }
  const [tab, setTab] = useState('Details')
  const [form, setForm] = useState(DEFAULT_FORM)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  const pwChecks = {
    length:  password.length >= 8,
    upper:   /[A-Z]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  }
  const pwAllMet = pwChecks.length && pwChecks.upper && pwChecks.special
  const [permissions, setPermissions] = useState([]) // [{ entity_id, enabled, modules[], can_create, can_edit, can_delete }]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [uRes, eRes, rRes] = await Promise.all([getUsers(), getEntities(), getRoles()])
      setUsers(uRes.data)
      setEntities(eRes.data)
      setRoles(rRes.data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const buildDefaultPermissions = (user = null) => {
    return entities.map(entity => {
      const existing = user?.entity_access?.find(a => a.entity_id === entity.id)
      return {
        entity_id: entity.id,
        entity_code: entity.code,
        entity_name: entity.name,
        entity_color: entity.primary_color || '#2563eb',
        enabled: !!existing,
        allowed_modules: existing?.allowed_modules || ['suppliers', 'invoices'],
        can_create: existing?.can_create ?? true,
        can_edit: existing?.can_edit ?? true,
        can_delete: existing?.can_delete ?? false,
      }
    })
  }

  const openCreate = () => {
    setForm(DEFAULT_FORM)
    setPassword('')
    setPermissions(buildDefaultPermissions())
    setTab('Details')
    setError('')
    setModal({ mode: 'create' })
  }

  const openEdit = (user) => {
    setForm({ full_name: user.full_name, email: user.email, role: user.role, is_active: user.is_active })
    setPassword('')
    setPermissions(buildDefaultPermissions(user))
    setTab('Details')
    setError('')
    setModal({ mode: 'edit', user })
  }

  const openPermissions = (user) => {
    setForm({ full_name: user.full_name, email: user.email, role: user.role, is_active: user.is_active })
    setPermissions(buildDefaultPermissions(user))
    setTab('Permissions')
    setError('')
    setModal({ mode: 'edit', user })
  }

  const toggleEntityAccess = (entityId) => {
    setPermissions(prev => prev.map(p =>
      p.entity_id === entityId ? { ...p, enabled: !p.enabled } : p
    ))
  }

  const toggleModule = (entityId, moduleKey) => {
    setPermissions(prev => prev.map(p => {
      if (p.entity_id !== entityId) return p
      const mods = p.allowed_modules.includes(moduleKey)
        ? p.allowed_modules.filter(m => m !== moduleKey)
        : [...p.allowed_modules, moduleKey]
      return { ...p, allowed_modules: mods }
    }))
  }

  const handleSave = async () => {
    if (!form.full_name || !form.email) {
      setError('Name and email are required')
      setTab('Details')
      return
    }
    if (modal.mode === 'create' && !password) {
      setError('Password is required for new users')
      setTab('Password')
      return
    }
    if (password && !pwAllMet) {
      setError('Password must meet all requirements')
      setTab('Password')
      return
    }

    setSaving(true)
    setError('')
    try {
      let savedUser
      if (modal.mode === 'create') {
        savedUser = (await createUser({ ...form, password, entity_ids: [] })).data
      } else {
        const updatePayload = { ...form }
        if (password) updatePayload.password = password
        savedUser = (await updateUser(modal.user.id, updatePayload)).data
      }

      // Save permissions
      const userId = savedUser.id || modal.user?.id
      const permsPayload = {
        permissions: permissions
          .filter(p => p.enabled)
          .map(p => ({
            entity_id: p.entity_id,
            allowed_modules: p.allowed_modules,
            can_create: p.can_create,
            can_edit: p.can_edit,
            can_delete: p.can_delete,
          })),
      }
      await updateUserPermissions(userId, permsPayload)

      await load()
      setModal(null)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const handleDeactivate = (user) => setDeactivateTarget(user)

  const handleReactivate = async (user) => {
    try {
      await reactivateUser(user.id)
      await load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to reactivate user') }
  }

  const handlePasswordReset = async () => {
    if (!pwAllMet) {
      setError('Password must meet all requirements')
      return
    }
    setSaving(true)
    setError('')
    try {
      await resetUserPassword(modal.user.id, { new_password: password })
      setPassword('')
      toast.success('Password updated successfully')
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to reset password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 980 }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>User Management</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: 13 }}>
            Manage users, passwords and entity/module permissions
          </p>
        </div>
        <button className="btn-primary btn-sm" onClick={openCreate}>
          <Plus size={14} /> Add User
        </button>
      </div>

      {/* Users table */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading...</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['User', 'Role', 'Entity Access', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{user.full_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user.email}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className={`badge badge-${user.role}`}>
                      {roles.find(r => r.key === user.role)?.display_name || user.role}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {user.role === 'admin' ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>All entities</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {user.entity_access?.map(a => (
                          <span key={a.entity_id} style={{
                            fontSize: 11, fontFamily: 'monospace', background: 'var(--bg-secondary)',
                            padding: '1px 6px', borderRadius: 4, color: 'var(--text-secondary)',
                          }}>
                            {a.entity_code || a.entity_id}
                          </span>
                        ))}
                        {(!user.entity_access || user.entity_access.length === 0) && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>None</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                      background: user.is_active ? 'rgba(22,163,74,0.12)' : 'rgba(0,0,0,0.06)',
                      color: user.is_active ? '#16a34a' : '#9ca3af',
                    }}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-ghost btn-sm" onClick={() => openEdit(user)} title="Edit user">
                        <Edit2 size={13} />
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => openPermissions(user)} title="Manage permissions">
                        <Shield size={13} />
                      </button>
                      {user.is_active
                        ? <button className="btn-ghost btn-sm" style={{ color: 'var(--text-muted)' }} onClick={() => handleDeactivate(user)} title="Deactivate"><UserX size={13} /></button>
                        : <button className="btn-ghost btn-sm" style={{ color: '#16a34a' }} onClick={() => handleReactivate(user)} title="Reactivate"><UserCheck size={13} /></button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={overlay}>
          <div style={modalBox}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                {modal.mode === 'create' ? 'Add New User' : `Edit — ${modal.user?.full_name}`}
              </h2>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
              {TABS_USER.map(t => (
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

            {/* Tab: Details */}
            {tab === 'Details' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div>
                    <label className="form-label">Full Name *</label>
                    <input className="form-input" value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder="Jane Smith" />
                  </div>
                  <div>
                    <label className="form-label">Email *</label>
                    <input className="form-input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="jane@safetec.co.za" />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <label className="form-label">Role</label>
                    <select className="form-input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                      {roles.map(r => (
                        <option key={r.key} value={r.key}>{r.display_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Status</label>
                    <select className="form-input" value={form.is_active ? 'active' : 'inactive'} onChange={e => setForm(p => ({ ...p, is_active: e.target.value === 'active' }))}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
                {modal.mode === 'create' && (
                  <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Set the user's initial password in the <strong>Password</strong> tab, then configure entity access in the <strong>Permissions</strong> tab.
                  </div>
                )}
              </div>
            )}

            {/* Tab: Password */}
            {tab === 'Password' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                  {modal.mode === 'create'
                    ? 'Set the initial password for this user. They should change it after first login.'
                    : 'Set a new password for this user. The user will be able to log in immediately with the new password.'
                  }
                </div>
                <div>
                  <label className="form-label">{modal.mode === 'create' ? 'Password *' : 'New Password'}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      style={{ paddingRight: 40 }}
                    />
                    <button onClick={() => setShowPw(p => !p)} style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                    }}>
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {[
                      { met: pwChecks.length,  label: 'At least 8 characters' },
                      { met: pwChecks.upper,   label: 'At least 1 uppercase letter' },
                      { met: pwChecks.special, label: 'At least 1 special character (e.g. !@#$)' },
                    ].map(({ met, label }) => (
                      <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: met ? '#16a34a' : 'var(--text-muted)', transition: 'color 0.2s' }}>
                        <span style={{
                          width: 14, height: 14, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: met ? '#16a34a' : 'transparent',
                          border: met ? 'none' : '1.5px solid var(--border)',
                          transition: 'all 0.2s',
                        }}>
                          {met && <svg width="8" height="8" viewBox="0 0 8 8"><polyline points="1,4 3,6 7,2" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </span>
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
                {modal.mode === 'edit' && password && (
                  <button className="btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={handlePasswordReset} disabled={saving || !pwAllMet}>
                    <Key size={13} /> {saving ? 'Updating...' : 'Update Password Now'}
                  </button>
                )}
              </div>
            )}

            {/* Tab: Permissions */}
            {tab === 'Permissions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Enable entities this user can access, then select which modules they can see within each entity. Admins automatically see everything.
                </div>

                {form.role === 'admin' && (
                  <div style={{ padding: '10px 12px', background: 'rgba(37,99,235,0.08)', borderRadius: 8, fontSize: 13, color: 'var(--accent)' }}>
                    Admin users have access to all entities and modules.
                  </div>
                )}

                {form.role !== 'admin' && permissions.map(perm => (
                  <div key={perm.entity_id} style={{
                    border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
                    borderLeft: perm.enabled ? `3px solid ${perm.entity_color}` : '3px solid var(--border)',
                    opacity: perm.enabled ? 1 : 0.6,
                  }}>
                    {/* Entity header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      background: perm.enabled ? 'var(--bg-secondary)' : 'transparent',
                    }}>
                      <input type="checkbox" checked={perm.enabled} onChange={() => toggleEntityAccess(perm.entity_id)}
                        style={{ width: 15, height: 15, cursor: 'pointer', accentColor: perm.entity_color }} />
                      <div style={{
                        width: 28, height: 28, borderRadius: 6, background: perm.entity_color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: 'white',
                      }}>
                        {perm.entity_code?.[0]}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{perm.entity_name}</div>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{perm.entity_code}</div>
                      </div>
                    </div>

                    {/* Module checkboxes */}
                    {perm.enabled && (
                      <div style={{ padding: '10px 14px 12px 48px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {ALL_MODULES.map(mod => {
                          const checked = perm.allowed_modules.includes(mod.key)
                          return (
                            <label key={mod.key} title={mod.description} style={{
                              display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                              padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: checked ? 600 : 400,
                              background: checked ? `${perm.entity_color}20` : 'var(--bg-secondary)',
                              color: checked ? perm.entity_color : 'var(--text-secondary)',
                              border: `1px solid ${checked ? perm.entity_color : 'var(--border)'}`,
                              transition: 'all 0.15s',
                            }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleModule(perm.entity_id, mod.key)}
                                style={{ display: 'none' }} />
                              {checked && <Check size={11} />}
                              {mod.label}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button className="btn-ghost btn-sm" onClick={() => setModal(null)} disabled={saving}>Cancel</button>
              <button className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : modal.mode === 'create' ? 'Create User' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteModal
        isOpen={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        title="Deactivate User"
        description={deactivateTarget ? `"${deactivateTarget.full_name}" will no longer be able to log in.` : ''}
        onArchive={async () => {
          try { await deleteUser(deactivateTarget.id); await load() }
          catch (e) { toast.error(e.response?.data?.detail || 'Failed to deactivate user') }
          setDeactivateTarget(null)
        }}
      />
    </div>
  )
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}

const modalBox = {
  background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 680,
  maxHeight: '92vh', overflowY: 'auto', padding: '24px 28px',
  border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
}
