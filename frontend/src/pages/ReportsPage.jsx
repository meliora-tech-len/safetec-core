import { useState, useEffect, useCallback, Fragment } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import {
  getDieselReportByTruck, getDieselReportBySupplier, getDieselAnnualSummary,
  getIncomeExpensesReport, getSarsVatDetail, getSarsVatDetailAnnual,
  getSubcontractorLoadsReport,
} from '../services/api'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: MONTHS[i] }))

const fmtR = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtL = (n) => `${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`
const fmtN = (n, d = 2) => Number(n || 0).toFixed(d)

const TABS = [
  { key: 'income',   label: 'Income vs Expenses' },
  { key: 'subloads', label: 'Subcontractor Loads' },
  { key: 'truck',    label: 'Diesel by Truck' },
  { key: 'supplier', label: 'Diesel by Supplier' },
  { key: 'annual',   label: 'Diesel Annual' },
]

const fmtT = (n) => `${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`

const thisYear = new Date().getFullYear()
const thisMonth = new Date().getMonth() + 1

export default function ReportsPage() {
  const { isAdmin, entities } = useAuth()

  const [tab, setTab]         = useState('income')
  const [entityId, setEntityId] = useEntityFilter()
  const [year, setYear]       = useSessionState('period:reports:year', thisYear)
  const [month, setMonth]     = useSessionState('period:reports:month', thisMonth)
  const [loading, setLoading] = useState(false)

  // Diesel reports use an array; income + subcontractor loads use structured objects
  const [dieselData, setDieselData]   = useState([])
  const [incomeData, setIncomeData]   = useState(null)
  const [detailData, setDetailData]   = useState(null)
  const [subData, setSubData]         = useState(null)

  const loadDetail = useCallback(async (m) => {
    if (!entityId) return
    setLoading(true)
    setDetailData(null)
    try {
      const res = await getSarsVatDetail({ entity_id: entityId, year, month: m })
      setDetailData(res.data)
    } catch {
      toast.error('Failed to load detail')
    } finally {
      setLoading(false)
    }
  }, [entityId, year])

  const load = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setDieselData([])
    setIncomeData(null)
    setDetailData(null)
    setSubData(null)
    try {
      if (tab === 'income') {
        const res = await getIncomeExpensesReport({ entity_id: entityId, year })
        setIncomeData(res.data)
      } else if (tab === 'subloads') {
        const res = await getSubcontractorLoadsReport({ entity_id: entityId, year, month })
        setSubData(res.data)
      } else {
        const p = { entity_id: entityId, year, month }
        let res
        if (tab === 'truck')         res = await getDieselReportByTruck(p)
        else if (tab === 'supplier') res = await getDieselReportBySupplier(p)
        else                         res = await getDieselAnnualSummary({ entity_id: entityId, year })
        setDieselData(res.data || [])
      }
    } catch {
      toast.error('Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [tab, entityId, year, month])

  useEffect(() => { load() }, [load])

  const years = Array.from({ length: 5 }, (_, i) => thisYear - i)

  const exportCsv = () => {
    if (tab === 'income') {
      if (!incomeData?.months) return
      const headers = [
        'Month',
        'Revenue (Incl VAT)', 'Revenue (Excl VAT)', 'Output VAT',
        'Expenses (Incl VAT)', 'Expenses (Excl VAT)', 'Diesel Input VAT', 'Input VAT',
        'VAT Payable',
        'Diesel', 'Payroll', 'Net Profit/Loss',
      ]
      const rows = incomeData.months.map(r => [
        r.month_name,
        r.income_incl_vat, r.income_excl_vat, r.output_vat,
        r.supplier_incl_vat, r.supplier_excl_vat, r.diesel_input_vat, r.input_vat,
        r.vat_payable,
        r.diesel, r.payroll, r.net,
      ].map(v => `"${v}"`).join(','))
      const csv = [headers.join(','), ...rows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `sars-vat-${year}.csv`; a.click()
      URL.revokeObjectURL(url)
    } else {
      if (!dieselData.length) return
      const headers = Object.keys(dieselData[0])
      const rows = dieselData.map(r => headers.map(h => `"${r[h] ?? ''}"`).join(','))
      const csv = [headers.join(','), ...rows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `diesel-${tab}-${year}${tab !== 'annual' ? `-${String(month).padStart(2, '0')}` : ''}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const [showExportMenu, setShowExportMenu] = useState(false)

  const handleDetailExportExcel = () => {
    if (!detailData) return
    setShowExportMenu(false)
    const { month_name, output_invoices, output_groups = [], input_invoices, input_groups = [], output_totals, input_totals, vat_payable } = detailData
    const title   = `SARS VAT Return — ${month_name} ${year}`
    const slug    = `sars-vat-${month_name}-${year}`
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
    const now     = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })
    const wb      = XLSX.utils.book_new()

    const ws1 = XLSX.utils.aoa_to_sheet([
      [title], [`Generated: ${now}`], [],
      ['VAT POSITION', '', '', ''],
      ['', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT'],
      ['Income',   output_totals.amount_incl, output_totals.amount_excl, output_totals.vat],
      ['Expenses', input_totals.amount_incl,  input_totals.amount_excl,  input_totals.vat],
      [],
      [vat_payable >= 0 ? 'VAT PAYABLE TO SARS' : 'VAT REFUND DUE', Math.abs(vat_payable)],
    ])
    ws1['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 20 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary')

    const ws2 = XLSX.utils.aoa_to_sheet([
      [title], [`Generated: ${now}`], [],
      ['Date', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT'],
      ...output_groups.flatMap(g => [
        [`${g.label.toUpperCase()} (${g.count})`],
        ...output_invoices.filter(r => r.category === g.key).map(r => [fmtDate(r.date), r.description, r.amount_incl, r.amount_excl, r.vat]),
        [`${g.label} subtotal`, '', g.amount_incl, g.amount_excl, g.vat],
      ]),
      [],
      ['TOTAL INCOME', '', output_totals.amount_incl, output_totals.amount_excl, output_totals.vat],
    ])
    ws2['!cols'] = [{ wch: 16 }, { wch: 48 }, { wch: 20 }, { wch: 20 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Income Invoices')

    const ws3 = XLSX.utils.aoa_to_sheet([
      [title], [`Generated: ${now}`], [],
      ['Date', 'Invoice #', 'Supplier', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT'],
      ...input_groups.flatMap(g => [
        [`${g.label.toUpperCase()} (${g.count})`],
        ...input_invoices.filter(r => r.category === g.key).map(r => [
          fmtDate(r.date), r.invoice_number || '', r.supplier_name || '', r.description || '',
          r.amount_incl, r.amount_excl, r.vat_applicable ? r.vat : 'Non-VAT',
        ]),
        [`${g.label} subtotal`, '', '', '', g.amount_incl, g.amount_excl, g.vat],
      ]),
      [],
      ['TOTAL EXPENSES', '', '', '', input_totals.amount_incl, input_totals.amount_excl, input_totals.vat],
    ])
    ws3['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 32 }, { wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws3, 'Expense Invoices')

    XLSX.writeFile(wb, `${slug}.xlsx`)
  }

  const handleDetailExportPdf = () => {
    if (!detailData) return
    setShowExportMenu(false)
    const { month_name, output_invoices, output_groups = [], input_invoices, input_groups = [], output_totals, input_totals, vat_payable } = detailData
    const title   = `SARS VAT Return — ${month_name} ${year}`
    const slug    = `sars-vat-${month_name}-${year}`
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
    const fmtAmt  = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const now     = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
    const doc     = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pw      = doc.internal.pageSize.getWidth()

    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 15)
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
    doc.text(`Generated ${now}`, 14, 21)
    doc.setTextColor(0)

    doc.setFontSize(9); doc.setFont('helvetica', 'bold')
    doc.text('INCOME INVOICES', 14, 28)
    autoTable(doc, {
      head: [['Date', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT']],
      body: [
        ...output_groups.flatMap(g => [
          [{ content: `${g.label.toUpperCase()} (${g.count})`, colSpan: 5, styles: { fontStyle: 'bold', fillColor: [220, 240, 228] } }],
          ...output_invoices.filter(r => r.category === g.key).map(r => [fmtDate(r.date), r.description, fmtAmt(r.amount_incl), fmtAmt(r.amount_excl), fmtAmt(r.vat)]),
          [`${g.label} subtotal`, '', fmtAmt(g.amount_incl), fmtAmt(g.amount_excl), fmtAmt(g.vat)],
        ]),
        ['TOTAL INCOME', '', fmtAmt(output_totals.amount_incl), fmtAmt(output_totals.amount_excl), fmtAmt(output_totals.vat)],
      ],
      startY: 31,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [22, 163, 74], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section !== 'body') return
        const first = String(d.row.raw?.[0]?.content ?? d.row.raw?.[0] ?? '')
        if (first === 'TOTAL INCOME' || first.endsWith(' subtotal')) {
          d.cell.styles.fontStyle = 'bold'
          if (first === 'TOTAL INCOME') d.cell.styles.fillColor = [235, 235, 235]
        }
      },
      margin: { left: 14, right: 14 },
    })

    const y2 = doc.lastAutoTable.finalY + 8
    doc.setFontSize(9); doc.setFont('helvetica', 'bold')
    doc.text('EXPENSE INVOICES', 14, y2)
    autoTable(doc, {
      head: [['Date', 'Invoice #', 'Supplier', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT']],
      body: [
        ...input_groups.flatMap(g => [
          [{ content: `${g.label.toUpperCase()} (${g.count})`, colSpan: 7, styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } }],
          ...input_invoices.filter(r => r.category === g.key).map(r => [
            fmtDate(r.date), r.invoice_number || '', r.supplier_name || '', r.description || '',
            fmtAmt(r.amount_incl), fmtAmt(r.amount_excl), r.vat_applicable ? fmtAmt(r.vat) : 'Non-VAT',
          ]),
          [`${g.label} subtotal`, '', '', '', fmtAmt(g.amount_incl), fmtAmt(g.amount_excl), fmtAmt(g.vat)],
        ]),
        ['TOTAL EXPENSES', '', '', '', fmtAmt(input_totals.amount_incl), fmtAmt(input_totals.amount_excl), fmtAmt(input_totals.vat)],
      ],
      startY: y2 + 3,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 28 }, 2: { cellWidth: 34 }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section !== 'body') return
        const first = String(d.row.raw?.[0]?.content ?? d.row.raw?.[0] ?? '')
        if (first === 'TOTAL EXPENSES' || first.endsWith(' subtotal')) {
          d.cell.styles.fontStyle = 'bold'
          if (first === 'TOTAL EXPENSES') d.cell.styles.fillColor = [235, 235, 235]
        }
      },
      margin: { left: 14, right: 14 },
    })

    const y3 = doc.lastAutoTable.finalY + 8
    const bx = pw - 14 - 108, bw = 108
    const summaryRows = [
      { label: 'Income VAT:',   value: fmtAmt(output_totals.vat), rgb: [22, 163, 74] },
      { label: 'Expenses VAT:', value: fmtAmt(input_totals.vat),  rgb: [50, 50, 50]  },
      { label: vat_payable >= 0 ? 'VAT Payable to SARS:' : 'VAT Refund Due:', value: fmtAmt(Math.abs(vat_payable)), rgb: vat_payable > 0 ? [220, 38, 38] : [22, 163, 74] },
    ]
    doc.setFillColor(245, 247, 250)
    doc.rect(bx, y3 - 4, bw, summaryRows.length * 8 + 6, 'F')
    summaryRows.forEach((row, i) => {
      const ry = y3 + i * 8
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80)
      doc.text(row.label, bx + 4, ry)
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...row.rgb)
      doc.text(row.value, bx + bw - 4, ry, { align: 'right' })
    })
    doc.setTextColor(0)
    doc.save(`${slug}.pdf`)
  }

  const handleAnnualExportExcel = async () => {
    if (!incomeData || !entityId) return
    setShowExportMenu(false)
    const { months, totals } = incomeData
    const title = `SARS VAT Annual Report — ${year}`
    const now   = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

    let detail = null
    try {
      const res = await getSarsVatDetailAnnual({ entity_id: entityId, year })
      detail = res.data
    } catch { /* export summary only if detail fails */ }

    const wb = XLSX.utils.book_new()

    // Sheet 1: Monthly Summary
    const sumHdrs = ['Month', 'Revenue Incl VAT', 'Revenue Excl VAT', 'Output VAT', 'Expenses Incl VAT', 'Expenses Excl VAT', 'Diesel Input VAT', 'Input VAT', 'VAT Payable', 'Diesel', 'Payroll', 'Net Profit / Loss']
    const sumRows = months.map(r => [r.month_name, r.income_incl_vat, r.income_excl_vat, r.output_vat, r.supplier_incl_vat, r.supplier_excl_vat, r.diesel_input_vat, r.input_vat, r.vat_payable, r.diesel, r.payroll, r.net])
    const sumTotal = ['YEAR TOTAL', totals.income_incl_vat, totals.income_excl_vat, totals.output_vat, totals.supplier_incl_vat, totals.supplier_excl_vat, totals.diesel_input_vat, totals.input_vat, totals.vat_payable, totals.diesel, totals.payroll, totals.net]
    const ws1 = XLSX.utils.aoa_to_sheet([[title], [`Generated: ${now}`], [], sumHdrs, ...sumRows, [], sumTotal])
    ws1['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Monthly Summary')

    if (detail) {
      // Sheet 2: All Income Invoices
      const incHdrs = ['Month', 'Date', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT']
      const incRows = []
      detail.months.forEach(m => {
        m.output_invoices.forEach(r => incRows.push([m.month_name, fmtDate(r.date), r.description, r.amount_incl, r.amount_excl, r.vat]))
        if (m.output_invoices.length) incRows.push([`${m.month_name} TOTAL`, '', '', m.output_totals.amount_incl, m.output_totals.amount_excl, m.output_totals.vat])
        incRows.push([])
      })
      const ws2 = XLSX.utils.aoa_to_sheet([[title], [`Generated: ${now}`], [], incHdrs, ...incRows])
      ws2['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 48 }, { wch: 20 }, { wch: 20 }, { wch: 16 }]
      XLSX.utils.book_append_sheet(wb, ws2, 'Income Invoices')

      // Sheet 3: All Expense Invoices
      const expHdrs = ['Month', 'Date', 'Invoice #', 'Supplier', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT']
      const expRows = []
      detail.months.forEach(m => {
        m.input_invoices.forEach(r => expRows.push([m.month_name, fmtDate(r.date), r.invoice_number || '', r.supplier_name || '', r.description || '', r.amount_incl, r.amount_excl, r.vat_applicable ? r.vat : 'Non-VAT']))
        if (m.input_invoices.length) expRows.push([`${m.month_name} TOTAL`, '', '', '', '', m.input_totals.amount_incl, m.input_totals.amount_excl, m.input_totals.vat])
        expRows.push([])
      })
      const ws3 = XLSX.utils.aoa_to_sheet([[title], [`Generated: ${now}`], [], expHdrs, ...expRows])
      ws3['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 24 }, { wch: 32 }, { wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 14 }]
      XLSX.utils.book_append_sheet(wb, ws3, 'Expense Invoices')
    }

    XLSX.writeFile(wb, `sars-vat-annual-${year}.xlsx`)
  }

  const handleAnnualExportPdf = async () => {
    if (!incomeData || !entityId) return
    setShowExportMenu(false)
    const { months, totals } = incomeData
    const title  = `SARS VAT Annual Report — ${year}`
    const now    = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
    const fmtAmt = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

    let detail = null
    try {
      const res = await getSarsVatDetailAnnual({ entity_id: entityId, year })
      detail = res.data
    } catch { /* fall back to summary only */ }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 15)
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
    doc.text(`Generated ${now}`, 14, 21)
    doc.setTextColor(0)

    // Page 1: Monthly summary
    autoTable(doc, {
      head: [['Month', 'Revenue\n(Incl VAT)', 'Revenue\n(Excl VAT)', 'Output\nVAT', 'Expenses\n(Incl VAT)', 'Expenses\n(Excl VAT)', 'Input\nVAT', 'VAT\nPayable', 'Diesel', 'Payroll', 'Net Profit/Loss']],
      body: [
        ...months.map(r => [
          r.month_name,
          r.income_incl_vat > 0 ? fmtAmt(r.income_incl_vat) : '—', r.income_excl_vat > 0 ? fmtAmt(r.income_excl_vat) : '—', r.output_vat > 0 ? fmtAmt(r.output_vat) : '—',
          r.supplier_incl_vat > 0 ? fmtAmt(r.supplier_incl_vat) : '—', r.supplier_excl_vat > 0 ? fmtAmt(r.supplier_excl_vat) : '—', r.input_vat > 0 ? fmtAmt(r.input_vat) : '—',
          fmtAmt(r.vat_payable), r.diesel > 0 ? fmtAmt(r.diesel) : '—', r.payroll > 0 ? fmtAmt(r.payroll) : '—', fmtAmt(r.net),
        ]),
        ['YEAR TOTAL', fmtAmt(totals.income_incl_vat), fmtAmt(totals.income_excl_vat), fmtAmt(totals.output_vat), fmtAmt(totals.supplier_incl_vat), fmtAmt(totals.supplier_excl_vat), fmtAmt(totals.input_vat), fmtAmt(totals.vat_payable), fmtAmt(totals.diesel), fmtAmt(totals.payroll), fmtAmt(totals.net)],
      ],
      startY: 26,
      styles: { fontSize: 7, cellPadding: 2, halign: 'right' },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: { 0: { halign: 'left', cellWidth: 22, fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.row.index === months.length) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [235, 235, 235] }
        const r = months[d.row.index]
        if (d.section === 'body' && r && r.income_incl_vat === 0 && r.supplier_incl_vat === 0) d.cell.styles.textColor = [180, 180, 180]
      },
      margin: { left: 14, right: 14 },
    })

    // Subsequent pages: per-month invoice detail
    if (detail) {
      detail.months.filter(m => m.output_invoices.length || m.input_invoices.length).forEach(m => {
        doc.addPage()
        doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(0)
        doc.text(`${m.month_name} ${year} — Invoice Detail`, 14, 14)

        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 163, 74)
        doc.text('INCOME INVOICES', 14, 22)
        autoTable(doc, {
          head: [['Date', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT']],
          body: [
            ...m.output_invoices.map(r => [fmtDate(r.date), r.description, fmtAmt(r.amount_incl), fmtAmt(r.amount_excl), fmtAmt(r.vat)]),
            ['TOTAL', '', fmtAmt(m.output_totals.amount_incl), fmtAmt(m.output_totals.amount_excl), fmtAmt(m.output_totals.vat)],
          ],
          startY: 25,
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [22, 163, 74], textColor: 255, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
          didParseCell: (d) => { if (d.section === 'body' && d.row.index === m.output_invoices.length) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [235, 235, 235] } },
          margin: { left: 14, right: 14 },
        })

        const y2 = doc.lastAutoTable.finalY + 8
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(71, 85, 105)
        doc.text('EXPENSE INVOICES', 14, y2)
        autoTable(doc, {
          head: [['Date', 'Invoice #', 'Supplier', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT']],
          body: [
            ...m.input_invoices.map(r => [fmtDate(r.date), r.invoice_number || '', r.supplier_name || '', r.description || '', fmtAmt(r.amount_incl), fmtAmt(r.amount_excl), r.vat_applicable ? fmtAmt(r.vat) : 'Non-VAT']),
            ['TOTAL', '', '', '', fmtAmt(m.input_totals.amount_incl), fmtAmt(m.input_totals.amount_excl), fmtAmt(m.input_totals.vat)],
          ],
          startY: y2 + 3,
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 28 }, 2: { cellWidth: 34 }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } },
          didParseCell: (d) => { if (d.section === 'body' && d.row.index === m.input_invoices.length) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [235, 235, 235] } },
          margin: { left: 14, right: 14 },
        })
      })
    }

    doc.save(`sars-vat-annual-${year}.pdf`)
  }

  // ── Subcontractor Loads exports ─────────────────────────────────────────────
  // Column order matches the on-screen table so the two can be read side by side.
  const SUB_HDRS = ['Date', 'Mine', 'Slip #', 'PO #', 'Driver', 'Tonnes', 'Rate', 'Invoiced Excl VAT',
                    'Sub Rate', 'Payout Excl VAT', 'Payout Incl VAT', 'Admin Fee']

  const subTotalRow = (label, t) => [label, '', '', '', '', t.tonnes, '', t.invoiced_excl, '', t.payout_excl, t.payout_incl, t.admin_fee]

  const handleSubExportExcel = () => {
    if (!subData) return
    setShowExportMenu(false)
    const { month_name, subcontractors = [], totals } = subData
    const title   = `Subcontractor Loads — ${month_name} ${year}`
    const now     = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
    const wb      = XLSX.utils.book_new()

    // Sheet 1: one row per truck, grouped by subcontractor
    const ws1 = XLSX.utils.aoa_to_sheet([
      [title], [`Generated: ${now}`], [],
      ['Subcontractor', 'Fleet #', 'Registration', 'Loads', 'Tonnes', 'Invoiced Excl VAT', 'Payout Excl VAT', 'Payout Incl VAT', 'Admin Fee'],
      ...subcontractors.flatMap(s => [
        ...s.trucks.map(t => [
          s.subcontractor_name, t.fleet_number || '', t.truck_registration,
          t.totals.loads, t.totals.tonnes, t.totals.invoiced_excl, t.totals.payout_excl, t.totals.payout_incl, t.totals.admin_fee,
        ]),
        [`${s.subcontractor_name} TOTAL`, '', '', s.totals.loads, s.totals.tonnes, s.totals.invoiced_excl, s.totals.payout_excl, s.totals.payout_incl, s.totals.admin_fee],
        [],
      ]),
      ['GRAND TOTAL', '', '', totals.loads, totals.tonnes, totals.invoiced_excl, totals.payout_excl, totals.payout_incl, totals.admin_fee],
    ])
    ws1['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 16 }, { wch: 8 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary')

    // Sheet 2: every load record, under its subcontractor + truck heading
    const ws2 = XLSX.utils.aoa_to_sheet([
      [title], [`Generated: ${now}`], [],
      ...subcontractors.flatMap(s => [
        [s.subcontractor_name.toUpperCase()],
        ...s.trucks.flatMap(t => [
          [`${t.fleet_number ? `${t.fleet_number} — ` : ''}${t.truck_registration} (${t.totals.loads} loads)`],
          SUB_HDRS,
          ...t.loads.map(l => [
            fmtDate(l.load_date), l.mine_name || '', l.slip_number || '', l.po_number || '', l.driver_name || '',
            l.tonnes, l.rate_per_ton, l.invoiced_excl,
            l.subcontractor_rate, l.payout_excl, l.payout_incl, l.admin_fee,
          ]),
          subTotalRow(`${t.truck_registration} total`, t.totals),
          [],
        ]),
        subTotalRow(`${s.subcontractor_name} TOTAL`, s.totals),
        [],
      ]),
      subTotalRow('GRAND TOTAL', totals),
    ])
    ws2['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 10 },
                    { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Load Detail')

    XLSX.writeFile(wb, `subcontractor-loads-${year}-${String(month).padStart(2, '0')}.xlsx`)
  }

  const handleSubExportPdf = () => {
    if (!subData) return
    setShowExportMenu(false)
    const { month_name, subcontractors = [], totals } = subData
    const title   = `Subcontractor Loads — ${month_name} ${year}`
    const now     = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
    const fmtAmt  = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : ''
    const doc     = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 15)
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
    doc.text(`Generated ${now}`, 14, 21)
    doc.setTextColor(0)

    // Page 1: per-truck totals grouped by subcontractor
    autoTable(doc, {
      head: [['Subcontractor', 'Fleet #', 'Registration', 'Loads', 'Tonnes', 'Invoiced Excl', 'Payout Excl', 'Payout Incl', 'Admin Fee']],
      body: [
        ...subcontractors.flatMap(s => [
          ...s.trucks.map((t, i) => [
            i === 0 ? s.subcontractor_name : '', t.fleet_number || '—', t.truck_registration,
            t.totals.loads, fmtT(t.totals.tonnes), fmtAmt(t.totals.invoiced_excl),
            fmtAmt(t.totals.payout_excl), fmtAmt(t.totals.payout_incl), fmtAmt(t.totals.admin_fee),
          ]),
          [`${s.subcontractor_name} subtotal`, '', '', s.totals.loads, fmtT(s.totals.tonnes),
           fmtAmt(s.totals.invoiced_excl), fmtAmt(s.totals.payout_excl), fmtAmt(s.totals.payout_incl), fmtAmt(s.totals.admin_fee)],
        ]),
        ['GRAND TOTAL', '', '', totals.loads, fmtT(totals.tonnes), fmtAmt(totals.invoiced_excl),
         fmtAmt(totals.payout_excl), fmtAmt(totals.payout_incl), fmtAmt(totals.admin_fee)],
      ],
      startY: 26,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 38 }, 1: { cellWidth: 16 }, 2: { cellWidth: 26 },
        3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
        6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
      },
      didParseCell: (d) => {
        if (d.section !== 'body') return
        const first = String(d.row.raw?.[0] ?? '')
        if (first === 'GRAND TOTAL' || first.endsWith(' subtotal')) {
          d.cell.styles.fontStyle = 'bold'
          d.cell.styles.fillColor = first === 'GRAND TOTAL' ? [225, 225, 225] : [241, 245, 249]
        }
      },
      margin: { left: 14, right: 14 },
    })

    // Then a page per subcontractor with every load record behind the totals
    subcontractors.forEach(s => {
      doc.addPage()
      doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(0)
      doc.text(`${s.subcontractor_name} — ${month_name} ${year}`, 14, 14)
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
      doc.text(
        `${s.totals.loads} loads · ${fmtT(s.totals.tonnes)} · Invoiced ${fmtAmt(s.totals.invoiced_excl)} · ` +
        `Payout ${fmtAmt(s.totals.payout_excl)} · Admin fee ${fmtAmt(s.totals.admin_fee)}`,
        14, 19,
      )
      doc.setTextColor(0)

      autoTable(doc, {
        head: [['Date', 'Mine', 'Slip #', 'Driver', 'Tonnes', 'Rate', 'Invoiced Excl', 'Sub Rate', 'Payout Excl', 'Admin Fee']],
        body: [
          ...s.trucks.flatMap(t => [
            [{ content: `${t.fleet_number ? `${t.fleet_number} — ` : ''}${t.truck_registration}  (${t.totals.loads} loads)`,
               colSpan: 10, styles: { fontStyle: 'bold', fillColor: [226, 232, 240] } }],
            ...t.loads.map(l => [
              fmtDate(l.load_date), l.mine_name || '—',
              (l.slip_number || '—') + (l.is_split_load ? ' (split)' : '') + (l.is_projection ? ' (proj)' : ''),
              l.driver_name || '—',
              fmtT(l.tonnes), fmtAmt(l.rate_per_ton), fmtAmt(l.invoiced_excl),
              fmtAmt(l.subcontractor_rate), fmtAmt(l.payout_excl), fmtAmt(l.admin_fee),
            ]),
            [`${t.truck_registration} total`, '', '', '', fmtT(t.totals.tonnes), '', fmtAmt(t.totals.invoiced_excl),
             '', fmtAmt(t.totals.payout_excl), fmtAmt(t.totals.admin_fee)],
          ]),
          [`${s.subcontractor_name} TOTAL`, '', '', '', fmtT(s.totals.tonnes), '', fmtAmt(s.totals.invoiced_excl),
           '', fmtAmt(s.totals.payout_excl), fmtAmt(s.totals.admin_fee)],
        ],
        startY: 23,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 16 }, 1: { cellWidth: 26 }, 2: { cellWidth: 26 }, 3: { cellWidth: 30 },
          4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
          7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' },
        },
        didParseCell: (d) => {
          if (d.section !== 'body') return
          const first = String(d.row.raw?.[0]?.content ?? d.row.raw?.[0] ?? '')
          if (first.endsWith(' TOTAL') || first.endsWith(' total')) {
            d.cell.styles.fontStyle = 'bold'
            d.cell.styles.fillColor = first.endsWith(' TOTAL') ? [225, 225, 225] : [245, 245, 245]
          }
        },
        margin: { left: 14, right: 14 },
      })
    })

    doc.save(`subcontractor-loads-${year}-${String(month).padStart(2, '0')}.pdf`)
  }

  const hasData = tab === 'income' ? !!incomeData
    : tab === 'subloads' ? !!subData?.subcontractors?.length
    : dieselData.length > 0

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Reports</h1>
          <p style={styles.subtitle}>Business reports and reconciliations</p>
        </div>
        <div style={{ position: 'relative' }}>
          {tab === 'income' || tab === 'subloads' ? (
            <>
              <button
                onClick={() => setShowExportMenu(v => !v)}
                style={styles.btnSecondary}
                disabled={!hasData && !detailData}
              >
                Export ▾
              </button>
              {showExportMenu && (
                <>
                  <div onClick={() => setShowExportMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                  <div style={{
                    position: 'absolute', right: 0, top: '110%', zIndex: 20,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 180, overflow: 'hidden',
                  }}>
                    {(tab === 'subloads'
                      ? [{ label: 'Export Excel (.xlsx)', action: handleSubExportExcel }, { label: 'Export PDF', action: handleSubExportPdf }]
                      : detailData
                        ? [{ label: 'Export Excel (.xlsx)', action: handleDetailExportExcel }, { label: 'Export PDF', action: handleDetailExportPdf }]
                        : [{ label: 'Export Excel (.xlsx)', action: handleAnnualExportExcel }, { label: 'Export PDF', action: handleAnnualExportPdf }]
                    ).map(item => (
                      <button key={item.label} onClick={item.action} style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '10px 16px', fontSize: 13, fontWeight: 500,
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <button onClick={exportCsv} style={styles.btnSecondary} disabled={!hasData}>
              Export
            </button>
          )}
        </div>
      </div>

      {/* Tabs + filters */}
      <div style={styles.tabBar}>
        <div style={styles.tabs}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : {}) }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={styles.filters}>
          {isAdmin && (
            <select value={entityId} onChange={e => setEntityId(e.target.value)} style={styles.select}>
              <option value="">— Entity —</option>
              {(entities || []).map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
            </select>
          )}
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={styles.select}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {tab !== 'annual' && tab !== 'income' && (
            <select value={month} onChange={e => setMonth(Number(e.target.value))} style={styles.select}>
              {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ ...styles.card, ...styles.empty }}>Loading…</div>
      ) : tab === 'income' ? (
        detailData
          ? <SarsVatDetail data={detailData} year={year} onBack={() => setDetailData(null)} />
          : incomeData
            ? <IncomeExpensesReport data={incomeData} year={year} onViewDetail={loadDetail} />
            : <div style={{ ...styles.card, ...styles.empty }}>Select an entity to load the report.</div>
      ) : tab === 'subloads' ? (
        !subData
          ? <div style={{ ...styles.card, ...styles.empty }}>Select an entity to load the report.</div>
          : subData.subcontractors.length === 0
            ? <div style={{ ...styles.card, ...styles.empty }}>No subcontractor loads for this period.</div>
            : <SubcontractorLoadsReport data={subData} year={year} />
      ) : (
        <div style={styles.card}>
          {dieselData.length === 0 ? (
            <div style={styles.empty}>No data for this period.</div>
          ) : tab === 'truck' ? (
            <TruckReport data={dieselData} />
          ) : tab === 'supplier' ? (
            <SupplierReport data={dieselData} />
          ) : (
            <AnnualReport data={dieselData} year={year} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Income vs Expenses / SARS VAT ─────────────────────────────────────────────
function IncomeExpensesReport({ data, year, onViewDetail }) {
  const { months, totals, has_payroll_entries } = data

  const vatPayableColor = (n) => n > 0 ? 'var(--danger)' : n < 0 ? '#16a34a' : 'var(--text-muted)'
  const netColor = (n) => n > 0 ? '#16a34a' : n < 0 ? 'var(--danger)' : 'var(--text-muted)'

  const vatCards = [
    { label: 'Income VAT',  value: totals.output_vat,   color: '#16a34a' },
    { label: 'Expenses VAT', value: totals.input_vat,   color: 'var(--text-secondary)' },
    {
      label: totals.vat_payable >= 0 ? 'VAT Payable to SARS' : 'VAT Refund Due',
      value: Math.abs(totals.vat_payable),
      color: vatPayableColor(totals.vat_payable),
    },
  ]

  return (
    <div>
      {/* VAT summary cards */}
      <div style={{ padding: '16px 20px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        VAT Position
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, padding: '0 20px 16px' }}>
        {vatCards.map(c => (
          <div key={c.label} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '16px 20px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>
              {fmtR(c.value)}
            </div>
          </div>
        ))}
      </div>

      {/* Business summary pills */}
      <div style={{ padding: '0 20px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        Business Summary
      </div>
      <div style={{ padding: '0 20px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Revenue (Incl VAT)', value: totals.total_income },
          { label: 'Diesel',             value: totals.diesel        },
          { label: 'Suppliers',          value: totals.suppliers     },
          { label: 'Payroll',            value: totals.payroll       },
          { label: 'Net Profit / Loss',  value: totals.net, color: netColor(totals.net) },
        ].map(c => (
          <div key={c.label} style={{ fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>{c.label}:</span>
            <span style={{ fontWeight: 600, color: c.color || 'var(--text-primary)' }}>{fmtR(c.value)}</span>
          </div>
        ))}
      </div>


      {/* Monthly SARS VAT table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th} rowSpan={2}>Month</th>
              <th style={{ ...styles.th, textAlign: 'center', color: '#16a34a', borderLeft: '2px solid var(--border)' }} colSpan={3}>
                Income
              </th>
              <th style={{ ...styles.th, textAlign: 'center', borderLeft: '2px solid var(--border)' }} colSpan={3}>
                Expenses
              </th>
              <th style={{ ...styles.th, textAlign: 'right', borderLeft: '2px solid var(--border)' }} rowSpan={2}>
                VAT Payable
              </th>
              <th style={styles.th} rowSpan={2}></th>
            </tr>
            <tr>
              <th style={{ ...styles.th, textAlign: 'right', color: '#16a34a', borderLeft: '2px solid var(--border)', fontSize: 10 }}>Incl VAT</th>
              <th style={{ ...styles.th, textAlign: 'right', color: '#16a34a', fontSize: 10 }}>Excl VAT</th>
              <th style={{ ...styles.th, textAlign: 'right', color: '#16a34a', fontSize: 10 }}>VAT</th>
              <th style={{ ...styles.th, textAlign: 'right', borderLeft: '2px solid var(--border)', fontSize: 10 }}>Incl VAT</th>
              <th style={{ ...styles.th, textAlign: 'right', fontSize: 10 }}>Excl VAT</th>
              <th style={{ ...styles.th, textAlign: 'right', fontSize: 10 }}>VAT</th>
            </tr>
          </thead>
          <tbody>
            {months.map(r => {
              const hasActivity = r.income_incl_vat > 0 || r.supplier_incl_vat > 0
              return (
                <tr key={r.month} style={{ ...styles.row, opacity: hasActivity ? 1 : 0.4 }}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{r.month_name} {year}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#16a34a', borderLeft: '2px solid var(--border)' }}>
                    {hasActivity ? fmtR(r.income_incl_vat) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#16a34a' }}>
                    {hasActivity ? fmtR(r.income_excl_vat) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>
                    {hasActivity ? fmtR(r.output_vat) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', borderLeft: '2px solid var(--border)' }}>
                    {r.supplier_incl_vat > 0 ? fmtR(r.supplier_incl_vat) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {r.supplier_excl_vat > 0 ? fmtR(r.supplier_excl_vat) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>
                    {r.input_vat > 0 ? fmtR(r.input_vat) : '—'}
                  </td>
                  <td style={{
                    ...styles.td, textAlign: 'right', fontWeight: 700,
                    borderLeft: '2px solid var(--border)',
                    color: vatPayableColor(r.vat_payable),
                  }}>
                    {hasActivity ? fmtR(r.vat_payable) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    {hasActivity && (
                      <button
                        onClick={() => onViewDetail(r.month)}
                        style={{
                          padding: '3px 10px', fontSize: 11, fontWeight: 600,
                          background: 'var(--bg-hover)', color: 'var(--accent)',
                          border: '1px solid var(--accent)', borderRadius: 6, cursor: 'pointer',
                        }}
                      >
                        Detail
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={styles.totalRow}>
              <td style={{ ...styles.td, fontWeight: 700 }}>YEAR TOTAL</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#16a34a', borderLeft: '2px solid var(--border)' }}>{fmtR(totals.income_incl_vat)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmtR(totals.income_excl_vat)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmtR(totals.output_vat)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, borderLeft: '2px solid var(--border)' }}>{fmtR(totals.supplier_incl_vat)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(totals.supplier_excl_vat)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(totals.input_vat)}</td>
              <td style={{
                ...styles.td, textAlign: 'right', fontWeight: 800, fontSize: 14,
                borderLeft: '2px solid var(--border)',
                color: vatPayableColor(totals.vat_payable),
              }}>{fmtR(totals.vat_payable)}</td>
              <td style={styles.td}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Diesel input VAT footnote */}
      {totals.diesel_input_vat > 0 && (
        <div style={{ padding: '8px 20px', fontSize: 11, color: 'var(--text-muted)' }}>
          * Expenses VAT includes {fmtR(totals.diesel_input_vat)} diesel admin fee VAT (diesel is zero-rated; only the admin fee carries VAT).
        </div>
      )}
    </div>
  )
}


// ── Monthly by Truck ────────────────────────────────────────────────────────────
function TruckReport({ data }) {
  const totals = data.reduce((acc, r) => ({
    fill_up_count: acc.fill_up_count + (r.fill_up_count || 0),
    total_litres: acc.total_litres + Number(r.total_litres || 0),
    total_amount: acc.total_amount + Number(r.total_amount || 0),
    total_admin_fee: acc.total_admin_fee + Number(r.total_admin_fee || 0),
    grand_total: acc.grand_total + Number(r.grand_total || 0),
  }), { fill_up_count: 0, total_litres: 0, total_amount: 0, total_admin_fee: 0, grand_total: 0 })

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          {['Truck', 'Logs', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Grand Total', 'Avg Rate (R/L)'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((r, i) => (
          <tr key={i} style={styles.row}>
            <td style={{ ...styles.td, fontWeight: 600 }}>{r.truck_reg || r.truck_id}</td>
            <td style={styles.td}>{r.fill_up_count}</td>
            <td style={styles.td}>{fmtL(r.total_litres)}</td>
            <td style={styles.td}>{fmtR(r.total_amount)}</td>
            <td style={styles.td}>{fmtR(r.total_admin_fee)}</td>
            <td style={{ ...styles.td, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtR(r.grand_total)}</td>
            <td style={styles.td}>
              {r.total_litres > 0 ? `R ${fmtN(r.total_amount / r.total_litres)}` : '—'}
            </td>
          </tr>
        ))}
        <tr style={styles.totalRow}>
          <td style={{ ...styles.td, fontWeight: 700 }}>TOTAL</td>
          <td style={styles.td}>{totals.fill_up_count}</td>
          <td style={styles.td}>{fmtL(totals.total_litres)}</td>
          <td style={styles.td}>{fmtR(totals.total_amount)}</td>
          <td style={styles.td}>{fmtR(totals.total_admin_fee)}</td>
          <td style={{ ...styles.td, fontWeight: 700 }}>{fmtR(totals.grand_total)}</td>
          <td style={styles.td}>
            {totals.total_litres > 0 ? `R ${fmtN(totals.total_amount / totals.total_litres)}` : '—'}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

// ── Supplier Reconciliation ─────────────────────────────────────────────────────
function SupplierReport({ data }) {
  const totals = data.reduce((acc, r) => ({
    fill_up_count: acc.fill_up_count + (r.fill_up_count || 0),
    total_litres: acc.total_litres + Number(r.total_litres || 0),
    total_amount: acc.total_amount + Number(r.total_amount || 0),
    total_admin_fee: acc.total_admin_fee + Number(r.total_admin_fee || 0),
    grand_total: acc.grand_total + Number(r.grand_total || 0),
  }), { fill_up_count: 0, total_litres: 0, total_amount: 0, total_admin_fee: 0, grand_total: 0 })

  return (
    <>
      <table style={styles.table}>
        <thead>
          <tr>
            {['Supplier', 'Logs', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Grand Total'].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} style={styles.row}>
              <td style={{ ...styles.td, fontWeight: 600 }}>{r.supplier_name || r.supplier_id}</td>
              <td style={styles.td}>{r.fill_up_count}</td>
              <td style={styles.td}>{fmtL(r.total_litres)}</td>
              <td style={styles.td}>{fmtR(r.total_amount)}</td>
              <td style={styles.td}>{fmtR(r.total_admin_fee)}</td>
              <td style={{ ...styles.td, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtR(r.grand_total)}</td>
            </tr>
          ))}
          <tr style={styles.totalRow}>
            <td style={{ ...styles.td, fontWeight: 700 }}>TOTAL</td>
            <td style={styles.td}>{totals.fill_up_count}</td>
            <td style={styles.td}>{fmtL(totals.total_litres)}</td>
            <td style={styles.td}>{fmtR(totals.total_amount)}</td>
            <td style={styles.td}>{fmtR(totals.total_admin_fee)}</td>
            <td style={{ ...styles.td, fontWeight: 700 }}>{fmtR(totals.grand_total)}</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

// ── Annual Summary ──────────────────────────────────────────────────────────────
function AnnualReport({ data, year }) {
  // data is array of monthly totals: { month, fill_up_count, total_litres, total_amount, total_admin_fee, grand_total }
  const totals = data.reduce((acc, r) => ({
    fill_up_count: acc.fill_up_count + (r.fill_up_count || 0),
    total_litres: acc.total_litres + Number(r.total_litres || 0),
    total_amount: acc.total_amount + Number(r.total_amount || 0),
    total_admin_fee: acc.total_admin_fee + Number(r.total_admin_fee || 0),
    grand_total: acc.grand_total + Number(r.grand_total || 0),
  }), { fill_up_count: 0, total_litres: 0, total_amount: 0, total_admin_fee: 0, grand_total: 0 })

  return (
    <>
      <div style={styles.annualTitle}>Annual Diesel Summary — {year}</div>
      <table style={styles.table}>
        <thead>
          <tr>
            {['Month', 'Logs', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Grand Total'].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} style={styles.row}>
              <td style={{ ...styles.td, fontWeight: 600 }}>
                {MONTHS[(r.month || i + 1) - 1]} {year}
              </td>
              <td style={styles.td}>{r.fill_up_count}</td>
              <td style={styles.td}>{fmtL(r.total_litres)}</td>
              <td style={styles.td}>{fmtR(r.total_amount)}</td>
              <td style={styles.td}>{fmtR(r.total_admin_fee)}</td>
              <td style={{ ...styles.td, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtR(r.grand_total)}</td>
            </tr>
          ))}
          <tr style={styles.totalRow}>
            <td style={{ ...styles.td, fontWeight: 700 }}>YEAR TOTAL</td>
            <td style={styles.td}>{totals.fill_up_count}</td>
            <td style={styles.td}>{fmtL(totals.total_litres)}</td>
            <td style={styles.td}>{fmtR(totals.total_amount)}</td>
            <td style={styles.td}>{fmtR(totals.total_admin_fee)}</td>
            <td style={{ ...styles.td, fontWeight: 700 }}>{fmtR(totals.grand_total)}</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

// ── SARS VAT Monthly Detail ────────────────────────────────────────────────────
// Fill-up breakdown shown under an expanded diesel invoice. Columns mirror the
// costing Diesel Summary so the two reconcile line for line: the diesel amount is
// zero-rated, and the 1% admin fee is the only part carrying VAT.
function DieselFillUpBreakdown({ lines, fmtDate, invoiceTotal }) {
  const tot = lines.reduce((a, l) => ({
    litres:         a.litres         + Number(l.litres || 0),
    amount_excl:    a.amount_excl    + Number(l.amount_excl || 0),
    admin_fee_excl: a.admin_fee_excl + Number(l.admin_fee_excl || 0),
    admin_fee_vat:  a.admin_fee_vat  + Number(l.admin_fee_vat || 0),
    admin_fee_incl: a.admin_fee_incl + Number(l.admin_fee_incl || 0),
    total:          a.total          + Number(l.total || 0),
  }), { litres: 0, amount_excl: 0, admin_fee_excl: 0, admin_fee_vat: 0, admin_fee_incl: 0, total: 0 })

  const th = { padding: '5px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', whiteSpace: 'nowrap' }
  const td = { padding: '5px 8px', fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }
  const R  = { textAlign: 'right' }

  return (
    <div style={{ overflowX: 'auto', padding: '8px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ ...th, textAlign: 'left' }}>Date</th>
            <th style={{ ...th, textAlign: 'left' }}>Slip #</th>
            <th style={{ ...th, textAlign: 'left' }}>Truck</th>
            <th style={{ ...th, ...R }}>Litres</th>
            <th style={{ ...th, ...R }}>R/Lt</th>
            <th style={{ ...th, ...R }}>Diesel</th>
            <th style={{ ...th, ...R }}>1% Fee Excl</th>
            <th style={{ ...th, ...R }}>Fee VAT</th>
            <th style={{ ...th, ...R }}>1% Fee Incl</th>
            <th style={{ ...th, ...R }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.fillup_id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={td}>{fmtDate(l.date)}</td>
              <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{l.slip_number || '—'}</td>
              <td style={td}>{l.truck_registration || '—'}</td>
              <td style={{ ...td, ...R }}>{fmtN(l.litres)}</td>
              <td style={{ ...td, ...R }}>{fmtN(l.rate_per_litre, 4)}</td>
              <td style={{ ...td, ...R }}>{fmtR(l.amount_excl)}</td>
              <td style={{ ...td, ...R }}>{fmtR(l.admin_fee_excl)}</td>
              <td style={{ ...td, ...R, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtR(l.admin_fee_vat)}</td>
              <td style={{ ...td, ...R }}>{fmtR(l.admin_fee_incl)}</td>
              <td style={{ ...td, ...R, fontWeight: 600 }}>{fmtR(l.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700 }}>
            <td style={{ ...td, fontWeight: 700 }} colSpan={3}>TOTAL ({lines.length})</td>
            <td style={{ ...td, ...R, fontWeight: 700 }}>{fmtN(tot.litres)}</td>
            <td style={td}></td>
            <td style={{ ...td, ...R, fontWeight: 700 }}>{fmtR(tot.amount_excl)}</td>
            <td style={{ ...td, ...R, fontWeight: 700 }}>{fmtR(tot.admin_fee_excl)}</td>
            <td style={{ ...td, ...R, fontWeight: 800, color: 'var(--text-primary)' }}>{fmtR(tot.admin_fee_vat)}</td>
            <td style={{ ...td, ...R, fontWeight: 700 }}>{fmtR(tot.admin_fee_incl)}</td>
            <td style={{ ...td, ...R, fontWeight: 700 }}>{fmtR(tot.total)}</td>
          </tr>
        </tfoot>
      </table>
      {/* The fill-ups should account for the whole invoice. When they don't, say so
          rather than leaving the reader to wonder why the lines don't add up. */}
      {invoiceTotal != null && Math.abs(tot.total - invoiceTotal) > 0.05 && (
        <div style={{ padding: '2px 8px 4px', fontSize: 10, color: 'var(--danger)', fontWeight: 600 }}>
          ⚠ Fill-ups total {fmtR(tot.total)} but the invoice is {fmtR(invoiceTotal)} — a difference of {fmtR(Math.abs(tot.total - invoiceTotal))} is not covered by any linked fill-up. The invoice amount above is used; only the fee VAT comes from these lines.
        </div>
      )}
    </div>
  )
}


function SarsVatDetail({ data, year, onBack }) {
  const { month_name, output_invoices, output_groups = [], input_invoices, input_groups = [], output_totals, input_totals, vat_payable } = data
  const vatColor = vat_payable > 0 ? 'var(--danger)' : vat_payable < 0 ? '#16a34a' : 'var(--text-muted)'
  const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const title    = `SARS VAT Return — ${month_name} ${year}`

  // Invoices carrying a diesel fill-up breakdown (Intsimbi) expand to show it.
  const [expanded, setExpanded] = useState(() => new Set())
  const toggleRow = (id) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: 'var(--bg-hover)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 6,
          }}>
            ← Back
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {title}
          </span>
        </div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: vatColor,
          padding: '5px 16px', borderRadius: 8,
          border: `1px solid ${vatColor}`, background: 'var(--bg-surface)',
        }}>
          VAT {vat_payable >= 0 ? 'Payable' : 'Refund'}: {fmtR(Math.abs(vat_payable))}
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 32, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexWrap: 'wrap' }}>
        {[
          { label: 'Income VAT',        value: output_totals.vat,        color: '#16a34a' },
          { label: 'Income Incl VAT',   value: output_totals.amount_incl },
          { label: 'Income Excl VAT',   value: output_totals.amount_excl },
          { label: 'Expenses VAT',      value: input_totals.vat,         color: 'var(--text-secondary)' },
          { label: 'Expenses Incl VAT', value: input_totals.amount_incl },
          { label: 'Expenses Excl VAT', value: input_totals.amount_excl },
        ].map(c => (
          <div key={c.label} style={{ fontSize: 12 }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 2, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</div>
            <div style={{ fontWeight: 700, color: c.color || 'var(--text-primary)' }}>{fmtR(c.value)}</div>
          </div>
        ))}
      </div>

      {/* Income invoices */}
      <div style={{ padding: '12px 20px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#16a34a' }}>
        Income Invoices ({output_invoices.length})
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Date', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT'].map((h, i) => (
                <th key={h} style={{ ...styles.th, textAlign: i >= 2 ? 'right' : 'left', color: '#16a34a' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {output_invoices.length === 0 ? (
              <tr><td colSpan={5} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-muted)' }}>No income invoices for this month.</td></tr>
            ) : output_groups.map(g => (
              <Fragment key={g.key}>
                <tr>
                  <td colSpan={5} style={{ ...styles.td, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', background: 'var(--bg-surface)' }}>
                    {g.label} ({g.count})
                  </td>
                </tr>
                {output_invoices.filter(r => r.category === g.key).map((r, i) => (
                  <tr key={`${g.key}-${i}`} style={styles.row}>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{r.description}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(r.amount_incl)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(r.amount_excl)}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmtR(r.vat)}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--bg-surface)' }}>
                  <td style={{ ...styles.td, fontWeight: 700, fontSize: 12 }} colSpan={2}>{g.label} subtotal</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(g.amount_incl)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(g.amount_excl)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmtR(g.vat)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr style={styles.totalRow}>
              <td style={{ ...styles.td, fontWeight: 700 }} colSpan={2}>TOTAL INCOME</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(output_totals.amount_incl)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(output_totals.amount_excl)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, color: '#16a34a' }}>{fmtR(output_totals.vat)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Expense invoices */}
      <div style={{ padding: '16px 20px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', borderTop: '2px solid var(--border)', marginTop: 8 }}>
        Expense Invoices ({input_invoices.length})
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Date', 'Invoice #', 'Supplier', 'Description', 'Amount Incl VAT', 'Amount Excl VAT', 'VAT'].map((h, i) => (
                <th key={h} style={{ ...styles.th, textAlign: i >= 4 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {input_invoices.length === 0 ? (
              <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-muted)' }}>No expense invoices for this month.</td></tr>
            ) : input_groups.map(g => (
              <Fragment key={g.key}>
                <tr>
                  <td colSpan={7} style={{ ...styles.td, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', background: 'var(--bg-surface)' }}>
                    {g.label} ({g.count})
                  </td>
                </tr>
                {input_invoices.filter(r => r.category === g.key).map((r, i) => {
                  const lines  = r.fillup_lines || []
                  const isOpen = expanded.has(r.invoice_id)
                  return (
                    <Fragment key={`${g.key}-${r.invoice_id ?? i}`}>
                      <tr style={styles.row}>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                        <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12 }}>
                          {lines.length > 0 ? (
                            <button
                              onClick={() => toggleRow(r.invoice_id)}
                              title={isOpen ? 'Hide fill-up breakdown' : 'Show fill-up breakdown'}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: 0, border: 'none', background: 'none', cursor: 'pointer',
                                font: 'inherit', color: 'var(--accent)', fontWeight: 600,
                              }}
                            >
                              <span style={{ fontSize: 9, width: 8, display: 'inline-block' }}>{isOpen ? '▼' : '▶'}</span>
                              {r.invoice_number || '—'}
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                                ({lines.length})
                              </span>
                            </button>
                          ) : (r.invoice_number || '—')}
                        </td>
                        <td style={{ ...styles.td, fontWeight: 600 }}>{r.supplier_name || '—'}</td>
                        <td style={{ ...styles.td, color: 'var(--text-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description || '—'}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(r.amount_incl)}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(r.amount_excl)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: r.vat_applicable ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                          {r.vat_applicable ? fmtR(r.vat) : <span style={{ fontSize: 10 }}>Non-VAT</span>}
                        </td>
                      </tr>
                      {isOpen && lines.length > 0 && (
                        <tr>
                          <td colSpan={7} style={{ padding: '0 0 0 28px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                            <DieselFillUpBreakdown lines={lines} fmtDate={fmtDate} invoiceTotal={r.amount_incl} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                <tr style={{ background: 'var(--bg-surface)' }}>
                  <td style={{ ...styles.td, fontWeight: 700, fontSize: 12 }} colSpan={4}>{g.label} subtotal</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(g.amount_incl)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(g.amount_excl)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(g.vat)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr style={styles.totalRow}>
              <td style={{ ...styles.td, fontWeight: 700 }} colSpan={4}>TOTAL EXPENSES</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(input_totals.amount_incl)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(input_totals.amount_excl)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800 }}>{fmtR(input_totals.vat)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* VAT payable footer */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 32,
        padding: '14px 20px', borderTop: '2px solid var(--border)', background: 'var(--bg-surface)',
      }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Income VAT: </span>
          <span style={{ fontWeight: 700, color: '#16a34a' }}>{fmtR(output_totals.vat)}</span>
        </div>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Expenses VAT: </span>
          <span style={{ fontWeight: 700 }}>{fmtR(input_totals.vat)}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: vatColor }}>
          VAT {vat_payable >= 0 ? 'Payable to SARS' : 'Refund Due'}: {fmtR(Math.abs(vat_payable))}
        </div>
      </div>
    </div>
  )
}


// ── Subcontractor Loads ────────────────────────────────────────────────────────
// Subcontractor → truck → every load record behind the truck's total.
function SubcontractorLoadsReport({ data, year }) {
  const { month_name, subcontractors, totals } = data
  const [collapsed, setCollapsed] = useState({})

  const toggle = (id) => setCollapsed(c => ({ ...c, [id]: !c[id] }))
  const allCollapsed = subcontractors.every(s => collapsed[s.subcontractor_id])
  const toggleAll = () =>
    setCollapsed(allCollapsed ? {} : Object.fromEntries(subcontractors.map(s => [s.subcontractor_id, true])))

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : '—'
  const COLS = 11

  return (
    <div>
      {/* Grand totals */}
      <div style={{ ...styles.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            Subcontractor Loads — {month_name} {year}
          </span>
          <button onClick={toggleAll} style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: 'var(--bg-hover)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 6,
          }}>
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 32, padding: '12px 20px', background: 'var(--bg-surface)', flexWrap: 'wrap' }}>
          {[
            { label: 'Subcontractors', value: String(subcontractors.length) },
            { label: 'Loads',          value: String(totals.loads) },
            { label: 'Tonnes',         value: fmtT(totals.tonnes) },
            { label: 'Invoiced Excl VAT', value: fmtR(totals.invoiced_excl) },
            { label: 'Payout Excl VAT',   value: fmtR(totals.payout_excl), color: '#16a34a' },
            { label: 'Admin Fee',         value: fmtR(totals.admin_fee) },
          ].map(c => (
            <div key={c.label} style={{ fontSize: 12 }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</div>
              <div style={{ fontWeight: 700, color: c.color || 'var(--text-primary)' }}>{c.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* One card per subcontractor */}
      {subcontractors.map(s => {
        const isCollapsed = !!collapsed[s.subcontractor_id]
        return (
          <div key={s.subcontractor_id} style={{ ...styles.card, marginBottom: 16 }}>
            <div
              onClick={() => toggle(s.subcontractor_id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 16, padding: '12px 20px', cursor: 'pointer', flexWrap: 'wrap',
                borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                <span style={{ display: 'inline-block', width: 14, color: 'var(--text-muted)' }}>{isCollapsed ? '▸' : '▾'}</span>
                {s.subcontractor_name}
                <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 12, color: 'var(--text-muted)' }}>
                  {s.trucks.length} truck{s.trucks.length === 1 ? '' : 's'} · {s.totals.loads} load{s.totals.loads === 1 ? '' : 's'}
                </span>
              </span>
              <span style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
                <span><span style={{ color: 'var(--text-muted)' }}>Tonnes: </span><b>{fmtT(s.totals.tonnes)}</b></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Invoiced: </span><b>{fmtR(s.totals.invoiced_excl)}</b></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Payout: </span><b style={{ color: '#16a34a' }}>{fmtR(s.totals.payout_excl)}</b></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Admin fee: </span><b>{fmtR(s.totals.admin_fee)}</b></span>
              </span>
            </div>

            {!isCollapsed && (
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Mine</th>
                      <th style={styles.th}>Slip #</th>
                      <th style={styles.th}>Driver</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Tonnes</th>
                      <th style={{ ...styles.th, textAlign: 'right', borderLeft: '2px solid var(--border)' }}>Rate</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Invoiced Excl</th>
                      <th style={{ ...styles.th, textAlign: 'right', borderLeft: '2px solid var(--border)', color: '#16a34a' }}>Sub Rate</th>
                      <th style={{ ...styles.th, textAlign: 'right', color: '#16a34a' }}>Payout Excl</th>
                      <th style={{ ...styles.th, textAlign: 'right', color: '#16a34a' }}>Payout Incl</th>
                      <th style={{ ...styles.th, textAlign: 'right', borderLeft: '2px solid var(--border)' }}>Admin Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.trucks.map(t => (
                      <Fragment key={t.truck_id}>
                        <tr>
                          <td colSpan={COLS} style={{
                            ...styles.td, fontWeight: 800, fontSize: 11, textTransform: 'uppercase',
                            letterSpacing: '0.05em', color: 'var(--text-muted)', background: 'var(--bg-surface)',
                          }}>
                            {t.fleet_number ? `${t.fleet_number} — ` : ''}{t.truck_registration} ({t.totals.loads})
                          </td>
                        </tr>
                        {t.loads.map(l => (
                          <tr key={l.load_id} style={styles.row}>
                            <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{fmtDate(l.load_date)}</td>
                            <td style={{ ...styles.td, fontWeight: 600 }}>{l.mine_name || '—'}</td>
                            <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                              {l.slip_number || '—'}
                              {l.is_split_load && <span style={badge}>SPLIT</span>}
                              {l.is_projection && <span style={{ ...badge, background: 'rgba(234,179,8,0.15)', color: '#92400e' }}>PROJ</span>}
                            </td>
                            <td style={{ ...styles.td, color: 'var(--text-muted)' }}>{l.driver_name || '—'}</td>
                            <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtT(l.tonnes)}</td>
                            <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', borderLeft: '2px solid var(--border)' }}>{fmtR(l.rate_per_ton)}</td>
                            <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(l.invoiced_excl)}</td>
                            <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', borderLeft: '2px solid var(--border)' }}>{fmtR(l.subcontractor_rate)}</td>
                            <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', color: '#16a34a' }}>{fmtR(l.payout_excl)}</td>
                            <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', color: '#16a34a' }}>{fmtR(l.payout_incl)}</td>
                            <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', borderLeft: '2px solid var(--border)' }}>{fmtR(l.admin_fee)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--bg-surface)' }}>
                          <td style={{ ...styles.td, fontWeight: 700, fontSize: 12 }} colSpan={4}>{t.truck_registration} total</td>
                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtT(t.totals.tonnes)}</td>
                          <td style={{ ...styles.td, borderLeft: '2px solid var(--border)' }}></td>
                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(t.totals.invoiced_excl)}</td>
                          <td style={{ ...styles.td, borderLeft: '2px solid var(--border)' }}></td>
                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: '#16a34a' }}>{fmtR(t.totals.payout_excl)}</td>
                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: '#16a34a' }}>{fmtR(t.totals.payout_incl)}</td>
                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', borderLeft: '2px solid var(--border)' }}>{fmtR(t.totals.admin_fee)}</td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={styles.totalRow}>
                      <td style={{ ...styles.td, fontWeight: 700 }} colSpan={4}>{s.subcontractor_name.toUpperCase()} TOTAL</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtT(s.totals.tonnes)}</td>
                      <td style={{ ...styles.td, borderLeft: '2px solid var(--border)' }}></td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtR(s.totals.invoiced_excl)}</td>
                      <td style={{ ...styles.td, borderLeft: '2px solid var(--border)' }}></td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', color: '#16a34a' }}>{fmtR(s.totals.payout_excl)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', color: '#16a34a' }}>{fmtR(s.totals.payout_incl)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', borderLeft: '2px solid var(--border)' }}>{fmtR(s.totals.admin_fee)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const badge = {
  marginLeft: 6, padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700,
  fontFamily: 'inherit', letterSpacing: '0.04em',
  background: 'var(--bg-hover)', color: 'var(--text-muted)',
}

const styles = {
  page: { padding: 'var(--page-pad)', flex: 1 },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 24,
  },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: 13, color: 'var(--text-muted)', marginTop: 4 },
  tabBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid var(--border)', marginBottom: 16,
  },
  tabs: { display: 'flex', gap: 4 },
  tab: {
    padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', borderBottom: '2px solid transparent',
    marginBottom: -1, transition: 'all 0.12s',
  },
  tabActive: { color: 'var(--accent)', fontWeight: 700, borderBottom: '2px solid var(--accent)' },
  filters: { display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 8 },
  select: {
    padding: '6px 10px', background: 'var(--bg-card)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, width: 'auto',
  },
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' },
  empty: { textAlign: 'center', color: 'var(--text-muted)', padding: 60, fontSize: 14 },
  reconNote: {
    background: 'rgba(234,179,8,0.1)', borderBottom: '1px solid rgba(234,179,8,0.25)',
    padding: '10px 16px', fontSize: 12, fontWeight: 600, color: '#92400e',
    letterSpacing: '0.04em',
  },
  annualTitle: {
    padding: '12px 16px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
    background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)',
  },
  row: { borderBottom: '1px solid var(--border)' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-secondary)' },
  totalRow: {
    borderTop: '2px solid var(--border)', background: 'var(--bg-hover)',
  },
  btnSecondary: {
    padding: '8px 16px', background: 'var(--bg-hover)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
}
