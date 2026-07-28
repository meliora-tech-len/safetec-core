import { useMemo } from 'react'
import { X } from 'lucide-react'
import { formatCurrency } from '../utils/helpers'
import SortableHeader, { useSort, applySort } from './SortableHeader'

/**
 * Generic "show proof" modal for a dashboard total — lists the itemized rows
 * that sum to the clicked stat card, with a total footer that should match it.
 * `columns` is [{ label, align?, render(row), sortValue?(row) }]; `onRowClick`
 * (optional) makes rows clickable (e.g. navigate to the underlying invoice).
 * Every column header sorts: give `sortValue` whenever what's rendered doesn't
 * sort correctly as text (amounts, formatted dates).
 */
export default function DrilldownModal({ title, subtitle, rows, total, columns, onRowClick, onClose }) {
  const { sort, onSort } = useSort(null)
  // Columns are keyed by label; fall back to the rendered cell, unwrapping the
  // odd JSX cell (e.g. a status badge) down to its text.
  const sortedRows = useMemo(() => applySort(rows, sort, (row, label) => {
    const col = columns.find(c => c.label === label)
    if (!col) return ''
    if (col.sortValue) return col.sortValue(row)
    const cell = col.render(row)
    return cell && typeof cell === 'object' ? (cell.props?.children ?? '') : cell
  }), [rows, sort, columns])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 900 }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {title}
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>{subtitle}</span>
          </h2>
          <button className="btn-icon btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
          {rows.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}><p>Nothing here for this total.</p></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {columns.map(col => (
                      <SortableHeader
                        key={col.label}
                        label={col.label}
                        col={col.label}
                        sort={sort}
                        onSort={onSort}
                        className={col.align === 'right' ? 'text-right' : undefined}
                        style={col.align === 'right' ? { textAlign: 'right' } : undefined}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => (
                    <tr
                      key={row.id ?? i}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                    >
                      {columns.map(col => (
                        <td key={col.label} className={col.align === 'right' ? 'text-right' : undefined}>
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={columns.length - 1} style={{ fontWeight: 700, textAlign: 'right', paddingTop: 10 }}>
                      Total
                    </td>
                    <td className="text-right" style={{ fontWeight: 800, paddingTop: 10 }}>
                      {formatCurrency(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
