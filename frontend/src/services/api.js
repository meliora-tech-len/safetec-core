import axios from 'axios'

const api = axios.create({ 
  baseURL: import.meta.env.VITE_API_URL 
    ? `${import.meta.env.VITE_API_URL}/api` 
    : '/api' 
})

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle 401 globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (email, password) => {
  const form = new URLSearchParams()
  form.append('username', email)
  form.append('password', password)
  return api.post('/auth/login', form, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
}
export const getMe = () => api.get('/auth/me')
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email })
export const resetPassword = (token, new_password) => api.post('/auth/reset-password', { token, new_password })

// ── Entities ──────────────────────────────────────────────────────────────────
export const getEntities = (params = {}) => api.get('/entities/', { params })
export const getEntity = (id) => api.get(`/entities/${id}`)
export const createEntity = (data) => api.post('/entities/', data)
export const updateEntity = (id, data) => api.put(`/entities/${id}`, data)

// ── Suppliers ─────────────────────────────────────────────────────────────────
export const getSuppliers = (params = {}) => api.get('/suppliers/', { params })
export const getSupplier = (id) => api.get(`/suppliers/${id}`)
export const createSupplier = (data) => api.post('/suppliers/', data)
export const createSupplierBulk = (data) => api.post('/suppliers/bulk', data)
export const updateSupplier = (id, data) => api.put(`/suppliers/${id}`, data)
export const deleteSupplier = (id) => api.delete(`/suppliers/${id}`)

// ── Invoices ──────────────────────────────────────────────────────────────────
export const getInvoices = (params = {}) => api.get('/invoices/', { params })
export const getInvoice = (id) => api.get(`/invoices/${id}`)
export const createInvoice = (data) => api.post('/invoices/', data)
export const updateInvoice = (id, data) => api.put(`/invoices/${id}`, data)
export const deleteInvoice = (id) => api.delete(`/invoices/${id}`)
export const getDashboardStats = (entity_id) =>
  api.get('/invoices/dashboard', { params: entity_id ? { entity_id } : {} })
export const sendInvoiceEmail = (id, theme = 'dark') =>
  api.post(`/invoices/${id}/send-email`, null, { params: { theme } })

export const downloadInvoiceEml = async (id, invoiceNumber, theme = 'dark') => {
  const res = await api.get(`/invoices/${id}/download-eml`, {
    params: { theme },
    responseType: 'blob',
  })
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'message/rfc822' }))
  const link = document.createElement('a')
  link.href = url
  const safe = invoiceNumber.replace(/[/\\]/g, '-')
  link.setAttribute('download', `${safe}.eml`)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export const downloadInvoicePdf = async (id, invoiceNumber, theme = 'dark') => {
  const res = await api.get(`/invoices/${id}/pdf`, {
    params: { theme },
    responseType: 'blob',
  })
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `${invoiceNumber}.pdf`)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const getUsers = () => api.get('/users/')
export const createUser = (data) => api.post('/users/', data)
export const updateUser = (id, data) => api.put(`/users/${id}`, data)
export const deleteUser = (id) => api.delete(`/users/${id}`)

// ── Audit ─────────────────────────────────────────────────────────────────────
export const getAuditLogs = (params = {}) => api.get('/audit/', { params })

// ── Entities (additions) ──────────────────────────────────────────────────────
export const uploadEntityLogo = (id, formData) =>
  api.post(`/entities/${id}/logo`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const archiveEntity = (id) => api.delete(`/entities/${id}`)
export const restoreEntity = (id) => api.post(`/entities/${id}/restore`)
export const getNextInvoiceNumber = (entityId, docType = 'invoice') =>
  api.get(`/entities/${entityId}/next-number`, { params: { doc_type: docType } })

// ── Users (additions) ─────────────────────────────────────────────────────────
export const updateUserPermissions = (id, data) => api.put(`/users/${id}/permissions`, data)
export const resetUserPassword = (id, data) => api.post(`/users/${id}/reset-password`, data)
export const reactivateUser = (id) => api.post(`/users/${id}/reactivate`)

// ── Roles ─────────────────────────────────────────────────────────────────────
export const getRoles = () => api.get('/roles/')
export const createRole = (data) => api.post('/roles/', data)
export const deleteRole = (key) => api.delete(`/roles/${key}`)

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = () => api.get('/settings/')
export const updateSetting = (key, data) => api.put(`/settings/${key}`, data)
export const createSetting = (data) => api.post('/settings/', data)

// ── Mines ─────────────────────────────────────────────────────────────────────
export const getMines = (params = {}) => api.get('/mines', { params })
export const getMine = (id) => api.get(`/mines/${id}`)
export const createMine = (data) => api.post('/mines', data)
export const updateMine = (id, data) => api.put(`/mines/${id}`, data)
export const deleteMine = (id) => api.delete(`/mines/${id}`)
export const getMineRates = (mineId, params = {}) => api.get(`/mines/${mineId}/rates`, { params })
export const addMineRate = (mineId, data) => api.post(`/mines/${mineId}/rates`, data)

// ── Fleet (single truck) ──────────────────────────────────────────────────────
export const getTruck = (id) => api.get(`/fleet/trucks/${id}`)
export const getFleetTrucks = (params = {}) => api.get('/fleet/trucks', { params })

// ── Truck Loads ───────────────────────────────────────────────────────────────
export const getTruckLoads = (params = {}) => api.get('/truck-loads', { params })
export const getTruckLoadSummary = (params = {}) => api.get('/truck-loads/summary', { params })
export const createTruckLoad = (data) => api.post('/truck-loads', data)
export const bulkCreateTruckLoads = (data) => api.post('/truck-loads/bulk', data)
export const updateTruckLoad = (id, data) => api.put(`/truck-loads/${id}`, data)
export const deleteTruckLoad = (id) => api.delete(`/truck-loads/${id}`)
export const archiveTruckLoad = (id) => api.patch(`/truck-loads/${id}/archive`)

// ── Drivers ───────────────────────────────────────────────────────────────────
export const getDrivers = (params = {}) => api.get('/drivers', { params })
export const updateDriver = (id, data) => api.put(`/drivers/${id}`, data)
export const addDriverAdditionalLoad = (driverId, year, month, data) =>
  api.post(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads`, data)
export const deleteDriverAdditionalLoad = (driverId, year, month, loadId) =>
  api.delete(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${loadId}`)
export const archiveDriverAdditionalLoad = (driverId, year, month, loadId) =>
  api.patch(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${loadId}/archive`)
export const addDriverFoodPayment = (driverId, year, month, data) =>
  api.post(`/drivers/${driverId}/cycles/${year}/${month}/food-payments`, data)
export const getTruckAdditionalLoads = (truckId, params = {}) =>
  api.get(`/fleet/trucks/${truckId}/additional-loads`, { params })

// ── Driver Salary Configs ─────────────────────────────────────────────────────
export const getDriverSalaryConfigs = (params = {}) => api.get('/driver-salary-configs', { params })
export const createDriverSalaryConfig = (data) => api.post('/driver-salary-configs', data)
export const updateDriverSalaryConfig = (id, data) => api.put(`/driver-salary-configs/${id}`, data)
export const deleteDriverSalaryConfig = (id) => api.delete(`/driver-salary-configs/${id}`)

// ── Diesel ────────────────────────────────────────────────────────────────────
export const getDieselSettings = (params = {}) => api.get('/diesel/settings', { params })
export const updateDieselSettings = (entityId, data) => api.put(`/diesel/settings/${entityId}`, data)

export const getDieselRates = (params = {}) => api.get('/diesel/rates', { params })
export const getDieselRate = (id) => api.get(`/diesel/rates/${id}`)
export const getCurrentDieselRate = (supplierId, params = {}) => api.get(`/diesel/rates/supplier/${supplierId}/current`, { params })
export const createDieselRate = (data) => api.post('/diesel/rates', data)
export const updateDieselRate = (id, data) => api.put(`/diesel/rates/${id}`, data)

export const getDieselFillUps = (params = {}) => api.get('/diesel/fillups', { params })
export const getDieselFillUpSummary = (params = {}) => api.get('/diesel/fillups/summary', { params })
export const getDieselFillUp = (id) => api.get(`/diesel/fillups/${id}`)
export const getDieselFillUpsByTruck = (truckId, params = {}) => api.get(`/diesel/fillups/truck/${truckId}`, { params })
export const createDieselFillUp = (data) => api.post('/diesel/fillups', data)
export const updateDieselFillUp = (id, data) => api.put(`/diesel/fillups/${id}`, data)
export const deleteDieselFillUp = (id) => api.delete(`/diesel/fillups/${id}`)
export const archiveDieselFillUp = (id) => api.patch(`/diesel/fillups/${id}/archive`)
export const verifyDieselFillUp       = (id) => api.patch(`/diesel/fillups/${id}/verify`)
export const archiveSupplierInvoice   = (id) => api.patch(`/supplier-invoices/${id}/archive`)
export const verifySupplierInvoice    = (id) => api.patch(`/supplier-invoices/${id}/verify`)
export const verifyAdditionalLoad     = (driverId, year, month, loadId) =>
  api.patch(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${loadId}/verify`)
export const verifyFoodPayment        = (driverId, year, month, paymentId) =>
  api.patch(`/drivers/${driverId}/cycles/${year}/${month}/food-payments/${paymentId}/verify`)

// ── Business Reports ──────────────────────────────────────────────────────────
export const getIncomeExpensesReport = (params) => api.get('/reports/income-expenses', { params })
export const getPayrollEntries = (params = {}) => api.get('/payroll-entries/', { params })
export const getPayrollEntriesSummary = (params) => api.get('/payroll-entries/summary', { params })

export const getDieselReportByTruck = (params) => api.get('/diesel/reports/monthly-by-truck', { params })
export const getDieselReportBySupplier = (params) => api.get('/diesel/reports/monthly-by-supplier', { params })
export const getDieselCostPerLoad = (truckloadId) => api.get('/diesel/reports/cost-per-load', { params: { truckload_id: truckloadId } })
export const getDieselAnnualSummary = (params) => api.get('/diesel/reports/annual-summary', { params })

// ── Supplier Invoices ─────────────────────────────────────────────────────────
export const getSupplierInvoices = (params = {}) => api.get('/supplier-invoices/', { params })
export const getSupplierInvoice = (id) => api.get(`/supplier-invoices/${id}`)
export const createSupplierInvoice = (data) => api.post('/supplier-invoices/', data)
export const updateSupplierInvoice = (id, data) => api.put(`/supplier-invoices/${id}`, data)
export const deleteSupplierInvoice = (id) => api.delete(`/supplier-invoices/${id}`)
export const markStatementPaid = (supplierId, year, month) =>
  api.post(`/supplier-invoices/statements/${supplierId}/${year}/${month}/mark-paid`)
export const getSupplierPayablesDashboard = (params = {}) =>
  api.get('/supplier-invoices/dashboard-summary', { params })

// ── Feedback ──────────────────────────────────────────────────────────────────
export const submitFeedback = (data) => api.post('/feedback/', data)

export default api
