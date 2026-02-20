import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ClientsPage from './pages/ClientsPage'
import InvoicesPage from './pages/InvoicesPage'
import InvoiceFormPage from './pages/InvoiceFormPage'
import InvoiceDetailPage from './pages/InvoiceDetailPage'
import AuditPage from './pages/AuditPage'
import './styles/globals.css'

function PrivateRoute({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

function AdminRoute({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route path="/dashboard" element={<DashboardPage />} />

            {/* Clients */}
            <Route path="/clients" element={<ClientsPage />} />

            {/* Invoices */}
            <Route path="/invoices" element={<InvoicesPage docType="invoice" />} />
            <Route path="/invoices/new" element={<InvoiceFormPage docType="invoice" />} />
            <Route path="/invoices/:id" element={<InvoiceDetailPage docType="invoice" />} />
            <Route path="/invoices/:id/edit" element={<InvoiceFormPage docType="invoice" />} />

            {/* Quotes 
            <Route path="/quotes" element={<InvoicesPage docType="quote" />} />
            <Route path="/quotes/new" element={<InvoiceFormPage docType="quote" />} />
            <Route path="/quotes/:id" element={<InvoiceDetailPage docType="quote" />} />
            <Route path="/quotes/:id/edit" element={<InvoiceFormPage docType="quote" />} />*/}

            {/* Admin only */}
            <Route path="/audit" element={<AdminRoute><AuditPage /></AdminRoute>} />
            <Route path="/entities" element={<AdminRoute><EntitiesPlaceholder /></AdminRoute>} />
            <Route path="/users" element={<AdminRoute><UsersPlaceholder /></AdminRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}

// Placeholder pages (easily expandable)
function EntitiesPlaceholder() {
  return (
    <div style={{ padding: '28px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Business Entities</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Manage your 6 business entities. Entity editing is done via the admin panel or seed script.</p>
      <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13 }}>
         Manage Multiple Business Entities
      </p>
    </div>
  )
}

function UsersPlaceholder() {
  return (
    <div style={{ padding: '28px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>User Management</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Manage user access and permissions.</p>
    </div>
  )
}
