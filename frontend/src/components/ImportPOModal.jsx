import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Upload, X, FileText, AlertCircle, CheckCircle } from 'lucide-react'

// Normalise a cell value to a plain string for column matching
function cellStr(val) {
  if (val == null) return ''
  return String(val).trim().toLowerCase()
}

// Format a number value coming from a cell (strips currency symbols, commas, spaces)
function cleanNum(val) {
  if (val == null || val === '') return ''
  const s = String(val).replace(/[^\d.\-]/g, '')
  return s === '' ? '' : s
}

// Convert an Excel serial date or date string to YYYY-MM-DD
function toDateStr(val) {
  if (!val) return ''
  // Excel serial number
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (d) {
      const month = String(d.m).padStart(2, '0')
      const day = String(d.d).padStart(2, '0')
      return `${d.y}-${month}-${day}`
    }
  }
  // String in YYYY/MM/DD or YYYY-MM-DD
  const s = String(val).trim()
  const m = s.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // Try JS Date parse
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return ''
}

// Extract route name (text before " to " in a description), uppercased
function extractRoute(description) {
  if (!description) return ''
  const lower = description.toLowerCase()
  const idx = lower.indexOf(' to ')
  if (idx > 0) return description.slice(0, idx).trim().toUpperCase()
  // Fallback: first word
  return description.split(/\s+/)[0].toUpperCase()
}

// Add a space between leading letters and trailing digits in a PO number
function formatPoNumber(poNum) {
  if (!poNum) return poNum
  return poNum.replace(/^([A-Za-z]+)(\d+)$/, '$1 $2')
}

function parsePOExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array', cellDates: false })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        // Convert to array of arrays (raw values)
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })

        // ── Find header row ────────────────────────────────────────
        // Look for the row containing "Horse Reg" AND ("Quantity" or "Price")
        let headerRowIdx = -1
        let colMap = {}
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          const hasHorse = row.some(c => cellStr(c).includes('horse'))
          const hasQty   = row.some(c => cellStr(c).includes('quantity') || cellStr(c) === 'qty')
          const hasPrice = row.some(c => cellStr(c).includes('price'))
          if (hasHorse && (hasQty || hasPrice)) {
            headerRowIdx = i
            row.forEach((c, j) => {
              const k = cellStr(c)
              if (k.includes('product'))        colMap.product = j
              if (k.includes('description'))    colMap.description = j
              if (k.includes('horse'))          colMap.horse_reg = j
              if (k.includes('load date'))      colMap.load_date = j
              if (k.includes('load wb') || k === 'load wb tckt' || k.includes('load wb tckt')) colMap.load_wb = j
              if (k.includes('delivery'))       colMap.delivery_date = j
              if ((k.includes('wb ticket') || k === 'wb ticket') && !k.includes('load')) colMap.wb_ticket = j
              if (k.includes('quantity') || k === 'qty') colMap.quantity = j
              if (k.includes('price'))          colMap.price = j
              if (k.includes('net value') || k === 'net') colMap.net_value = j
            })
            break
          }
        }

        if (headerRowIdx === -1) {
          return reject(new Error('No PO table found in this file. Make sure the file contains columns for Horse Reg, Quantity, and Price.'))
        }

        // ── Extract PO metadata from rows above header ─────────────
        let po_number = ''
        let po_date = ''
        let project_code = ''

        for (let i = 0; i < headerRowIdx; i++) {
          const row = rows[i]
          for (let j = 0; j < row.length; j++) {
            const s = String(row[j] || '').trim()
            // PO number pattern
            if (!po_number) {
              const m = s.match(/\b(POH\d+)\b/i)
              if (m) po_number = m[1].toUpperCase()
            }
            // Date near label "Date" or "Order number"
            if (!po_date) {
              const d = toDateStr(row[j])
              if (d && d >= '2000-01-01') po_date = d
            }
            // Project code: cell following "Project Code" label
            if (!project_code) {
              if (cellStr(row[j]) === 'project code' || cellStr(row[j]).includes('project code')) {
                // next non-empty cell in same row
                for (let k = j + 1; k < row.length; k++) {
                  const pc = String(row[k] || '').trim()
                  if (pc) { project_code = pc; break }
                }
              }
              // Also handle "Project Code" in cell, value in adjacent cell
              if (!project_code && s.match(/^\d{4}-\d{4}$/)) {
                project_code = s
              }
            }
          }
        }

        // ── Parse data rows ────────────────────────────────────────
        const stopPattern = /^(total|transfer|tax|expense|discount)/i
        const lineItems = []

        for (let i = headerRowIdx + 1; i < rows.length; i++) {
          const row = rows[i]
          // Stop if row looks like a footer total
          const firstCell = String(row[colMap.product ?? 0] || row[0] || '').trim()
          if (stopPattern.test(firstCell)) break
          // Skip blank rows
          if (row.every(c => c === '' || c == null)) continue

          const horse_reg   = String(row[colMap.horse_reg   ?? 2] || '').trim()
          const description = String(row[colMap.description ?? 1] || '').trim()
          const quantity    = cleanNum(row[colMap.quantity   ?? (colMap.net_value != null ? colMap.net_value - 2 : 7)])
          const price       = cleanNum(row[colMap.price      ?? (colMap.net_value != null ? colMap.net_value - 1 : 8)])
          const net_value   = cleanNum(row[colMap.net_value  ?? 9])
          const load_wb     = String(row[colMap.load_wb      ?? 4] || '').trim()
          const wb_ticket   = String(row[colMap.wb_ticket    ?? 6] || '').trim()

          // Must have at least a horse reg or quantity to be a real data row
          if (!horse_reg && !quantity) continue

          const itemDescription = horse_reg && description
            ? `${horse_reg} - ${description}`
            : horse_reg || description

          lineItems.push({
            description: itemDescription,
            loading_number: load_wb,
            offloading_number: wb_ticket,
            quantity,
            unit_price: price,
            amount: net_value,
            is_vat_exempt: false,
            line_type: 'item',
          })
        }

        if (lineItems.length === 0) {
          return reject(new Error('No data rows found in the PO table.'))
        }

        // ── Build header line item ─────────────────────────────────
        const firstDesc = lineItems[0]?.description || ''
        // Extract route from the description part after Horse Reg
        const descPart = firstDesc.includes(' - ') ? firstDesc.split(' - ').slice(1).join(' - ') : firstDesc
        const route = extractRoute(descPart)
        const poSpaced = formatPoNumber(po_number)
        const headerDesc = [route, poSpaced, project_code ? `- TDK/${project_code}` : ''].filter(Boolean).join(' ')

        const allLines = [
          {
            description: headerDesc,
            loading_number: '',
            offloading_number: '',
            quantity: '',
            unit_price: '',
            amount: '',
            is_vat_exempt: false,
            line_type: 'header',
          },
          ...lineItems,
        ].map((li, i) => ({ ...li, sort_order: i }))

        resolve({ po_number, po_date, project_code, line_items: allLines })
      } catch (err) {
        reject(new Error('Failed to parse the file: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read the file.'))
    reader.readAsArrayBuffer(file)
  })
}

export default function ImportPOModal({ onClose }) {
  const navigate = useNavigate()
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState(null)
  const fileRef = useRef(null)

  const handleFile = async (file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setError('Please upload an Excel file (.xlsx, .xls) or CSV.')
      return
    }
    setError('')
    setParsing(true)
    try {
      const result = await parsePOExcel(file)
      setParsed(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setParsing(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }

  const handleConfirm = () => {
    navigate('/invoices/new', { state: { poImportPayload: parsed } })
    onClose()
  }

  const itemLines = parsed ? parsed.line_items.filter(l => l.line_type === 'item') : []
  const total = itemLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const previewLines = itemLines.slice(0, 5)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: 620, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>Import PO</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(220,38,38,0.08)', color: '#dc2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
          </div>
        )}

        {!parsed ? (
          /* ── Upload zone ── */
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Upload the Excel file converted from the Purchase Order PDF. The importer will extract line items and pre-fill a new invoice.
            </p>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10,
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? 'rgba(var(--accent-rgb, 59,130,246),0.04)' : 'var(--bg-secondary)',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <Upload size={28} style={{ color: 'var(--text-muted)', marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {parsing ? 'Parsing…' : 'Drop Excel file here or click to browse'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>.xlsx, .xls, .csv</div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
          </>
        ) : (
          /* ── Preview ── */
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', background: 'rgba(16,185,129,0.08)', borderRadius: 8 }}>
              <CheckCircle size={15} style={{ color: '#059669', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>File parsed successfully</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <Info label="PO Number" value={parsed.po_number || '—'} mono />
              <Info label="PO Date" value={parsed.po_date || '—'} />
              <Info label="Project Code" value={parsed.project_code || '—'} mono />
              <Info label="Line Items" value={`${itemLines.length} rows`} />
            </div>

            <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Invoice header line
            </div>
            <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: 16, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {parsed.line_items[0]?.description}
            </div>

            <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Preview ({Math.min(5, itemLines.length)} of {itemLines.length} rows)
            </div>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Description', 'Load WB', 'WB Ticket', 'Qty', 'Price', 'Net'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Description' ? 'left' : 'right', padding: '5px 8px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewLines.map((li, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '5px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{li.description}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{li.loading_number}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{li.offloading_number}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>{li.quantity}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>{li.unit_price}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>{parseFloat(li.amount || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {itemLines.length > 5 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                … and {itemLines.length - 5} more rows
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Total ex-VAT: <span style={{ color: 'var(--accent)' }}>R {total.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ghost btn-sm" onClick={() => { setParsed(null); setError('') }}>
                  Upload different file
                </button>
                <button className="btn-primary btn-sm" onClick={handleConfirm}>
                  Generate Invoice
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Info({ label, value, mono }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}
