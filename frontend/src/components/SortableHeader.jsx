import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

export function useSort(defaultCol = null, defaultDir = 'asc') {
  const [sort, setSort] = useState({ col: defaultCol, dir: defaultDir })
  const onSort = (col) =>
    setSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }))
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
