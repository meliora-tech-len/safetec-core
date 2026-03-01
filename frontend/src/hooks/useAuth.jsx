import { createContext, useContext, useState, useEffect } from 'react'
import { login as apiLogin, getEntities } from "../services/api"

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })
  const loading = false
  const [entities, setEntities] = useState([])
  const [activeEntity, setActiveEntityState] = useState(() => {
    try { return JSON.parse(localStorage.getItem('activeEntity')) } catch { return null }
  })

  // Load entities whenever the logged-in user changes
  useEffect(() => {
    if (!user) {
      setEntities([])
      setActiveEntityState(null)
      return
    }
    getEntities().then(res => {
      const list = res.data
      setEntities(list)

      if (user.role === 'admin') {
        // Admins always start with "All Entities" view
        setActiveEntityState(null)
        localStorage.removeItem('activeEntity')
        return
      }

      // Restore previously selected entity for non-admin users
      let stored = null
      try { stored = JSON.parse(localStorage.getItem('activeEntity')) } catch {}

      if (stored) {
        const fresh = list.find(e => e.id === stored.id)
        if (fresh) {
          setActiveEntityState(fresh)
          localStorage.setItem('activeEntity', JSON.stringify(fresh))
        } else {
          // Previously selected entity no longer accessible — clear it
          setActiveEntityState(null)
          localStorage.removeItem('activeEntity')
        }
      }
      // No stored entity → stay null (All Businesses mode)
    }).catch(() => {})
  }, [user])

  const setActiveEntity = (entity) => {
    setActiveEntityState(entity)
    localStorage.setItem('activeEntity', JSON.stringify(entity))
  }

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
    localStorage.removeItem('activeEntity')
    setUser(null)
    setActiveEntityState(null)
    setEntities([])
  }

  const isAdmin = user?.role === 'admin'

  const accessibleEntityIds = user?.role === 'admin'
    ? null  // null = all
    : (user?.entity_access?.map(a => a.entity_id) || [])

  return (
    <AuthContext.Provider value={{
      user, login, logout, loading, isAdmin,
      accessibleEntityIds, entities, activeEntity, setActiveEntity,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
