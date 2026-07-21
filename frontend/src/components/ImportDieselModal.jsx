import { useState, useEffect, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle, Flag } from 'lucide-react'
import { getSuppliers, importDiesel } from '../services/api'
import SearchableSelect from './SearchableSelect'
import { errorMessage } from '../utils/helpers'

// Parse a Bokamosho-style diesel pivot sheet into fill-up rows.
// - forward-fills DIESEL DEPO + DATE down each group
// - skips every "… Total" subtotal row (they have no LITRES)
function toISODate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const d = new Date(v)
  return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseDieselSheet(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })

  let hdr = -1
  for (let i = 0; i < grid.length; i++) {
    if ((grid[i] || []).some(c => String(c ?? '').trim().toUpperCase() === 'DIESEL DEPO')) { hdr = i; break }
  }
  if (hdr < 0) throw new Error('Could not find the header row (DIESEL DEPO).')

  const H = (grid[hdr] || []).map(c => String(c ?? '').trim().toUpperCase())
  const find = (pred) => H.findIndex(pred)
  const cDepot = find(h => h === 'DIESEL DEPO')
  const cDate  = find(h => h === 'DATE')
  const cReg   = find(h => h === 'REGISTRATION')
  const cSlip  = find(h => h === 'SLIP NUMBER')
  const cLit   = find(h => h === 'LITRES')
  const cAmt   = find(h => h.startsWith('SUM OF AMOUNT') || h === 'AMOUNT (EXCL)' || h === 'AMOUNT EXCL')
  if (cReg < 0 || cLit < 0 || cAmt < 0) throw new Error('Missing required columns (Registration / Litres / Amount).')

  const isTotal = (v) => String(v ?? '').trim().toLowerCase().endsWith('total')
  let lastDepot = null, lastDate = null
  const out = []
  for (let i = hdr + 1; i < grid.length; i++) {
    const row = grid[i] || []
    const depot = row[cDepot], dt = row[cDate], reg = row[cReg], slip = row[cSlip], lit = row[cLit], amt = row[cAmt]

    const depotStr = depot == null ? '' : String(depot).trim()
    if (depotStr && !isTotal(depotStr)) lastDepot = depotStr
    if (dt != null && dt !== '') lastDate = dt

    if (lit == null || lit === '') continue                  // subtotal rows have no litres
    const regStr = reg == null ? '' : String(reg).trim()
    if (!regStr || isTotal(regStr)) continue
    if (isTotal(slip)) continue

    out.push({
      depot: lastDepot || null,
      fillup_date: toISODate(lastDate),
      registration: regStr,
      slip_number: slip == null ? null : String(slip).trim() || null,
      litres: Number(lit),
      amount: Number(amt),
    })
  }
  return out
}

const STATUS_STYLE = {
  matched:   { color: '#16a34a', bg: 'rgba(34,197,94,0.12)',  label: 'Match' },
  created:   { color: '#16a34a', bg: 'rgba(34,197,94,0.12)',  label: 'Created' },
  updated:   { color: '#2563eb', bg: 'rgba(37,99,235,0.12)',  label: 'Rate filled' },
  duplicate: { color: '#d97706', bg: 'rgba(217,119,6,0.14)',  label: 'Duplicate' },
  unmatched: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)',  label: 'No truck' },
  invalid:   { color: '#dc2626', bg: 'rgba(220,38,38,0.12)',  label: 'Invalid' },
}

export default function ImportDieselModal({ entityId, onClose, onImported }) {
  const [suppliers, setSuppliers] = useState([])
  const [depotSuppliers, setDepotSuppliers] = useState({})   // depot → supplierId (string)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  // distinct depots found in the sheet (empty string for blank depot)
  const depots = useMemo(() => [...new Set(rows.map(r => r.depot || ''))], [rows])
  const allMapped = depots.length > 0 && depots.every(d => depotSuppliers[d])

  useEffect(() => {
    if (!entityId) return
    getSuppliers({ entity_id: entityId, is_diesel_supplier: true, limit: 200 })
      .then(r => setSuppliers(r.data || []))
      .catch(() => {})
  }, [entityId])

  // Auto-match each depot to a supplier by name (e.g. "JFM Oukop" → "Oukop")
  useEffect(() => {
    if (!depots.length || !suppliers.length) return
    setDepotSuppliers(prev => {
      const next = { ...prev }
      depots.forEach(d => {
        if (next[d]) return
        const dl = d.toLowerCase()
        const m = suppliers.find(s => {
          const n = s.name.toLowerCase()
          return dl && (dl.includes(n) || n.includes(dl))
        })
        if (m) next[d] = String(m.id)
      })
      return next
    })
  }, [rows, suppliers])  // eslint-disable-line react-hooks/exhaustive-deps

  function depotSupplierMap() {
    const map = {}
    Object.entries(depotSuppliers).forEach(([d, sid]) => { if (sid) map[d] = Number(sid) })
    return map
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setPreview(null)
    try {
      const parsed = parseDieselSheet(await file.arrayBuffer())
      if (!parsed.length) { toast.error('No data rows found in the sheet'); setRows([]); return }
      setRows(parsed)
      toast.success(`Parsed ${parsed.length} row${parsed.length !== 1 ? 's' : ''}`)
    } catch (err) {
      toast.error(err.message || 'Failed to parse file')
      setRows([])
    }
  }

  async function runPreview() {
    if (!rows.length) return toast.error('Choose a file first')
    if (!allMapped) return toast.error('Assign a diesel supplier to every depot')
    setBusy(true)
    try {
      const res = await importDiesel({ entity_id: Number(entityId), depot_suppliers: depotSupplierMap(), commit: false, rows })
      setPreview(res.data)
    } catch (e) { toast.error(errorMessage(e, 'Preview failed')) }
    finally { setBusy(false) }
  }

  async function runImport() {
    setBusy(true)
    try {
      const res = await importDiesel({ entity_id: Number(entityId), depot_suppliers: depotSupplierMap(), commit: true, rows })
      const c = res.data.created
      const u = res.data.updated || 0
      toast.success(
        `Imported ${c} fill-up${c !== 1 ? 's' : ''}` +
        (u > 0 ? ` · filled rate into ${u} pending slip${u !== 1 ? 's' : ''}` : '')
      )
      onImported?.()
      onClose()
    } catch (e) { toast.error(errorMessage(e, 'Import failed')) }
    finally { setBusy(false) }
  }

  const fmtAmt = (n) => Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card, #fff)', borderRadius: 10, width: 'min(900px, 100%)',
        maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSpreadsheet size={16} style={{ color: 'var(--accent)' }} /> Import Diesel Sheet
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Controls */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} style={{ display: 'none' }} />
            <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {fileName || 'Choose .xlsx file'}
            </button>
            {rows.length > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} rows parsed</span>}
            <div style={{ flex: 1 }} />
            <button className="btn-primary btn-sm" onClick={runPreview} disabled={busy || !rows.length || !allMapped}>
              {busy && !preview ? 'Checking…' : 'Preview'}
            </button>
          </div>

          {/* Depot → supplier mapping */}
          {depots.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                Diesel supplier per depot
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {depots.map(d => (
                  <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={d || '(no depot)'}>
                      {d || '(no depot)'}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SearchableSelect formInput value={depotSuppliers[d] || ''}
                        onChange={v => setDepotSuppliers(p => ({ ...p, [d]: v }))}
                        options={suppliers} getValue={s => String(s.id)} getLabel={s => s.name} placeholder="Diesel supplier…" />
                    </div>
                  </div>
                ))}
              </div>
              {!allMapped && <div style={{ fontSize: 11, color: '#d97706', marginTop: 6 }}>Assign a supplier to every depot to continue.</div>}
            </div>
          )}
        </div>

        {/* Preview */}
        <div style={{ overflowY: 'auto', flex: 1, padding: preview ? '14px 18px' : 0 }}>
          {!preview ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Pick the supplier and the diesel sheet, then <strong>Preview</strong>. Subtotal ("Total") rows are ignored automatically.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <Chip color="#16a34a" label="Will import" value={preview.matched} />
                {preview.updated > 0 && <Chip color="#2563eb" label="Rate fills (pending)" value={preview.updated} />}
                <Chip color="#d97706" label="Duplicates (skip)" value={preview.duplicates} />
                <Chip color="#dc2626" label="No truck (skip)" value={preview.unmatched} />
                {preview.invalid > 0 && <Chip color="#dc2626" label="Invalid" value={preview.invalid} />}
              </div>

              {preview.unmatched_registrations?.length > 0 && (
                <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#b91c1c', marginBottom: 4 }}>
                    <AlertTriangle size={13} /> No truck found for these registrations
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{preview.unmatched_registrations.join(', ')}</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                    Add them as a truck registration (or temp registration) in Fleet, then re-import.
                  </div>
                </div>
              )}

              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface)' }}>
                      {['Date', 'Reg', 'Slip', 'Litres', 'Amount (excl)', 'Rate', 'Supplier', 'Truck', 'Status'].map((h, i) => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: i >= 3 && i <= 5 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => {
                      const st = STATUS_STYLE[r.status] || STATUS_STYLE.unmatched
                      return (
                        <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{r.fillup_date}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{r.registration}</td>
                          <td style={{ padding: '6px 10px' }}>{r.slip_number || '—'}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtAmt(r.litres)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtAmt(r.amount)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtAmt(r.rate_per_litre)}</td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{r.supplier_name || '—'}</td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                            {r.truck_registration || '—'}
                            {r.matched_by_temp && (
                              <span title="Matched via temporary registration" style={{ marginLeft: 5, fontSize: 9, fontWeight: 800, color: '#b45309', background: 'rgba(217,119,6,0.14)', padding: '1px 4px', borderRadius: 3 }}>TEMP</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 7px', borderRadius: 10 }}>{st.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {preview ? `${preview.matched + (preview.updated || 0)} of ${preview.total} rows will be imported` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={runImport} disabled={busy || !preview || (preview.matched + (preview.updated || 0)) === 0}>
              {busy ? 'Importing…' : preview ? `Import ${preview.matched + (preview.updated || 0)}` : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Chip({ color, label, value }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
      color, background: `${color}1f`, padding: '4px 10px', borderRadius: 20 }}>
      <CheckCircle size={12} /> {value} {label}
    </span>
  )
}
