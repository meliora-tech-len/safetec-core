import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import SortableHeader, { applySort } from '../components/SortableHeader'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import { useLocalState } from '../hooks/useLocalState'
import {
  getDieselReportByTruck, getDieselReportBySupplier, getDieselAnnualSummary,
  getIncomeExpensesReport, getSarsVatDetail, getSarsVatDetailAnnual,
  getSubcontractorLoadsReport, getSupplierSummaryReport, downloadSupplierSummaryExcel, getPoLoadReconciliationReport, lookupPoLoadSlip,
  createReportExclusion, deleteReportExclusion,
  getProfitSheetReport, saveProfitSheetReport, setProfitSheetLock,
} from '../services/api'
import { errorMessage } from '../utils/helpers'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

import { MONTHS_SHORT_0 as MONTHS } from '../utils/helpers'
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: MONTHS[i] }))

const fmtR = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtL = (n) => `${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`
const fmtN = (n, d = 2) => Number(n || 0).toFixed(d)

const TABS = [
  { key: 'income',   label: 'Income vs Expenses' },
  { key: 'profit',   label: 'Profit Sheet' },
  { key: 'subloads', label: 'Subcontractor Loads' },
  { key: 'supsummary', label: 'Supplier Summary' },
  { key: 'poloads',  label: 'Invoiced PO vs Loads' },
  { key: 'truck',    label: 'Diesel by Truck' },
  { key: 'supplier', label: 'Diesel by Supplier' },
  { key: 'annual',   label: 'Diesel Annual' },
]

const fmtT = (n) => `${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`

// ── Profit Sheet value resolution ─────────────────────────────────────────────
// One line carries both the calculated figure (`auto`) and whatever the user
// typed over it (`overrides`). The override wins when it holds anything; an
// emptied input falls straight back to the calculated figure. The two derived
// columns are computed from the RESOLVED values rather than stored, so they stay
// correct while she is still typing in the columns they depend on.
const psBlank = (v) => v === null || v === undefined || v === ''
const psNum   = (v) => (psBlank(v) ? 0 : Number(v) || 0)

const psValue = (r, key) => {
  const ov = r.overrides || {}, auto = r.auto || {}
  switch (key) {
    case 'reg_no': return psBlank(ov.reg_no) ? (auto.reg_no || '') : ov.reg_no
    case 'driver': return psBlank(ov.driver) ? (auto.driver || '') : ov.driver
    case 'diesel': return psBlank(ov.diesel) ? psNum(auto.diesel) : psNum(ov.diesel)
    case 'loads':  return psBlank(ov.loads)  ? psNum(auto.loads)  : psNum(ov.loads)
    case 'profit': return psBlank(ov.profit) ? psNum(auto.profit) : psNum(ov.profit)
    case 'sand':   return psNum(ov.sand_loads_incl_vat)
    case 'diesel_avg': {
      if (!psBlank(ov.diesel_avg_per_load)) return psNum(ov.diesel_avg_per_load)
      const loads = psValue(r, 'loads')
      return loads ? psValue(r, 'diesel') / loads : 0
    }
    case 'profit_ex_sand': {
      if (!psBlank(ov.profit_excl_sand)) return psNum(ov.profit_excl_sand)
      return psValue(r, 'profit') - psValue(r, 'sand')
    }
    default: return ''
  }
}

const psTotals = (rows) => rows.reduce((a, r) => ({
  diesel:         a.diesel + psValue(r, 'diesel'),
  loads:          a.loads + psValue(r, 'loads'),
  profit:         a.profit + psValue(r, 'profit'),
  sand:           a.sand + psValue(r, 'sand'),
  profit_ex_sand: a.profit_ex_sand + psValue(r, 'profit_ex_sand'),
}), { diesel: 0, loads: 0, profit: 0, sand: 0, profit_ex_sand: 0 })

const PS_HEADERS = ['Reg No', 'Driver', 'Diesel', 'Diesel Average P/L', 'Loads on Truck',
                    'Profit', 'Sand Loads (Incl VAT)', 'Profit Excl Sand', 'Notes']

// Header label → the resolved value it sorts on, so the numeric columns compare
// as numbers instead of as the text in the input.
const PS_SORT_KEYS = {
  'Reg No': 'reg_no', 'Driver': 'driver', 'Diesel': 'diesel',
  'Diesel Average P/L': 'diesel_avg', 'Loads on Truck': 'loads', 'Profit': 'profit',
  'Sand Loads (Incl VAT)': 'sand', 'Profit Excl Sand': 'profit_ex_sand',
}
const psSortValue = (r, label) =>
  label === 'Notes' ? (r.notes || '') : psValue(r, PS_SORT_KEYS[label])

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
  const [supSumData, setSupSumData]   = useState(null)
  const [poData, setPoData]           = useState(null)

  // Profit Sheet is the one editable report — its rows live here (not in the
  // child) so the export handlers write exactly what is on screen, unsaved
  // edits included.
  const [profitRows, setProfitRows]   = useState(null)
  const [profitDirty, setProfitDirty] = useState(false)
  const [profitSaving, setProfitSaving] = useState(false)
  // Final lock state for the loaded entity-month ({locked, locked_at, locked_by_name}).
  const [profitLock, setProfitLock]   = useState(null)
  const [profitLockSaving, setProfitLockSaving] = useState(false)
  // Sorting is a view on the same rows — it never rewrites the saved order, but
  // the exports do follow it, since they print what is on screen. The order is
  // frozen as a list of row keys when a header is clicked rather than recomputed
  // from the values: on an editable table, re-sorting every keystroke would make
  // the line jump out from under the cursor while she is typing into it.
  const [profitSort, setProfitSort]   = useLocalState('sort:reports.profit-sheet', { col: null, dir: 'asc' })
  const [profitOrder, setProfitOrder] = useState(null)
  const [showHiddenProfit, setShowHiddenProfit] = useState(false)

  const profitVisible = useMemo(() => {
    const visible = (profitRows || []).filter(r => !r.is_hidden)
    if (!profitOrder) return visible
    const pos = new Map(profitOrder.map((k, i) => [k, i]))
    // A row the frozen order has never seen (just added or restored) sits last.
    return [...visible].sort((a, b) => (pos.get(a.key) ?? Infinity) - (pos.get(b.key) ?? Infinity))
  }, [profitRows, profitOrder])

  const profitHidden = useMemo(() => (profitRows || []).filter(r => r.is_hidden), [profitRows])

  // The frozen order is per-fetch, the sort choice is remembered — so when a
  // fresh set of rows lands, re-freeze it under the remembered sort. Without
  // this the header would show an arrow over rows in their saved order.
  useEffect(() => {
    if (!profitRows || profitOrder || !profitSort.col) return
    setProfitOrder(applySort(profitVisible, profitSort, psSortValue).map(r => r.key))
  }, [profitRows])

  const onProfitSort = useCallback((col) => {
    const next = { col, dir: profitSort.col === col && profitSort.dir === 'asc' ? 'desc' : 'asc' }
    setProfitSort(next)
    setProfitOrder(applySort(profitVisible, next, psSortValue).map(r => r.key))
  }, [profitSort, profitVisible])

  // Which month's drill-down is open — needed to refetch it after an exclusion.
  const detailMonthRef = useRef(null)

  const loadDetail = useCallback(async (m) => {
    if (!entityId) return
    setLoading(true)
    setDetailData(null)
    detailMonthRef.current = m
    try {
      const res = await getSarsVatDetail({ entity_id: entityId, year, month: m })
      setDetailData(res.data)
    } catch {
      toast.error('Failed to load detail')
    } finally {
      setLoading(false)
    }
  }, [entityId, year])

  // Remove a row from the report / put it back. Report-only: the invoice itself is
  // untouched, so this is always reversible. Refresh the detail AND the annual
  // figures behind it, since the totals there change too.
  const toggleExclusion = useCallback(async (row, restore) => {
    try {
      if (restore) {
        await deleteReportExclusion(row.record_type, row.record_id)
      } else {
        await createReportExclusion({ record_type: row.record_type, record_id: row.record_id })
      }
      const [detail, annual] = await Promise.all([
        getSarsVatDetail({ entity_id: entityId, year, month: detailMonthRef.current }),
        getIncomeExpensesReport({ entity_id: entityId, year }),
      ])
      setDetailData(detail.data)
      setIncomeData(annual.data)
      toast.success(restore ? 'Restored to the report' : 'Removed from the report')
    } catch (err) {
      toast.error(errorMessage(err, restore ? 'Failed to restore' : 'Failed to remove'))
    }
  }, [entityId, year])

  const load = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setDieselData([])
    setIncomeData(null)
    setDetailData(null)
    setSubData(null)
    setSupSumData(null)
    setPoData(null)
    setProfitRows(null)
    setProfitDirty(false)
    setShowHiddenProfit(false)
    setProfitOrder(null)
    setProfitLock(null)
    try {
      if (tab === 'income') {
        const res = await getIncomeExpensesReport({ entity_id: entityId, year })
        setIncomeData(res.data)
      } else if (tab === 'profit') {
        const res = await getProfitSheetReport({ entity_id: entityId, year, month })
        setProfitRows(res.data.rows.map(r => ({ ...r, key: r.truck_id ?? `custom-${crypto.randomUUID()}` })))
        setProfitLock(res.data.lock || null)
      } else if (tab === 'subloads') {
        const res = await getSubcontractorLoadsReport({ entity_id: entityId, year, month })
        setSubData(res.data)
      } else if (tab === 'supsummary') {
        const res = await getSupplierSummaryReport({ entity_id: entityId, year, month })
        setSupSumData(res.data)
      } else if (tab === 'poloads') {
        const res = await getPoLoadReconciliationReport({ entity_id: entityId, year, month })
        setPoData(res.data)
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
    } else if (tab === 'supsummary') {
      if (!supSumData?.suppliers?.length) return
      // Summary per supplier, then every invoice behind each supplier's total.
      const q = (v) => `"${v ?? ''}"`
      const lines = [
        ['Supplier', 'Invoices', 'Excl VAT', 'VAT', 'Incl VAT'].map(q).join(','),
        ...supSumData.suppliers.map(s => [
          s.supplier_name, s.count, s.amount_excl, s.vat, s.amount_incl,
        ].map(q).join(',')),
        ['TOTAL', supSumData.totals.count, supSumData.totals.amount_excl,
         supSumData.totals.vat, supSumData.totals.amount_incl].map(q).join(','),
        '',
        ['Supplier', 'Date', 'Invoice #', 'Description', 'Excl VAT', 'VAT', 'Incl VAT'].map(q).join(','),
        ...supSumData.suppliers.flatMap(s => (s.invoices || []).map(i => [
          s.supplier_name, i.date, i.invoice_number, i.description,
          i.amount_excl, i.vat, i.amount_incl,
        ].map(q).join(','))),
      ]
      const csv = lines.join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `supplier-summary-${year}-${String(month).padStart(2, '0')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } else if (tab === 'supplier') {
      if (!dieselData.length) return
      // Summary per supplier, then every fill-up behind each supplier's total.
      const q = (v) => `"${v ?? ''}"`
      const lines = [
        ['Supplier', 'Logs', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Fee VAT', 'Grand Total'].map(q).join(','),
        ...dieselData.map(r => [
          r.supplier_name, r.fillup_count, r.total_litres, r.total_amount,
          r.total_admin_fee, r.total_admin_fee_vat, r.grand_total,
        ].map(q).join(',')),
        '',
        ['Supplier', 'Date', 'Truck', 'Slip #', 'Trans ID', 'Invoice #', 'Litres', 'Rate (R/L)', 'Excl. Fee', 'Admin Fee', 'Fee VAT', 'Total', 'Verified'].map(q).join(','),
        ...dieselData.flatMap(r => (r.fillups || []).map(f => [
          r.supplier_name, f.fillup_date, f.truck_registration, f.slip_number, f.trans_id,
          f.invoice_number, f.litres, f.rate_per_litre, f.amount, f.admin_fee_amount,
          f.admin_fee_vat, f.total_amount, f.verified ? 'Yes' : 'No',
        ].map(q).join(','))),
      ]
      const csv = lines.join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `diesel-supplier-${year}-${String(month).padStart(2, '0')}.csv`
      a.click()
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
        ...output_invoices.filter(r => r.category === g.key && !r.excluded).map(r => [fmtDate(r.date), r.description, r.amount_incl, r.amount_excl, r.vat]),
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
        ...input_invoices.filter(r => r.category === g.key && !r.excluded).map(r => [
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
          ...output_invoices.filter(r => r.category === g.key && !r.excluded).map(r => [fmtDate(r.date), r.description, fmtAmt(r.amount_incl), fmtAmt(r.amount_excl), fmtAmt(r.vat)]),
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
          ...input_invoices.filter(r => r.category === g.key && !r.excluded).map(r => [
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
        m.input_invoices.filter(r => !r.excluded).forEach(r => expRows.push([m.month_name, fmtDate(r.date), r.invoice_number || '', r.supplier_name || '', r.description || '', r.amount_incl, r.amount_excl, r.vat_applicable ? r.vat : 'Non-VAT']))
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
            ...m.output_invoices.filter(r => !r.excluded).map(r => [fmtDate(r.date), r.description, fmtAmt(r.amount_incl), fmtAmt(r.amount_excl), fmtAmt(r.vat)]),
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
            ...m.input_invoices.filter(r => !r.excluded).map(r => [fmtDate(r.date), r.invoice_number || '', r.supplier_name || '', r.description || '', fmtAmt(r.amount_incl), fmtAmt(r.amount_excl), r.vat_applicable ? fmtAmt(r.vat) : 'Non-VAT']),
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

  // ── Invoiced PO vs Loads export ─────────────────────────────────────────────
  const PO_ISSUE_LABEL = {
    no_load: 'No matching load',
    reg:     'Truck differs',
    tonnes:  'Tonnes differ',
    amount:  'Amount differs',
    period:  'Load in another period',
  }
  const poIssueText = (issues) => (issues || []).map(i => PO_ISSUE_LABEL[i] || i).join(', ')

  const handlePoExportExcel = () => {
    if (!poData) return
    setShowExportMenu(false)
    const { month_name, pos = [], uninvoiced = [], totals, uninvoiced_totals } = poData
    const title   = `Invoiced PO vs Truck Loads — ${month_name} ${year}`
    const now     = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
    const wb      = XLSX.utils.book_new()

    // Sheet 1: one row per PO → truck, invoiced against loads
    const ws1 = XLSX.utils.aoa_to_sheet([
      [title], [`Generated: ${now}`], [],
      ['PO Number', 'Invoice(s)', 'Registration', 'Invoiced Loads', 'Invoiced Tonnes', 'Invoiced Excl VAT', 'Invoiced Incl VAT',
       'Load Count', 'Load Tonnes', 'Load Amount', 'Diff Loads', 'Diff Tonnes', 'Diff Amount', 'Issues'],
      ...pos.flatMap(p => [
        ...p.trucks.map(t => [
          p.po_number, p.invoices.map(i => i.invoice_number).join(', '), t.registration,
          t.totals.invoiced_loads, t.totals.invoiced_tonnes, t.totals.invoiced_amount, t.totals.invoiced_amount_incl,
          t.totals.load_loads, t.totals.load_tonnes, t.totals.load_amount,
          t.totals.diff_loads, t.totals.diff_tonnes, t.totals.diff_amount,
          t.issue_count ? `${t.issue_count} line(s)` : '',
        ]),
        [`${p.po_number} TOTAL`, '', '', p.totals.invoiced_loads, p.totals.invoiced_tonnes, p.totals.invoiced_amount, p.totals.invoiced_amount_incl,
         p.totals.load_loads, p.totals.load_tonnes, p.totals.load_amount,
         p.totals.diff_loads, p.totals.diff_tonnes, p.totals.diff_amount, ''],
        [],
      ]),
      ['GRAND TOTAL', '', '', totals.invoiced_loads, totals.invoiced_tonnes, totals.invoiced_amount, totals.invoiced_amount_incl,
       totals.load_loads, totals.load_tonnes, totals.load_amount,
       totals.diff_loads, totals.diff_tonnes, totals.diff_amount, ''],
    ])
    ws1['!cols'] = [{ wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 13 }, { wch: 14 }, { wch: 16 }, { wch: 16 },
                    { wch: 11 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 11 }, { wch: 14 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary')

    // Sheet 2: every invoice line beside the load it matched
    const ws2 = XLSX.utils.aoa_to_sheet([
      [title], [`Generated: ${now}`], [],
      ['PO Number', 'Invoice', 'Registration', 'Slip #', 'Invoiced Reg', 'Invoiced Tonnes', 'Invoiced Rate', 'Invoiced Amount',
       'Load Date', 'Load Reg', 'Load Tonnes', 'Load Rate', 'Load Amount', 'Load Period', 'Issues'],
      ...pos.flatMap(p => p.trucks.flatMap(t => t.lines.map(l => [
        p.po_number, l.invoice_number, t.registration, l.slip_number || '',
        l.invoiced_registration || '', l.invoiced_tonnes, l.invoiced_rate, l.invoiced_amount,
        fmtDate(l.load_date), l.load_registration || '', l.load_tonnes || '', l.load_rate || '', l.load_amount || '',
        l.load_period || '', poIssueText(l.issues),
      ]))),
    ])
    ws2['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 14 }, { wch: 12 }, { wch: 15 },
                    { wch: 13 }, { wch: 12 }, { wch: 11 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 30 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Line Detail')

    // Sheet 3: loads in the period that no invoice bills
    const ws3 = XLSX.utils.aoa_to_sheet([
      [`${title} — Loads Not Invoiced`], [`Generated: ${now}`], [],
      ['Registration', 'Fleet #', 'Date', 'Slip #', 'Mine', 'Driver', 'Tonnes', 'Rate', 'Amount'],
      ...uninvoiced.flatMap(g => [
        ...g.loads.map(l => [
          g.registration, g.fleet_number || '', fmtDate(l.load_date), l.slip_number || '',
          l.mine_name || '', l.driver_name || '', l.load_tonnes, l.load_rate, l.load_amount,
        ]),
        [`${g.registration} TOTAL`, '', '', '', '', '', g.totals.load_tonnes, '', g.totals.load_amount],
        [],
      ]),
      ['GRAND TOTAL', '', '', '', '', '', uninvoiced_totals.load_tonnes, '', uninvoiced_totals.load_amount],
    ])
    ws3['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws3, 'Not Invoiced')

    XLSX.writeFile(wb, `invoiced-po-vs-loads-${year}-${String(month).padStart(2, '0')}.xlsx`)
  }

  const handlePoExportPdf = () => {
    if (!poData) return
    setShowExportMenu(false)
    const { month_name, pos = [], uninvoiced = [], totals, uninvoiced_totals, issue_count } = poData
    const title   = `Invoiced PO vs Truck Loads — ${month_name} ${year}`
    const now     = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
    const fmtAmt  = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : '—'
    const doc     = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text(title, 14, 15)
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
    doc.text(`Generated ${now}  ·  ${pos.length} PO(s)  ·  ${issue_count} line(s) needing attention`, 14, 21)
    doc.setTextColor(0)

    autoTable(doc, {
      head: [['PO Number', 'Registration', 'Inv Loads', 'Inv Tonnes', 'Excl VAT', 'Incl VAT',
              'Loads', 'Load Tonnes', 'Load Amount', 'Diff Amount', 'Issues']],
      body: [
        ...pos.flatMap(p => [
          ...p.trucks.map((t, i) => [
            i === 0 ? p.po_number : '', t.registration,
            t.totals.invoiced_loads, fmtT(t.totals.invoiced_tonnes), fmtAmt(t.totals.invoiced_amount), fmtAmt(t.totals.invoiced_amount_incl),
            t.totals.load_loads, fmtT(t.totals.load_tonnes), fmtAmt(t.totals.load_amount),
            fmtAmt(t.totals.diff_amount), t.issue_count || '',
          ]),
          [`${p.po_number} subtotal`, '', p.totals.invoiced_loads, fmtT(p.totals.invoiced_tonnes), fmtAmt(p.totals.invoiced_amount),
           fmtAmt(p.totals.invoiced_amount_incl),
           p.totals.load_loads, fmtT(p.totals.load_tonnes), fmtAmt(p.totals.load_amount), fmtAmt(p.totals.diff_amount), ''],
        ]),
        ['GRAND TOTAL', '', totals.invoiced_loads, fmtT(totals.invoiced_tonnes), fmtAmt(totals.invoiced_amount),
         fmtAmt(totals.invoiced_amount_incl),
         totals.load_loads, fmtT(totals.load_tonnes), fmtAmt(totals.load_amount), fmtAmt(totals.diff_amount), ''],
      ],
      startY: 26,
      styles: { fontSize: 7.5, cellPadding: 1.8 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 38 }, 1: { cellWidth: 22 },
        2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
        8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' },
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

    // Only the lines that disagree — the part that needs working through
    const problem = pos.flatMap(p => p.trucks.flatMap(t =>
      t.lines.filter(l => l.issues.length).map(l => [
        p.po_number, l.invoice_number, t.registration, l.slip_number || '—',
        fmtT(l.invoiced_tonnes), fmtAmt(l.invoiced_amount),
        l.load_id ? fmtDate(l.load_date) : '—',
        l.load_id ? fmtT(l.load_tonnes) : '—',
        l.load_id ? fmtAmt(l.load_amount) : '—',
        poIssueText(l.issues),
      ])))
    if (problem.length) {
      doc.addPage()
      doc.setFontSize(12); doc.setFont('helvetica', 'bold')
      doc.text(`Discrepancies — ${month_name} ${year}`, 14, 14)
      autoTable(doc, {
        head: [['PO Number', 'Invoice', 'Registration', 'Slip #', 'Inv Tonnes', 'Inv Amount',
                'Load Date', 'Load Tonnes', 'Load Amount', 'Issue']],
        body: problem,
        startY: 20,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [185, 28, 28], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 38 }, 1: { cellWidth: 20 }, 2: { cellWidth: 22 }, 3: { cellWidth: 20 },
          4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
          7: { halign: 'right' }, 8: { halign: 'right' }, 9: { cellWidth: 40 },
        },
        margin: { left: 14, right: 14 },
      })
    }

    if (uninvoiced.length) {
      doc.addPage()
      doc.setFontSize(12); doc.setFont('helvetica', 'bold')
      doc.text(`Loads Not Invoiced — ${month_name} ${year}`, 14, 14)
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
      doc.text(`${uninvoiced_totals.load_loads} load(s) · ${fmtT(uninvoiced_totals.load_tonnes)} · ${fmtAmt(uninvoiced_totals.load_amount)}`, 14, 19)
      doc.setTextColor(0)
      autoTable(doc, {
        head: [['Registration', 'Fleet #', 'Date', 'Slip #', 'Mine', 'Driver', 'Tonnes', 'Rate', 'Amount']],
        body: [
          ...uninvoiced.flatMap(g => [
            ...g.loads.map((l, i) => [
              i === 0 ? g.registration : '', i === 0 ? (g.fleet_number || '—') : '',
              fmtDate(l.load_date), l.slip_number || '—', l.mine_name || '—', l.driver_name || '—',
              fmtT(l.load_tonnes), fmtAmt(l.load_rate), fmtAmt(l.load_amount),
            ]),
          ]),
          ['GRAND TOTAL', '', '', '', '', '', fmtT(uninvoiced_totals.load_tonnes), '', fmtAmt(uninvoiced_totals.load_amount)],
        ],
        startY: 23,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [180, 83, 9], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 24 }, 1: { cellWidth: 16 }, 2: { cellWidth: 18 }, 3: { cellWidth: 22 },
          4: { cellWidth: 30 }, 5: { cellWidth: 30 },
          6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
        },
        didParseCell: (d) => {
          if (d.section === 'body' && String(d.row.raw?.[0] ?? '') === 'GRAND TOTAL') {
            d.cell.styles.fontStyle = 'bold'
            d.cell.styles.fillColor = [225, 225, 225]
          }
        },
        margin: { left: 14, right: 14 },
      })
    }

    doc.save(`invoiced-po-vs-loads-${year}-${String(month).padStart(2, '0')}.pdf`)
  }

  // ── Profit Sheet: edit / save / export ──────────────────────────────────────
  const updateProfitRow = useCallback((key, patch) => {
    setProfitRows(rows => rows.map(r => r.key === key
      ? { ...r, ...patch, overrides: { ...r.overrides, ...(patch.overrides || {}) } }
      : r))
    setProfitDirty(true)
  }, [])

  const addProfitRow = useCallback(() => {
    setProfitRows(rows => [...(rows || []), {
      key: `custom-${crypto.randomUUID()}`, truck_id: null, is_custom: true,
      sort_order: (rows?.length ?? 0) + 1000, notes: '',
      auto: {}, overrides: {},
    }])
    setProfitDirty(true)
  }, [])

  // A hand-added line has no calculated source, so deleting it just drops it. A
  // truck line would be rebuilt from live data on the next load, so it is
  // flagged hidden instead — off the table, the totals and the exports, but
  // listed under the table so it can be put back.
  const removeProfitRow = useCallback((key) => {
    setProfitRows(rows => rows.flatMap(r =>
      r.key !== key ? [r] : (r.is_custom ? [] : [{ ...r, is_hidden: true }])))
    setProfitDirty(true)
  }, [])

  const restoreProfitRow = useCallback((key) => {
    setProfitRows(rows => rows.map(r => r.key === key ? { ...r, is_hidden: false } : r))
    setProfitDirty(true)
  }, [])

  const saveProfitSheet = useCallback(async () => {
    if (!profitRows || !entityId) return
    setProfitSaving(true)
    try {
      const payload = {
        rows: profitRows.map((r, i) => ({
          truck_id: r.truck_id ?? null,
          sort_order: i,
          is_hidden: !!r.is_hidden,
          notes: r.notes || null,
          // Blank inputs are sent as null so the server drops the override and
          // the column goes back to tracking the calculated figure.
          overrides: Object.fromEntries(
            Object.entries(r.overrides || {}).map(([k, v]) => [k, psBlank(v) ? null : v])
          ),
        })),
      }
      const res = await saveProfitSheetReport({ entity_id: entityId, year, month }, payload)
      setProfitRows(res.data.rows.map(r => ({ ...r, key: r.truck_id ?? `custom-${crypto.randomUUID()}` })))
      setProfitLock(res.data.lock || null)
      setProfitDirty(false)
      toast.success('Profit sheet report saved')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save the report'))
    } finally {
      setProfitSaving(false)
    }
  }, [profitRows, entityId, year, month])

  // Final lock (admin only): freezes the sheet AND all capture for its regs
  // this month — truck loads, food allowance, diesel, supplier invoices.
  const toggleProfitLock = useCallback(async () => {
    const locking = !profitLock?.locked
    const label = `${MONTHS[month - 1]} ${year}`
    const msg = locking
      ? `Final lock the Profit Sheet for ${label}?\n\nNothing more can be captured or changed for ANY of its regs under this month — truck loads, food allowance, diesel and supplier invoices are all frozen until the lock is removed.`
      : `Remove the final lock on the Profit Sheet for ${label}?\n\nCapture for its regs opens up again.`
    if (!window.confirm(msg)) return
    setProfitLockSaving(true)
    try {
      const res = await setProfitSheetLock({ entity_id: entityId, year, month }, locking)
      setProfitLock(res.data)
      toast.success(locking ? 'Profit Sheet final locked' : 'Final lock removed')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to change the final lock'))
    } finally {
      setProfitLockSaving(false)
    }
  }, [profitLock, entityId, year, month])

  const profitTitle = `Profit Sheet — ${MONTHS[month - 1]} ${year}`
  const profitSlug  = `profit-sheet-${year}-${String(month).padStart(2, '0')}`

  // Exports print exactly what is on screen: deleted lines are out, and the rows
  // come through in whatever order the headers are sorted by.
  const handleProfitExportExcel = () => {
    if (!profitVisible.length) return
    setShowExportMenu(false)
    const t   = psTotals(profitVisible)
    const now = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })
    const ws  = XLSX.utils.aoa_to_sheet([
      [profitTitle], [`Generated: ${now}`], [],
      PS_HEADERS,
      ...profitVisible.map(r => [
        psValue(r, 'reg_no'), psValue(r, 'driver'),
        psValue(r, 'diesel'), psValue(r, 'diesel_avg'), psValue(r, 'loads'),
        psValue(r, 'profit'), psValue(r, 'sand'), psValue(r, 'profit_ex_sand'),
        r.notes || '',
      ]),
      [],
      ['TOTAL', '', t.diesel, '', t.loads, t.profit, t.sand, t.profit_ex_sand, ''],
    ])
    ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 15 },
                   { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 70 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Profit Sheet')
    XLSX.writeFile(wb, `${profitSlug}.xlsx`)
  }

  const handleProfitExportPdf = () => {
    if (!profitVisible.length) return
    setShowExportMenu(false)
    const t   = psTotals(profitVisible)
    const now = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text(profitTitle, 14, 15)
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
    doc.text(`Generated ${now}`, 14, 21)
    doc.setTextColor(0)

    autoTable(doc, {
      head: [PS_HEADERS],
      body: [
        ...profitVisible.map(r => [
          psValue(r, 'reg_no'), psValue(r, 'driver'),
          fmtN(psValue(r, 'diesel')), fmtN(psValue(r, 'diesel_avg')),
          String(psValue(r, 'loads')),
          fmtN(psValue(r, 'profit')),
          psValue(r, 'sand') ? fmtN(psValue(r, 'sand')) : '',
          fmtN(psValue(r, 'profit_ex_sand')),
          r.notes || '',
        ]),
        ['TOTAL', '', fmtN(t.diesel), '', String(t.loads), fmtN(t.profit), fmtN(t.sand), fmtN(t.profit_ex_sand), ''],
      ],
      startY: 26,
      styles: { fontSize: 7, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 20, fontStyle: 'bold' }, 1: { cellWidth: 24 },
        2: { cellWidth: 22, halign: 'right' }, 3: { cellWidth: 24, halign: 'right' },
        4: { cellWidth: 18, halign: 'center' }, 5: { cellWidth: 24, halign: 'right' },
        6: { cellWidth: 24, halign: 'right' },
        7: { cellWidth: 24, halign: 'right', fontStyle: 'bold', fillColor: [255, 249, 196] },
        8: { cellWidth: 'auto' },
      },
      didParseCell: (d) => {
        if (d.section !== 'body') return
        const row = profitVisible[d.row.index]
        if (!row) {                       // the TOTAL row
          d.cell.styles.fontStyle = 'bold'
          d.cell.styles.fillColor = [235, 235, 235]
          return
        }
        // A loss is called out in red, mirroring how the sheet is marked up by hand.
        if (psValue(row, 'profit') < 0 && [0, 1, 2, 3, 4, 5, 7, 8].includes(d.column.index)) {
          d.cell.styles.textColor = [220, 38, 38]
        }
      },
      margin: { left: 14, right: 14 },
    })

    doc.save(`${profitSlug}.pdf`)
  }

  // ── Supplier Summary exports ────────────────────────────────────────────────
  // Excel is generated server-side: one tab per supplier with month sections —
  // the shape of the manually-kept supplier workbook. Whole year or one month.
  const [supSumExporting, setSupSumExporting] = useState(false)
  const handleSupSumExportExcel = async (monthOnly) => {
    setShowExportMenu(false)
    if (supSumExporting) return
    setSupSumExporting(true)
    try {
      const params = { entity_id: entityId, year, ...(monthOnly ? { month } : {}) }
      const r = await downloadSupplierSummaryExcel(params)
      const url = URL.createObjectURL(new Blob([r.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }))
      const a = document.createElement('a')
      a.href = url
      a.download = `supplier-summary-${year}${monthOnly ? `-${String(month).padStart(2, '0')}` : ''}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to export'))
    } finally {
      setSupSumExporting(false)
    }
  }
  const handleSupSumExportCsv = () => {
    setShowExportMenu(false)
    exportCsv()
  }

  const hasData = tab === 'income' ? !!incomeData
    : tab === 'profit' ? profitVisible.length > 0
    : tab === 'subloads' ? !!subData?.subcontractors?.length
    : tab === 'supsummary' ? !!supSumData?.suppliers?.length
    : tab === 'poloads' ? !!(poData?.pos?.length || poData?.uninvoiced?.length)
    : dieselData.length > 0

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Reports</h1>
          <p style={styles.subtitle}>Business reports and reconciliations</p>
        </div>
        <div style={{ position: 'relative' }}>
          {tab === 'income' || tab === 'profit' || tab === 'subloads' || tab === 'poloads' || tab === 'supsummary' ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {tab === 'profit' && (
                <>
                  {profitLock?.locked && (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: '#d97706',
                      background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.35)',
                      borderRadius: 6, padding: '4px 10px', whiteSpace: 'nowrap',
                    }}
                      title={`Nothing can be captured for this month's regs — truck loads, food allowance, diesel and supplier invoices are frozen.`}
                    >
                      🔒 Final locked {profitLock.locked_at ? new Date(profitLock.locked_at).toLocaleDateString('en-ZA') : ''}
                      {profitLock.locked_by_name ? ` by ${profitLock.locked_by_name}` : ''}
                    </span>
                  )}
                  {isAdmin && profitRows && (
                    <button
                      onClick={toggleProfitLock}
                      disabled={profitLockSaving}
                      style={{ ...styles.btnSecondary, cursor: profitLockSaving ? 'default' : 'pointer' }}
                      title={profitLock?.locked
                        ? 'Reopen capture for this month'
                        : 'Freeze this month: no more truck loads, food allowance, diesel or supplier invoices for its regs'}
                    >
                      {profitLockSaving ? 'Working…' : profitLock?.locked ? 'Remove Final Lock' : 'Final Lock'}
                    </button>
                  )}
                  {profitDirty && !profitLock?.locked && <span style={{ fontSize: 12, color: '#d97706' }}>Unsaved changes</span>}
                  {!profitLock?.locked && (
                    <button
                      onClick={saveProfitSheet}
                      disabled={profitSaving || !profitDirty}
                      style={{
                        ...styles.btnSecondary,
                        background: profitDirty ? 'var(--accent)' : 'var(--bg-hover)',
                        color: profitDirty ? '#fff' : 'var(--text-primary)',
                        borderColor: profitDirty ? 'var(--accent)' : 'var(--border)',
                        cursor: profitSaving || !profitDirty ? 'default' : 'pointer',
                      }}
                    >
                      {profitSaving ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </>
              )}
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
                    {(tab === 'profit'
                      ? [{ label: 'Export Excel (.xlsx)', action: handleProfitExportExcel }, { label: 'Export PDF', action: handleProfitExportPdf }]
                      : tab === 'subloads'
                      ? [{ label: 'Export Excel (.xlsx)', action: handleSubExportExcel }, { label: 'Export PDF', action: handleSubExportPdf }]
                      : tab === 'poloads'
                      ? [{ label: 'Export Excel (.xlsx)', action: handlePoExportExcel }, { label: 'Export PDF', action: handlePoExportPdf }]
                      : tab === 'supsummary'
                      ? [{ label: supSumExporting ? 'Exporting…' : `Export Excel — ${year} workbook`, action: () => handleSupSumExportExcel(false) },
                         { label: supSumExporting ? 'Exporting…' : `Export Excel — ${MONTHS[month - 1]} ${year}`, action: () => handleSupSumExportExcel(true) },
                         { label: 'Export CSV — this month', action: handleSupSumExportCsv }]
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
            </div>
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
          ? <SarsVatDetail data={detailData} year={year} onBack={() => setDetailData(null)} onToggleExclusion={toggleExclusion} />
          : incomeData
            ? <IncomeExpensesReport data={incomeData} year={year} onViewDetail={loadDetail} />
            : <div style={{ ...styles.card, ...styles.empty }}>Select an entity to load the report.</div>
      ) : tab === 'profit' ? (
        !profitRows
          ? <div style={{ ...styles.card, ...styles.empty }}>Select an entity to load the report.</div>
          : <ProfitSheetReport
              rows={profitVisible}
              hiddenRows={profitHidden}
              showHidden={showHiddenProfit}
              onToggleHidden={() => setShowHiddenProfit(v => !v)}
              sort={profitSort}
              onSort={onProfitSort}
              onChange={updateProfitRow}
              onAddRow={addProfitRow}
              onRemoveRow={removeProfitRow}
              onRestoreRow={restoreProfitRow}
              locked={!!profitLock?.locked}
            />
      ) : tab === 'subloads' ? (
        !subData
          ? <div style={{ ...styles.card, ...styles.empty }}>Select an entity to load the report.</div>
          : subData.subcontractors.length === 0
            ? <div style={{ ...styles.card, ...styles.empty }}>No subcontractor loads for this period.</div>
            : <SubcontractorLoadsReport data={subData} year={year} />
      ) : tab === 'supsummary' ? (
        !supSumData
          ? <div style={{ ...styles.card, ...styles.empty }}>Select an entity to load the report.</div>
          : supSumData.suppliers.length === 0
            ? <div style={{ ...styles.card, ...styles.empty }}>No supplier invoices for this period.</div>
            : <SupplierSummaryReport data={supSumData} year={year} />
      ) : tab === 'poloads' ? (
        !poData
          ? <div style={{ ...styles.card, ...styles.empty }}>Select an entity to load the report.</div>
          : poData.pos.length === 0 && poData.uninvoiced.length === 0
            ? <div style={{ ...styles.card, ...styles.empty }}>No invoiced POs for this period.</div>
            : <PoLoadReconciliationReport data={poData} year={year} issueLabels={PO_ISSUE_LABEL} />
      ) : (
        <div style={styles.card}>
          {dieselData.length === 0 ? (
            <div style={styles.empty}>No data for this period.</div>
          ) : tab === 'truck' ? (
            <TruckReport data={dieselData} />
          ) : tab === 'supplier' ? (
            <SupplierReport data={dieselData} year={year} month={month} />
          ) : (
            <AnnualReport data={dieselData} year={year} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Profit Sheet (editable) ───────────────────────────────────────────────────
// Every cell is an input pre-filled with the calculated figure. Overtyping one
// stores an override; clearing it hands the cell back to the calculation, which
// is why the blur handler normalises an empty string to null rather than to 0.
// `rows` arrives already filtered and sorted; `hiddenRows` are the truck lines
// deleted off the report, listed under the table so they can be put back.
function ProfitSheetReport({
  rows, hiddenRows = [], showHidden, onToggleHidden,
  sort, onSort, onChange, onAddRow, onRemoveRow, onRestoreRow, locked = false,
}) {
  const totals = psTotals(rows)

  const setOverride = (r, field, value) => onChange(r.key, { overrides: { [field]: value } })

  // `null`/`undefined` means untouched → show the calculated figure. An empty
  // string means she is mid-edit and cleared it → leave it empty until blur.
  const shown = (r, field, autoText) => {
    const ov = r.overrides?.[field]
    return ov === null || ov === undefined ? autoText : ov
  }

  // Called as a plain function, NOT rendered as <Cell/> — a component declared
  // inside the render would get a fresh identity every keystroke, remounting the
  // input and dropping focus after a single character.
  const cell = ({ r, field, autoText, type = 'number', align = 'right', tint, bold }) => {
    const overridden = !psBlank(r.overrides?.[field])
    return (
      <input
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        value={shown(r, field, autoText)}
        readOnly={locked}
        onChange={e => !locked && setOverride(r, field, e.target.value)}
        onFocus={e => { if (!locked) e.target.style.borderColor = 'var(--accent)' }}
        onBlur={e => {
          e.target.style.borderColor = 'transparent'
          if (!locked && e.target.value === '') setOverride(r, field, null)
        }}
        style={{
          width: '100%', minWidth: type === 'number' ? 86 : 96,
          padding: '5px 7px', fontSize: 12.5, textAlign: align,
          fontWeight: bold ? 700 : 500,
          color: 'var(--text-primary)',
          background: overridden ? 'rgba(234,179,8,0.14)' : (tint || 'transparent'),
          border: '1px solid transparent', borderRadius: 4, outline: 'none',
        }}
        title={overridden ? `Edited — clear the cell to go back to ${autoText || '—'}` : undefined}
      />
    )
  }

  return (
    <div style={styles.card}>
      {locked ? (
        <div style={{ ...styles.reconNote, background: 'rgba(217,119,6,0.10)', borderBottom: '1px solid rgba(217,119,6,0.3)', color: 'var(--text-secondary)', fontWeight: 500 }}>
          🔒 This month is final locked. The totals are frozen, and nothing can be captured for
          these regs under this month — truck loads, food allowance, diesel and supplier invoices
          all refuse new records until an admin removes the lock.
        </div>
      ) : (
        <div style={{ ...styles.reconNote, background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid rgba(59,130,246,0.25)', color: 'var(--text-secondary)', fontWeight: 500 }}>
          Every cell is editable. Figures fill in from loads, diesel and each truck's Profit Sheet —
          type over any of them to correct it, or clear a cell to go back to the calculated value.
          Edited cells are highlighted. Click a column heading to sort, and × to take a line off the
          report. Remember to Save before you leave the page.
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...styles.table, minWidth: 1180 }}>
          <thead>
            <tr>
              {PS_HEADERS.map(h => (
                <SortableHeader
                  key={h} label={h} col={h} sort={sort} onSort={onSort}
                  style={{ ...styles.th, whiteSpace: 'nowrap' }}
                />
              ))}
              <th style={{ ...styles.th, width: 34 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const loss = psValue(r, 'profit') < 0
              return (
                <tr key={r.key} style={{ ...styles.row, ...(loss ? { background: 'rgba(220,38,38,0.05)' } : {}) }}>
                  <td style={{ ...styles.td, padding: 4 }}>
                    {cell({ r, field: 'reg_no', autoText: r.auto?.reg_no || '', type: 'text', align: 'left', bold: true })}
                  </td>
                  <td style={{ ...styles.td, padding: 4 }}>
                    {cell({ r, field: 'driver', autoText: r.auto?.driver || '', type: 'text', align: 'left' })}
                  </td>
                  <td style={{ ...styles.td, padding: 4 }}>
                    {cell({ r, field: 'diesel', autoText: fmtN(r.auto?.diesel) })}
                  </td>
                  <td style={{ ...styles.td, padding: 4 }}>
                    {/* Derived: diesel ÷ loads, unless she pins it by hand. */}
                    {cell({ r, field: 'diesel_avg_per_load', autoText: fmtN(psValue(r, 'diesel_avg')) })}
                  </td>
                  <td style={{ ...styles.td, padding: 4 }}>
                    {cell({ r, field: 'loads', autoText: String(psNum(r.auto?.loads)), align: 'center' })}
                  </td>
                  <td style={{ ...styles.td, padding: 4 }}>
                    {cell({ r, field: 'profit', autoText: fmtN(r.auto?.profit), bold: true })}
                  </td>
                  <td style={{ ...styles.td, padding: 4 }}>
                    {/* No calculated source — sand loads are captured by hand. */}
                    {cell({ r, field: 'sand_loads_incl_vat', autoText: '' })}
                  </td>
                  <td style={{ ...styles.td, padding: 4 }}>
                    {/* Derived: profit − sand loads, unless she pins it by hand. */}
                    {cell({ r, field: 'profit_excl_sand', autoText: fmtN(psValue(r, 'profit_ex_sand')),
                            tint: 'rgba(250,204,21,0.18)', bold: true })}
                  </td>
                  <td style={{ ...styles.td, padding: 4, minWidth: 260 }}>
                    <input
                      type="text"
                      value={r.notes ?? ''}
                      readOnly={locked}
                      onChange={e => !locked && onChange(r.key, { notes: e.target.value })}
                      placeholder={locked ? '' : 'Notes'}
                      style={{
                        width: '100%', minWidth: 240, padding: '5px 7px', fontSize: 12.5,
                        color: 'var(--text-secondary)', background: 'transparent',
                        border: '1px solid transparent', borderRadius: 4, outline: 'none',
                      }}
                      onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                      onBlur={e => { e.target.style.borderColor = 'transparent' }}
                    />
                  </td>
                  <td style={{ ...styles.td, padding: 4, textAlign: 'center' }}>
                    {/* A hand-added line is gone for good; a truck line is only
                        taken off the report and can be restored below, since it
                        is rebuilt from live data on every load. */}
                    {!locked && (
                      <button
                        onClick={() => onRemoveRow(r.key)}
                        title={r.is_custom
                          ? 'Delete this line'
                          : 'Take this line off the report (it can be restored below)'}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 2,
                        }}
                      >×</button>
                    )}
                  </td>
                </tr>
              )
            })}
            <tr style={styles.totalRow}>
              <td style={{ ...styles.td, fontWeight: 700 }}>TOTAL</td>
              <td style={styles.td} />
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(totals.diesel)}</td>
              <td style={styles.td} />
              <td style={{ ...styles.td, textAlign: 'center', fontWeight: 700 }}>{totals.loads}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: totals.profit < 0 ? 'var(--danger)' : '#16a34a' }}>
                {fmtR(totals.profit)}
              </td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(totals.sand)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, background: 'rgba(250,204,21,0.18)', color: totals.profit_ex_sand < 0 ? 'var(--danger)' : '#16a34a' }}>
                {fmtR(totals.profit_ex_sand)}
              </td>
              <td style={styles.td} />
              <td style={styles.td} />
            </tr>

            {/* Removed lines sit below the total so it is obvious they are out
                of it — greyed, read-only, one click away from coming back. */}
            {showHidden && hiddenRows.map(r => (
              <tr key={r.key} style={{ ...styles.row, opacity: 0.55 }}>
                <td style={{ ...styles.td, fontWeight: 700, textDecoration: 'line-through' }}>
                  {psValue(r, 'reg_no') || '—'}
                </td>
                <td style={styles.td}>{psValue(r, 'driver') || '—'}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmtN(psValue(r, 'diesel'))}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmtN(psValue(r, 'diesel_avg'))}</td>
                <td style={{ ...styles.td, textAlign: 'center' }}>{psValue(r, 'loads')}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmtN(psValue(r, 'profit'))}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmtN(psValue(r, 'sand'))}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmtN(psValue(r, 'profit_ex_sand'))}</td>
                <td style={{ ...styles.td, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                  Removed from the report
                </td>
                <td style={{ ...styles.td, textAlign: 'center' }}>
                  {!locked && (
                    <button
                      onClick={() => onRestoreRow(r.key)}
                      title="Put this line back on the report"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--accent)', fontSize: 14, lineHeight: 1, padding: 2,
                      }}
                    >↺</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
        {!locked && (
          <button onClick={onAddRow} style={{ ...styles.btnSecondary, padding: '6px 12px', fontSize: 12 }}>
            + Add line
          </button>
        )}
        {hiddenRows.length > 0 && (
          <button
            onClick={onToggleHidden}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '6px 4px',
              fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', textDecoration: 'underline',
            }}
          >
            {showHidden
              ? 'Hide removed lines'
              : `${hiddenRows.length} removed line${hiddenRows.length === 1 ? '' : 's'} — show`}
          </button>
        )}
      </div>
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
          * Expenses VAT excludes {fmtR(totals.diesel_input_vat)} VAT on our own 1% diesel admin fee — that fee is an internal markup, not a supplier charge, so it is not claimable. Fees billed by the diesel supplier are included.
        </div>
      )}
    </div>
  )
}


// ── Monthly by Truck ────────────────────────────────────────────────────────────
function TruckReport({ data }) {
  const totals = data.reduce((acc, r) => ({
    fillup_count: acc.fillup_count + (r.fillup_count || 0),
    total_litres: acc.total_litres + Number(r.total_litres || 0),
    total_amount: acc.total_amount + Number(r.total_amount || 0),
    total_admin_fee: acc.total_admin_fee + Number(r.total_admin_fee || 0),
    total_admin_fee_vat: acc.total_admin_fee_vat + Number(r.total_admin_fee_vat || 0),
    grand_total: acc.grand_total + Number(r.grand_total || 0),
  }), { fillup_count: 0, total_litres: 0, total_amount: 0, total_admin_fee: 0, total_admin_fee_vat: 0, grand_total: 0 })

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          {['Truck', 'Logs', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Fee VAT', 'Grand Total', 'Avg Rate (R/L)'].map(h => (
            <th key={h} style={styles.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((r, i) => (
          <tr key={i} style={styles.row}>
            <td style={{ ...styles.td, fontWeight: 600 }}>{r.truck_reg || r.truck_id}</td>
            <td style={styles.td}>{r.fillup_count}</td>
            <td style={styles.td}>{fmtL(r.total_litres)}</td>
            <td style={styles.td}>{fmtR(r.total_amount)}</td>
            <td style={styles.td}>{fmtR(r.total_admin_fee)}</td>
            <td style={styles.td}>{fmtR(r.total_admin_fee_vat)}</td>
            <td style={{ ...styles.td, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtR(r.grand_total)}</td>
            <td style={styles.td}>
              {r.total_litres > 0 ? `R ${fmtN(r.total_amount / r.total_litres)}` : '—'}
            </td>
          </tr>
        ))}
        <tr style={styles.totalRow}>
          <td style={{ ...styles.td, fontWeight: 700 }}>TOTAL</td>
          <td style={styles.td}>{totals.fillup_count}</td>
          <td style={styles.td}>{fmtL(totals.total_litres)}</td>
          <td style={styles.td}>{fmtR(totals.total_amount)}</td>
          <td style={styles.td}>{fmtR(totals.total_admin_fee)}</td>
          <td style={styles.td}>{fmtR(totals.total_admin_fee_vat)}</td>
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
// Supplier → every fill-up behind that supplier's monthly total. Rows come from
// the backend already scoped to the selected month by STATEMENT period (with
// archived fill-ups excluded), so these figures tie back to the Diesel module.
function SupplierReport({ data, year, month }) {
  const [collapsed, setCollapsed] = useState({})
  const toggle = (id) => setCollapsed(c => ({ ...c, [id]: !c[id] }))
  const allCollapsed = data.every(r => collapsed[r.supplier_id])
  const toggleAll = () =>
    setCollapsed(allCollapsed ? {} : Object.fromEntries(data.map(r => [r.supplier_id, true])))

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : '—'

  const totals = data.reduce((acc, r) => ({
    fillup_count: acc.fillup_count + (r.fillup_count || 0),
    total_litres: acc.total_litres + Number(r.total_litres || 0),
    total_amount: acc.total_amount + Number(r.total_amount || 0),
    total_admin_fee: acc.total_admin_fee + Number(r.total_admin_fee || 0),
    total_admin_fee_vat: acc.total_admin_fee_vat + Number(r.total_admin_fee_vat || 0),
    grand_total: acc.grand_total + Number(r.grand_total || 0),
  }), { fillup_count: 0, total_litres: 0, total_amount: 0, total_admin_fee: 0, total_admin_fee_vat: 0, grand_total: 0 })

  return (
    <div>
      <div style={{ ...styles.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            Diesel by Supplier — {MONTHS[month - 1]} {year}
          </span>
          {data.length > 0 && (
            <button onClick={toggleAll} style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'var(--bg-hover)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}>
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Supplier</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Logs</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Total Litres</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Excl. Fee</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Admin Fee</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Fee VAT</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Grand Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => (
                <tr key={r.supplier_id} style={styles.row}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{r.supplier_name || r.supplier_id}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{r.fillup_count}</td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtL(r.total_litres)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(r.total_amount)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(r.total_admin_fee)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(r.total_admin_fee_vat)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--text-primary)' }}>{fmtR(r.grand_total)}</td>
                </tr>
              ))}
              <tr style={styles.totalRow}>
                <td style={{ ...styles.td, fontWeight: 700 }}>TOTAL</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{totals.fillup_count}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtL(totals.total_litres)}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(totals.total_amount)}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(totals.total_admin_fee)}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(totals.total_admin_fee_vat)}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(totals.grand_total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* One card per supplier: every record making up its total */}
      {data.map(r => {
        const isCollapsed = !!collapsed[r.supplier_id]
        const lines = r.fillups || []
        return (
          <div key={r.supplier_id} style={{ ...styles.card, marginBottom: 16 }}>
            <div
              onClick={() => toggle(r.supplier_id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 16, padding: '12px 20px', cursor: 'pointer', flexWrap: 'wrap',
                borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                <span style={{ display: 'inline-block', width: 14, color: 'var(--text-muted)' }}>{isCollapsed ? '▸' : '▾'}</span>
                {r.supplier_name}
                <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 12, color: 'var(--text-muted)' }}>
                  {lines.length} record{lines.length === 1 ? '' : 's'}
                </span>
              </span>
              <span style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
                <span><span style={{ color: 'var(--text-muted)' }}>Litres: </span><b>{fmtL(r.total_litres)}</b></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Excl. fee: </span><b>{fmtR(r.total_amount)}</b></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Admin fee: </span><b>{fmtR(r.total_admin_fee)}</b></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Total: </span><b>{fmtR(r.grand_total)}</b></span>
              </span>
            </div>

            {!isCollapsed && (
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Truck</th>
                      <th style={styles.th}>Slip #</th>
                      <th style={styles.th}>Trans ID</th>
                      <th style={styles.th}>Invoice #</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Litres</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Rate (R/L)</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Excl. Fee</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Admin Fee</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Fee VAT</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(f => (
                      <tr key={f.id} style={styles.row}>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          {fmtDate(f.fillup_date)}
                          {/* slip dated outside the statement month it was billed under */}
                          {f.statement_month && (f.statement_month !== month || f.statement_year !== year) && (
                            <span style={badge}>STMT {MONTHS[f.statement_month - 1]}</span>
                          )}
                        </td>
                        <td style={{ ...styles.td, fontWeight: 600 }}>{f.truck_registration || '—'}</td>
                        <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{f.slip_number || '—'}</td>
                        <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{f.trans_id || '—'}</td>
                        <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{f.invoice_number || '—'}</td>
                        <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtL(f.litres)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {f.rate_pending ? <span style={{ color: 'var(--text-muted)' }}>pending</span> : `R ${fmtN(f.rate_per_litre, 4)}`}
                        </td>
                        <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(f.amount)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(f.admin_fee_amount)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(f.admin_fee_vat)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtR(f.total_amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--bg-surface)' }}>
                      <td style={{ ...styles.td, fontWeight: 700, fontSize: 12 }} colSpan={5}>{r.supplier_name} total ({r.fillup_count})</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtL(r.total_litres)}</td>
                      <td style={styles.td}></td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(r.total_amount)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(r.total_admin_fee)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(r.total_admin_fee_vat)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtR(r.grand_total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Annual Summary ──────────────────────────────────────────────────────────────
function AnnualReport({ data, year }) {
  // data is array of monthly totals: { month, fillup_count, total_litres, total_amount, total_admin_fee, total_admin_fee_vat, grand_total }
  const totals = data.reduce((acc, r) => ({
    fillup_count: acc.fillup_count + (r.fillup_count || 0),
    total_litres: acc.total_litres + Number(r.total_litres || 0),
    total_amount: acc.total_amount + Number(r.total_amount || 0),
    total_admin_fee: acc.total_admin_fee + Number(r.total_admin_fee || 0),
    total_admin_fee_vat: acc.total_admin_fee_vat + Number(r.total_admin_fee_vat || 0),
    grand_total: acc.grand_total + Number(r.grand_total || 0),
  }), { fillup_count: 0, total_litres: 0, total_amount: 0, total_admin_fee: 0, total_admin_fee_vat: 0, grand_total: 0 })

  return (
    <>
      <div style={styles.annualTitle}>Annual Diesel Summary — {year}</div>
      <table style={styles.table}>
        <thead>
          <tr>
            {['Month', 'Logs', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Fee VAT', 'Grand Total'].map(h => (
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
              <td style={styles.td}>{r.fillup_count}</td>
              <td style={styles.td}>{fmtL(r.total_litres)}</td>
              <td style={styles.td}>{fmtR(r.total_amount)}</td>
              <td style={styles.td}>{fmtR(r.total_admin_fee)}</td>
              <td style={styles.td}>{fmtR(r.total_admin_fee_vat)}</td>
              <td style={{ ...styles.td, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtR(r.grand_total)}</td>
            </tr>
          ))}
          <tr style={styles.totalRow}>
            <td style={{ ...styles.td, fontWeight: 700 }}>YEAR TOTAL</td>
            <td style={styles.td}>{totals.fillup_count}</td>
            <td style={styles.td}>{fmtL(totals.total_litres)}</td>
            <td style={styles.td}>{fmtR(totals.total_amount)}</td>
            <td style={styles.td}>{fmtR(totals.total_admin_fee)}</td>
            <td style={styles.td}>{fmtR(totals.total_admin_fee_vat)}</td>
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


// Remove / restore control on a report row. Any user may use it: it's report-only
// and reversible, so it carries no lock or admin gate.
function RowExclusionButton({ row, onToggle }) {
  const excluded = !!row.excluded
  return (
    <button
      onClick={() => onToggle(row, excluded)}
      title={excluded ? 'Put this row back on the report'
                      : 'Remove this row from the report (the invoice itself is not deleted)'}
      style={{
        padding: '2px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
        borderRadius: 5, whiteSpace: 'nowrap',
        background: 'none',
        border: `1px solid ${excluded ? 'var(--accent)' : 'var(--border)'}`,
        color: excluded ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {excluded ? 'Restore' : '✕'}
    </button>
  )
}


function SarsVatDetail({ data, year, onBack, onToggleExclusion }) {
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
              <th style={{ ...styles.th, textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {output_invoices.length === 0 ? (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-muted)' }}>No income invoices for this month.</td></tr>
            ) : output_groups.map(g => (
              <Fragment key={g.key}>
                <tr>
                  <td colSpan={6} style={{ ...styles.td, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', background: 'var(--bg-surface)' }}>
                    {g.label} ({g.count})
                  </td>
                </tr>
                {output_invoices.filter(r => r.category === g.key).map((r, i) => {
                  const off = !!r.excluded   // removed from the report: shown, but not counted
                  return (
                    <tr key={`${g.key}-${r.record_id ?? i}`} style={{ ...styles.row, opacity: off ? 0.45 : 1, textDecoration: off ? 'line-through' : 'none' }}>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{r.description}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(r.amount_incl)}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(r.amount_excl)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmtR(r.vat)}</td>
                      <td style={{ ...styles.td, textAlign: 'center', textDecoration: 'none' }}>
                        <RowExclusionButton row={r} onToggle={onToggleExclusion} />
                      </td>
                    </tr>
                  )
                })}
                <tr style={{ background: 'var(--bg-surface)' }}>
                  <td style={{ ...styles.td, fontWeight: 700, fontSize: 12 }} colSpan={2}>{g.label} subtotal</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(g.amount_incl)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(g.amount_excl)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmtR(g.vat)}</td>
                  <td style={styles.td}></td>
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
              <td style={styles.td}></td>
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
              <th style={{ ...styles.th, textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {input_invoices.length === 0 ? (
              <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: 'var(--text-muted)' }}>No expense invoices for this month.</td></tr>
            ) : input_groups.map(g => (
              <Fragment key={g.key}>
                <tr>
                  <td colSpan={8} style={{ ...styles.td, fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', background: 'var(--bg-surface)' }}>
                    {g.label} ({g.count})
                  </td>
                </tr>
                {input_invoices.filter(r => r.category === g.key).map((r, i) => {
                  const lines  = r.fillup_lines || []
                  const isOpen = expanded.has(r.invoice_id)
                  const off    = !!r.excluded   // removed from the report: shown, but not counted
                  return (
                    <Fragment key={`${g.key}-${r.invoice_id ?? i}`}>
                      <tr style={{ ...styles.row, opacity: off ? 0.45 : 1, textDecoration: off ? 'line-through' : 'none' }}>
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
                        <td style={{ ...styles.td, textAlign: 'center', textDecoration: 'none' }}>
                          <RowExclusionButton row={r} onToggle={onToggleExclusion} />
                        </td>
                      </tr>
                      {isOpen && lines.length > 0 && (
                        <tr>
                          <td colSpan={8} style={{ padding: '0 0 0 28px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
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
                  <td style={styles.td}></td>
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
              <td style={styles.td}></td>
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

// ── Supplier Summary ──────────────────────────────────────────────────────────
// One row per supplier for the month, invoice-date basis (same rules as the SARS
// VAT detail, so the grand total ties to Income vs Expenses). Rows start
// collapsed; clicking a supplier reveals its individual invoices.
const SUP_CAT_LABEL = {
  diesel: 'Diesel', subcontractor: 'Subcontractor',
  intercompany: 'Intercompany', other: null,
}

function SupplierSummaryReport({ data, year }) {
  const { month_name, suppliers, totals } = data
  const [expanded, setExpanded] = useState({})

  const toggle = (name) => setExpanded(e => ({ ...e, [name]: !e[name] }))
  const allExpanded = suppliers.every(s => expanded[s.supplier_name])
  const toggleAll = () =>
    setExpanded(allExpanded ? {} : Object.fromEntries(suppliers.map(s => [s.supplier_name, true])))

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : '—'

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          Supplier Summary — {month_name} {year}
        </span>
        <button onClick={toggleAll} style={{
          padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          background: 'var(--bg-hover)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 6,
        }}>
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 32, padding: '12px 20px', background: 'var(--bg-surface)', flexWrap: 'wrap' }}>
        {[
          { label: 'Suppliers', value: String(suppliers.length) },
          { label: 'Invoices',  value: String(totals.count) },
          { label: 'Excl VAT',  value: fmtR(totals.amount_excl) },
          { label: 'VAT',       value: fmtR(totals.vat) },
          { label: 'Incl VAT',  value: fmtR(totals.amount_incl), color: '#16a34a' },
        ].map(c => (
          <div key={c.label} style={{ fontSize: 12 }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 2, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</div>
            <div style={{ fontWeight: 700, color: c.color || 'var(--text-primary)' }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Supplier</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Invoices</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Excl VAT</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>VAT</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Incl VAT</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(s => {
              const isOpen = !!expanded[s.supplier_name]
              const cat = SUP_CAT_LABEL[s.category]
              return (
                <Fragment key={s.supplier_name}>
                  <tr style={{ ...styles.row, cursor: 'pointer' }} onClick={() => toggle(s.supplier_name)}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>
                      <span style={{ display: 'inline-block', width: 14, color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
                      {s.supplier_name}
                      {cat && <span style={badge}>{cat.toUpperCase()}</span>}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{s.count}</td>
                    <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(s.amount_excl)}</td>
                    <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtR(s.vat)}</td>
                    <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtR(s.amount_incl)}</td>
                  </tr>
                  {isOpen && s.invoices.map(i => (
                    <tr key={i.record_id} style={{ background: 'var(--bg-surface)' }}>
                      <td style={{ ...styles.td, paddingLeft: 34, color: 'var(--text-muted)' }}>
                        <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.date)}</span>
                        {i.invoice_number && <span style={{ fontFamily: 'monospace', fontSize: 12, marginLeft: 10 }}>{i.invoice_number}</span>}
                        <span style={{ marginLeft: 10 }}>{i.description}</span>
                        {!i.vat_applicable && <span style={badge}>NON-VAT</span>}
                      </td>
                      <td style={styles.td}></td>
                      <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtR(i.amount_excl)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtR(i.vat)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtR(i.amount_incl)}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={styles.totalRow}>
              <td style={{ ...styles.td, fontWeight: 700 }}>TOTAL</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{totals.count}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtR(totals.amount_excl)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtR(totals.vat)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtR(totals.amount_incl)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Invoiced PO vs Truck Loads ────────────────────────────────────────────────
// 'period' is informational (the load is real, it just carries another month's
// statement period), so it's styled as a note rather than an error.
const PO_ISSUE_STYLE = {
  no_load: { bg: '#fee2e2', fg: '#b91c1c' },
  reg:     { bg: '#fee2e2', fg: '#b91c1c' },
  tonnes:  { bg: '#fef3c7', fg: '#b45309' },
  amount:  { bg: '#fef3c7', fg: '#b45309' },
  period:  { bg: 'var(--bg-hover)', fg: 'var(--text-muted)' },
}

function IssueTag({ issue, label }) {
  const s = PO_ISSUE_STYLE[issue] || PO_ISSUE_STYLE.period
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 9.5,
      fontWeight: 700, letterSpacing: '0.02em', whiteSpace: 'nowrap',
      background: s.bg, color: s.fg, marginRight: 4,
    }}>
      {label}
    </span>
  )
}

// Signed difference — blank when the two sides agree, so the eye lands on the gaps.
function Diff({ value, format }) {
  if (!value) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  return (
    <b style={{ color: value > 0 ? '#b45309' : '#b91c1c' }}>
      {value > 0 ? '+' : ''}{format(value)}
    </b>
  )
}

function PoLoadReconciliationReport({ data, year, issueLabels }) {
  const { month_name, pos, by_reg = [], uninvoiced, totals, uninvoiced_totals, issue_count } = data
  const [collapsed, setCollapsed] = useState({})
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [groupBy, setGroupBy] = useState('po') // 'po' | 'reg'

  // Slip lookup — searches every month's invoices + loads, not just this report's.
  const [slipQuery, setSlipQuery] = useState('')
  const [slipResult, setSlipResult] = useState(null)
  const [slipBusy, setSlipBusy] = useState(false)
  const runSlipSearch = async (e) => {
    e?.preventDefault()
    const q = slipQuery.trim()
    if (!q) { setSlipResult(null); return }
    setSlipBusy(true)
    try {
      const res = await lookupPoLoadSlip({ entity_id: data.entity_id, slip: q })
      setSlipResult(res.data)
    } catch (err) {
      setSlipResult({ slip: q, error: errorMessage(err), invoiced: [], loads: [] })
    } finally {
      setSlipBusy(false)
    }
  }
  const clearSlipSearch = () => { setSlipQuery(''); setSlipResult(null) }

  // Both views render the same matched lines; only the grouping differs. Normalise
  // each into { key, title, meta, totals, issue_count, sub: [{ label, meta, lines, ... }] }
  // so a single render path serves both.
  const groups = groupBy === 'reg'
    ? by_reg.map(r => ({
        key: r.registration,
        title: `${r.fleet_number ? `${r.fleet_number} — ` : ''}${r.registration}`,
        meta: `${r.pos.length} PO${r.pos.length === 1 ? '' : 's'}`,
        subcontractor: r.subcontractor || null,
        notFleet: !r.known_truck,
        issue_count: r.issue_count,
        totals: r.totals,
        sub: r.pos.map(p => ({
          key: p.po_number,
          label: p.po_number,
          meta: `${p.invoice_numbers.join(', ')}${p.customer_name ? ` · ${p.customer_name}` : ''}`,
          notFleet: false,
          lines: p.lines,
          totals: p.totals,
          issue_count: p.issue_count,
          footerLabel: `${p.po_number} total`,
        })),
      }))
    : pos.map(p => ({
        key: p.po_number,
        title: p.po_number,
        meta: `${p.invoices.map(i => i.invoice_number).join(', ')}${p.customer_name ? ` · ${p.customer_name}` : ''} · ${p.trucks.length} truck${p.trucks.length === 1 ? '' : 's'}`,
        notFleet: false,
        issue_count: p.issue_count,
        totals: p.totals,
        sub: p.trucks.map(t => ({
          key: t.registration,
          label: `${t.fleet_number ? `${t.fleet_number} — ` : ''}${t.registration}`,
          meta: `${t.totals.invoiced_loads} invoiced · ${t.totals.load_loads} matched`,
          notFleet: !t.known_truck,
          lines: t.lines,
          totals: t.totals,
          issue_count: t.issue_count,
          footerLabel: `${t.registration} total`,
        })),
      }))

  const toggle = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }))
  const visibleGroups = onlyIssues ? groups.filter(g => g.issue_count > 0) : groups
  const allCollapsed = visibleGroups.length > 0 && visibleGroups.every(g => collapsed[g.key])
  const toggleAll = () =>
    setCollapsed(allCollapsed ? {} : Object.fromEntries(visibleGroups.map(g => [g.key, true])))

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : '—'

  return (
    <div>
      {/* Grand totals */}
      <div style={{ ...styles.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            Invoiced PO vs Truck Loads — {month_name} {year}
          </span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {[['po', 'By PO'], ['reg', 'By Reg']].map(([val, label]) => (
                <button key={val} onClick={() => setGroupBy(val)} style={{
                  padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: groupBy === val ? 'var(--accent, #2563eb)' : 'var(--bg-hover)',
                  color: groupBy === val ? '#fff' : 'var(--text-primary)',
                }}>{label}</button>
              ))}
            </span>
            <button onClick={() => setOnlyIssues(v => !v)} style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: onlyIssues ? '#b91c1c' : 'var(--bg-hover)',
              color: onlyIssues ? '#fff' : 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}>
              {onlyIssues ? 'Showing discrepancies' : 'Discrepancies only'}
            </button>
            <button onClick={toggleAll} style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'var(--bg-hover)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}>
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 32, padding: '12px 20px', background: 'var(--bg-surface)', flexWrap: 'wrap' }}>
          {[
            { label: groupBy === 'reg' ? 'Trucks' : 'POs', value: String(groupBy === 'reg' ? by_reg.length : pos.length) },
            { label: 'Invoiced Loads',  value: String(totals.invoiced_loads) },
            { label: 'Matched Loads',   value: String(totals.load_loads) },
            { label: 'Invoiced Tonnes', value: fmtT(totals.invoiced_tonnes) },
            { label: 'Load Tonnes',     value: fmtT(totals.load_tonnes) },
            { label: 'Total Including VAT', value: fmtR(totals.invoiced_amount_incl) },
            { label: 'Total Excluding VAT', value: fmtR(totals.invoiced_amount) },
            { label: 'Load Amount',     value: fmtR(totals.load_amount) },
            { label: 'Difference',      value: fmtR(totals.diff_amount), color: totals.diff_amount ? '#b91c1c' : '#16a34a' },
            { label: 'Lines to Check',  value: String(issue_count), color: issue_count ? '#b91c1c' : '#16a34a' },
          ].map(c => (
            <div key={c.label} style={{ fontSize: 12 }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</div>
              <div style={{ fontWeight: 700, color: c.color || 'var(--text-primary)' }}>{c.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Slip lookup */}
      <div style={{ ...styles.card, marginBottom: 16, padding: '14px 20px' }}>
        <form onSubmit={runSlipSearch} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginRight: 4 }}>Find a slip</span>
          <input
            value={slipQuery}
            onChange={e => setSlipQuery(e.target.value)}
            placeholder="e.g. 931502"
            style={{
              padding: '6px 10px', fontSize: 13, minWidth: 180,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-input, var(--bg-surface))', color: 'var(--text-primary)',
            }}
          />
          <button type="submit" disabled={slipBusy || !slipQuery.trim()} style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 600,
            cursor: slipBusy ? 'default' : 'pointer', opacity: slipBusy ? 0.6 : 1,
            background: 'var(--accent, #2563eb)', color: '#fff', border: 'none', borderRadius: 6,
          }}>{slipBusy ? 'Searching…' : 'Search'}</button>
          {slipResult && (
            <button type="button" onClick={clearSlipSearch} style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'var(--bg-hover)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}>Clear</button>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Searches all months for this entity — invoices and loads.
          </span>
        </form>

        {slipResult && (
          <div style={{ marginTop: 14 }}>
            {slipResult.error ? (
              <div style={{ color: '#b91c1c', fontSize: 13 }}>{slipResult.error}</div>
            ) : (
              <>
                {/* Verdict */}
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                  {slipResult.invoiced.length > 0 ? (
                    <span style={{ color: '#16a34a' }}>
                      ✓ Slip {slipResult.slip} is on {slipResult.invoiced.length} invoice line{slipResult.invoiced.length === 1 ? '' : 's'}
                    </span>
                  ) : slipResult.loads.length > 0 ? (
                    <span style={{ color: '#b45309' }}>
                      ⚠ Slip {slipResult.slip} is recorded as a load but is NOT on any PO invoice
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>
                      Slip {slipResult.slip} isn’t on any invoice or truck load for this entity
                    </span>
                  )}
                </div>

                {slipResult.invoiced.length > 0 && (
                  <div style={{ overflowX: 'auto', marginBottom: slipResult.loads.length ? 12 : 0 }}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Invoice</th>
                          <th style={styles.th}>PO</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Reg</th>
                          <th style={styles.th}>Waybill (load / offload)</th>
                          <th style={{ ...styles.th, textAlign: 'right' }}>Tonnes</th>
                          <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slipResult.invoiced.map((r, i) => (
                          <tr key={i}>
                            <td style={styles.td}>{r.invoice_number}</td>
                            <td style={styles.td}>{r.po_number || '—'}</td>
                            <td style={styles.td}>{r.status || '—'}</td>
                            <td style={styles.td}>{r.registration || '—'}</td>
                            <td style={styles.td}>{r.loading_number || '—'} / {r.offloading_number || '—'}</td>
                            <td style={{ ...styles.td, textAlign: 'right' }}>{fmtT(r.tonnes)}</td>
                            <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {slipResult.loads.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Load Reg</th>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Period</th>
                          <th style={{ ...styles.th, textAlign: 'right' }}>Tonnes</th>
                          <th style={styles.th}>Slip</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slipResult.loads.map(l => (
                          <tr key={l.load_id}>
                            <td style={styles.td}>{l.fleet_number ? `${l.fleet_number} — ` : ''}{l.registration || '—'}</td>
                            <td style={styles.td}>{fmtDate(l.load_date)}</td>
                            <td style={styles.td}>{l.period || '—'}</td>
                            <td style={{ ...styles.td, textAlign: 'right' }}>{fmtT(l.tonnes)}</td>
                            <td style={styles.td}>
                              {l.slip_number || '—'}
                              {l.is_projection && <span style={badge}>PROJ</span>}
                              {l.is_archived && <span style={{ ...badge, background: '#e5e7eb', color: '#6b7280' }}>ARCHIVED</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {onlyIssues && visibleGroups.length === 0 && (
        <div style={{ ...styles.card, ...styles.empty, marginBottom: 16 }}>
          Every invoiced line matches its truck load for this period.
        </div>
      )}

      {/* One card per PO (By PO) or per truck (By Reg). In By Reg the cards are
          clustered under a subcontractor heading (own-fleet trucks last). */}
      {visibleGroups.map((g, gi) => {
        const isCollapsed = !!collapsed[g.key]
        const sub = onlyIssues ? g.sub.filter(s => s.issue_count > 0) : g.sub
        const showSubHeading = groupBy === 'reg' &&
          (gi === 0 || visibleGroups[gi - 1].subcontractor !== g.subcontractor)
        return (
          <Fragment key={g.key}>
          {showSubHeading && (
            <div style={{
              margin: '4px 2px 10px', padding: '4px 2px',
              fontSize: 13, fontWeight: 800, letterSpacing: '0.02em',
              color: 'var(--text-primary)', borderBottom: '2px solid var(--border)',
            }}>
              {g.subcontractor || 'Own Fleet'}
            </div>
          )}
          <div style={{ ...styles.card, marginBottom: 16 }}>
            <div
              onClick={() => toggle(g.key)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 16, padding: '12px 20px', cursor: 'pointer', flexWrap: 'wrap',
                borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                <span style={{ display: 'inline-block', width: 14, color: 'var(--text-muted)' }}>{isCollapsed ? '▸' : '▾'}</span>
                {g.title}
                <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 12, color: 'var(--text-muted)' }}>
                  {g.meta}
                </span>
                {g.notFleet && (
                  <span style={{ ...badge, background: '#fee2e2', color: '#b91c1c' }}>NOT A FLEET TRUCK</span>
                )}
                {g.issue_count > 0 && (
                  <span style={{ ...badge, background: '#fee2e2', color: '#b91c1c' }}>
                    {g.issue_count} TO CHECK
                  </span>
                )}
              </span>
              <span style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
                <span><span style={{ color: 'var(--text-muted)' }}>Invoiced: </span><b>{fmtR(g.totals.invoiced_amount)}</b></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Loads: </span><b>{fmtR(g.totals.load_amount)}</b></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Diff: </span><Diff value={g.totals.diff_amount} format={fmtR} /></span>
              </span>
            </div>

            {!isCollapsed && (
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Invoice</th>
                      <th style={styles.th}>Slip #</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Inv Tonnes</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Inv Rate</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Invoiced</th>
                      <th style={{ ...styles.th, borderLeft: '2px solid var(--border)' }}>Load Date</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Load Tonnes</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Load Rate</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Load Amount</th>
                      <th style={{ ...styles.th, textAlign: 'right', borderLeft: '2px solid var(--border)' }}>Diff</th>
                      <th style={styles.th}>Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.map(t => {
                      const lines = onlyIssues ? t.lines.filter(l => l.issues.length) : t.lines
                      return (
                        <Fragment key={t.key}>
                          <tr>
                            <td colSpan={11} style={{
                              padding: '8px 12px', background: 'var(--bg-surface)',
                              fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
                              borderTop: '1px solid var(--border)',
                            }}>
                              {t.label}
                              <span style={{ marginLeft: 8, fontWeight: 500, color: 'var(--text-muted)' }}>
                                {t.meta}
                              </span>
                              {t.notFleet && (
                                <span style={{ ...badge, background: '#fee2e2', color: '#b91c1c' }}>NOT A FLEET TRUCK</span>
                              )}
                            </td>
                          </tr>
                          {lines.map((l, i) => {
                            const bad = l.issues.filter(x => x !== 'period')
                            return (
                              <tr key={`${l.invoice_number}-${l.slip_number}-${i}`}
                                  style={bad.length ? { background: 'rgba(239,68,68,0.05)' } : undefined}>
                                <td style={styles.td}>{l.invoice_number}</td>
                                <td style={styles.td}>{l.slip_number || '—'}</td>
                                <td style={{ ...styles.td, textAlign: 'right' }}>{fmtT(l.invoiced_tonnes)}</td>
                                <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(l.invoiced_rate)}</td>
                                <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(l.invoiced_amount)}</td>
                                <td style={{ ...styles.td, borderLeft: '2px solid var(--border)' }}>
                                  {l.load_id ? fmtDate(l.load_date) : <span style={{ color: '#b91c1c', fontWeight: 600 }}>missing</span>}
                                </td>
                                <td style={{ ...styles.td, textAlign: 'right' }}>{l.load_id ? fmtT(l.load_tonnes) : '—'}</td>
                                <td style={{ ...styles.td, textAlign: 'right' }}>{l.load_id ? fmtR(l.load_rate) : '—'}</td>
                                <td style={{ ...styles.td, textAlign: 'right' }}>{l.load_id ? fmtR(l.load_amount) : '—'}</td>
                                <td style={{ ...styles.td, textAlign: 'right', borderLeft: '2px solid var(--border)' }}>
                                  {l.load_id
                                    ? <Diff value={Number((l.invoiced_amount - l.load_amount).toFixed(2))} format={fmtR} />
                                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                                <td style={styles.td}>
                                  {l.issues.length === 0
                                    ? <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>
                                    : l.issues.map(x => (
                                        <IssueTag key={x} issue={x} label={
                                          x === 'reg' && l.load_registration
                                            ? `Load is ${l.load_registration}`
                                            : x === 'period' && l.load_period
                                              ? l.load_period
                                              : issueLabels[x] || x
                                        } />
                                      ))}
                                </td>
                              </tr>
                            )
                          })}
                          <tr>
                            <td style={{ ...styles.td, fontWeight: 700 }}>{t.footerLabel}</td>
                            <td style={styles.td} />
                            <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtT(t.totals.invoiced_tonnes)}</td>
                            <td style={styles.td} />
                            <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(t.totals.invoiced_amount)}</td>
                            <td style={{ ...styles.td, borderLeft: '2px solid var(--border)' }} />
                            <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtT(t.totals.load_tonnes)}</td>
                            <td style={styles.td} />
                            <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(t.totals.load_amount)}</td>
                            <td style={{ ...styles.td, textAlign: 'right', borderLeft: '2px solid var(--border)' }}>
                              <Diff value={t.totals.diff_amount} format={fmtR} />
                            </td>
                            <td style={styles.td} />
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </Fragment>
        )
      })}

      {/* Loads with no invoice behind them */}
      {uninvoiced.length > 0 && (
        <div style={{ ...styles.card, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#b45309' }}>
              Loads Not Invoiced
              <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 12, color: 'var(--text-muted)' }}>
                {uninvoiced_totals.load_loads} load{uninvoiced_totals.load_loads === 1 ? '' : 's'} in this period on no invoice
              </span>
            </span>
            <span style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
              <span><span style={{ color: 'var(--text-muted)' }}>Tonnes: </span><b>{fmtT(uninvoiced_totals.load_tonnes)}</b></span>
              <span><span style={{ color: 'var(--text-muted)' }}>Value: </span><b style={{ color: '#b45309' }}>{fmtR(uninvoiced_totals.load_amount)}</b></span>
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Registration</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Slip #</th>
                  <th style={styles.th}>Mine</th>
                  <th style={styles.th}>Driver</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Tonnes</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Rate</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {uninvoiced.map(g => g.loads.map((l, i) => (
                  <tr key={l.load_id}>
                    <td style={styles.td}>
                      {i === 0 ? `${g.fleet_number ? `${g.fleet_number} — ` : ''}${g.registration}` : ''}
                    </td>
                    <td style={styles.td}>{fmtDate(l.load_date)}</td>
                    <td style={styles.td}>
                      {l.slip_number || '—'}
                      {l.is_projection && <span style={badge}>PROJ</span>}
                    </td>
                    <td style={styles.td}>{l.mine_name || '—'}</td>
                    <td style={styles.td}>{l.driver_name || '—'}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmtT(l.load_tonnes)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(l.load_rate)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmtR(l.load_amount)}</td>
                  </tr>
                )))}
                <tr>
                  <td style={{ ...styles.td, fontWeight: 700 }}>TOTAL</td>
                  <td style={styles.td} /><td style={styles.td} /><td style={styles.td} /><td style={styles.td} />
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtT(uninvoiced_totals.load_tonnes)}</td>
                  <td style={styles.td} />
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(uninvoiced_totals.load_amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
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
