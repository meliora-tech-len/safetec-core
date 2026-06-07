import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileSpreadsheet, FileText, Pencil, Trash2, LayoutList } from 'lucide-react'
import toast from 'react-hot-toast'
import { format, parseISO, isValid } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { getStatements, deleteStatement, exportStatementPdf, exportStatementExcel, saveBlob } from '../services/api'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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


export default function StatementsPage() {
  const navigate = useNavigate()
  const { isAdmin, activeEntity } = useAuth()

  const [statements, setStatements] = useState([])
  const [loading, setLoading]       = useState(true)
  const [exporting, setExporting]   = useState(null) // statement id + fmt being exported

  useEffect(() => {
    load()
  }, [activeEntity])

  async function load() {
    setLoading(true)
    try {
      const params = {}
      if (!isAdmin && activeEntity) params.entity_id = activeEntity.id
      const res = await getStatements(params)
      setStatements(res.data || [])
    } catch {
      toast.error('Failed to load statements')
    } finally {
      setLoading(false)
    }
  }

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
          <div className="page-subtitle">{statements.length} statement{statements.length !== 1 ? 's' : ''}</div>
        </div>
        <button className="btn-primary" onClick={() => navigate('/statements/new')}>
          <Plus size={15} /> New Statement
        </button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Customer</th>
              <th>Title</th>
              <th style={{ textAlign: 'right' }}>Lines</th>
              <th style={{ textAlign: 'right' }}>Amount Due (R)</th>
              <th style={{ width: 130 }}>Export</th>
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : statements.length === 0 ? (
              <tr><td colSpan={7}>
                <div className="empty-state">
                  <LayoutList size={32} />
                  <p>No statements yet — create one to get started</p>
                </div>
              </td></tr>
            ) : statements.map(stmt => (
              <tr key={stmt.id}>
                <td style={{ fontSize: 13 }}>{fmtDate(stmt.statement_date)}</td>
                <td style={{ fontWeight: 500 }}>{stmt.customer_name || '—'}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{stmt.title || '—'}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{(stmt.lines || []).length}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>
                  {fmtAmt(stmt.total ?? (stmt.lines || []).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0))}
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
