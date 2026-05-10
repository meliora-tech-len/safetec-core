import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  getDieselReportByTruck, getDieselReportBySupplier, getDieselAnnualSummary,
  getIncomeExpensesReport,
} from '../services/api'
import toast from 'react-hot-toast'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: MONTHS[i] }))

const fmtR = (n) => `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtL = (n) => `${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`
const fmtN = (n, d = 2) => Number(n || 0).toFixed(d)

const TABS = [
  { key: 'income',   label: 'Income vs Expenses' },
  { key: 'truck',    label: 'Diesel by Truck' },
  { key: 'supplier', label: 'Diesel by Supplier' },
  { key: 'annual',   label: 'Diesel Annual' },
]

const thisYear = new Date().getFullYear()
const thisMonth = new Date().getMonth() + 1

export default function ReportsPage() {
  const { isAdmin, activeEntity, entities } = useAuth()

  const [tab, setTab]         = useState('income')
  const [entityId, setEntityId] = useState(activeEntity?.id || '')
  const [year, setYear]       = useState(thisYear)
  const [month, setMonth]     = useState(thisMonth)
  const [loading, setLoading] = useState(false)

  // Diesel reports use an array; income report uses a structured object
  const [dieselData, setDieselData]   = useState([])
  const [incomeData, setIncomeData]   = useState(null)

  useEffect(() => {
    if (!isAdmin && activeEntity?.id) setEntityId(activeEntity.id)
  }, [isAdmin, activeEntity])

  const load = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setDieselData([])
    setIncomeData(null)
    try {
      if (tab === 'income') {
        const res = await getIncomeExpensesReport({ entity_id: entityId, year })
        setIncomeData(res.data)
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
      const headers = ['Month', 'Revenue', 'Diesel', 'Suppliers', 'Payroll', 'Total Expenses', 'Net']
      const rows = incomeData.months.map(r => [
        r.month_name, r.truck_income, r.diesel, r.suppliers, r.payroll, r.total_expenses, r.net,
      ].map(v => `"${v}"`).join(','))
      const csv = [headers.join(','), ...rows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `income-expenses-${year}.csv`; a.click()
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

  const hasData = tab === 'income' ? !!incomeData : dieselData.length > 0

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Reports</h1>
          <p style={styles.subtitle}>Business reports and reconciliations</p>
        </div>
        <button onClick={exportCsv} style={styles.btnSecondary} disabled={!hasData}>
          Export CSV
        </button>
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
        incomeData
          ? <IncomeExpensesReport data={incomeData} year={year} />
          : <div style={{ ...styles.card, ...styles.empty }}>Select an entity to load the report.</div>
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

// ── Income vs Expenses ─────────────────────────────────────────────────────────
function IncomeExpensesReport({ data, year }) {
  const { months, totals, has_payroll_entries } = data

  const netColor = (n) => n > 0 ? '#16a34a' : n < 0 ? 'var(--danger)' : 'var(--text-muted)'

  // Summary cards
  const cards = [
    { label: 'Total Revenue',   value: totals.total_income,   color: '#16a34a' },
    { label: 'Total Expenses',  value: totals.total_expenses,  color: 'var(--danger)' },
    { label: 'Net Profit / Loss', value: totals.net,           color: netColor(totals.net) },
  ]

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: 20 }}>
        {cards.map(c => (
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

      {/* Expense breakdown pills */}
      <div style={{ padding: '0 20px 16px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Diesel',     value: totals.diesel    },
          { label: 'Suppliers',  value: totals.suppliers  },
          { label: 'Payroll',    value: totals.payroll    },
        ].map(c => (
          <div key={c.label} style={{ fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>{c.label}:</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtR(c.value)}</span>
          </div>
        ))}
      </div>

      {/* Payroll source notice */}
      {!has_payroll_entries && totals.payroll > 0 && (
        <div style={{
          margin: '0 20px 16px', padding: '8px 12px', background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6,
          fontSize: 12, color: '#92400e',
        }}>
          Payroll figures are calculated from in-progress pay cycles. Finalize payroll to lock in these amounts.
        </div>
      )}

      {/* Monthly table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Month</th>
              <th style={{ ...styles.th, textAlign: 'right', color: '#16a34a' }}>Revenue</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Diesel</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Suppliers</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Payroll</th>
              <th style={{ ...styles.th, textAlign: 'right', color: 'var(--danger)' }}>Total Expenses</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {months.map(r => {
              const hasActivity = r.total_income > 0 || r.total_expenses > 0
              return (
                <tr key={r.month} style={{
                  ...styles.row,
                  opacity: hasActivity ? 1 : 0.4,
                }}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{r.month_name} {year}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>
                    {hasActivity ? fmtR(r.truck_income) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {r.diesel > 0 ? fmtR(r.diesel) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {r.suppliers > 0 ? fmtR(r.suppliers) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {r.payroll > 0 ? fmtR(r.payroll) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', color: 'var(--danger)' }}>
                    {r.total_expenses > 0 ? fmtR(r.total_expenses) : '—'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: netColor(r.net) }}>
                    {hasActivity ? fmtR(r.net) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={styles.totalRow}>
              <td style={{ ...styles.td, fontWeight: 700 }}>YEAR TOTAL</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmtR(totals.total_income)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(totals.diesel)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(totals.suppliers)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{fmtR(totals.payroll)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>{fmtR(totals.total_expenses)}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 800, fontSize: 14, color: netColor(totals.net) }}>{fmtR(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
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
          {['Truck', 'Fill-ups', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Grand Total', 'Avg Rate (R/L)'].map(h => (
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
            {['Supplier', 'Fill-ups', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Grand Total'].map(h => (
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
            {['Month', 'Fill-ups', 'Total Litres', 'Excl. Fee', 'Admin Fee', 'Grand Total'].map(h => (
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
  page: { padding: '28px 32px', flex: 1 },
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
  tabActive: { color: 'var(--accent)', fontWeight: 700, borderBottomColor: 'var(--accent)' },
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
