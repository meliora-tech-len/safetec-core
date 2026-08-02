import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { useLocalState } from '../hooks/useLocalState'

/**
 * Table sort state. Pass a stable `key` (unique per table) to remember the
 * user's choice across reloads and sessions; omit it for throwaway tables
 * (modals) that should always open on their default order.
 */
export function useSort(defaultCol = null, defaultDir = 'asc', key = null) {
  const fallback = { col: defaultCol, dir: defaultDir }
  const [stored, setSort] = useLocalState(key ? `sort:${key}` : null, fallback)
  // Guard against a stored value written by an older shape of this hook.
  const sort = stored && (stored.dir === 'asc' || stored.dir === 'desc') ? stored : fallback
  const onSort = (col) =>
    setSort(prev => ({ col, dir: prev?.col === col && prev?.dir === 'asc' ? 'desc' : 'asc' }))
  return { sort, onSort }
}

export function applySort(data, sort, getVal = null) {
  if (!sort.col || !data?.length) return data
  return [...data].sort((a, b) => {
    let av = getVal ? getVal(a, sort.col) : a[sort.col]
    let bv = getVal ? getVal(b, sort.col) : b[sort.col]
    if (av == null) av = ''
    if (bv == null) bv = ''
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
    return sort.dir === 'asc' ? cmp : -cmp
  })
}

export default function SortableHeader({ label, col, sort, onSort, style, className }) {
  const active = sort.col === col
  return (
    <th
      onClick={() => onSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
      className={className}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {active
          ? (sort.dir === 'asc'
              ? <ChevronUp size={12} style={{ color: 'var(--accent)' }} />
              : <ChevronDown size={12} style={{ color: 'var(--accent)' }} />)
          : <ChevronsUpDown size={12} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        }
      </span>
    </th>
  )
}
