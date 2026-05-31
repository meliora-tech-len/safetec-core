import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, Download, Save, ChevronDown, ChevronUp, FileSpreadsheet, FileText, ArrowLeft } from 'lucide-react'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import { parseISO, isValid, format, differenceInDays, startOfDay, isWithinInterval } from 'date-fns'
import { useAuth } from '../hooks/useAuth'
import SearchableSelect from '../components/SearchableSelect'
import DateInput from '../components/DateInput'
import {
  getStatement, createStatement, updateStatement,
  getInvoices, getEntity, getCustomers, getCustomer, getTruckLoads,
} from '../services/api'

const TABS = [
  { key: 'invoice',      label: 'Invoice Statement' },
  { key: 'account',      label: 'Account Statement' },
  { key: 'truck_period', label: 'Truck Period' },
]

function today()  { return new Date().toISOString().slice(0, 10) }
function uid()    { return Math.random().toString(36).slice(2) }

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

function invoiceToRow(inv) {
  return {
    _id: uid(),
    line_date:      inv.issue_date ? inv.issue_date.slice(0, 10) : '',
    description:    inv.notes || inv.line_items?.[0]?.description || '',
    invoice_number: inv.invoice_number || '',
    amount:         String(parseFloat(inv.total) || 0),
  }
}

function paymentToRow(inv) {
  return {
    _id: uid(),
    line_date:      inv.paid_date ? inv.paid_date.slice(0, 10) : '',
    description:    'PAYMENT : THANK YOU',
    invoice_number: '',
    amount:         String(-(parseFloat(inv.total) || 0)),
  }
}

function blankRow() {
  return { _id: uid(), line_date: today(), description: '', invoice_number: '', amount: '' }
}


export default function StatementEditorPage() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const isNew     = !id
  const { isAdmin, activeEntity, entities } = useAuth()

  // ─── header state ──────────────────────────────────────────────────────────
  const [stmtType,    setStmtType]    = useState('invoice')
  const [entityId,    setEntityId]    = useState(activeEntity?.id?.toString() || '')
  const [customerId,  setCustomerId]  = useState('')
  const [customers,   setCustomers]   = useState([])
  const [stmtDate,    setStmtDate]    = useState(today())
  const [title,       setTitle]       = useState('')
  const [rows,        setRows]        = useState([blankRow()])
  const [saving,      setSaving]      = useState(false)
  const [exporting,   setExporting]   = useState(false)
  const [loading,     setLoading]     = useState(!isNew)

  // ─── import bar state ──────────────────────────────────────────────────────
  const [importOpen,  setImportOpen]  = useState(false)
  const [importFrom,  setImportFrom]  = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })
  const [importTo,    setImportTo]    = useState(today())
  const [importing,   setImporting]   = useState(false)
  const [importIncludePaid, setImportIncludePaid] = useState(false)

  // ─── load existing statement ───────────────────────────────────────────────
  useEffect(() => {
    if (isNew) return
    setLoading(true)
    getStatement(id)
      .then(res => {
        const s = res.data
        setStmtType(s.statement_type || 'invoice')
        setEntityId(String(s.entity_id))
        setCustomerId(s.customer_id ? String(s.customer_id) : '')
        setStmtDate(s.statement_date ? s.statement_date.slice(0, 10) : today())
        setTitle(s.title || '')
        setRows((s.lines || []).map(l => ({
          _id:            uid(),
          line_date:      l.line_date ? l.line_date.slice(0, 10) : '',
          description:    l.description || '',
          invoice_number: l.invoice_number || '',
          amount:         String(parseFloat(l.amount) ?? ''),
        })))
      })
      .catch(() => toast.error('Failed to load statement'))
      .finally(() => setLoading(false))
  }, [id])

  // ─── load customers when entity changes ───────────────────────────────────
  useEffect(() => {
    setCustomers([])
    if (!entityId) return
    getCustomers({ entity_id: entityId, limit: 500 })
      .then(r => setCustomers(r.data || []))
      .catch(() => {})
  }, [entityId])

  // ─── row helpers ──────────────────────────────────────────────────────────
  function setRow(id, field, value) {
    setRows(prev => prev.map(r => r._id === id ? { ...r, [field]: value } : r))
  }
  function addRow()       { setRows(prev => [...prev, blankRow()]) }
  function removeRow(_id) { setRows(prev => prev.length > 1 ? prev.filter(r => r._id !== _id) : prev) }

  // ─── import from invoices ─────────────────────────────────────────────────
  async function handleImport() {
    if (!entityId || !customerId) { toast.error('Select entity and customer first'); return }
    setImporting(true)
    try {
      const res   = await getInvoices({ entity_id: entityId, customer_id: customerId, document_type: 'invoice', limit: 1000 })
      const from  = parseISO(importFrom)
      const to    = parseISO(importTo + 'T23:59:59')
      const invs  = (res.data || []).filter(inv => {
        if (!importIncludePaid && inv.status === 'paid') return false
        const d = inv.issue_date ? parseISO(inv.issue_date) : null
        return d && isValid(d) && isWithinInterval(d, { start: from, end: to })
      })
      if (invs.length === 0) { toast.error('No invoices found'); return }

      const newRows = []
      invs.forEach(inv => {
        newRows.push(invoiceToRow(inv))
        if (stmtType === 'account' && inv.status === 'paid' && inv.paid_date) {
          newRows.push(paymentToRow(inv))
        }
      })

      // Sort by date then append / replace
      newRows.sort((a, b) => (a.line_date || '') < (b.line_date || '') ? -1 : 1)
      setRows(newRows)
      setImportOpen(false)
      toast.success(`Loaded ${invs.length} invoice${invs.length !== 1 ? 's' : ''}`)
    } catch {
      toast.error('Import failed')
    } finally {
      setImporting(false)
    }
  }

  // ─── save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!entityId)   { toast.error('Select an entity');  return }
    if (!customerId) { toast.error('Select a customer'); return }
    if (!stmtDate)   { toast.error('Set a date');        return }
    setSaving(true)
    const payload = {
      entity_id:      Number(entityId),
      customer_id:    customerId ? Number(customerId) : null,
      statement_type: stmtType,
      statement_date: stmtDate,
      title:          title || null,
      lines: rows.map((r, i) => ({
        line_date:      r.line_date || null,
        description:    r.description || null,
        invoice_number: r.invoice_number || null,
        amount:         parseFloat(r.amount) || 0,
        sort_order:     i,
      })),
    }
    try {
      if (isNew) {
        const res = await createStatement(payload)
        toast.success('Statement saved')
        navigate(`/statements/${res.data.id}`, { replace: true })
      } else {
        await updateStatement(id, payload)
        toast.success('Changes saved')
      }
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ─── export ───────────────────────────────────────────────────────────────
  async function handleExport(fmt) {
    if (!entityId) { toast.error('Select an entity'); return }
    setExporting(true)
    try {
      const [entityRes, custRes] = await Promise.all([
        getEntity(entityId),
        customerId ? getCustomer(customerId) : Promise.resolve({ data: null }),
      ])
      const entity   = entityRes.data
      const customer = custRes.data
      const sortedRows = rows.slice().sort((a, b) => (a.line_date || '') < (b.line_date || '') ? -1 : 1)
      const safeTitle  = title || 'STATEMENT'
      const filename   = `${entity?.code || 'ENT'}_${safeTitle.replace(/\s+/g, '_')}`

      if (stmtType === 'invoice') {
        fmt === 'excel' ? exportInvoiceExcel(sortedRows, entity, customer, safeTitle, filename)
                        : exportInvoicePdf(sortedRows, entity, customer, safeTitle, filename)
      } else if (stmtType === 'account') {
        fmt === 'excel' ? exportAccountExcel(sortedRows, entity, customer, safeTitle, filename)
                        : exportAccountPdf(sortedRows, entity, customer, safeTitle, filename)
      } else {
        const loadsRes = await getTruckLoads({
          entity_id:       entityId,
          statement_month: parseISO(stmtDate).getMonth() + 1,
          statement_year:  parseISO(stmtDate).getFullYear(),
          limit: 2000,
        })
        const loads = (loadsRes.data || []).filter(l => !l.is_archived && !l.is_projection)
        exportTruckPeriodExcel(sortedRows, loads, entity, customer, safeTitle, filename)
      }
    } catch (e) {
      console.error(e); toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  // ─── export generators (same as list page) ───────────────────────────────
  function exportInvoiceExcel(lines, entity, customer, stmtTitle, filename) {
    const rows = []
    buildCustomerLines(customer).forEach(l => rows.push([l]))
    rows.push([]); rows.push(['', stmtTitle]); rows.push([])
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
      ;[2, 4].forEach(c => { const ref = XLSX.utils.encode_cell({ r: dataStart + i, c }); if (ws[ref]) ws[ref].z = '#,##0.00' })
    }
    const totRef = XLSX.utils.encode_cell({ r: rows.length - 1, c: 4 }); if (ws[totRef]) ws[totRef].z = '#,##0.00'
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Statement')
    XLSX.writeFile(wb, `${filename}.xlsx`); toast.success('Downloaded')
  }

  function exportInvoicePdf(lines, entity, customer, stmtTitle, filename) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    let y = 18
    const custLines = buildCustomerLines(customer)
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(custLines[0] || '', 14, y); y += 6
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    for (let i = 1; i < custLines.length; i++) { doc.text(custLines[i], 14, y); y += 4 }
    y += 4; doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text(stmtTitle, 105, y, { align: 'center' }); y += 8
    const total = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
    autoTable(doc, {
      startY: y, head: [['Date', 'Description', 'Invoice #', 'Amount (R)']],
      body: lines.map(l => [fmtDateDot(l.line_date), l.description || '', l.invoice_number || '', fmtAmt(l.amount)]),
      foot: [['', '', 'TOTAL OUTSTANDING', fmtAmt(total)]],
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      footStyles: { fillColor: [240, 240, 240], textColor: 30, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 90 }, 2: { cellWidth: 32 }, 3: { cellWidth: 33, halign: 'right' } },
      theme: 'grid',
    })
    doc.save(`${filename}.pdf`); toast.success('Downloaded')
  }

  function exportAccountExcel(lines, entity, customer, stmtTitle, filename) {
    const wsRows = []
    wsRows.push(['STATEMENT', '', '', '', 'Date', fmtDateDot(new Date())]); wsRows.push([])
    buildCustomerLines(customer).forEach(l => wsRows.push([l]))
    wsRows.push([]); wsRows.push(['', stmtTitle]); wsRows.push([])
    wsRows.push(['DATE', 'DESCRIPTION', 'INV #', 'DEBIT', 'CREDIT', 'BALANCE'])
    const dataStart = wsRows.length; let balance = 0
    lines.forEach(l => {
      const amt = parseFloat(l.amount) || 0; balance += amt
      wsRows.push([fmtDateDot(l.line_date), l.description || '', l.invoice_number || '',
        amt > 0 ? amt : null, amt < 0 ? Math.abs(amt) : null, balance])
    })
    wsRows.push([])
    const now = startOfDay(new Date())
    const aging = { current: 0, days30: 0, days60: 0, days90: 0 }
    lines.filter(l => (parseFloat(l.amount) || 0) > 0).forEach(l => {
      const age = l.line_date ? differenceInDays(now, startOfDay(parseISO(l.line_date))) : 0
      const amt = parseFloat(l.amount) || 0
      if (age <= 30) aging.current += amt; else if (age <= 60) aging.days30 += amt
      else if (age <= 90) aging.days60 += amt; else aging.days90 += amt
    })
    wsRows.push(['90 DAYS', '60 DAYS', '30 DAYS', 'CURRENT', 'AMOUNT DUE'])
    wsRows.push([aging.days90 || null, aging.days60 || null, aging.days30 || null, aging.current || null,
                 aging.days90 + aging.days60 + aging.days30 + aging.current])
    if (entity?.bank_name || entity?.bank_account_number) {
      wsRows.push([]); wsRows.push(['Banking Details:'])
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
      ;[3, 4, 5].forEach(c => { const ref = XLSX.utils.encode_cell({ r: dataStart + i, c }); if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.00' })
    }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Account Statement')
    XLSX.writeFile(wb, `${filename}_ACCOUNT.xlsx`); toast.success('Downloaded')
  }

  function exportAccountPdf(lines, entity, customer, stmtTitle, filename) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    let y = 14
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('STATEMENT', 14, y)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`Date: ${fmtDateDot(new Date())}`, 196, y, { align: 'right' }); y += 8
    const custLines = buildCustomerLines(customer)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text(custLines[0] || '', 14, y); y += 5
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    for (let i = 1; i < custLines.length; i++) { doc.text(custLines[i], 14, y); y += 4 }
    y += 4; doc.setFontSize(11); doc.setFont('helvetica', 'bold')
    doc.text(stmtTitle, 105, y, { align: 'center' }); y += 7
    let balance = 0
    autoTable(doc, {
      startY: y, head: [['Date', 'Description', 'Inv #', 'Debit (R)', 'Credit (R)', 'Balance (R)']],
      body: lines.map(l => {
        const amt = parseFloat(l.amount) || 0; balance += amt
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
      startY: y, head: [['90 Days', '60 Days', '30 Days', 'Current', 'Amount Due']],
      body: [[fmtAmt(aging.days90), fmtAmt(aging.days60), fmtAmt(aging.days30), fmtAmt(aging.current),
              fmtAmt(aging.days90 + aging.days60 + aging.days30 + aging.current)]],
      headStyles: { fillColor: [80, 80, 80], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 9, fontStyle: 'bold', halign: 'right' }, theme: 'grid',
    })
    if (entity?.bank_name || entity?.bank_account_number) {
      y = doc.lastAutoTable.finalY + 8; doc.setFontSize(9); doc.setFont('helvetica', 'bold')
      doc.text('Banking Details:', 14, y); y += 5; doc.setFont('helvetica', 'normal')
      ;[entity.name, entity.bank_name,
        entity.bank_branch && `Branch: ${entity.bank_branch}`,
        entity.bank_account_number && `Account No: ${entity.bank_account_number}`,
        entity.bank_branch_code && `Branch Code: ${entity.bank_branch_code}`,
        entity.bank_reference && `Ref: ${entity.bank_reference}`,
      ].filter(Boolean).forEach(l => { doc.text(l, 14, y); y += 4 })
    }
    doc.save(`${filename}_ACCOUNT.pdf`); toast.success('Downloaded')
  }

  function exportTruckPeriodExcel(lines, loads, entity, customer, stmtTitle, filename) {
    const exRows = []
    buildCustomerLines(customer).forEach(l => exRows.push([l]))
    exRows.push([]); exRows.push(['', stmtTitle]); exRows.push([])
    exRows.push(['INVOICES']); exRows.push(['DATE', 'DESCRIPTION', 'INVOICE #', 'AMOUNT INCL VAT'])
    const invDataStart = exRows.length
    lines.forEach(l => exRows.push([fmtDateDot(l.line_date), l.description || '', l.invoice_number || '', parseFloat(l.amount) || 0]))
    exRows.push(['', '', 'TOTAL', lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)])
    exRows.push([])
    const truckMap = {}
    loads.forEach(load => {
      const reg = load.truck_registration || 'UNKNOWN'; const mine = load.mine_name || 'Unknown'
      if (!truckMap[reg]) truckMap[reg] = {}
      if (!truckMap[reg][mine]) truckMap[reg][mine] = { trips: 0, tonnes: 0, amountInvoiced: 0, amountPayout: 0 }
      const m = truckMap[reg][mine]; m.trips++; m.tonnes += parseFloat(load.tonnes) || 0
      m.amountInvoiced += parseFloat(load.amount_incl_vat) || 0
      m.amountPayout += parseFloat(load.subcontractor_amount_incl_vat) || parseFloat(load.amount_incl_vat) || 0
    })
    const hasPayout = Object.values(truckMap).some(mines => Object.values(mines).some(m => m.amountPayout !== m.amountInvoiced && m.amountPayout > 0))
    exRows.push(['TRUCK LOAD SUMMARY'])
    const hd = ['TRUCK REG', 'MINE', 'TRIPS', 'TONNES', 'AMOUNT INVOICED']; if (hasPayout) hd.push('AMOUNT PAYOUT')
    exRows.push(hd)
    const loadDataStart = exRows.length
    const sortedRegs = Object.keys(truckMap).sort()
    let totTrips = 0, totTonnes = 0, totInv = 0, totPay = 0
    sortedRegs.forEach(reg => {
      Object.keys(truckMap[reg]).sort().forEach((mine, idx) => {
        const m = truckMap[reg][mine]
        const row = [idx === 0 ? reg : '', mine, m.trips, m.tonnes, m.amountInvoiced]
        if (hasPayout) row.push(m.amountPayout)
        exRows.push(row); totTrips += m.trips; totTonnes += m.tonnes; totInv += m.amountInvoiced; totPay += m.amountPayout
      })
    })
    const totRow = ['TOTAL', '', totTrips, totTonnes, totInv]; if (hasPayout) totRow.push(totPay); exRows.push(totRow)
    const ws = XLSX.utils.aoa_to_sheet(exRows)
    ws['!cols'] = [{ wch: 14 }, { wch: 45 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 20 }]
    for (let i = 0; i <= lines.length; i++) { const ref = XLSX.utils.encode_cell({ r: invDataStart + i, c: 3 }); if (ws[ref] && ws[ref].t === 'n') ws[ref].z = '#,##0.00' }
    const totalLoadRows = sortedRegs.reduce((s, r) => s + Object.keys(truckMap[r]).length, 0)
    for (let i = 0; i <= totalLoadRows; i++) {
      ;(hasPayout ? [3, 4, 5] : [3, 4]).forEach(c => { const ref = XLSX.utils.encode_cell({ r: loadDataStart + i, c }); if (ws[ref] && ws[ref].t === 'n') ws[ref].z = c === 3 ? '#,##0.000' : '#,##0.00' })
    }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Truck Period')
    XLSX.writeFile(wb, `${filename}_TRUCK.xlsx`); toast.success('Downloaded')
  }

  // ─── computed ─────────────────────────────────────────────────────────────
  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const isAccountType = stmtType === 'account'

  if (loading) return (
    <div style={{ padding: '28px 32px', flex: 1 }}>
      <div className="loading-center"><div className="spinner" /></div>
    </div>
  )

  return (
    <div style={{ padding: '28px 32px', flex: 1 }}>

      {/* ── Page header ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost btn-sm" onClick={() => navigate('/statements')} style={{ padding: '5px 10px' }}>
            <ArrowLeft size={14} /> Statements
          </button>
          <div>
            <div className="page-title">{isNew ? 'New Statement' : (title || 'Edit Statement')}</div>
            <div className="page-subtitle">{isNew ? 'Build and save a statement' : 'Edit rows, then save or export'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {stmtType !== 'truck_period' && (
            <>
              <button className="btn-ghost btn-sm" onClick={() => handleExport('pdf')} disabled={exporting}>
                <FileText size={14} style={{ color: 'var(--danger)' }} />
                PDF
              </button>
            </>
          )}
          <button className="btn-ghost btn-sm" onClick={() => handleExport('excel')} disabled={exporting}>
            <FileSpreadsheet size={14} style={{ color: '#16a34a' }} />
            Excel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Type tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStmtType(key)}
            style={{
              padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: stmtType === key ? 700 : 400,
              color: stmtType === key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: stmtType === key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -2, transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Header fields ── */}
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isAdmin && (
              <div className="form-row">
                <div className="form-group">
                  <label>Entity</label>
                  <select value={entityId} onChange={e => { setEntityId(e.target.value); setCustomerId('') }}>
                    <option value="">Select entity…</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Customer <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <SearchableSelect
                    options={customers} value={customerId} onChange={setCustomerId}
                    getValue={c => String(c.id)} getLabel={c => c.name} placeholder="Search customer…"
                  />
                </div>
              </div>
            )}
            {!isAdmin && (
              <div className="form-group">
                <label>Customer <span style={{ color: 'var(--danger)' }}>*</span></label>
                <SearchableSelect
                  options={customers} value={customerId} onChange={setCustomerId}
                  getValue={c => String(c.id)} getLabel={c => c.name} placeholder="Search customer…"
                />
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label>Statement Date</label>
                <DateInput value={stmtDate} onChange={setStmtDate} />
              </div>
              <div className="form-group">
                <label>Title</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. MAY 2026" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Import from invoices ── */}
        <div className="card" style={{ padding: 0 }}>
          <button
            onClick={() => setImportOpen(o => !o)}
            style={{
              width: '100%', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Download size={14} style={{ color: 'var(--accent)' }} />
              Load from Invoices
            </span>
            {importOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {importOpen && (
            <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                  <label>From</label>
                  <DateInput value={importFrom} onChange={setImportFrom} />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                  <label>To</label>
                  <DateInput value={importTo} onChange={setImportTo} />
                </div>
                {stmtType !== 'account' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)', paddingBottom: 10 }}>
                    <input type="checkbox" checked={importIncludePaid} onChange={e => setImportIncludePaid(e.target.checked)} />
                    Include paid
                  </label>
                )}
                <button className="btn-primary btn-sm" onClick={handleImport} disabled={importing} style={{ marginBottom: 0 }}>
                  {importing ? 'Loading…' : 'Load & Replace Rows'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                This will replace all current rows with the imported invoices.
                {stmtType === 'account' && ' Payment rows are added automatically for paid invoices.'}
              </p>
            </div>
          )}
        </div>

        {/* ── Rows table ── */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Rows <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({rows.length})</span>
            </span>
            <button className="btn-ghost btn-sm" onClick={addRow}>
              <Plus size={13} /> Add Row
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)' }}>
                  <th style={thStyle}>Date</th>
                  <th style={{ ...thStyle, width: '40%' }}>Description</th>
                  <th style={thStyle}>Invoice #</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>
                    {isAccountType ? 'Amount (+ debit / − credit)' : 'Amount'}
                  </th>
                  <th style={{ ...thStyle, width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const amt = parseFloat(row.amount) || 0
                  const isCredit = isAccountType && amt < 0
                  return (
                    <tr
                      key={row._id}
                      style={{ background: isCredit ? 'rgba(34,197,94,0.04)' : undefined }}
                    >
                      <td style={tdStyle}>
                        <input
                          type="date"
                          value={row.line_date}
                          onChange={e => setRow(row._id, 'line_date', e.target.value)}
                          style={{ ...inputStyle, width: 130 }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          value={row.description}
                          onChange={e => setRow(row._id, 'description', e.target.value)}
                          placeholder="Description…"
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          value={row.invoice_number}
                          onChange={e => setRow(row._id, 'invoice_number', e.target.value)}
                          placeholder="Inv #"
                          style={{ ...inputStyle, width: 110 }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          value={row.amount}
                          onChange={e => setRow(row._id, 'amount', e.target.value)}
                          placeholder="0.00"
                          style={{
                            ...inputStyle, width: 130, textAlign: 'right',
                            color: isCredit ? 'var(--success)' : undefined,
                          }}
                        />
                      </td>
                      <td style={{ ...tdStyle, padding: '0 8px' }}>
                        <button
                          className="btn-icon"
                          onClick={() => removeRow(row._id)}
                          style={{ color: 'var(--text-muted)', opacity: rows.length === 1 ? 0.3 : 1 }}
                          disabled={rows.length === 1}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Total footer */}
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16,
          }}>
            {isAccountType && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Balance Outstanding:
                <strong style={{ color: total >= 0 ? 'var(--text-primary)' : 'var(--success)', marginLeft: 8, fontFamily: 'monospace' }}>
                  R {fmtAmt(total)}
                </strong>
              </span>
            )}
            {!isAccountType && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Total Outstanding:
                <strong style={{ color: 'var(--text-primary)', marginLeft: 8, fontFamily: 'monospace' }}>
                  R {fmtAmt(total)}
                </strong>
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

const thStyle = {
  padding: '9px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'left', whiteSpace: 'nowrap',
}
const tdStyle = { padding: '6px 8px', borderTop: '1px solid var(--border)' }
const inputStyle = {
  background: 'transparent', border: '1px solid transparent', borderRadius: 4,
  padding: '5px 8px', fontSize: 13, color: 'var(--text-primary)', width: '100%',
  outline: 'none', transition: 'border-color 0.12s',
  fontFamily: 'inherit',
}
