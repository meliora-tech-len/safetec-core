import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Export data to an Excel (.xlsx) file.
 *
 * @param {Array<{header: string, key: string}>} columns
 * @param {Array<object>} data
 * @param {string} filename  — without extension
 */
export function exportToExcel(columns, data, filename) {
  const headers = columns.map(c => c.header)
  const rows = data.map(row => columns.map(c => {
    const val = c.value ? c.value(row) : (row[c.key] ?? '')
    return val
  }))

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

  // Column widths — auto-size based on content
  ws['!cols'] = columns.map((c, i) => {
    const maxLen = Math.max(
      c.header.length,
      ...rows.map(r => String(r[i] ?? '').length)
    )
    return { wch: Math.min(maxLen + 2, 50) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

/**
 * Export data to a PDF file using jspdf-autotable.
 *
 * @param {Array<{header: string, key: string}>} columns
 * @param {Array<object>} data
 * @param {string} filename  — without extension
 * @param {string} title     — shown at the top of the PDF
 */
export function exportToPdf(columns, data, filename, title) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const pageWidth = doc.internal.pageSize.getWidth()
  const now = new Date().toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  // Title
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, 16)

  // Subtitle / date
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120)
  doc.text(`Generated ${now}`, 14, 22)
  doc.text(`${data.length} record${data.length !== 1 ? 's' : ''}`, pageWidth - 14, 22, { align: 'right' })
  doc.setTextColor(0)

  const head = [columns.map(c => c.header)]
  const body = data.map(row =>
    columns.map(c => {
      const val = c.value ? c.value(row) : (row[c.key] ?? '')
      return val == null ? '' : String(val)
    })
  )

  autoTable(doc, {
    head,
    body,
    startY: 26,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 14, right: 14 },
  })

  doc.save(`${filename}.pdf`)
}
