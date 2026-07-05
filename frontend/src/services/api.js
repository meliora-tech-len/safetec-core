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

// Handle 401 globally — use replace to avoid a hard reload flash
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      localStorage.removeItem('activeEntity')
      // Only redirect if not already on the login page to avoid loops
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace('/login')
      }
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
export const updateEntityInvoiceConfig = (id, data) => api.put(`/entities/${id}/invoice-config`, data)

// ── Suppliers ─────────────────────────────────────────────────────────────────
export const getSuppliers = (params = {}) => api.get('/suppliers/', { params })
export const getSupplier = (id) => api.get(`/suppliers/${id}`)
export const createSupplier = (data) => api.post('/suppliers/', data)
export const permanentlyDeleteSupplier = (id) => api.delete(`/suppliers/${id}/permanent`)
export const createSupplierBulk = (data) => api.post('/suppliers/bulk', data)
export const updateSupplier = (id, data) => api.put(`/suppliers/${id}`, data)
export const deleteSupplier = (id) => api.delete(`/suppliers/${id}`)

// ── Invoices ──────────────────────────────────────────────────────────────────
export const getInvoices = (params = {}) => api.get('/invoices/', { params })
export const getInvoice = (id) => api.get(`/invoices/${id}`)
export const createInvoice = (data) => api.post('/invoices/', data)
export const updateInvoice = (id, data) => api.put(`/invoices/${id}`, data)
export const deleteInvoice = (id) => api.delete(`/invoices/${id}`)
export const getDashboardStats = (entity_id, params = {}) =>
  api.get('/invoices/dashboard', { params: { ...(entity_id ? { entity_id } : {}), ...params } })
export const getProfitLossSummary = (params = {}) =>
  api.get('/invoices/profit-loss', { params })
export const sendInvoiceEmail = (id, theme = 'dark') =>
  api.post(`/invoices/${id}/send-email`, null, { params: { theme } })

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

// Split a combined PO PDF into one PDF per order; downloads a ZIP. Returns the PO count.
export const splitPoPdf = async (file) => {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post('/invoices/split-pos', form, {
    responseType: 'blob',
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  const stamp = new Date().toISOString().slice(0, 10)
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `split-pos-${stamp}.zip`)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
  return parseInt(res.headers['x-po-count'] || '0', 10)
}

// Bulk download: merge=false → ZIP of separate PDFs, merge=true → one merged PDF.
export const downloadInvoicesBulk = async (invoiceIds, { merge = false, theme = 'dark' } = {}) => {
  const res = await api.post('/invoices/bulk-pdf', {
    invoice_ids: Array.from(invoiceIds),
    merge,
  }, {
    params: { theme },
    responseType: 'blob',
  })
  const stamp = new Date().toISOString().slice(0, 10)
  const isMerged = merge
  const type = isMerged ? 'application/pdf' : 'application/zip'
  const filename = isMerged ? `invoices-merged-${stamp}.pdf` : `invoices-${stamp}.zip`
  const url = window.URL.createObjectURL(new Blob([res.data], { type }))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
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
export const getAuditLogMonths = (params = {}) => api.get('/audit/months', { params })
export const exportAuditLogs = (params = {}) => api.get('/audit/export', { params })

// ── Entities (additions) ──────────────────────────────────────────────────────
export const uploadEntityLogo = (id, formData) =>
  api.post(`/entities/${id}/logo`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const uploadEntityLetterhead = (id, formData) =>
  api.post(`/entities/${id}/letterhead`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const archiveEntity = (id) => api.delete(`/entities/${id}`)
export const restoreEntity = (id) => api.post(`/entities/${id}/restore`)
export const getNextInvoiceNumber = (entityId, docType = 'invoice') =>
  api.get(`/entities/${entityId}/next-number`, { params: { doc_type: docType } })

// ── Users (additions) ─────────────────────────────────────────────────────────
export const updateUserPermissions = (id, data) => api.put(`/users/${id}/permissions`, data)
export const resetUserPassword = (id, data) => api.put(`/users/${id}/password`, data)
export const reactivateUser = (id) => api.post(`/users/${id}/reactivate`)

// ── Roles ─────────────────────────────────────────────────────────────────────
export const getRoles = () => api.get('/roles/')
export const createRole = (data) => api.post('/roles/', data)
export const deleteRole = (key) => api.delete(`/roles/${key}`)

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = () => api.get('/settings/')
export const getSetting = (key) => api.get(`/settings/${key}`)
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

// ── Invoice Templates ─────────────────────────────────────────────────────────
export const getInvoiceTemplates = (params = {}) => api.get('/invoice-templates/', { params })
export const getInvoiceTemplate = (id) => api.get(`/invoice-templates/${id}`)
export const createInvoiceTemplate = (data) => api.post('/invoice-templates/', data)
export const updateInvoiceTemplate = (id, data) => api.put(`/invoice-templates/${id}`, data)
export const deleteInvoiceTemplate = (id) => api.delete(`/invoice-templates/${id}`)
export const cloneInvoiceTemplatePayload = (id) => api.post(`/invoice-templates/${id}/clone-payload`)

// ── Customers ─────────────────────────────────────────────────────────────────
export const getCustomers = (params = {}) => api.get('/customers/', { params })
export const getCustomer = (id) => api.get(`/customers/${id}`)
export const createCustomer = (data) => api.post('/customers/', data)
export const updateCustomer = (id, data) => api.put(`/customers/${id}`, data)
export const deleteCustomer = (id) => api.delete(`/customers/${id}`)
export const permanentlyDeleteCustomer = (id) => api.delete(`/customers/${id}/permanent`)

// ── Subcontractors ────────────────────────────────────────────────────────────
export const getSubcontractors        = (params = {}) => api.get('/subcontractors/', { params })
export const getSubcontractor         = (id)          => api.get(`/subcontractors/${id}`)
export const createSubcontractorBulk  = (data)        => api.post('/subcontractors/bulk', data)
export const updateSubcontractor      = (id, data)    => api.put(`/subcontractors/${id}`, data)
export const deleteSubcontractor      = (id)          => api.delete(`/subcontractors/${id}`)
export const permanentlyDeleteSubcontractor = (id)    => api.delete(`/subcontractors/${id}/permanent`)
export const getSubcontractorInvoices   = (id, params = {}) => api.get(`/subcontractors/${id}/invoices`, { params })
export const createSubcontractorInvoice = (id, data)        => api.post(`/subcontractors/${id}/invoices`, data)
export const getSubcontractorCosting        = (id, params = {}) => api.get(`/subcontractors/${id}/costing`, { params })
export const saveSubcontractorCostingNote   = (id, params = {}, data = {}) => api.put(`/subcontractors/${id}/costing/note`, data, { params })
export const saveSubcontractorCostingNetOverride = (id, params = {}, data = {}) => api.put(`/subcontractors/${id}/costing/net-override`, data, { params })
export const createTruckCostingIncome       = (id, params = {}, data = {}) => api.post(`/subcontractors/${id}/costing/income`, data, { params })
export const deleteTruckCostingIncome       = (id, incomeId) => api.delete(`/subcontractors/${id}/costing/income/${incomeId}`)
export const setSubcontractorCostingSent    = (id, params = {}, data = {}) => api.put(`/subcontractors/${id}/costing/sent`, data, { params })
export const downloadSubcontractorCostingPdf   = (id, params = {}) => api.get(`/subcontractors/${id}/costing/export/pdf`,   { params, responseType: 'blob' })
export const downloadSubcontractorCostingExcel = (id, params = {}) => api.get(`/subcontractors/${id}/costing/export/excel`, { params, responseType: 'blob' })

// ── Fleet (single truck) ──────────────────────────────────────────────────────
export const getTruck = (id) => api.get(`/fleet/trucks/${id}`)
export const getFleetTrucks = (params = {}) => api.get('/fleet/trucks', { params })

// ── Truck Loads ───────────────────────────────────────────────────────────────
export const getTruckLoads = (params = {}) => api.get('/truck-loads', { params })
export const getTruckLoadSummary      = (params = {}) => api.get('/truck-loads/summary', { params })
export const getTruckFleetSummary         = (params = {}) => api.get('/truck-loads/fleet-summary', { params })
export const getDieselInvoiceReconciliation = (params = {}) => api.get('/diesel/invoice-reconciliation', { params })
export const createTruckLoad = (data) => api.post('/truck-loads', data)
export const createSplitLoad = (data) => api.post('/truck-loads/split', data)
export const bulkCreateTruckLoads = (data) => api.post('/truck-loads/bulk', data)
export const updateTruckLoad = (id, data) => api.put(`/truck-loads/${id}`, data)
export const deleteTruckLoad = (id) => api.delete(`/truck-loads/${id}`)
export const archiveTruckLoad = (id) => api.patch(`/truck-loads/${id}/archive`)

// ── Drivers ───────────────────────────────────────────────────────────────────
export const getDrivers = (params = {}) => api.get('/drivers', { params })
export const updateDriver = (id, data) => api.put(`/drivers/${id}`, data)
export const addDriverTruckAssignment = (driverId, data) => api.post(`/drivers/${driverId}/truck-assignments`, data)
export const removeDriverTruckAssignment = (driverId, assignmentId) => api.delete(`/drivers/${driverId}/truck-assignments/${assignmentId}`)
export const addDriverAdditionalLoad = (driverId, year, month, data) =>
  api.post(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads`, data)
export const updateDriverAdditionalLoad = (driverId, year, month, loadId, data) =>
  api.put(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${loadId}`, data)
export const deleteDriverAdditionalLoad = (driverId, year, month, loadId) =>
  api.delete(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${loadId}`)
export const archiveDriverAdditionalLoad = (driverId, year, month, loadId) =>
  api.patch(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${loadId}/archive`)
export const addDriverFoodPayment = (driverId, year, month, data) =>
  api.post(`/drivers/${driverId}/cycles/${year}/${month}/food-payments`, data)
export const downloadPayslipPdf = async (driverId, year, month, filename) => {
  const res = await api.get(`/drivers/${driverId}/cycles/${year}/${month}/payslip-pdf`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url; a.download = filename || `payslip_${year}_${String(month).padStart(2, '0')}.pdf`
  a.click(); URL.revokeObjectURL(url)
}
export const getTruckAdditionalLoads = (truckId, params = {}) =>
  api.get(`/fleet/trucks/${truckId}/additional-loads`, { params })
export const getTruckFoodPayments = (truckId, params = {}) =>
  api.get(`/fleet/trucks/${truckId}/food-payments`, { params })
export const getTruckWashes = (truckId, params = {}) =>
  api.get(`/fleet/trucks/${truckId}/washes`, { params })
export const addTruckWash = (truckId, data) =>
  api.post(`/fleet/trucks/${truckId}/washes`, data)
export const updateTruckWash = (truckId, washId, data) =>
  api.put(`/fleet/trucks/${truckId}/washes/${washId}`, data)
export const deleteTruckWash = (truckId, washId) =>
  api.delete(`/fleet/trucks/${truckId}/washes/${washId}`)
export const deleteDriverFoodPayment = (driverId, year, month, paymentId) =>
  api.delete(`/drivers/${driverId}/cycles/${year}/${month}/food-payments/${paymentId}`)

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

// ── Additional Load Rates (per-customer flat rate, Safetec) ────────────────────
export const getAdditionalLoadRates   = (params = {}) => api.get('/additional-load-rates/', { params })
export const createAdditionalLoadRate = (data)        => api.post('/additional-load-rates/', data)
export const updateAdditionalLoadRate = (id, data)    => api.put(`/additional-load-rates/${id}`, data)
export const deleteAdditionalLoadRate = (id)          => api.delete(`/additional-load-rates/${id}`)

export const importDiesel = (data) => api.post('/diesel/import', data)
export const getDieselFillUps = (params = {}) => api.get('/diesel/fillups', { params })
export const getDieselFillUpSlips = (params = {}) => api.get('/diesel/fillups/slips', { params })
export const getDieselFillUpSummary = (params = {}) => api.get('/diesel/fillups/summary', { params })
export const getDieselFillUp = (id) => api.get(`/diesel/fillups/${id}`)
export const getDieselFillUpsByTruck = (truckId, params = {}) => api.get(`/diesel/fillups/truck/${truckId}`, { params })
export const createDieselFillUp = (data) => api.post('/diesel/fillups', data)
export const updateDieselFillUp = (id, data) => api.put(`/diesel/fillups/${id}`, data)
export const deleteDieselFillUp = (id) => api.delete(`/diesel/fillups/${id}`)
export const archiveDieselFillUp = (id) => api.patch(`/diesel/fillups/${id}/archive`)
export const verifyDieselFillUp       = (id, action) => api.patch(`/diesel/fillups/${id}/verify`, null, { params: action ? { action } : {} })
export const finalizeDieselFillUp     = (id, action) => api.patch(`/diesel/fillups/${id}/finalize`, null, { params: action ? { action } : {} })
export const getDieselWarnings        = (params = {}) => api.get('/diesel/warnings', { params })
export const bulkImportSupplierInvoices = (data) => api.post('/supplier-invoices/bulk-import', data)
export const resolveSupplierDieselConflicts = (resolutions) => api.post('/supplier-invoices/resolve-diesel-conflicts', resolutions)
export const archiveSupplierInvoice   = (id) => api.patch(`/supplier-invoices/${id}/archive`)
export const getPendingSupplierInvoices = (params = {}) => api.get('/supplier-invoices/pending-verification', { params })
export const skipPendingVerification  = (id) => api.post(`/supplier-invoices/${id}/skip-verification`)
export const verifySupplierInvoice    = (id, action) => api.patch(`/supplier-invoices/${id}/verify`, null, { params: action ? { action } : {} })
export const finalizeSupplierInvoice  = (id, action) => api.patch(`/supplier-invoices/${id}/finalize`, null, { params: action ? { action } : {} })
export const verifyAdditionalLoad     = (driverId, year, month, loadId, action) =>
  api.patch(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${loadId}/verify`, null, { params: action ? { action } : {} })
export const finalizeAdditionalLoad   = (driverId, year, month, loadId, action) =>
  api.patch(`/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${loadId}/finalize`, null, { params: action ? { action } : {} })
export const verifyFoodPayment        = (driverId, year, month, paymentId, action) =>
  api.patch(`/drivers/${driverId}/cycles/${year}/${month}/food-payments/${paymentId}/verify`, null, { params: action ? { action } : {} })
export const finalizeFoodPayment      = (driverId, year, month, paymentId, action) =>
  api.patch(`/drivers/${driverId}/cycles/${year}/${month}/food-payments/${paymentId}/finalize`, null, { params: action ? { action } : {} })

// ── Generic per-value verification overlay ──────────────────────────────────
// `action` ('add'/'apply' | 'remove') carries the client's intent so a stale tab
// can't toggle a verification the wrong way. Omit for legacy toggle behaviour.
export const getVerifications = (prefix) => api.get('/verifications', { params: { prefix } })
export const verifyValue      = (target, entityId = null, action = null) => api.patch('/verifications/verify', { target, entity_id: entityId, action })
export const finalizeValue    = (target, entityId = null, action = null) => api.patch('/verifications/finalize', { target, entity_id: entityId, action })

// ── Payroll Settings ──────────────────────────────────────────────────────────
export const getPayrollSettings = () => api.get('/payroll-settings')

// ── Business Reports ──────────────────────────────────────────────────────────
export const getIncomeExpensesReport = (params) => api.get('/reports/income-expenses', { params })
export const getSarsVatDetail = (params) => api.get('/reports/sars-vat-detail', { params })
export const getSarsVatDetailAnnual = (params) => api.get('/reports/sars-vat-detail-annual', { params })
export const getPayrollEntries = (params = {}) => api.get('/payroll-entries/', { params })
export const getPayrollEntriesSummary = (params) => api.get('/payroll-entries/summary', { params })

export const getDieselReportByTruck = (params) => api.get('/diesel/reports/monthly-by-truck', { params })
export const getDieselReportBySupplier = (params) => api.get('/diesel/reports/monthly-by-supplier', { params })
export const getDieselCostPerLoad = (truckloadId) => api.get('/diesel/reports/cost-per-load', { params: { truckload_id: truckloadId } })
export const getDieselAnnualSummary = (params) => api.get('/diesel/reports/annual-summary', { params })
export const repairDieselInvoiceLinks = () => api.post('/diesel/fillups/repair-invoice-links')

// ── Supplier Invoices ─────────────────────────────────────────────────────────
export const getSupplierInvoices = (params = {}) => api.get('/supplier-invoices/', { params })
// One-off admin cleanup of stranded diesel "Pending" placeholders. Dry run by
// default; pass { commit: true } to apply. Optionally scope { entity_id, supplier_id }.
export const cleanupDieselPlaceholders = (params = {}) => api.post('/supplier-invoices/cleanup-diesel-placeholders', null, { params })
export const getSupplierInvoicesByVehicle = (params = {}) => api.get('/supplier-invoices/by-vehicle', { params })
export const getSupplierInvoice = (id) => api.get(`/supplier-invoices/${id}`)
export const createSupplierInvoice = (data) => api.post('/supplier-invoices/', data)
export const updateSupplierInvoice = (id, data) => api.put(`/supplier-invoices/${id}`, data)
export const deleteSupplierInvoice = (id) => api.delete(`/supplier-invoices/${id}`)
// scope: 'forward' (stop from this month onward) | 'all' (remove every month)
export const removeFixedExpense = (id, scope = 'forward') =>
  api.delete(`/supplier-invoices/${id}/fixed-expense`, { params: { scope } })
export const markStatementPaid = (supplierId, year, month) =>
  api.post(`/supplier-invoices/statements/${supplierId}/${year}/${month}/mark-paid`)
export const getSupplierPayablesDashboard = (params = {}) =>
  api.get('/supplier-invoices/dashboard-summary', { params })
export const addInvoiceLineItem = (invoiceId, data) =>
  api.post(`/supplier-invoices/${invoiceId}/line-items`, data)
export const updateInvoiceLineItem = (invoiceId, lineId, data) =>
  api.put(`/supplier-invoices/${invoiceId}/line-items/${lineId}`, data)
export const deleteInvoiceLineItem = (invoiceId, lineId) =>
  api.delete(`/supplier-invoices/${invoiceId}/line-items/${lineId}`)

// Physical-invoice attachment (the document received from the supplier)
export const uploadSupplierInvoiceAttachment = (id, formData) =>
  api.post(`/supplier-invoices/${id}/attachment`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const deleteSupplierInvoiceAttachment = (id) =>
  api.delete(`/supplier-invoices/${id}/attachment`)
// Fetches the file with the auth header, then opens it inline in a new tab.
// (A plain window.open of the endpoint would not send the JWT bearer header.)
export const viewSupplierInvoiceAttachment = async (id) => {
  const res = await api.get(`/supplier-invoices/${id}/attachment`, { responseType: 'blob' })
  const url = window.URL.createObjectURL(res.data)
  window.open(url, '_blank')
  setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
}

// ── Truck Monthly Expenses (Profit Sheet) ─────────────────────────────────────
export const getTruckMonthlyExpenses = (truckId, params) =>
  api.get(`/fleet/trucks/${truckId}/monthly-expenses`, { params })
export const upsertTruckMonthlyExpenses = (truckId, params, data) =>
  api.put(`/fleet/trucks/${truckId}/monthly-expenses`, data, { params })

// ── Statements ────────────────────────────────────────────────────────────────
export const getStatements    = (params = {}) => api.get('/statements/',   { params })
export const getStatement     = (id)          => api.get(`/statements/${id}`)
export const createStatement  = (data)        => api.post('/statements/',  data)
export const updateStatement  = (id, data)    => api.put(`/statements/${id}`, data)
export const deleteStatement  = (id)          => api.delete(`/statements/${id}`)
export const exportStatementPdf   = (payload) => api.post('/statements/export/pdf',  payload, { responseType: 'blob' })
export const exportStatementExcel = (payload) => api.post('/statements/export/xlsx', payload, { responseType: 'blob' })

// Trigger a browser download from a blob response
export function saveBlob(data, mime, filename) {
  const url = window.URL.createObjectURL(new Blob([data], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

// ── Feedback ──────────────────────────────────────────────────────────────────
export const submitFeedback = (data) => api.post('/feedback/', data)

// ── Budgets ───────────────────────────────────────────────────────────────────
export const getBudgets = (params = {}) => api.get('/budgets', { params })
export const getBudget = (id) => api.get(`/budgets/${id}`)
export const createBudget = (data) => api.post('/budgets', data)
export const updateBudget = (id, data) => api.patch(`/budgets/${id}`, data)
export const deleteBudget = (id) => api.delete(`/budgets/${id}`)
export const addBudgetSection = (budgetId, data) => api.post(`/budgets/${budgetId}/sections`, data)
export const updateBudgetSection = (sectionId, data) => api.patch(`/budgets/sections/${sectionId}`, data)
export const deleteBudgetSection = (sectionId) => api.delete(`/budgets/sections/${sectionId}`)
export const addBudgetLine = (sectionId, data) => api.post(`/budgets/sections/${sectionId}/lines`, data)
export const updateBudgetLine = (lineId, data) => api.patch(`/budgets/lines/${lineId}`, data)
export const deleteBudgetLine = (lineId) => api.delete(`/budgets/lines/${lineId}`)
export const upsertBudgetLineValue = (lineId, data) => api.put(`/budgets/lines/${lineId}/values`, data)
// Pull existing system data (suppliers, income, subcontractors, wages) into the
// budget's auto lines. Manual lines and hand-edited cells are preserved.
export const refreshBudgetFromSystem = (id) => api.post(`/budgets/${id}/refresh-from-system`)

// Budget "constants" — recurring lines (e.g. Travel & Accom) seeded into every
// budget's matching section on creation and on every "Pull from system" refresh.
export const getBudgetLineTemplates = () => api.get('/budgets/line-templates')
export const createBudgetLineTemplate = (data) => api.post('/budgets/line-templates', data)
export const updateBudgetLineTemplate = (id, data) => api.patch(`/budgets/line-templates/${id}`, data)
export const deleteBudgetLineTemplate = (id) => api.delete(`/budgets/line-templates/${id}`)

export default api
