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
export const getEntities = () => api.get('/entities/')
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

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = () => api.get('/settings/')
export const updateSetting = (key, data) => api.put(`/settings/${key}`, data)
export const createSetting = (data) => api.post('/settings/', data)

export default api
