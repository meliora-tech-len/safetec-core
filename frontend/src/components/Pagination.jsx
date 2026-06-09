import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Reusable pager for server-paginated tables.
 *
 * Props:
 *   page     — current 1-based page
 *   pageSize — rows per page
 *   total    — total matching rows (across all pages)
 *   onChange — (nextPage) => void
 */
export default function Pagination({ page, pageSize, total, onChange }) {
  if (!total) return null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  const go = (p) => onChange(Math.min(Math.max(1, p), pages))
  const btnStyle = (disabled) => ({ ...styles.btn, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' })

  return (
    <div style={styles.bar}>
      <span style={styles.summary}>
        Showing <strong>{from.toLocaleString()}–{to.toLocaleString()}</strong> of{' '}
        <strong>{total.toLocaleString()}</strong>
      </span>
      <div style={styles.controls}>
        <button style={btnStyle(page <= 1)} disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronLeft size={14} /> Prev
        </button>
        <span style={styles.pageInfo}>Page {page} of {pages.toLocaleString()}</span>
        <button style={btnStyle(page >= pages)} disabled={page >= pages} onClick={() => go(page + 1)}>
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

const styles = {
  bar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  summary: { fontSize: 12, color: 'var(--text-muted)' },
  controls: { display: 'flex', alignItems: 'center', gap: 10 },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: 3, height: 30, padding: '0 10px',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)',
  },
  pageInfo: { fontSize: 12, color: 'var(--text-secondary)', minWidth: 90, textAlign: 'center' },
}
