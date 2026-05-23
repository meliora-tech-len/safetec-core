import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { resetUserPassword } from '../../services/api'
import toast from 'react-hot-toast'
import {
  LayoutDashboard, Users, Building2, FileText,
  LogOut, Shield, Sun, Moon, Settings, ChevronDown, Truck,
  FileCheck, FilePlus, ShoppingCart, Package, MapPin, Fuel, BarChart2, Link2,
  Key, Eye, EyeOff, X, UserCheck,
} from 'lucide-react'

function hexToRgb(hex) {
  const h = hex.replace('#', '').padEnd(6, '0')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function darkenHex(hex, factor) {
  const { r, g, b } = hexToRgb(hex)
  const ch = (v) => Math.max(0, Math.round(v * (1 - factor))).toString(16).padStart(2, '0')
  return `#${ch(r)}${ch(g)}${ch(b)}`
}

const NAV = [
  { to: '/dashboard',         icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/suppliers',         icon: Users,           label: 'Suppliers',    module: 'suppliers' },
  { to: '/customers',         icon: UserCheck,       label: 'Customers',    module: 'invoices' },
  { to: '/fleet',             icon: Truck,           label: 'Fleet',        module: 'fleet',        end: true },
  { to: '/subcontractors',    icon: Building2,       label: 'Subcontractors', module: 'fleet' },
  { to: '/drivers',           icon: Users,           label: 'Drivers',      module: 'drivers' },
  { to: '/fleet/assignments', icon: Link2,           label: 'Assignments',  module: 'drivers' },
  { to: '/truck-loads',       icon: Package,         label: 'Truck Loads',  module: 'truck_loads' },
  { to: '/diesel',            icon: Fuel,            label: 'Diesel',       module: 'diesel' },
  { to: '/audit',             icon: Shield,          label: 'Audit Log',    adminOnly: true },
]

const DOCUMENTS_NAV = [
  { to: '/quotes',           icon: FileCheck,    label: 'Quotes',    module: 'invoices' },
  { to: '/invoices',         icon: FileText,     label: 'Invoices',  module: 'invoices' },
  { to: '/purchase-orders',  icon: ShoppingCart, label: 'PO\'s',     module: 'invoices' },
]

const ADMIN_NAV = [
  { to: '/entities', icon: Building2, label: 'Entities' },
  { to: '/users',    icon: Users,     label: 'Users' },
]

const SETTINGS_NAV = [
  { to: '/settings/mines',        icon: MapPin,    label: 'Mines' },
  { to: '/reports',               icon: BarChart2, label: 'Reports' },
  { to: '/settings/payroll',      icon: Settings,  label: 'Payroll Rates' },
  { to: '/settings/diesel-rates', icon: Fuel,      label: 'Diesel Rates' },
  { to: '/settings',              icon: Settings,  label: 'Settings',     end: true },
]

export default function Sidebar() {
  const { user, logout, isAdmin, activeEntity, entities, setActiveEntity } = useAuth()
  const { isDark, toggle } = useTheme()
  const navigate = useNavigate()
  const [entityMenuOpen, setEntityMenuOpen] = useState(false)
  const entityMenuRef = useRef(null)
  const [pwOpen, setPwOpen]       = useState(false)
  const [newPw, setNewPw]         = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [pwSaving, setPwSaving]   = useState(false)

  const pwChecks = {
    length:  newPw.length >= 8,
    upper:   /[A-Z]/.test(newPw),
    special: /[^A-Za-z0-9]/.test(newPw),
  }
  const pwAllMet = pwChecks.length && pwChecks.upper && pwChecks.special

  const handleLogout = () => { logout(); navigate('/login') }

  const handleSelfPasswordChange = async () => {
    if (!pwAllMet) return
    setPwSaving(true)
    try {
      await resetUserPassword(user.id, { new_password: newPw })
      toast.success('Password updated')
      setNewPw('')
      setPwOpen(false)
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to update password')
    } finally { setPwSaving(false) }
  }

  // Close entity dropdown when clicking outside
  useEffect(() => {
    if (!entityMenuOpen) return
    const handler = (e) => {
      if (entityMenuRef.current && !entityMenuRef.current.contains(e.target))
        setEntityMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [entityMenuOpen])

  const canSwitchEntity = !isAdmin && entities.length > 1

  // Apply / clear entity branding colors whenever activeEntity changes
  useEffect(() => {
    const el = document.documentElement
    if (activeEntity) {
      const c = activeEntity.primary_color || '#2563eb'
      const { r, g, b } = hexToRgb(c)
      el.style.setProperty('--accent', c)
      el.style.setProperty('--accent-hover', darkenHex(c, 0.12))
      el.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`)
      el.style.setProperty('--accent-subtle', `rgba(${r},${g},${b},0.1)`)
      el.style.setProperty('--border-accent', `rgba(${r},${g},${b},0.3)`)
    } else {
      // No entity selected — revert to CSS theme defaults
      el.style.removeProperty('--accent')
      el.style.removeProperty('--accent-hover')
      el.style.removeProperty('--accent-dim')
      el.style.removeProperty('--accent-subtle')
      el.style.removeProperty('--border-accent')
    }
  }, [activeEntity])

  // Filter nav items by module access
  const getEntityAccess = () => {
    if (!activeEntity || isAdmin) return null
    return user?.entity_access?.find(a => a.entity_id === activeEntity.id)
  }
  const entityAccess = getEntityAccess()

  const visibleNav = NAV.filter(item => {
    if (item.adminOnly && !isAdmin) return false
    if (!item.module) return true  // no module restriction (dashboard)
    if (isAdmin) return true
    if (!entityAccess) return false
    return (entityAccess.allowed_modules || []).includes(item.module)
  })

  const visibleDocNav = DOCUMENTS_NAV.filter(item => {
    if (isAdmin) return true
    if (!entityAccess) return false
    return (entityAccess.allowed_modules || []).includes(item.module)
  })

  const logoLetter = activeEntity?.code?.[0] || 'S'
  const logoUrl = activeEntity?.logo_url

  return (
    <aside style={styles.sidebar}>
      {/* Logo / Entity */}
      <div style={{ ...styles.logo, position: 'relative' }} ref={entityMenuRef}>
        <div style={{
          ...styles.logoIcon,
          background: activeEntity?.primary_color || 'var(--accent)',
          overflow: 'hidden',
        }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : <span style={{ color: 'white', fontWeight: 800, fontSize: 15 }}>{logoLetter}</span>
          }
        </div>
        <div
          style={{ flex: 1, minWidth: 0, cursor: canSwitchEntity ? 'pointer' : 'default' }}
          onClick={() => canSwitchEntity && setEntityMenuOpen(o => !o)}
        >
          <div style={styles.logoText}>safetec_core</div>
          <div style={{ ...styles.logoSub, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeEntity ? activeEntity.code : 'Business Management'}
            </span>
            {canSwitchEntity && <ChevronDown size={10} />}
          </div>
        </div>

        {/* Entity switcher dropdown */}
        {entityMenuOpen && (
          <div style={styles.entityDropdown}>
            {entities.map(e => (
              <button
                key={e.id}
                style={{
                  ...styles.entityDropdownItem,
                  background: activeEntity?.id === e.id ? 'var(--accent-subtle)' : 'transparent',
                  color: activeEntity?.id === e.id ? 'var(--accent)' : 'var(--text-primary)',
                  fontWeight: activeEntity?.id === e.id ? 600 : 400,
                }}
                onClick={() => { setActiveEntity(e); setEntityMenuOpen(false) }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 5, background: e.primary_color || 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800, color: 'white', flexShrink: 0,
                }}>
                  {e.code?.[0]}
                </span>
                <span style={{ fontSize: 12 }}>{e.code} — {e.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <nav style={styles.nav}>
        {/* Main nav */}
        <div style={styles.navSection}>
          {visibleNav.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={!!end} style={({ isActive }) => ({
              ...styles.navItem,
              ...(isActive ? styles.navItemActive : {}),
            })}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        {/* Billing nav */}
        {visibleDocNav.length > 0 && (
          <div>
            <div style={styles.navLabel}>Billing</div>
            {visibleDocNav.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} style={({ isActive }) => ({
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {}),
              })}>
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {/* Settings nav */}
        <div>
          <div style={styles.navLabel}>Settings</div>
          {SETTINGS_NAV.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={!!end} style={({ isActive }) => ({
              ...styles.navItem,
              ...(isActive ? styles.navItemActive : {}),
            })}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        {/* Admin nav */}
        {isAdmin && (
          <div>
            <div style={styles.navLabel}>Administration</div>
            {ADMIN_NAV.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} end style={({ isActive }) => ({
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {}),
              })}>
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        )}


      </nav>

      {/* Theme toggle */}
      <div style={{ padding: '0 12px 10px' }}>
        <button className="theme-toggle" onClick={toggle} style={{ width: '100%', justifyContent: 'center' }}>
          {isDark ? <Sun size={13} /> : <Moon size={13} />}
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </button>
      </div>

      {/* User */}
      <div style={styles.userSection}>
        <div style={styles.userInfo}>
          <div style={styles.avatar}>{user?.full_name?.[0]?.toUpperCase() || 'U'}</div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.userName}>{user?.full_name}</div>
            <div style={styles.userRole}>{user?.role}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => { setNewPw(''); setShowNewPw(false); setPwOpen(true) }} style={styles.logoutBtn} title="Change password">
            <Key size={14} />
          </button>
          <button onClick={handleLogout} style={styles.logoutBtn} title="Logout">
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Change Password modal — portalled to body so it sits above all page stacking contexts */}
      {pwOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: 360, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Change Password</span>
              <button onClick={() => setPwOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={17} />
              </button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Updating password for <strong>{user?.full_name}</strong>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Password</label>
            <div style={{ position: 'relative', marginTop: 6, marginBottom: 6 }}>
              <input
                className="form-input"
                type={showNewPw ? 'text' : 'password'}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="Minimum 8 characters"
                style={{ paddingRight: 38 }}
                autoFocus
              />
              <button type="button" onClick={() => setShowNewPw(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}>
                {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
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
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn-ghost btn-sm" onClick={() => setPwOpen(false)} disabled={pwSaving}>Cancel</button>
              <button className="btn-primary btn-sm" onClick={handleSelfPasswordChange} disabled={pwSaving || !pwAllMet}>
                {pwSaving ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </aside>
  )
}

const styles = {
  sidebar: {
    width: 210, flexShrink: 0, background: 'var(--bg-sidebar)',
    borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
    height: '100vh', position: 'sticky', top: 0,
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '16px 14px', borderBottom: '1px solid var(--border)',
  },
  logoIcon: {
    width: 34, height: 34, borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  logoText: { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' },
  logoSub: { fontSize: 10, color: 'var(--text-muted)', marginTop: 1 },
  nav: { flex: 1, padding: '10px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
  navSection: { display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 8 },
  navLabel: { fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 8px 4px' },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
    borderRadius: 7, fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)',
    textDecoration: 'none', transition: 'all 0.12s',
  },
  navItemActive: {
    background: 'var(--accent-subtle)', color: 'var(--accent)', fontWeight: 600,
  },
  userSection: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', borderTop: '1px solid var(--border)',
  },
  userInfo: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  avatar: {
    width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, color: 'white', flexShrink: 0,
  },
  userName: { fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userRole: { fontSize: 10, color: 'var(--text-muted)' },
  logoutBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', borderRadius: 6 },
  entityDropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 8, boxShadow: 'var(--shadow)', padding: 4,
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  entityDropdownItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
    textAlign: 'left', width: '100%',
  },
}
