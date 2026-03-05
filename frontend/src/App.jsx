import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import DashboardPage from './pages/DashboardPage'
import SuppliersPage from './pages/SuppliersPage'
import InvoicesPage from './pages/InvoicesPage'
import InvoiceFormPage from './pages/InvoiceFormPage'
import InvoiceDetailPage from './pages/InvoiceDetailPage'
import AuditPage from './pages/AuditPage'
import EntitiesPage from './pages/EntitiesPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'
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
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route path="/dashboard" element={<DashboardPage />} />

            {/* Suppliers */}
            <Route path="/suppliers" element={<SuppliersPage />} />

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
            <Route path="/entities" element={<AdminRoute><EntitiesPage /></AdminRoute>} />
            <Route path="/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
            <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}
