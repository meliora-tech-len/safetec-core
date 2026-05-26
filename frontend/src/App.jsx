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
import SupplierProfilePage from './pages/SupplierProfilePage'
import InvoicesPage from './pages/InvoicesPage'
import InvoiceFormPage from './pages/InvoiceFormPage'
import InvoiceDetailPage from './pages/InvoiceDetailPage'
import AuditPage from './pages/AuditPage'
import EntitiesPage from './pages/EntitiesPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'
import FleetPage from './pages/FleetPage'
import ClientsPage from './pages/ClientsPage'
import DriversPage from './pages/DriversPage'
import DriverDetailPage from './pages/DriverDetailPage'
import DriverAssignmentsPage from './pages/DriverAssignmentsPage'
import PayrollSettingsPage from './pages/PayrollSettingsPage'
import TruckLoadsPage from './pages/TruckLoadsPage'
import TruckLoadProfilePage from './pages/TruckLoadProfilePage'
import MinesSettingsPage from './pages/MinesSettingsPage'
import DieselFillUpsPage from './pages/DieselFillUpsPage'
import DieselRatesPage from './pages/DieselRatesPage'
import ReportsPage from './pages/ReportsPage'
import SubcontractorsPage from './pages/SubcontractorsPage'
import SubcontractorProfilePage from './pages/SubcontractorProfilePage'
import CustomersPage from './pages/CustomersPage'
import InvoiceTemplatesPage from './pages/InvoiceTemplatesPage'
import InvoiceTemplateFormPage from './pages/InvoiceTemplateFormPage'
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
            <Route path="/suppliers/:supplierId" element={<SupplierProfilePage />} />

            {/* Fleet */}
            <Route path="/fleet" element={<FleetPage />} />

            {/* Subcontractors */}
            <Route path="/subcontractors" element={<SubcontractorsPage />} />
            <Route path="/subcontractors/:id" element={<SubcontractorProfilePage />} />

            {/* Clients */}
            <Route path="/clients" element={<ClientsPage />} />

            {/* Customers */}
            <Route path="/customers" element={<CustomersPage />} />

            {/* Drivers */}
            <Route path="/drivers" element={<DriversPage />} />
            <Route path="/drivers/:driverId" element={<DriverDetailPage />} />
            <Route path="/fleet/assignments" element={<DriverAssignmentsPage />} />

            {/* Quotes */}
            <Route path="/quotes" element={<InvoicesPage docType="quote" />} />
            <Route path="/quotes/new" element={<InvoiceFormPage docType="quote" />} />
            <Route path="/quotes/:id" element={<InvoiceDetailPage docType="quote" />} />
            <Route path="/quotes/:id/edit" element={<InvoiceFormPage docType="quote" />} />

            {/* Invoices */}
            <Route path="/invoices" element={<InvoicesPage docType="invoice" />} />
            <Route path="/invoices/new" element={<InvoiceFormPage docType="invoice" />} />
            <Route path="/invoices/:id" element={<InvoiceDetailPage docType="invoice" />} />
            <Route path="/invoices/:id/edit" element={<InvoiceFormPage docType="invoice" />} />

            {/* Purchase Orders */}
            <Route path="/purchase-orders" element={<InvoicesPage docType="purchase_order" />} />
            <Route path="/purchase-orders/new" element={<InvoiceFormPage docType="purchase_order" />} />
            <Route path="/purchase-orders/:id" element={<InvoiceDetailPage docType="purchase_order" />} />
            <Route path="/purchase-orders/:id/edit" element={<InvoiceFormPage docType="purchase_order" />} />

            {/* Invoice Templates */}
            <Route path="/invoice-templates" element={<InvoiceTemplatesPage />} />
            <Route path="/invoice-templates/new" element={<InvoiceTemplateFormPage />} />
            <Route path="/invoice-templates/:id/edit" element={<InvoiceTemplateFormPage />} />

            {/* Admin only */}
            <Route path="/audit" element={<AdminRoute><AuditPage /></AdminRoute>} />
            <Route path="/entities" element={<AdminRoute><EntitiesPage /></AdminRoute>} />
            <Route path="/users" element={<AdminRoute><UsersPage /></AdminRoute>} />

            {/* Settings — all authenticated users */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/payroll" element={<PayrollSettingsPage />} />
            <Route path="/settings/mines" element={<MinesSettingsPage />} />

            {/* Truck Loads */}
            <Route path="/truck-loads" element={<PrivateRoute><TruckLoadsPage /></PrivateRoute>} />
            <Route path="/truck-loads/:truckId" element={<PrivateRoute><TruckLoadProfilePage /></PrivateRoute>} />

            {/* Diesel */}
            <Route path="/diesel" element={<DieselFillUpsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings/diesel-rates" element={<DieselRatesPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}
