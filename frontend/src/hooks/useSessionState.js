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
  const read = () => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw)
    } catch {}
    return typeof initial === 'function' ? initial() : initial
  }

  const [state, setState] = useState(() => ({ key, value: read() }))

  // A changed key means a different stored value — re-read during render
  // rather than in an effect, so the first paint is already correct.
  const value = state.key === key ? state.value : read()
  if (state.key !== key) setState({ key, value })

  const set = useCallback((next) => {
    setState(prev => {
      const v = typeof next === 'function' ? next(prev.value) : next
      try { sessionStorage.setItem(key, JSON.stringify(v)) } catch {}
      return { key, value: v }
    })
  }, [key])

  return [value, set]
}
