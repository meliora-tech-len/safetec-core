import { useEffect, useState } from 'react'

/**
 * Returns true when the viewport is at/below `breakpoint` px (default 768).
 * Mirrors the CSS breakpoint used for the mobile sidebar drawer, so JS behaviour
 * (drawer open/close) stays in sync with the layout.
 */
export function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint}px)`
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return isMobile
}
