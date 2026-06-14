import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import FeedbackWidget from '../FeedbackWidget'
import ErrorBoundary from '../ErrorBoundary'
import { useAuth } from '../../hooks/useAuth'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useFieldArrowNav } from '../../hooks/useFieldArrowNav'

export default function AppLayout() {
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const { activeEntity } = useAuth()

  // Excel-style Left/Right arrow navigation between form fields, app-wide.
  useFieldArrowNav()

  // Close the drawer on route change and whenever we leave mobile width
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])
  useEffect(() => { if (!isMobile) setDrawerOpen(false) }, [isMobile])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {isMobile && drawerOpen && (
        <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />
      )}

      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Mobile top bar — CSS hides it on desktop */}
        <div className="mobile-topbar">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', padding: 4, display: 'flex' }}
          >
            <Menu size={22} />
          </button>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            {activeEntity ? activeEntity.code : 'safetec_core'}
          </span>
        </div>

        {/* Key by active entity so switching entities remounts the current page,
            forcing it to refetch its entity-scoped data (branding alone isn't enough). */}
        <ErrorBoundary key={activeEntity?.id ?? 'all'}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' },
          success: { iconTheme: { primary: 'var(--success)', secondary: 'var(--bg-card)' } },
          error: { iconTheme: { primary: 'var(--danger)', secondary: 'var(--bg-card)' } },
        }}
      />
      <FeedbackWidget />
    </div>
  )
}
