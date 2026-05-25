import { useState, useEffect, useRef, forwardRef } from 'react'
import { Calendar } from 'lucide-react'

function isoToDisplay(iso) {
  if (!iso || iso.length < 8) return ''
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function displayToISO(text) {
  if (!text || text.length < 10) return null
  const parts = text.split('/')
  if (parts.length !== 3) return null
  const [d, m, y] = parts
  if (d.length !== 2 || m.length !== 2 || y.length !== 4) return null
  const dd = parseInt(d, 10), mm = parseInt(m, 10)
  if (isNaN(dd) || isNaN(mm)) return null
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return `${y}-${m}-${d}`
}

// Accepts/emits yyyy-mm-dd (same API as <input type="date">).
// Displays and accepts typing in dd/mm/yyyy. Calendar icon opens the native picker.
const DateInput = forwardRef(function DateInput(
  { value, onChange, className, style, inputStyle, disabled, onKeyDown, ...props },
  ref
) {
  const [text, setText] = useState(isoToDisplay(value))
  const lastISO = useRef(value)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (value !== lastISO.current) {
      lastISO.current = value
      setText(isoToDisplay(value))
    }
  }, [value])

  const emit = (iso) => {
    lastISO.current = iso
    onChange?.({ target: { value: iso } })
  }

  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    let formatted
    if (digits.length === 0)      formatted = ''
    else if (digits.length <= 2)  formatted = digits
    else if (digits.length <= 4)  formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
    else                          formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    setText(formatted)
    const iso = displayToISO(formatted)
    if (iso)              emit(iso)
    else if (!formatted)  emit('')
  }

  const handleBlur = () => {
    const iso = displayToISO(text)
    if (iso) setText(isoToDisplay(iso))
  }

  const handleKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) return
    const passThrough = ['Backspace', 'Delete', 'Tab', 'Enter', 'Escape',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (!passThrough.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault()
    onKeyDown?.(e)
  }

  const handlePickerChange = (e) => {
    if (!e.target.value) return
    setText(isoToDisplay(e.target.value))
    emit(e.target.value)
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        className={className}
        style={{ flex: 1, minWidth: 0, paddingRight: '1.8em', ...inputStyle }}
        disabled={disabled}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="dd/mm/yyyy"
        maxLength={10}
      />
      {/* Calendar icon — visual only, pointer events blocked so clicks fall to the hidden input */}
      <Calendar
        size={13}
        style={{
          position: 'absolute', right: 7, pointerEvents: 'none',
          color: 'var(--text-muted)', opacity: disabled ? 0.3 : 0.55,
        }}
      />
      {/* Hidden native date input sits over the icon area — clicking it opens the picker */}
      <input
        ref={pickerRef}
        type="date"
        value={value || ''}
        onChange={handlePickerChange}
        tabIndex={-1}
        disabled={disabled}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: 28, opacity: 0, cursor: 'pointer',
        }}
      />
    </div>
  )
})

export default DateInput
