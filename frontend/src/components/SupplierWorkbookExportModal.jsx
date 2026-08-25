import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'
import DateInput from './DateInput'
import { downloadSupplierSummaryExcel } from '../services/api'
import { errorMessage, MONTHS_LONG_1 as MONTH_NAMES } from '../utils/helpers'

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const box = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
  padding: 24, width: 400, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
}

// ── Supplier Workbook export modal ────────────────────────────────────────────
// Period picker for the server-side Excel workbook (Reports → Supplier Summary
// layout: one tab per supplier with month sections). Used by the Supplier
// Profile (pass `supplier` → that supplier only) and the Reports page (no
// supplier → every supplier of the entity).
//   "Month & Year" exports whole report months (incl. Manage→Move pins — ties
//   to the report exactly); "Date Range" filters to invoices dated inside the
//   range; "All" exports the entire history.
export default function SupplierWorkbookExportModal({ entityId, supplier, initialMonth, initialYear, onClose }) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const pad2 = (n) => String(n).padStart(2, '0')
  const [mode, setMode] = useState('month')            // 'month' | 'dates' | 'all'
  const [fromMonth, setFromMonth] = useState(initialMonth || 1)
  const [fromYear, setFromYear]   = useState(initialYear || thisYear)
  const [toMonth, setToMonth]     = useState(initialMonth || now.getMonth() + 1)
  const [toYear, setToYear]       = useState(initialYear || thisYear)
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [busy, setBusy] = useState(false)

  const lastDay = (y, m) => new Date(y, m, 0).getDate()
  const start = mode === 'month' ? `${fromYear}-${pad2(fromMonth)}-01` : dateFrom
  const end   = mode === 'month'
    ? `${toYear}-${pad2(toMonth)}-${pad2(lastDay(toYear, toMonth))}`
    : dateTo
  const bothSet = mode !== 'all' && !!(start && end)
  const valid = mode === 'all' || (bothSet && start <= end)

  const years = []
  for (let y = thisYear; y >= 2020; y--) years.push(y)

  const doExport = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const params = { entity_id: supplier ? supplier.entity_id : entityId }
      if (supplier) params.supplier_id = supplier.id
      if (mode === 'all') params.all_time = true
      else { params.start = start; params.end = end }
      const r = await downloadSupplierSummaryExcel(params)
      const url = URL.createObjectURL(new Blob([r.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }))
      const slug = supplier ? `${supplier.name.replace(/\s+/g, '-').toLowerCase()}-` : ''
      const a = document.createElement('a')
      a.href = url
      a.download = `supplier-summary-${slug}${mode === 'all' ? 'all' : `${start}-to-${end}`}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to export'))
    } finally {
      setBusy(false)
    }
  }

  const monthSelect = (value, setValue, title) => (
    <select className="form-input" value={value} title={title}
      onChange={e => setValue(Number(e.target.value))} style={{ flex: 1 }}>
      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
        <option key={m} value={m}>{MONTH_NAMES[m]}</option>
      ))}
    </select>
  )
  const yearSelect = (value, setValue, title) => (
    <select className="form-input" value={value} title={title}
      onChange={e => setValue(Number(e.target.value))} style={{ width: 90 }}>
      {years.map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  )

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Export Supplier Workbook</h3>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          {supplier
            ? <>Excel with month sections for {supplier.name} — same layout as the Reports → Supplier Summary export.</>
            : <>Excel workbook with one tab per supplier and month sections — the Supplier Summary report for the chosen period.</>}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['month', 'Month & Year'], ['dates', 'Date Range'], ['all', 'All']].map(([key, lbl]) => (
            <button key={key} type="button" onClick={() => setMode(key)}
              className={mode === key ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 13, padding: '6px 14px' }}>
              {lbl}
            </button>
          ))}
        </div>

        {mode === 'month' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>From</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {monthSelect(fromMonth, setFromMonth, 'First month included')}
              {yearSelect(fromYear, setFromYear, 'First year included')}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600 }}>To</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {monthSelect(toMonth, setToMonth, 'Last month included')}
              {yearSelect(toYear, setToYear, 'Last year included')}
            </div>
          </div>
        ) : mode === 'dates' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>From</label>
            <DateInput autoFocus value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="form-input" style={{ width: '100%' }} />
            <label style={{ fontSize: 12, fontWeight: 600 }}>To</label>
            <DateInput value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="form-input" style={{ width: '100%' }} />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Every supplier invoice on record{supplier ? ` for ${supplier.name}` : ''}, from the
            earliest month to the latest.
          </div>
        )}

        {bothSet && !valid && (
          <div style={{ fontSize: 12, color: '#dc2626', marginTop: 10 }}>
            The start of the period must be on or before its end.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn-ghost" style={{ fontSize: 13, padding: '6px 12px' }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={doExport} disabled={!valid || busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <FileSpreadsheet size={15} />
            {busy ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
      </div>
    </div>
  )
}
