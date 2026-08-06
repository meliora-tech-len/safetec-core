import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileSpreadsheet, FileText, Pencil, Trash2, LayoutList } from 'lucide-react'
import toast from 'react-hot-toast'
import { format, parseISO, isValid } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'
import { getStatements, deleteStatement, exportStatementPdf, exportStatementExcel, saveBlob } from '../services/api'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const now = new Date()
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const YEARS = []
for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) YEARS.push(y)

const entityChip = {
  background: 'var(--accent-dim)', color: 'var(--accent)',
  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: 0.5,
}

function fmtDate(val) {
  if (!val) return ''
  try {
    const d = typeof val === 'string' ? parseISO(val) : val
    return isValid(d) ? format(d, 'dd MMM yyyy') : ''
  } catch { return '' }
}

function fmtAmt(val) {
  const n = parseFloat(val) || 0
  return n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}


function stmtTotal(stmt) {
  const t = parseFloat(stmt.total)
  return Number.isFinite(t) ? t : (stmt.lines || []).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
}

export default function StatementsPage() {
  const navigate = useNavigate()
  const { isAdmin, entities } = useAuth()

  const [statements, setStatements] = useState([])
  const [loading, setLoading]       = useState(true)
  const [exporting, setExporting]   = useState(null) // statement id + fmt being exported

  const [filterEntity, setFilterEntity] = useEntityFilter()
  const [filterMonth, setFilterMonth] = useSessionState('period:statements:month', now.getMonth() + 1) // '' = all months
  const [filterYear, setFilterYear] = useSessionState('period:statements:year', now.getFullYear())
  const { sort, onSort } = useSort('statement_date', 'desc', 'statements')

  useEffect(() => {
    load()
  }, [filterEntity, filterMonth, filterYear])

  async function load() {
    setLoading(true)
    try {
      const params = {}
      if (filterEntity) params.entity_id = filterEntity
      if (filterMonth) params.month = filterMonth
      if (filterYear) params.year = filterYear
      const res = await getStatements(params)
      setStatements(res.data || [])
    } catch {
      toast.error('Failed to load statements')
    } finally {
      setLoading(false)
    }
  }

  const sorted = applySort(statements, sort, (s, col) => {
    if (col === 'lines') return (s.lines || []).length
    if (col === 'total') return stmtTotal(s)
    return s[col]
  })

  async function handleDelete(stmt) {
    if (!window.confirm(`Delete "${stmt.title || 'this statement'}"?`)) return
    try {
      await deleteStatement(stmt.id)
      setStatements(prev => prev.filter(s => s.id !== stmt.id))
      toast.success('Statement deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function handleExport(stmt, fmt) {
    setExporting(stmt.id + fmt)
    try {
      const payload = {
        entity_id:      stmt.entity_id,
        customer_id:    stmt.customer_id ?? null,
        statement_type: stmt.statement_type || 'generic',
        statement_date: stmt.statement_date ? stmt.statement_date.slice(0, 10) : null,
        title:          stmt.title || null,
        lines: (stmt.lines || []).slice().sort((a, b) => a.sort_order - b.sort_order).map((l, i) => ({
          line_date:      l.line_date ? l.line_date.slice(0, 10) : null,
          description:    l.description || null,
          invoice_number: l.invoice_number || null,
          amount:         parseFloat(l.amount) || 0,
          sort_order:     i,
        })),
      }
      const base = (stmt.title || 'STATEMENT').replace(/\s+/g, '_')
      if (fmt === 'excel') {
        const res = await exportStatementExcel(payload)
        saveBlob(res.data, XLSX_MIME, `${base}.xlsx`)
      } else {
        const res = await exportStatementPdf(payload)
        saveBlob(res.data, 'application/pdf', `${base}.pdf`)
      }
      toast.success('Downloaded')
    } catch (e) {
      console.error(e)
      toast.error('Export failed')
    } finally {
      setExporting(null)
    }
  }

  // ─── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>

      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LayoutList size={22} style={{ color: 'var(--accent)' }} />
            Statements
          </div>
          <div className="page-subtitle">
            {statements.length} statement{statements.length !== 1 ? 's' : ''} — {filterMonth ? `${MONTHS[filterMonth]} ` : ''}{filterYear}
          </div>
        </div>
        <button className="btn-primary" onClick={() => navigate('/statements/new')}>
          <Plus size={15} /> New Statement
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 180 }}>
            <option value="">All Entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value ? parseInt(e.target.value) : '')} style={{ width: 130 }}>
          <option value="">All Months</option>
          {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))} style={{ width: 90 }}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <SortableHeader label="Date" col="statement_date" sort={sort} onSort={onSort} />
              {isAdmin && <SortableHeader label="Entity" col="entity_code" sort={sort} onSort={onSort} />}
              <SortableHeader label="Customer" col="customer_name" sort={sort} onSort={onSort} />
              <SortableHeader label="Title" col="title" sort={sort} onSort={onSort} />
              <SortableHeader label="Lines" col="lines" sort={sort} onSort={onSort} style={{ textAlign: 'right' }} />
              <SortableHeader label="Amount Due (R)" col="total" sort={sort} onSort={onSort} style={{ textAlign: 'right' }} />
              <th style={{ width: 130 }}>Export</th>
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdmin ? 8 : 7} style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : statements.length === 0 ? (
              <tr><td colSpan={isAdmin ? 8 : 7}>
                <div className="empty-state">
                  <LayoutList size={32} />
                  <p>No statements for this period — adjust the filters or create one</p>
                </div>
              </td></tr>
            ) : sorted.map(stmt => (
              <tr key={stmt.id}>
                <td style={{ fontSize: 13 }}>{fmtDate(stmt.statement_date)}</td>
                {isAdmin && (
                  <td>
                    {stmt.entity_code
                      ? <span style={entityChip}>{stmt.entity_code}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                )}
                <td style={{ fontWeight: 500 }}>{stmt.customer_name || '—'}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{stmt.title || '—'}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{(stmt.lines || []).length}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>
                  {fmtAmt(stmtTotal(stmt))}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn-ghost btn-sm"
                      title="Export PDF"
                      disabled={exporting === stmt.id + 'pdf'}
                      onClick={() => handleExport(stmt, 'pdf')}
                      style={{ padding: '4px 8px' }}
                    >
                      <FileText size={13} style={{ color: 'var(--danger)' }} />
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      title="Export Excel"
                      disabled={exporting === stmt.id + 'excel'}
                      onClick={() => handleExport(stmt, 'excel')}
                      style={{ padding: '4px 8px' }}
                    >
                      <FileSpreadsheet size={13} style={{ color: '#16a34a' }} />
                    </button>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-icon" title="Edit" onClick={() => navigate(`/statements/${stmt.id}`)}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn-icon" title="Delete" onClick={() => handleDelete(stmt)}
                      style={{ color: 'var(--danger)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
