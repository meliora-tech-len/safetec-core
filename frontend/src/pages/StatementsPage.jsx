import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileSpreadsheet, FileText, Pencil, Trash2, LayoutList } from 'lucide-react'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import { format, parseISO, isValid, differenceInDays, startOfDay } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import { getStatements, deleteStatement, getEntity, getCustomer, getTruckLoads } from '../services/api'

const TYPE_LABELS = {
  invoice:      'Invoice Statement',
  account:      'Account Statement',
  truck_period: 'Truck Period',
}

function fmtDate(val) {
  if (!val) return ''
  try {
    const d = typeof val === 'string' ? parseISO(val) : val
    return isValid(d) ? format(d, 'dd MMM yyyy') : ''
  } catch { return '' }
}

function fmtDateDot(val) {
  if (!val) return ''
  try {
    const d = typeof val === 'string' ? parseISO(val) : val
    return isValid(d) ? format(d, 'dd.MM.yyyy') : ''
  } catch { return '' }
}

function fmtAmt(val) {
  const n = parseFloat(val) || 0
  return n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function buildCustomerLines(customer) {
  if (!customer) return []
  const lines = []
  if (customer.name)        lines.push(customer.name)
  if (customer.address) customer.address.split(/\n|,/).map(s => s.trim()).filter(Boolean).forEach(l => lines.push(l))
  if (customer.city)        lines.push(customer.city)
  if (customer.postal_code) lines.push(customer.postal_code)
  if (customer.vat_number)  lines.push(`Vat no: ${customer.vat_number}`)
  return lines
}


export default function StatementsPage() {
  const navigate = useNavigate()
  const { isAdmin, activeEntity, entities } = useAuth()

  const [statements, setStatements] = useState([])
  const [loading, setLoading]       = useState(true)
  const [filterType, setFilterType] = useState('')
  const [exporting, setExporting]   = useState(null) // statement id being exported

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
      const [entityRes, custRes] = await Promise.all([
        getEntity(stmt.entity_id),
        stmt.customer_id ? getCustomer(stmt.customer_id) : Promise.resolve({ data: null }),
      ])
      const entity   = entityRes.data
      const customer = custRes.data

      const lines = (stmt.lines || []).slice().sort((a, b) => a.sort_order - b.sort_order)

      if (stmt.statement_type === 'invoice') {
        if (fmt === 'excel') exportInvoiceExcel(stmt, lines, entity, customer)
        else                 exportInvoicePdf(stmt, lines, entity, customer)
      } else if (stmt.statement_type === 'account') {
        if (fmt === 'excel') exportAccountExcel(stmt, lines, entity, customer)
        else                 exportAccountPdf(stmt, lines, entity, customer)
      } else {
        // truck_period — also need truck loads
        const loadsRes = await getTruckLoads({
          entity_id: stmt.entity_id,
          statement_month: parseISO(stmt.statement_date).getMonth() + 1,
          statement_year:  parseISO(stmt.statement_date).getFullYear(),
          limit: 2000,
        })
        const loads = (loadsRes.data || []).filter(l => !l.is_archived && !l.is_projection)
        exportTruckPeriodExcel(stmt, lines, loads, entity, customer)
      }
    } catch (e) {
      console.error(e)
      toast.error('Export failed')
    } finally {
      setExporting(null)
    }
  }

  // ─── export helpers ────────────────────────────────────────────────────────
  function exportInvoiceExcel(stmt, lines, entity, customer) {
    const rows = []
    buildCustomerLines(customer).forEach(l => rows.push([l]))
    rows.push([])
    rows.push(['', stmt.title || ''])
    rows.push([])
    const dataStart = rows.length
    lines.forEach(l => {
      const amt = parseFloat(l.amount) || 0
      rows.push([fmtDateDot(l.line_date), l.description || '', amt, l.invoice_number || '', amt])
    })
    rows.push([])
    const total = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
    rows.push(['', '', '', 'TOTAL AMOUNT OUTSTANDING', total])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 14 }, { wch: 55 }, { wch: 16 }, { wch: 24 }, { wch: 16 }]
    for (let i = 0; i < lines.length; i++) {
      ;[2, 4].forEach(c => {
        const ref = XLSX.utils.encode_cell({ r: dataStart + i, c })
        if (ws[ref]) ws[ref].z = '#,##0.00'
      })
    }
    const totRef = XLSX.utils.encode_cell({ r: rows.length - 1, c: 4 })
    if (ws[totRef]) ws[totRef].z = '#,##0.00'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Statement')
    XLSX.writeFile(wb, `${entity?.code || 'ENT'}_${(stmt.title || 'STATEMENT').replace(/\s+/g, '_')}.xlsx`)
    toast.success('Downloaded')
  }

  function exportInvoicePdf(stmt, lines, entity, customer) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    let y = 18
    const custLines = buildCustomerLines(customer)
    doc.setFontSize(11); doc.setFont('helvetica', 'bold')
    doc.text(custLines[0] || '', 14, y); y += 6
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    for (let i = 1; i < custLines.length; i++) { doc.text(custLines[i], 14, y); y += 4 }
    y += 4
    doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text(stmt.title || '', 105, y, { align: 'center' }); y += 8
    const total = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Description', 'Invoice #', 'Amount (R)']],
      body: lines.map(l => [fmtDateDot(l.line_date), l.description || '', l.invoice_number || '', fmtAmt(l.amount)]),
      foot: [['', '', 'TOTAL OUTSTANDING', fmtAmt(total)]],
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      footStyles: { fillColor: [240, 240, 240], textColor: 30, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 90 }, 2: { cellWidth: 32 }, 3: { cellWidth: 33, halign: 'right' } },
      theme: 'grid',
    })
    doc.save(`${entity?.code || 'ENT'}_${(stmt.title || 'STATEMENT').replace(/\s+/g, '_')}.pdf`)
    toast.success('Downloaded')
  }

  function exportAccountExcel(stmt, lines, entity, customer) {
    const wsRows = []
    wsRows.push(['STATEMENT', '', '', '', 'Date', fmtDateDot(new Date())])
    wsRows.push([])
    buildCustomerLines(customer).forEach(l => wsRows.push([l]))
    wsRows.push([])
    wsRows.push(['', stmt.title || ''])
    wsRows.push([])
    wsRows.push(['DATE', 'DESCRIPTION', 'INV #', 'DEBIT', 'CREDIT', 'BALANCE'])
    const dataStart = wsRows.length
    let balance = 0
    lines.forEach(l => {
      const amt = parseFloat(l.amount) || 0
      balance += amt
      wsRows.push([fmtDateDot(l.line_date), l.description || '', l.invoice_number || '',
        amt > 0 ? amt : null, amt < 0 ? Math.abs(amt) : null, balance])
    })
    wsRows.push([])
    // Aging
    const now = startOfDay(new Date())
    const aging = { current: 0, days30: 0, days60: 0, days90: 0 }
    lines.filter(l => (parseFloat(l.amount) || 0) > 0).forEach(l => {
      const age = l.line_date ? differenceInDays(now, startOfDay(parseISO(l.line_date))) : 0
      const amt = parseFloat(l.amount) || 0
      if (age <= 30) aging.current += amt
      else if (age <= 60) aging.days30 += amt
      else if (age <= 90) aging.days60 += amt
      else aging.days90 += amt
    })
    wsRows.push(['90 DAYS', '60 DAYS', '30 DAYS', 'CURRENT', 'AMOUNT DUE'])
    wsRows.push([aging.days90 || null, aging.days60 || null, aging.days30 || null, aging.current || null,
                 aging.days90 + aging.days60 + aging.days30 + aging.current])
    if (entity?.bank_name || entity?.bank_account_number) {
      wsRows.push([])
      wsRows.push(['Banking Details:'])
      if (entity.name)               wsRows.push([entity.name])
      if (entity.bank_name)          wsRows.push([entity.bank_name])
      if (entity.bank_branch)        wsRows.push([`Branch: ${entity.bank_branch}`])
      if (entity.bank_account_number) wsRows.push([`Account No: ${entity.bank_account_number}`])
      if (entity.bank_branch_code)   wsRows.push([`Branch Code: ${entity.bank_branch_code}`])
      if (entity.bank_reference)     wsRows.push([`Ref: ${entity.bank_reference}`])
    }
    const ws = XLSX.utils.aoa_to_sheet(wsRows)
    ws['!cols'] = [{ wch: 14 }, { wch: 50 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
    for (let i = 0; i < lines.length; i++) {
      ;[3, 4, 5].forEach(c => {
        const ref = XLSX.utils.encode_cell({ r: dataStart + i, c })
        if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.00'
      })
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Account Statement')
    XLSX.writeFile(wb, `${entity?.code || 'ENT'}_${(stmt.title || 'ACCOUNT_STMT').replace(/\s+/g, '_')}.xlsx`)
    toast.success('Downloaded')
  }

  function exportAccountPdf(stmt, lines, entity, customer) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    let y = 14
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('STATEMENT', 14, y)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`Date: ${fmtDateDot(new Date())}`, 196, y, { align: 'right' })
    y += 8
    const custLines = buildCustomerLines(customer)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text(custLines[0] || '', 14, y); y += 5
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    for (let i = 1; i < custLines.length; i++) { doc.text(custLines[i], 14, y); y += 4 }
    y += 4
    doc.setFontSize(11); doc.setFont('helvetica', 'bold')
    doc.text(stmt.title || '', 105, y, { align: 'center' }); y += 7
    let balance = 0
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Description', 'Inv #', 'Debit (R)', 'Credit (R)', 'Balance (R)']],
      body: lines.map(l => {
        const amt = parseFloat(l.amount) || 0
        balance += amt
        return [fmtDateDot(l.line_date), l.description || '', l.invoice_number || '',
          amt > 0 ? fmtAmt(amt) : '', amt < 0 ? fmtAmt(Math.abs(amt)) : '', fmtAmt(balance)]
      }),
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 72 }, 2: { cellWidth: 22 },
        3: { cellWidth: 24, halign: 'right' }, 4: { cellWidth: 24, halign: 'right' }, 5: { cellWidth: 26, halign: 'right' } },
      theme: 'grid',
    })
    const now = startOfDay(new Date())
    const aging = { current: 0, days30: 0, days60: 0, days90: 0 }
    lines.filter(l => (parseFloat(l.amount) || 0) > 0).forEach(l => {
      const age = l.line_date ? differenceInDays(now, startOfDay(parseISO(l.line_date))) : 0
      const amt = parseFloat(l.amount) || 0
      if (age <= 30) aging.current += amt; else if (age <= 60) aging.days30 += amt
      else if (age <= 90) aging.days60 += amt; else aging.days90 += amt
    })
    y = doc.lastAutoTable.finalY + 8
    autoTable(doc, {
      startY: y,
      head: [['90 Days', '60 Days', '30 Days', 'Current', 'Amount Due']],
      body: [[fmtAmt(aging.days90), fmtAmt(aging.days60), fmtAmt(aging.days30), fmtAmt(aging.current),
              fmtAmt(aging.days90 + aging.days60 + aging.days30 + aging.current)]],
      headStyles: { fillColor: [80, 80, 80], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 9, fontStyle: 'bold', halign: 'right' },
      theme: 'grid',
    })
    if (entity?.bank_name || entity?.bank_account_number) {
      y = doc.lastAutoTable.finalY + 8
      doc.setFontSize(9); doc.setFont('helvetica', 'bold')
      doc.text('Banking Details:', 14, y); y += 5
      doc.setFont('helvetica', 'normal')
      ;[entity.name, entity.bank_name,
        entity.bank_branch && `Branch: ${entity.bank_branch}`,
        entity.bank_account_number && `Account No: ${entity.bank_account_number}`,
        entity.bank_branch_code && `Branch Code: ${entity.bank_branch_code}`,
        entity.bank_reference && `Ref: ${entity.bank_reference}`,
      ].filter(Boolean).forEach(l => { doc.text(l, 14, y); y += 4 })
    }
    doc.save(`${entity?.code || 'ENT'}_${(stmt.title || 'ACCOUNT_STMT').replace(/\s+/g, '_')}.pdf`)
    toast.success('Downloaded')
  }

  function exportTruckPeriodExcel(stmt, lines, loads, entity, customer) {
    const rows = []
    buildCustomerLines(customer).forEach(l => rows.push([l]))
    rows.push([])
    rows.push(['', stmt.title || ''])
    rows.push([])
    rows.push(['INVOICES'])
    rows.push(['DATE', 'DESCRIPTION', 'INVOICE #', 'AMOUNT INCL VAT'])
    const invDataStart = rows.length
    lines.forEach(l => rows.push([fmtDateDot(l.line_date), l.description || '', l.invoice_number || '', parseFloat(l.amount) || 0]))
    rows.push(['', '', 'TOTAL', lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)])
    rows.push([])
    const truckMap = {}
    loads.forEach(load => {
      const reg = load.truck_registration || 'UNKNOWN'
      const mine = load.mine_name || 'Unknown Mine'
      if (!truckMap[reg]) truckMap[reg] = {}
      if (!truckMap[reg][mine]) truckMap[reg][mine] = { trips: 0, tonnes: 0, amountInvoiced: 0, amountPayout: 0 }
      const m = truckMap[reg][mine]
      m.trips++; m.tonnes += parseFloat(load.tonnes) || 0
      m.amountInvoiced += parseFloat(load.amount_incl_vat) || 0
      m.amountPayout += parseFloat(load.subcontractor_amount_incl_vat) || parseFloat(load.amount_incl_vat) || 0
    })
    const hasPayout = Object.values(truckMap).some(mines => Object.values(mines).some(m => m.amountPayout !== m.amountInvoiced && m.amountPayout > 0))
    rows.push(['TRUCK LOAD SUMMARY'])
    const hd = ['TRUCK REG', 'MINE', 'TRIPS', 'TONNES', 'AMOUNT INVOICED']
    if (hasPayout) hd.push('AMOUNT PAYOUT')
    rows.push(hd)
    const loadDataStart = rows.length
    const sortedRegs = Object.keys(truckMap).sort()
    let totTrips = 0, totTonnes = 0, totInv = 0, totPay = 0
    sortedRegs.forEach(reg => {
      Object.keys(truckMap[reg]).sort().forEach((mine, idx) => {
        const m = truckMap[reg][mine]
        const row = [idx === 0 ? reg : '', mine, m.trips, m.tonnes, m.amountInvoiced]
        if (hasPayout) row.push(m.amountPayout)
        rows.push(row)
        totTrips += m.trips; totTonnes += m.tonnes; totInv += m.amountInvoiced; totPay += m.amountPayout
      })
    })
    const totRow = ['TOTAL', '', totTrips, totTonnes, totInv]
    if (hasPayout) totRow.push(totPay)
    rows.push(totRow)
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 14 }, { wch: 45 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 20 }]
    for (let i = 0; i <= lines.length; i++) {
      const ref = XLSX.utils.encode_cell({ r: invDataStart + i, c: 3 })
      if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.00'
    }
    const totalLoadRows = sortedRegs.reduce((s, r) => s + Object.keys(truckMap[r]).length, 0)
    for (let i = 0; i <= totalLoadRows; i++) {
      ;(hasPayout ? [3, 4, 5] : [3, 4]).forEach(c => {
        const ref = XLSX.utils.encode_cell({ r: loadDataStart + i, c })
        if (ws[ref] && ws[ref].t === 'n') ws[ref].z = c === 3 ? '#,##0.000' : '#,##0.00'
      })
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Truck Period')
    XLSX.writeFile(wb, `${entity?.code || 'ENT'}_${(stmt.title || 'TRUCK_PERIOD').replace(/\s+/g, '_')}.xlsx`)
    toast.success('Downloaded')
  }

  // ─── render ────────────────────────────────────────────────────────────────
  const visible = filterType ? statements.filter(s => s.statement_type === filterType) : statements

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

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {[['', 'All'], ['invoice', 'Invoice Statements'], ['account', 'Account Statements'], ['truck_period', 'Truck Period']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilterType(key)}
            style={{
              padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: filterType === key ? 700 : 400,
              color: filterType === key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: filterType === key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -2, transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Customer</th>
              <th>Title</th>
              <th style={{ textAlign: 'right' }}>Lines</th>
              <th style={{ textAlign: 'right' }}>Total (R)</th>
              <th style={{ width: 130 }}>Export</th>
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={8}>
                <div className="empty-state">
                  <LayoutList size={32} />
                  <p>No statements yet — create one to get started</p>
                </div>
              </td></tr>
            ) : visible.map(stmt => (
              <tr key={stmt.id}>
                <td style={{ fontSize: 13 }}>{fmtDate(stmt.statement_date)}</td>
                <td>
                  <span className="badge badge-invoice" style={{ fontSize: 10 }}>
                    {TYPE_LABELS[stmt.statement_type] || stmt.statement_type}
                  </span>
                </td>
                <td style={{ fontWeight: 500 }}>{stmt.customer_name || '—'}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{stmt.title || '—'}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{(stmt.lines || []).length}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>
                  {fmtAmt(stmt.total ?? (stmt.lines || []).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0))}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {stmt.statement_type !== 'truck_period' && (
                      <button
                        className="btn-ghost btn-sm"
                        title="Export PDF"
                        disabled={exporting === stmt.id + 'pdf'}
                        onClick={() => handleExport(stmt, 'pdf')}
                        style={{ padding: '4px 8px' }}
                      >
                        <FileText size={13} style={{ color: 'var(--danger)' }} />
                      </button>
                    )}
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
