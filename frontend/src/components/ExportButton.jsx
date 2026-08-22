import { useState, useRef, useEffect } from 'react'
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react'
import { exportToExcel, exportToPdf } from '../utils/exportUtils'

/**
 * Reusable export dropdown.
 *
 * Props:
 *   columns   — Array<{ header: string, key?: string, value?: (row) => string }>
 *   data      — Array<object>  (the currently displayed / filtered rows)
 *   fetchData — optional async () => Array<object>. When set, the full dataset is
 *               fetched on export (e.g. all server pages) instead of using `data`.
 *   filename  — string without extension  e.g. 'suppliers-2024'
 *   title     — string shown in the PDF header  e.g. 'Suppliers Report'
 *   disabled  — bool (optional)
 *   extraItems — optional Array<{ key, label, icon?, title?, onClick }> of extra
 *                menu entries rendered below the standard Excel/PDF pair.
 */
export default function ExportButton({ columns, data, fetchData, filename, title, disabled, extraItems }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handle = async (type) => {
    setOpen(false)
    let rows = data
    if (fetchData) {
      setBusy(true)
      try { rows = await fetchData() }
      catch { rows = null }
      finally { setBusy(false) }
    }
    if (!rows?.length) return
    const stamp = new Date().toISOString().slice(0, 10)
    const file = `${filename}-${stamp}`
    if (type === 'excel') exportToExcel(columns, rows, file)
    else exportToPdf(columns, rows, file, title)
  }

  const noData = !fetchData && !data?.length

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="btn-ghost"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy || noData}
        title={noData ? 'No data to export' : (busy ? 'Preparing export…' : 'Export')}
        style={{ display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <Download size={13} />
        {busy ? 'Exporting…' : 'Export'}
        <ChevronDown size={11} style={{ opacity: 0.6, marginLeft: 1 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 100,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: 'var(--shadow)', overflow: 'hidden',
          minWidth: 160,
        }}>
          <button onClick={() => handle('excel')} style={itemStyle}>
            <FileSpreadsheet size={14} style={{ color: '#16a34a' }} />
            Export to Excel
          </button>
          <button onClick={() => handle('pdf')} style={itemStyle}>
            <FileText size={14} style={{ color: '#dc2626' }} />
            Export to PDF
          </button>
          {extraItems?.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid var(--border)' }} />
              {extraItems.map(item => (
                <button
                  key={item.key || item.label}
                  onClick={() => { setOpen(false); item.onClick() }}
                  title={item.title}
                  style={itemStyle}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const itemStyle = {
  display: 'flex', alignItems: 'center', gap: 9,
  width: '100%', padding: '9px 14px',
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 13, color: 'var(--text-primary)', textAlign: 'left',
  transition: 'background 0.1s',
}
