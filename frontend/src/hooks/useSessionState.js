import { useState, useCallback } from 'react'

/**
 * Drop-in useState replacement persisted to sessionStorage, so filter
 * selections (month, year, …) survive navigating away and back — and a
 * page refresh — within the browser session. A fresh session starts from
 * the default again, so the app never opens on a stale period.
 *
 * Without this, a user who selects May, drills into a record and comes
 * back lands on the current month and thinks the May data disappeared.
 */
export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw)
    } catch {}
    return typeof initial === 'function' ? initial() : initial
  })

  const set = useCallback((next) => {
    setValue(prev => {
      const v = typeof next === 'function' ? next(prev) : next
      try { sessionStorage.setItem(key, JSON.stringify(v)) } catch {}
      return v
    })
  }, [key])

  return [value, set]
}
