import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import {
  LayoutDashboard, Users, Building2, FileText, FileSearch,
  LogOut, Shield, Sun, Moon
} from 'lucide-react'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clients',   icon: Users,           label: 'Clients' },
  { to: '/invoices',  icon: FileText,        label: 'Invoices' },
  //{ to: '/quotes',    icon: FileSearch,      label: 'Quotes' },
  { to: '/audit',     icon: Shield,          label: 'Audit Log', adminOnly: true },
]

const ADMIN_NAV = [
  { to: '/entities', icon: Building2, label: 'Entities' },
  { to: '/users',    icon: Users,     label: 'Users' },
]

export default function Sidebar() {
  const { user, logout, isAdmin } = useAuth()
  const { isDark, toggle } = useTheme()
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <aside style={styles.sidebar}>
      {/* Logo */}
      <div style={styles.logo}>
        <div style={styles.logoIcon}>S</div>
        <div>
          <div style={styles.logoText}>safetec_core</div>
          <div style={styles.logoSub}>Business Management</div>
        </div>
      </div>

      <nav style={styles.nav}>
        {/* Main nav */}
        <div style={styles.navSection}>
          {NAV.filter(n => !n.adminOnly || isAdmin).map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}>
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
              <NavLink key={to} to={to} style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}>
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
          {isDark ? 'Light mode' : 'Dark mode'}
        </button>
      </div>

      {/* User footer */}
      <div style={styles.footer}>
        <div style={styles.userInfo}>
          <div style={styles.avatar}>{(user?.full_name || 'U')[0].toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.userName}>{user?.full_name}</div>
            <div style={styles.userRole}>{user?.role}</div>
          </div>
        </div>
        <button onClick={handleLogout} className="btn-icon btn-ghost" title="Logout">
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  )
}

const styles = {
  sidebar: {
    width: 220,
    minWidth: 220,
    background: 'var(--bg-surface)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    position: 'sticky',
    top: 0,
    overflow: 'hidden',
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '18px 16px',
    borderBottom: '1px solid var(--border)',
  },
  logoIcon: {
    width: 34, height: 34, borderRadius: 8,
    background: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 800, fontSize: 18, color: 'white', flexShrink: 0,
  },
  logoText: { fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' },
  logoSub: { fontSize: 10, color: 'var(--text-muted)' },
  nav: { flex: 1, overflowY: 'auto', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 16 },
  navSection: { display: 'flex', flexDirection: 'column', gap: 2 },
  navLabel: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1, color: 'var(--text-muted)', padding: '0 8px 6px',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', borderRadius: 6,
    color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
    transition: 'all 0.15s',
    textDecoration: 'none',
  },
  navItemActive: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    fontWeight: 600,
  },
  footer: {
    padding: '12px 12px',
    borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  userInfo: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  avatar: {
    width: 30, height: 30, borderRadius: '50%',
    background: 'var(--accent)', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: 13, flexShrink: 0,
  },
  userName: { fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userRole: { fontSize: 10, color: 'var(--text-muted)', textTransform: 'capitalize' },
}
