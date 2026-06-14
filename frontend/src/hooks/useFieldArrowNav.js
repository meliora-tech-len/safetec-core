import { useEffect } from 'react'

/**
 * Excel-style keyboard navigation, mounted once globally (in AppLayout).
 *
 * Left / Right arrows move focus to the previous / next form field instead of
 * moving the text caret inside the field — matching the muscle memory of users
 * who live in spreadsheets. Tab still works as before; this just adds arrows.
 *
 * Scope & safety:
 *   - Navigation is confined to the nearest `.modal`, `<form>` or
 *     `[data-field-scope]` ancestor, so arrows never jump out of an open dialog
 *     into the page behind it. Outside those, it walks the whole page.
 *   - <textarea> and contentEditable are left alone (they need arrows to edit).
 *   - Checkboxes / radios are skipped (arrows have native meaning there).
 *   - Any field or container marked `data-no-arrow-nav` opts out entirely.
 *   - Modifier combos (Shift/Ctrl/Alt/Meta + arrow) are left untouched so text
 *     selection and word-jumps still work.
 *
 * SearchableSelect stops propagation while its dropdown is open, so option
 * arrowing there is unaffected.
 */
const FIELD_SELECTOR = [
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(',')

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
}

export function useFieldArrowNav() {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.defaultPrevented) return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return

      const el = document.activeElement
      if (!el || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      if (el.closest('[data-no-arrow-nav]')) return
      if (!el.matches(FIELD_SELECTOR)) return

      const scope = el.closest('.modal, form, [data-field-scope]') || document
      const fields = Array.from(scope.querySelectorAll(FIELD_SELECTOR))
        .filter(f => isVisible(f) && !f.closest('[data-no-arrow-nav]'))

      const idx = fields.indexOf(el)
      if (idx === -1) return

      const next = fields[idx + (e.key === 'ArrowRight' ? 1 : -1)]
      if (!next) return // stop at the first/last field, don't wrap

      e.preventDefault()
      next.focus()
      // Excel-like: select existing text so typing overwrites it.
      if (next.tagName === 'INPUT' && typeof next.select === 'function') {
        try { next.select() } catch { /* some input types can't be selected */ }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
