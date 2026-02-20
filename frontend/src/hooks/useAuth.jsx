import { createContext, useContext, useState, useEffect } from 'react'
import { login as apiLogin, getMe } from "../services/api"

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })
  const [loading, setLoading] = useState(false)

  const login = async (email, password) => {
    const res = await apiLogin(email, password)
    const { access_token, user: userData } = res.data
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(userData))
    setUser(userData)
    return userData
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const isAdmin = user?.role === 'admin'

  const accessibleEntityIds = user?.role === 'admin'
    ? null  // null = all
    : (user?.entity_access?.map(a => a.entity_id) || [])

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin, accessibleEntityIds }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
