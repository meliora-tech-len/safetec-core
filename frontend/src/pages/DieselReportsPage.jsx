import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  getDieselReportByTruck, getDieselReportBySupplier, getDieselAnnualSummary,
} from '../services/api'
import toast from 'react-hot-toast'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: MONTHS[i] }))

const fmtR = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtL = (n) => `${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`
const fmtN = (n, d = 2) => Number(n || 0).toFixed(d)

const TABS = [
  { key: 'truck', label: 'Monthly by Truck' },
  { key: 'supplier', label: 'Supplier Reconciliation' },
  { key: 'annual', label: 'Annual Summary' },
]

const thisYear = new Date().getFullYear()
const thisMonth = new Date().getMonth() + 1

export default function DieselReportsPage() {
  const { isAdmin, activeEntity, entities } = useAuth()

  const [tab, setTab] = useState('truck')
  const [entityId, setEntityId] = useState(activeEntity?.id || '')
  const [year, setYear] = useState(thisYear)
  const [month, setMonth] = useState(thisMonth)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])

  useEffect(() => {
    if (!isAdmin && activeEntity?.id) setEntityId(activeEntity.id)
  }, [isAdmin, activeEntity])

  const load = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setData([])
    try {
      let res
      const p = { entity_id: entityId, year, month }
      if (tab === 'truck') res = await getDieselReportByTruck(p)
      else if (tab === 'supplier') res = await getDieselReportBySupplier(p)
      else res = await getDieselAnnualSummary({ entity_id: entityId, year })
      setData(res.data || [])
    } catch {
      toast.error('Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [tab, entityId, year, month])

  useEffect(() => { load() }, [load])

  const years = Array.from({ length: 5 }, (_, i) => thisYear - i)

  // CSV export helper
  const exportCsv = () => {
    if (!data.length) return
    const headers = Object.keys(data[0])
    const rows = data.map(r => headers.map(h => `"${r[h] ?? ''}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `diesel-report-${tab}-${year}${tab !== 'annual' ? `-${String(month).padStart(2, '0')}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Diesel Reports</h1>
          <p style={styles.subtitle}>Cost analysis and supplier reconciliation</p>
        </div>
        <button onClick={exportCsv} style={styles.btnSecondary} disabled={!data.length}>
          Export CSV
        </button>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : {}) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
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
        {tab !== 'annual' && (
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={styles.select}>
            {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        )}
      </div>

      {/* Report content */}
      <div style={styles.card}>
        {loading ? (
          <div style={styles.empty}>Loading…</div>
        ) : data.length === 0 ? (
          <div style={styles.empty}>No data for this period.</div>
        ) : tab === 'truck' ? (
          <TruckReport data={data} />
        ) : tab === 'supplier' ? (
          <SupplierReport data={data} />
        ) : (
          <AnnualReport data={data} year={year} />
        )}
      </div>
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
              {r.total_litres > 0 ? `R ${fmtN(r.total_amount / r.total_litres)}` : '—'}
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
            {totals.total_litres > 0 ? `R ${fmtN(totals.total_amount / totals.total_litres)}` : '—'}
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
      <div style={styles.reconNote}>
        DIESEL TOTALS TO MATCH SUPPLIER — reconcile these figures against supplier statements before payment.
      </div>
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

const styles = {
  page: { padding: 24, maxWidth: 1100, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: 13, color: 'var(--text-muted)', marginTop: 4 },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 },
  tab: {
    padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', borderBottom: '2px solid transparent',
    marginBottom: -1, transition: 'all 0.12s',
  },
  tabActive: { color: 'var(--accent)', fontWeight: 700, borderBottomColor: 'var(--accent)' },
  filters: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  select: {
    padding: '7px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
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
