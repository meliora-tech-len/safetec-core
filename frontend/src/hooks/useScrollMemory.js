import { useEffect, useRef } from 'react'

// Remembers the page scroll position under a sessionStorage key so returning
// to a list lands where the user left off. The app scrolls inside AppLayout's
// <main>, not the window. Written straight to sessionStorage on scroll so a
// refresh keeps it too; restored once `ready` is true so the offset isn't
// clamped by a still-empty page. Pass `skip` when something else should win
// (e.g. a deep-link scroll target).
export function useScrollMemory(key, ready, { skip = false } = {}) {
  const restored = useRef(false)
  useEffect(() => { if (!ready) restored.current = false }, [ready])

  useEffect(() => {
    const el = document.querySelector('main')
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        try { sessionStorage.setItem(key, String(el.scrollTop)) } catch {}
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [key])

  useEffect(() => {
    if (restored.current || !ready) return
    restored.current = true
    if (skip) return
    let saved = 0
    try { saved = Number(sessionStorage.getItem(key)) || 0 } catch {}
    const el = document.querySelector('main')
    if (el && saved > 0) el.scrollTop = saved
  }, [ready, skip, key])
}
