import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Upload, X, FileText, AlertCircle, CheckCircle, ChevronRight } from 'lucide-react'

function cellStr(val) {
  if (val == null) return ''
  return String(val).trim().toLowerCase()
}

function cleanNum(val) {
  if (val == null || val === '') return ''
  const s = String(val).replace(/[^\d.\-]/g, '')
  return s === '' ? '' : s
}

function toDateStr(val) {
  if (!val) return ''
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(val).trim()
  const m = s.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return ''
}

function extractRoute(description) {
  if (!description) return ''
  const lower = description.toLowerCase()
  const idx = lower.indexOf(' to ')
  if (idx > 0) return description.slice(0, idx).trim().toUpperCase()
  return description.split(/\s+/)[0].toUpperCase()
}

function formatPoNumber(poNum) {
  if (!poNum) return poNum
  return poNum.replace(/^([A-Za-z]+)(\d+)$/, '$1 $2')
}

// Scan rows around centerIdx for date, supplier code, project code.
// Uses substring matching within cell values to handle multi-line merged cells
// (e.g. "Project Code\n2605-4586" or "Order number...\nPOH... 2026/05/31 SFT003").
function extractMetaFromRows(rows, centerIdx) {
  let po_date = '', supplier_code = '', project_code = ''
  for (let ri = Math.max(0, centerIdx - 1); ri < Math.min(rows.length, centerIdx + 3); ri++) {
    const row = rows[ri]
    for (let ci = 0; ci < row.length; ci++) {
      const s = String(row[ci] || '').trim()
      if (!s) continue
      // Date: match anywhere inside the cell (handles "...POH... 2026/05/31 ...")
      if (!po_date) {
        const dm = s.match(/(\d{4}[\/\-]\d{2}[\/\-]\d{2})/)
        if (dm) {
          const d = toDateStr(dm[1])
          if (d && d >= '2000-01-01') po_date = d
        }
      }
      // Supplier code: word-boundary match handles "...SFT003..." in multi-line cells
      if (!supplier_code) {
        const sm = s.match(/\b([A-Za-z]{2,5}\d{3})\b/)
        if (sm) supplier_code = sm[1].toUpperCase()
      }
      // Project code: match NNNN-NNNN anywhere (also covers "Project Code\n2605-4586")
      if (!project_code) {
        const pm = s.match(/(\d{4}-\d{4})/)
        if (pm) project_code = pm[1]
      }
    }
  }
  return { po_date, supplier_code, project_code }
}

function buildColMap(headerRow) {
  const m = {}
  headerRow.forEach((c, j) => {
    const k = cellStr(c)
    if (k.includes('product'))     m.product = j
    if (k.includes('description')) m.description = j
    if (k.includes('horse'))       m.horse_reg = j
    if (k.includes('load date'))   m.load_date = j
    if (k.includes('load wb') || k === 'load wb tckt') m.load_wb = j
    if (k.includes('delivery'))    m.delivery_date = j
    if ((k.includes('wb ticket') || k === 'wb ticket') && !k.includes('load')) m.wb_ticket = j
    if (k.includes('quantity') || k === 'qty') m.quantity = j
    if (k.includes('price'))       m.price = j
    if (k.includes('net value') || k === 'net') m.net_value = j
  })
  return m
}

function parseDataRow(row, colMap) {
  const horse_reg   = String(row[colMap.horse_reg   ?? 2] || '').trim()
  const description = String(row[colMap.description ?? 1] || '').trim()
  const quantity    = cleanNum(row[colMap.quantity   ?? 7])
  const price       = cleanNum(row[colMap.price      ?? 8])
  const net_value   = cleanNum(row[colMap.net_value  ?? 9])
  const load_wb     = String(row[colMap.load_wb      ?? 4] || '').trim()
  const wb_ticket   = String(row[colMap.wb_ticket    ?? 6] || '').trim()
  if (!horse_reg && !quantity) return null
  return {
    description: horse_reg && description ? `${horse_reg} - ${description}` : horse_reg || description,
    loading_number: load_wb,
    offloading_number: wb_ticket,
    quantity,
    unit_price: price,
    amount: net_value,
    is_vat_exempt: false,
    line_type: 'item',
  }
}

function buildHeaderLine(lineItems, po_number, project_code) {
  const firstDesc = lineItems[0]?.description || ''
  const descPart = firstDesc.includes(' - ') ? firstDesc.split(' - ').slice(1).join(' - ') : firstDesc
  const route = extractRoute(descPart)
  const poSpaced = formatPoNumber(po_number)
  const desc = [route, poSpaced, project_code ? `- TDK/${project_code}` : ''].filter(Boolean).join(' ')
  return { description: desc, loading_number: '', offloading_number: '', quantity: '', unit_price: '', amount: '', is_vat_exempt: false, line_type: 'header' }
}

const PAGE_PAT     = /^page \d+ of \d+/i
const CARRY_PAT    = /^to be transferred/i
const TRANSFER_PAT = /^transfer\b/i
const FOOTER_PAT   = /^(total tax|tax excluded|total tax excluded)/i

// Two-phase parser:
// Phase 1 – find every row containing a POH number (these are segment boundaries).
// Phase 2 – for each PO, extract data rows from each of its page segments independently.
// This handles any number of pages per PO and any number of POs per file.
function parsePOExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array', cellDates: false })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })

        // Phase 1: locate every POH row (any column).
        // Use a loose regex — no word-boundary requirement — so multi-line merged cells
        // like "Order number...\nPOH10126050000276... SFT003" are still detected even
        // when the POH token is embedded mid-string.
        const pohRows = []
        for (let i = 0; i < rows.length; i++) {
          const flat = rows[i].map(c => String(c || '').trim()).join(' ')
          const m = flat.match(/(POH\s*\d+)/i)
          if (m) {
            const po_number = m[1].replace(/\s+/g, '').toUpperCase()
            pohRows.push({ idx: i, po_number })
          }
        }

        if (pohRows.length === 0)
          return reject(new Error('No purchase orders found. Make sure the file contains POH order numbers.'))

        // Group occurrences by PO number, preserve first-seen order
        const poMap = {}
        const poOrder = []
        for (const { idx, po_number } of pohRows) {
          if (!poMap[po_number]) { poMap[po_number] = { po_number, rowIndices: [] }; poOrder.push(po_number) }
          poMap[po_number].rowIndices.push(idx)
        }

        // Phase 2: parse data segments for each PO
        const results = []
        for (const po_number of poOrder) {
          const { rowIndices } = poMap[po_number]
          const meta = extractMetaFromRows(rows, rowIndices[0])
          const allLineItems = []
          let lastGoodColMap = null  // reused when a continuation page has no detectable headers

          for (const segStart of rowIndices) {
            // Segment ends at the next POH row (any PO) or end of file
            const nextPoh = pohRows.find(p => p.idx > segStart)
            const segEnd = nextPoh ? nextPoh.idx : rows.length

            // Find column header row within this segment.
            // Page-2 continuation headers are often split: Product/Description/Quantity/Price
            // on row 1 and Horse Reg/Load Date/WB Ticket on row 2. Detect the Horse Reg row
            // and merge in the previous non-blank row to capture all column indices.
            let colMap = null
            let colHeaderRow = -1
            let prevNonBlankRow = null
            for (let i = segStart + 1; i < segEnd; i++) {
              const row = rows[i]
              if (row.every(c => c === '' || c == null)) continue
              const hasHorse = row.some(c => cellStr(c).includes('horse'))
              if (hasHorse) {
                const merged = [...row]
                if (prevNonBlankRow) {
                  prevNonBlankRow.forEach((c, j) => {
                    if (cellStr(c) && !cellStr(merged[j])) merged[j] = c
                  })
                }
                const candidate = buildColMap(merged)
                // Reject merged-cell headers: PDF-to-Excel sometimes puts ALL column names
                // into a single cell (e.g. "Horse Reg\nLoad Date\n...Quantity\nPrice..."),
                // which causes every key to map to the same column index.
                // In that case skip this row and let the fallback colMap handle it.
                const keyIdxs = [candidate.horse_reg, candidate.quantity, candidate.price, candidate.net_value].filter(v => v != null)
                const isValidMap = keyIdxs.length === 0 || new Set(keyIdxs).size > 1
                if (isValidMap) {
                  colMap = candidate
                  colHeaderRow = i
                  break
                }
                // Merged cell — don't break; fallback will activate after the loop
              }
              prevNonBlankRow = row
            }
            // Fallback: continuation pages sometimes have non-standard or missing column
            // headers. Reuse the previous segment's colMap — layout is always the same
            // within a single PO. colHeaderRow = segStart so we scan from the top of the
            // segment; non-data rows will safely return null from parseDataRow.
            if (!colMap && lastGoodColMap) {
              colMap = lastGoodColMap
              colHeaderRow = segStart
            }
            if (!colMap) continue
            lastGoodColMap = colMap

            // Parse data rows
            for (let i = colHeaderRow + 1; i < segEnd; i++) {
              const row = rows[i]
              if (row.every(c => c === '' || c == null)) continue
              const firstNE = String(row.find(c => String(c || '').trim() !== '') || '').trim()
              if (PAGE_PAT.test(firstNE))     continue
              if (CARRY_PAT.test(firstNE))    continue
              if (TRANSFER_PAT.test(firstNE)) continue
              if (FOOTER_PAT.test(firstNE))   break
              const item = parseDataRow(row, colMap)
              if (item) allLineItems.push(item)
            }
          }

          if (allLineItems.length === 0) continue

          const headerLine = buildHeaderLine(allLineItems, po_number, meta.project_code)
          results.push({
            id: crypto.randomUUID(),
            po_number,
            po_date: meta.po_date,
            supplier_code: meta.supplier_code,
            project_code: meta.project_code,
            line_items: [headerLine, ...allLineItems].map((li, i) => ({ ...li, sort_order: i })),
            total_excl: allLineItems.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
          })
        }

        if (results.length === 0) return reject(new Error('No data rows found in any purchase order.'))
        resolve(results)
      } catch (err) {
        reject(new Error('Failed to parse the file: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read the file.'))
    reader.readAsArrayBuffer(file)
  })
}

export default function ImportPOModal({ onClose, entities = [] }) {
  const navigate = useNavigate()
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [pos, setPos] = useState(null)
  const [entityFilter, setEntityFilter] = useState('')
  const fileRef = useRef(null)

  const matchEntity = (supplier_code) => {
    if (!supplier_code) return null
    return entities.find(e => supplier_code.toUpperCase().startsWith(e.code?.toUpperCase() ?? ''))
  }

  const handleFile = async (file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext)) { setError('Please upload an Excel file (.xlsx, .xls) or CSV.'); return }
    setError('')
    setParsing(true)
    try {
      const result = await parsePOExcel(file)
      setPos(result)
      const codes = [...new Set(result.map(p => matchEntity(p.supplier_code)?.code).filter(Boolean))]
      if (codes.length === 1) setEntityFilter(codes[0])
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }

  const handleCreateInvoice = (po) => { navigate('/invoices/new', { state: { poImportPayload: po } }); onClose() }

  const entityCodes = pos ? [...new Set(pos.map(p => matchEntity(p.supplier_code)?.code).filter(Boolean))] : []
  const filteredPos = pos
    ? (entityFilter ? pos.filter(p => matchEntity(p.supplier_code)?.code?.toUpperCase() === entityFilter.toUpperCase()) : pos)
    : []
  const fmt = (n) => Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: pos ? 820 : 560, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', maxHeight: '90vh', overflowY: 'auto', transition: 'max-width 0.2s' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>Import PO</span>
            {pos && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pos.length} order{pos.length !== 1 ? 's' : ''} found</span>}
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

        {!pos ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Upload the Excel file converted from the PO PDF. Multiple POs and multi-page POs are handled automatically — each PO becomes a separate invoice.
            </p>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg-secondary)', transition: 'border-color 0.15s' }}
            >
              <Upload size={28} style={{ color: 'var(--text-muted)', marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {parsing ? 'Parsing…' : 'Drop Excel file here or click to browse'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>.xlsx, .xls, .csv</div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', background: 'rgba(16,185,129,0.08)', borderRadius: 8 }}>
              <CheckCircle size={15} style={{ color: '#059669', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>
                {pos.length} purchase order{pos.length !== 1 ? 's' : ''} found — click Create Invoice on each one to generate
              </span>
            </div>

            {entityCodes.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Filter:</span>
                <button className={`btn btn-sm ${!entityFilter ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEntityFilter('')} style={{ fontSize: 12 }}>All ({pos.length})</button>
                {entityCodes.map(code => {
                  const count = pos.filter(p => matchEntity(p.supplier_code)?.code === code).length
                  return (
                    <button key={code} className={`btn btn-sm ${entityFilter === code ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEntityFilter(code)} style={{ fontSize: 12 }}>
                      {code} ({count})
                    </button>
                  )
                })}
              </div>
            )}

            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border)' }}>
                    {['PO Number', 'Date', 'Entity', 'Project Code', 'Lines', 'Total Ex-VAT', ''].map(h => (
                      <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textAlign: (h === 'Total Ex-VAT' || h === 'Lines') ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPos.map(po => {
                    const entity = matchEntity(po.supplier_code)
                    const itemLines = po.line_items.filter(l => l.line_type === 'item')
                    return (
                      <tr key={po.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '9px 10px', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{po.po_number}</td>
                        <td style={{ padding: '9px 10px' }}>{po.po_date || '—'}</td>
                        <td style={{ padding: '9px 10px' }}>
                          {entity
                            ? <span style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontWeight: 600, fontSize: 11 }}>{entity.code}</span>
                            : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{po.supplier_code || '—'}</span>}
                        </td>
                        <td style={{ padding: '9px 10px', fontFamily: 'monospace' }}>{po.project_code || '—'}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right' }}>{itemLines.length}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>R {fmt(po.total_excl)}</td>
                        <td style={{ padding: '9px 10px' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleCreateInvoice(po)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontSize: 12 }}>
                            Create Invoice <ChevronRight size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredPos.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No orders match the selected filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPos(null); setError('') }}>Upload different file</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
