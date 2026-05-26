import { Outlet } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Sidebar from './Sidebar'
import FeedbackWidget from '../FeedbackWidget'
import ErrorBoundary from '../ErrorBoundary'

export default function AppLayout() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <ErrorBoundary>
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
