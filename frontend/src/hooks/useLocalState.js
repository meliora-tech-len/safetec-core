import { useState, useCallback } from 'react'

/**
 * Drop-in useState replacement persisted to localStorage — for view
 * preferences that should outlive the browser session (table sort order,
 * column choices). Its sibling useSessionState is for period/filter state
 * that must reset on a fresh session so the app never opens on stale data;
 * a sort order has no such staleness risk, so it sticks for good.
 *
 * Pass a falsy key to opt out of persistence entirely (plain useState),
 * so callers can decide per-instance without breaking the rules of hooks.
 */
export function useLocalState(key, initial) {
  const read = () => {
    if (key) {
      try {
        const raw = localStorage.getItem(key)
        if (raw !== null) return JSON.parse(raw)
      } catch {}
    }
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
      if (key) {
        try { localStorage.setItem(key, JSON.stringify(v)) } catch {}
      }
      return { key, value: v }
    })
  }, [key])

  return [value, set]
}
