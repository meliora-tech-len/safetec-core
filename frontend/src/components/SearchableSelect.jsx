import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Searchable dropdown that looks like a `<select>` but lets the user type
 * to filter options.  The option list renders into document.body via a portal
 * so it is never clipped by a parent with overflow:hidden/auto.
 *
 * Props
 *   value       – current selected value (string); '' = nothing selected
 *   onChange    – called with the new value string when the user picks an option
 *   options     – array of objects to show
 *   getValue    – fn(option) → string   — the stored value (usually String(id))
 *   getLabel    – fn(option) → string   — the displayed text
 *   placeholder – text shown when nothing is selected (default "Select…")
 *   style       – extra style for the trigger input element
 */
export default function SearchableSelect({
  value, onChange, options = [], getValue, getLabel,
  placeholder = 'Select…', style = {}, formInput = false,
}) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [hoverIdx, setHoverIdx] = useState(-1)
  const [dropRect, setDropRect] = useState(null)

  const wrapRef  = useRef(null)
  const inputRef = useRef(null)
  const listRef  = useRef(null)

  const selected = options.find(o => getValue(o) === value) ?? null

  const filtered = query.trim()
    ? options.filter(o => getLabel(o).toLowerCase().includes(query.toLowerCase()))
    : options

  // ── Geometry ────────────────────────────────────────────────────────────────
  const measureTrigger = () => {
    if (wrapRef.current) setDropRect(wrapRef.current.getBoundingClientRect())
  }

  // ── Open / close ────────────────────────────────────────────────────────────
  const openDrop = () => {
    measureTrigger()
    setQuery('')
    setHoverIdx(-1)
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const closeDrop = () => { setOpen(false); setQuery(''); setHoverIdx(-1) }

  const pick = (opt) => { onChange(getValue(opt)); closeDrop() }

  // ── Keyboard (only active when open) ────────────────────────────────────────
  const handleKeyDown = (e) => {
    e.stopPropagation()   // don't let Enter/Escape bubble to form-level handlers
    switch (e.key) {
      case 'Escape':
        closeDrop()
        break
      case 'ArrowDown':
        e.preventDefault()
        setHoverIdx(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHoverIdx(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (hoverIdx >= 0 && filtered[hoverIdx]) pick(filtered[hoverIdx])
        else if (filtered.length === 1) pick(filtered[0])
        break
      case 'Tab':
        closeDrop()
        break
      default:
        break
    }
  }

  // ── Close on outside click ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (
        !wrapRef.current?.contains(e.target) &&
        !listRef.current?.contains(e.target)
      ) closeDrop()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // ── Re-measure on scroll / resize so the portal follows the trigger ─────────
  useEffect(() => {
    if (!open) return
    const onMove = () => measureTrigger()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  // ── Derived drop position (flip up if near bottom of viewport) ───────────────
  const DROP_MAX_H = 220
  let dropTop = 0
  if (dropRect) {
    const spaceBelow = window.innerHeight - dropRect.bottom
    dropTop = spaceBelow >= DROP_MAX_H || spaceBelow >= dropRect.top
      ? dropRect.bottom + 2
      : dropRect.top - DROP_MAX_H - 2
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  const inputStyle = formInput ? {
    padding: '8px 12px',
    fontSize: 14,
    borderRadius: 'var(--radius-sm)',
    border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
    background: 'var(--bg-base)',
    color: open || selected ? 'var(--text-primary)' : 'var(--text-muted)',
    cursor: open ? 'text' : 'pointer',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
    boxShadow: open ? '0 0 0 3px var(--accent-dim)' : 'none',
    ...style,
  } : {
    padding: '4px 6px',
    fontSize: 12,
    borderRadius: 5,
    border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
    background: 'var(--bg-card)',
    color: open || selected ? 'var(--text-primary)' : 'var(--text-muted)',
    cursor: open ? 'text' : 'pointer',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    ...style,
  }

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <input
        ref={inputRef}
        readOnly={!open}
        value={open ? query : (selected ? getLabel(selected) : value || '')}
        placeholder={open ? 'Type to search…' : placeholder}
        onClick={open ? undefined : openDrop}
        onKeyDown={open
          ? handleKeyDown
          : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrop() } }
        }
        onChange={open ? (e) => { setQuery(e.target.value); setHoverIdx(-1) } : undefined}
        style={inputStyle}
      />

      {open && dropRect && createPortal(
        <div ref={listRef} style={{
          position: 'fixed',
          top: dropTop,
          left: dropRect.left,
          width: Math.max(dropRect.width, 200),
          maxHeight: DROP_MAX_H,
          overflowY: 'auto',
          background: 'var(--bg-card)',
          border: '1px solid var(--accent)',
          borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          zIndex: 9999,
        }}>
          {filtered.length === 0
            ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No results
              </div>
            : filtered.map((o, i) => {
                const isSelected = getValue(o) === value
                const isActive   = i === hoverIdx || isSelected
                return (
                  <div
                    key={getValue(o)}
                    onMouseDown={e => { e.preventDefault(); pick(o) }}
                    onMouseEnter={() => setHoverIdx(i)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: isActive ? 'var(--accent-subtle)' : 'transparent',
                      color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    {getLabel(o)}
                  </div>
                )
              })
          }
        </div>,
        document.body,
      )}
    </div>
  )
}
