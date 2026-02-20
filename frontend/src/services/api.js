import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

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

// ── Entities ──────────────────────────────────────────────────────────────────
export const getEntities = () => api.get('/entities/')
export const getEntity = (id) => api.get(`/entities/${id}`)
export const createEntity = (data) => api.post('/entities/', data)
export const updateEntity = (id, data) => api.put(`/entities/${id}`, data)

// ── Clients ───────────────────────────────────────────────────────────────────
export const getClients = (params = {}) => api.get('/clients/', { params })
export const getClient = (id) => api.get(`/clients/${id}`)
export const createClient = (data) => api.post('/clients/', data)
export const updateClient = (id, data) => api.put(`/clients/${id}`, data)
export const deleteClient = (id) => api.delete(`/clients/${id}`)

// ── Invoices ──────────────────────────────────────────────────────────────────
export const getInvoices = (params = {}) => api.get('/invoices/', { params })
export const getInvoice = (id) => api.get(`/invoices/${id}`)
export const createInvoice = (data) => api.post('/invoices/', data)
export const updateInvoice = (id, data) => api.put(`/invoices/${id}`, data)
export const deleteInvoice = (id) => api.delete(`/invoices/${id}`)
export const getDashboardStats = (entity_id) =>
  api.get('/invoices/dashboard', { params: entity_id ? { entity_id } : {} })
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

export default api
