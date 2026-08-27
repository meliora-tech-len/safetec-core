import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getDashboardStats, getSupplierPayablesDashboard, getDieselWarnings, getProfitLossSummary } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { usePendingInvoices } from '../hooks/usePendingInvoices'
import PendingInvoicesModal from '../components/PendingInvoicesModal'
import DrilldownModal from '../components/DrilldownModal'
import { formatCurrency, formatDate, statusBadgeClass } from '../utils/helpers'
import { TrendingUp, TrendingDown, AlertCircle, FileText, Clock, Building2, ChevronRight, ChevronDown, CreditCard, Fuel, Scale, ClipboardCheck, Users } from 'lucide-react'

import { MONTHS_LONG_1 as MONTH_NAMES } from '../utils/helpers'

export default function DashboardPage() {
  const { entities, activeEntity, setActiveEntity, isAdmin } = useAuth()
  const [stats, setStats] = useState(null)
  const [payables, setPayables] = useState(null)
  const [dieselWarnings, setDieselWarnings] = useState(null)
  const [profitLoss, setProfitLoss] = useState(null)
  const [showOtherPeriods, setShowOtherPeriods] = useState(false)
  const [showPending, setShowPending] = useState(false)
  const [drilldown, setDrilldown] = useState(null)
  const pending = usePendingInvoices(isAdmin)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return { month: d.getMonth() + 1, year: d.getFullYear() }
  })
  const navigate = useNavigate()

  const periodLabel = `${MONTH_NAMES[period.month]} ${period.year}`
  // 30-day terms run to the end of the month after the statement month, and we pay
  // on the 7th of the month after that: a July statement is paid 7 September.
  const days30PayLabel = `Due 7th of ${MONTH_NAMES[(period.month + 1) % 12 + 1]}`
  const days30PayDate = (month, year) =>
    month && year ? formatDate(new Date(year, month + 1, 7)) : '—'
  // Sort keys: always a number so blanks and dates never fall back to text compare.
  const dateSort = (v) => (v ? new Date(v).getTime() : 0)
  const statementSort = (r) => (r.statement_year || 0) * 12 + (r.statement_month || 0)
  const yearOptions = (() => {
    const cur = new Date().getFullYear()
    const yrs = []
    for (let y = cur + 1; y >= cur - 4; y--) yrs.push(y)
    return yrs
  })()

  useEffect(() => {
    let ignore = false
    setLoading(true)
    const params = {
      ...(activeEntity?.id ? { entity_id: activeEntity.id } : {}),
      month: period.month,
      year: period.year,
    }
    Promise.all([
      getDashboardStats(activeEntity?.id || undefined, { month: period.month, year: period.year }),
      getSupplierPayablesDashboard(params),
      getDieselWarnings(params),
      getProfitLossSummary(params),
    ]).then(([statsRes, payablesRes, warningsRes, profitLossRes]) => {
      if (!ignore) {
        setStats(statsRes.data)
        setPayables(payablesRes.data)
        setDieselWarnings(warningsRes.data)
        setProfitLoss(profitLossRes.data)
      }
    }).finally(() => {
      if (!ignore) setLoading(false)
    })
    return () => { ignore = true }
  }, [activeEntity, period.month, period.year])

  const handleEntityChange = (e) => {
    const val = e.target.value
    if (!val) {
      setActiveEntity(null)
    } else {
      const ent = entities.find(en => en.id === parseInt(val))
      setActiveEntity(ent ?? null)
    }
  }

  // ── Drill-down "show proof" modals for the Debtors/Creditors totals ────────
  // Columns carry a `sortValue` wherever the rendered text wouldn't sort right —
  // amounts (currency strings) and dates (dd/mm/yyyy) both need the raw value.
  const debtorColumns = (dateLabel, dateField) => [
    { label: 'Invoice #', render: r => r.invoice_number },
    { label: 'Customer', render: r => r.customer_name || r.supplier_name || '—' },
    { label: 'Entity', render: r => r.entity_code || '—' },
    { label: 'Status', render: r => <span className={statusBadgeClass(r.status)}>{r.status}</span>, sortValue: r => r.status },
    { label: dateLabel, render: r => formatDate(r[dateField]), sortValue: r => dateSort(r[dateField]) },
    { label: 'Amount', align: 'right', render: r => formatCurrency(r.total), sortValue: r => Number(r.total) || 0 },
  ]
  const creditorDate = (r, dateField) => {
    if (dateField === 'statement') return r.statement_month ? `${MONTH_NAMES[r.statement_month]} ${r.statement_year}` : '—'
    // 'pay_30' is derived here rather than read off the invoice: payment_due_date is
    // still stored on the old rule, and correcting it there would move the date on
    // every other screen too.
    if (dateField === 'pay_30') return days30PayDate(r.statement_month, r.statement_year)
    return formatDate(r[dateField])
  }
  // 'pay_30' is a straight offset off the statement period, so it sorts on the
  // same key — no need to rebuild the derived date.
  const creditorDateSort = (r, dateField) =>
    (dateField === 'statement' || dateField === 'pay_30') ? statementSort(r) : dateSort(r[dateField])
  const creditorColumns = (dateLabel, dateField, amountField, showInvoiceDate = false) => [
    { label: 'Invoice #', render: r => r.invoice_number || '—' },
    { label: 'Supplier', render: r => r.supplier_name },
    { label: 'Entity', render: r => r.entity_code || '—' },
    // The invoice date often falls outside the statement period it's billed in, so
    // show both when drilling into what's still owed.
    ...(showInvoiceDate
      ? [{ label: 'Invoice date', render: r => formatDate(r.invoice_date), sortValue: r => dateSort(r.invoice_date) }]
      : []),
    { label: dateLabel, render: r => creditorDate(r, dateField), sortValue: r => creditorDateSort(r, dateField) },
    { label: 'Amount', align: 'right', render: r => formatCurrency(r[amountField]), sortValue: r => Number(r[amountField]) || 0 },
  ]
  const goToInvoice = (row) => { setDrilldown(null); navigate(`/invoices/${row.id}`) }
  const goToSupplier = (row) => { if (!row.supplier_id) return; setDrilldown(null); navigate(`/suppliers/${row.supplier_id}`) }

  const openOutstandingDebtors = () => setDrilldown({
    title: 'Outstanding Debtors', subtitle: periodLabel,
    rows: stats.outstanding_invoices, total: stats.outstanding_total,
    columns: debtorColumns('Issued', 'issue_date'), onRowClick: goToInvoice,
  })
  const openPaidDebtors = () => setDrilldown({
    title: 'Paid Debtors', subtitle: `Collected in ${periodLabel}`,
    rows: stats.paid_invoices, total: stats.paid_this_month,
    columns: debtorColumns('Paid', 'paid_date'), onRowClick: goToInvoice,
  })
  const openOutstandingCashCreditors = () => setDrilldown({
    title: 'Outstanding Cash Creditors', subtitle: `Statement ${periodLabel}`,
    rows: payables.outstanding_current_invoices, total: payables.total_current,
    columns: creditorColumns('Statement', 'statement', 'outstanding_amount', true), onRowClick: goToSupplier,
  })
  const openOutstanding30DayCreditors = () => setDrilldown({
    title: 'Outstanding 30-Day Creditors', subtitle: `Statement ${periodLabel}`,
    rows: payables.outstanding_days_30_invoices, total: payables.total_30_days,
    columns: creditorColumns('Due', 'pay_30', 'outstanding_amount', true), onRowClick: goToSupplier,
  })
  const openPaidCashCreditors = () => setDrilldown({
    title: 'Paid Cash Creditors', subtitle: `Paid in ${periodLabel}`,
    rows: payables.paid_current_invoices, total: payables.total_paid_current,
    columns: creditorColumns('Paid', 'paid_date', 'amount'), onRowClick: goToSupplier,
  })
  const openPaid30DayCreditors = () => setDrilldown({
    title: 'Paid 30-Day Creditors', subtitle: `Paid in ${periodLabel}`,
    rows: payables.paid_days_30_invoices, total: payables.total_paid_30_days,
    columns: creditorColumns('Paid', 'paid_date', 'amount'), onRowClick: goToSupplier,
  })

  const openOverallDebtors = () => {
    const rows = [
      ...stats.outstanding_invoices.map(r => ({ ...r, _type: 'Outstanding', _date: r.issue_date })),
      ...stats.paid_invoices.map(r => ({ ...r, _type: 'Paid', _date: r.paid_date })),
    ]
    setDrilldown({
      title: 'Debtors — Overall Total', subtitle: `Paid + Outstanding · ${periodLabel}`,
      rows, total: Number(stats.outstanding_total) + Number(stats.paid_this_month),
      columns: [
        { label: 'Invoice #', render: r => r.invoice_number },
        { label: 'Customer', render: r => r.customer_name || r.supplier_name || '—' },
        { label: 'Entity', render: r => r.entity_code || '—' },
        { label: 'Type', render: r => r._type },
        { label: 'Date', render: r => formatDate(r._date), sortValue: r => dateSort(r._date) },
        { label: 'Amount', align: 'right', render: r => formatCurrency(r.total), sortValue: r => Number(r.total) || 0 },
      ],
      onRowClick: goToInvoice,
    })
  }

  // ── Profit & Loss drill-downs: the invoices behind each side of a P&L card ──
  const openPlInvoices = (pl) => setDrilldown({
    title: `${pl.entity_name} — Invoices generated`, subtitle: periodLabel,
    rows: pl.invoices || [], total: pl.invoices_total,
    columns: [
      { label: 'Invoice #', render: r => r.invoice_number },
      { label: 'Customer', render: r => r.customer_name || r.supplier_name || '—' },
      { label: 'Status', render: r => <span className={statusBadgeClass(r.status)}>{r.status}</span>, sortValue: r => r.status },
      { label: 'Issued', render: r => formatDate(r.issue_date), sortValue: r => dateSort(r.issue_date) },
      { label: 'Amount', align: 'right', render: r => formatCurrency(r.total), sortValue: r => Number(r.total) || 0 },
    ],
    onRowClick: goToInvoice,
  })
  const openPlSupplierInvoices = (pl) => setDrilldown({
    title: `${pl.entity_name} — Supplier invoices`, subtitle: periodLabel,
    rows: pl.supplier_invoices || [], total: pl.supplier_invoices_total,
    columns: [
      { label: 'Invoice #', render: r => r.invoice_number || '—' },
      { label: 'Supplier', render: r => r.supplier_name },
      { label: 'Invoice date', render: r => formatDate(r.invoice_date), sortValue: r => dateSort(r.invoice_date) },
      // The P&L groups supplier invoices by statement period, so show it next to
      // the invoice date — the two often fall in different months.
      { label: 'Statement', render: r => creditorDate(r, 'statement'), sortValue: r => statementSort(r) },
      { label: 'Amount', align: 'right', render: r => formatCurrency(r.amount), sortValue: r => Number(r.amount) || 0 },
    ],
    onRowClick: goToSupplier,
  })

  const openOverallCreditors = () => {
    const rows = [
      ...payables.outstanding_current_invoices.map(r => ({ ...r, _type: 'Outstanding Cash', _date: r.statement_month ? `${MONTH_NAMES[r.statement_month]} ${r.statement_year}` : '—', _sortDate: dateSort(new Date(r.statement_year, (r.statement_month || 1) - 1, 1)), _amount: r.outstanding_amount })),
      ...payables.outstanding_days_30_invoices.map(r => ({ ...r, _type: 'Outstanding 30-Day', _date: r.statement_month ? `${MONTH_NAMES[r.statement_month]} ${r.statement_year}` : '—', _sortDate: dateSort(new Date(r.statement_year, (r.statement_month || 1) - 1, 1)), _amount: r.outstanding_amount })),
      ...payables.paid_current_invoices.map(r => ({ ...r, _type: 'Paid Cash', _date: formatDate(r.paid_date), _sortDate: dateSort(r.paid_date), _amount: r.amount })),
      ...payables.paid_days_30_invoices.map(r => ({ ...r, _type: 'Paid 30-Day', _date: formatDate(r.paid_date), _sortDate: dateSort(r.paid_date), _amount: r.amount })),
    ]
    setDrilldown({
      title: 'Creditors — Overall Total', subtitle: `Paid + Outstanding · ${periodLabel}`,
      rows,
      total: Number(payables.total_current) + Number(payables.total_30_days) + Number(payables.total_paid_current) + Number(payables.total_paid_30_days),
      columns: [
        { label: 'Invoice #', render: r => r.invoice_number || '—' },
        { label: 'Supplier', render: r => r.supplier_name },
        { label: 'Entity', render: r => r.entity_code || '—' },
        { label: 'Type', render: r => r._type },
        { label: 'Date', render: r => r._date, sortValue: r => r._sortDate },
        { label: 'Amount', align: 'right', render: r => formatCurrency(r._amount), sortValue: r => Number(r._amount) || 0 },
      ],
      onRowClick: goToSupplier,
    })
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Dashboard</h1>
          <p style={styles.sub}>Statement period: {periodLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={period.month}
            onChange={e => setPeriod(p => ({ ...p, month: parseInt(e.target.value) }))}
            style={{ width: 130 }}
          >
            {MONTH_NAMES.slice(1).map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <select
            value={period.year}
            onChange={e => setPeriod(p => ({ ...p, year: parseInt(e.target.value) }))}
            style={{ width: 100 }}
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={activeEntity?.id?.toString() || ''} onChange={handleEntityChange} style={{ width: 200 }}>
            {isAdmin && <option value="">All Entities</option>}
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : (stats || payables) && (
        <>
          {/* ── Supplier invoices needing verification (admin) ───────── */}
          {isAdmin && pending.count > 0 && (
            <button
              onClick={() => setShowPending(true)}
              className="card"
              style={{
                display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                textAlign: 'left', cursor: 'pointer', marginBottom: 16,
                border: '1px solid var(--warning)', background: 'rgba(245,158,11,0.06)',
              }}
            >
              <div className="stat-card-icon" style={{ background: '#f59e0b20', color: 'var(--warning)', flexShrink: 0 }}>
                <ClipboardCheck size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {pending.count} supplier invoice{pending.count !== 1 ? 's' : ''} to verify
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Created in the last 7 days and not yet final-locked — click to review
                </div>
              </div>
              <ChevronRight size={18} color="var(--text-muted)" />
            </button>
          )}

          {/* ── Profit & Loss (BTP / Thembi) ─────────────────────────── */}
          {profitLoss?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel
                icon={<Scale size={13} />}
                label={`Profit & Loss · ${periodLabel}`}
              />
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {profitLoss.map(pl => (
                  <ProfitLossCard
                    key={pl.entity_id}
                    pl={pl}
                    onInvoices={() => openPlInvoices(pl)}
                    onSupplierInvoices={() => openPlSupplierInvoices(pl)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── PRIMARY: Creditors (Suppliers) ───────────────────────── */}
          <SectionLabel
            icon={<CreditCard size={13} />}
            label="Creditors (Suppliers)"
            hint="Cash basis: outstanding balances as of now, plus what was actually paid in this period (by payment date) — not what was billed/incurred in this period."
          />
          {payables && (
            <div style={{ display: 'flex', marginBottom: 16 }}>
              <div style={{ maxWidth: 320, width: '100%' }}>
                <StatCard
                  icon={<CreditCard size={20} />}
                  iconBg="#4f8ef720"
                  iconColor="var(--accent)"
                  label="Overall Creditors Total"
                  value={formatCurrency(
                    Number(payables.total_current) + Number(payables.total_30_days) +
                    Number(payables.total_paid_current) + Number(payables.total_paid_30_days)
                  )}
                  sub="Paid + Outstanding"
                  onClick={
                    (payables.outstanding_current_invoices.length || payables.outstanding_days_30_invoices.length ||
                     payables.paid_current_invoices.length || payables.paid_days_30_invoices.length)
                      ? openOverallCreditors : undefined
                  }
                />
              </div>
            </div>
          )}
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <StatCard
              icon={<Clock size={20} />}
              iconBg="#22c55e20"
              iconColor="#16a34a"
              label="Outstanding Cash Creditors"
              value={formatCurrency(payables?.total_current || 0)}
              sub={`Statement ${MONTH_NAMES[period.month]}`}
              onClick={payables?.outstanding_current_invoices?.length ? openOutstandingCashCreditors : undefined}
            />
            <StatCard
              icon={<AlertCircle size={20} />}
              iconBg="#f59e0b20"
              iconColor="var(--warning)"
              label="Outstanding 30-Day Creditors"
              value={formatCurrency(payables?.total_30_days || 0)}
              sub={days30PayLabel}
              onClick={payables?.outstanding_days_30_invoices?.length ? openOutstanding30DayCreditors : undefined}
            />
            <StatCard
              icon={<TrendingUp size={20} />}
              iconBg="#22c55e20"
              iconColor="var(--success)"
              label="Paid Cash Creditors"
              value={formatCurrency(payables?.total_paid_current || 0)}
              sub={`Paid in ${MONTH_NAMES[period.month]}`}
              onClick={payables?.paid_current_invoices?.length ? openPaidCashCreditors : undefined}
            />
            <StatCard
              icon={<TrendingUp size={20} />}
              iconBg="#22c55e20"
              iconColor="var(--success)"
              label="Paid 30-Day Creditors"
              value={formatCurrency(payables?.total_paid_30_days || 0)}
              sub={`Paid in ${MONTH_NAMES[period.month]}`}
              onClick={payables?.paid_days_30_invoices?.length ? openPaid30DayCreditors : undefined}
            />
          </div>

          {/* Diesel Warnings */}
          {dieselWarnings && (dieselWarnings.missing_slip_count > 0 || dieselWarnings.missing_invoice_count > 0) && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Fuel size={15} color="var(--text-muted)" />
                <span style={{ fontSize: 14, fontWeight: 600 }}>Diesel — Needs Attention</span>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {dieselWarnings.missing_slip_count > 0 && (
                  <div className="card" style={{ flex: 1, minWidth: 260 }}>
                    <div style={styles.cardHeader}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Missing Slip #</span>
                      <span style={{ background: 'rgba(239,68,68,0.12)', color: '#dc2626', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>
                        {dieselWarnings.missing_slip_count}
                      </span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {dieselWarnings.missing_slip.slice(0, 5).map(f => (
                        <div key={f.id} style={{ ...styles.payableRow, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 12 }}>{f.truck_registration || '—'}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{f.supplier_name}</span>
                          </div>
                          <span style={{ fontSize: 11, color: f.invoice_number ? 'var(--text-muted)' : 'var(--danger)' }}>
                            {f.invoice_number ? `INV: ${f.invoice_number}` : f.fillup_date}
                          </span>
                        </div>
                      ))}
                      {dieselWarnings.missing_slip_count > 5 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', paddingTop: 6 }}>
                          +{dieselWarnings.missing_slip_count - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {dieselWarnings.missing_invoice_count > 0 && (
                  <div className="card" style={{ flex: 1, minWidth: 260 }}>
                    <div style={styles.cardHeader}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Missing Invoice #</span>
                      <span style={{ background: 'rgba(245,158,11,0.15)', color: '#d97706', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>
                        {dieselWarnings.missing_invoice_count}
                      </span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {dieselWarnings.missing_invoice.slice(0, 5).map(f => (
                        <div key={f.id} style={{ ...styles.payableRow, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 12 }}>{f.truck_registration || '—'}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{f.supplier_name}</span>
                          </div>
                          <span style={{ fontSize: 11, color: f.slip_number ? 'var(--text-muted)' : 'var(--danger)' }}>
                            {f.slip_number ? `Slip: ${f.slip_number}` : f.fillup_date}
                          </span>
                        </div>
                      ))}
                      {dieselWarnings.missing_invoice_count > 5 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', paddingTop: 6 }}>
                          +{dieselWarnings.missing_invoice_count - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Invoices logged in other months — collapsed by default (informational) */}
          {payables?.other_period_payables?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => setShowOtherPeriods(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                {showOtherPeriods ? <ChevronDown size={15} color="var(--text-muted)" /> : <ChevronRight size={15} color="var(--text-muted)" />}
                <span style={{ fontSize: 14, fontWeight: 600 }}>Invoices logged in other months</span>
                <span style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
                  {payables.other_period_payables.length}
                </span>
              </button>
              {showOtherPeriods && (
                <div className="card" style={{ marginTop: 12 }}>
                  {payables.other_period_payables.map(p => (
                    <div key={`${p.supplier_id}-${p.invoice_year}-${p.invoice_month}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                      <div>
                        <Link to={`/suppliers/${p.supplier_id}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
                          {p.supplier_name}
                        </Link>
                        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                          {MONTH_NAMES[p.invoice_month]} {p.invoice_year} · {p.invoice_count} invoice{p.invoice_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <span style={{ fontWeight: 700 }}>{formatCurrency(p.total_outstanding)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── SECONDARY: Debtors (Customers) ────────────────────────── */}
          {stats && (
            <>
              <SectionDivider />
              <SectionLabel
                icon={<Users size={13} />}
                label="Debtors (Customers)"
                hint="Cash basis: outstanding balances as of now, plus what was actually collected in this period (by payment date) — not what was billed/issued in this period. Drafts and quotes aren't counted here."
              />
              <div style={{ display: 'flex', marginBottom: 16 }}>
                <div style={{ maxWidth: 320, width: '100%' }}>
                  <StatCard
                    icon={<Users size={20} />}
                    iconBg="#4f8ef720"
                    iconColor="var(--accent)"
                    label="Overall Debtors Total"
                    value={formatCurrency(Number(stats.outstanding_total) + Number(stats.paid_this_month))}
                    sub="Paid + Outstanding"
                    onClick={(stats.outstanding_invoices.length || stats.paid_invoices.length) ? openOverallDebtors : undefined}
                  />
                </div>
              </div>
              <div className="grid-4" style={{ marginBottom: 16 }}>
                <StatCard
                  icon={<FileText size={20} />}
                  iconBg="#4f8ef720"
                  iconColor="var(--accent)"
                  label="Outstanding Debtors"
                  value={formatCurrency(stats.outstanding_total)}
                  sub={`${stats.total_invoices} invoices total`}
                  onClick={stats.outstanding_invoices?.length ? openOutstandingDebtors : undefined}
                />
                <StatCard
                  icon={<TrendingUp size={20} />}
                  iconBg="#22c55e20"
                  iconColor="var(--success)"
                  label="Paid Debtors"
                  value={formatCurrency(stats.paid_this_month)}
                  sub={`Collected in ${MONTH_NAMES[period.month]}`}
                  onClick={stats.paid_invoices?.length ? openPaidDebtors : undefined}
                />
                <StatCard
                  icon={<AlertCircle size={20} />}
                  iconBg="#ef444420"
                  iconColor="var(--danger)"
                  label="Overdue"
                  value={stats.overdue_count}
                  sub="Require attention"
                />
                <StatCard
                  icon={<Clock size={20} />}
                  iconBg="#f59e0b20"
                  iconColor="var(--warning)"
                  label="Drafts"
                  value={stats.draft_count}
                  sub={`+ ${stats.total_quotes} quotes`}
                />
              </div>
            </>
          )}

          {stats && <div style={styles.grid}>
            {/* Recent Invoices */}
            <div className="card" style={{ flex: 2 }}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Recent Documents</span>
                <button className="btn-ghost btn-sm" onClick={() => navigate('/invoices')}>
                  View all <ChevronRight size={13} />
                </button>
              </div>
              {stats.recent_invoices.length === 0 ? (
                <div className="empty-state" style={{ padding: '30px 0' }}>
                  <FileText size={32} /><p>No documents yet</p>
                </div>
              ) : (
                <table style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Supplier</th>
                      <th>Entity</th>
                      <th>Status</th>
                      <th className="text-right">Amount</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent_invoices.map(inv => (
                      <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                        <td className="font-mono text-accent" style={{ fontSize: 12 }}>{inv.invoice_number}</td>
                        <td>{inv.supplier_name || '—'}</td>
                        <td><span style={styles.entityChip}>{inv.entity_code}</span></td>
                        <td><span className={statusBadgeClass(inv.status)}>{inv.status}</span></td>
                        <td className="text-right font-bold">{formatCurrency(inv.total)}</td>
                        <td className="text-muted">{formatDate(inv.issue_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Entity Breakdown */}
            <div className="card" style={{ flex: 1 }}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Entity Breakdown</span>
                <Building2 size={16} color="var(--text-muted)" />
              </div>
              {stats.entity_breakdown.length === 0 ? (
                <div className="empty-state" style={{ padding: '30px 0' }}>
                  <Building2 size={32} /><p>No data</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                  {stats.entity_breakdown.map(eb => (
                    <div key={eb.entity_id} style={styles.entityRow}>
                      <div style={styles.entityDot} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{eb.entity_code}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{eb.invoice_count} documents</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{formatCurrency(eb.total_invoiced)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>}
        </>
      )}

      {showPending && (
        <PendingInvoicesModal
          invoices={pending.invoices}
          loading={pending.loading}
          onSkip={pending.skip}
          onClose={() => setShowPending(false)}
        />
      )}

      {drilldown && <DrilldownModal {...drilldown} onClose={() => setDrilldown(null)} />}
    </div>
  )
}

function SectionLabel({ icon, label, hint }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {icon}{label}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function SectionDivider() {
  return (
    <div style={{ height: 2, margin: '8px 0 28px', background: 'linear-gradient(90deg, transparent, var(--border) 15%, var(--border) 85%, transparent)' }} />
  )
}

function ProfitLossCard({ pl, onInvoices, onSupplierInvoices }) {
  const profit = Number(pl.profit_loss) >= 0
  const accent = profit ? '#16a34a' : 'var(--danger)'
  return (
    <div className="card" style={{ flex: 1, minWidth: 280 }}>
      <div style={styles.cardHeader}>
        <span style={styles.cardTitle}>{pl.entity_name}</span>
        <span style={styles.entityChip}>{pl.entity_code}</span>
      </div>
      <div style={{ marginTop: 12 }}>
        <PlRow
          label="Invoices generated"
          count={pl.invoices_count}
          amount={formatCurrency(pl.invoices_total)}
          color="#16a34a"
          onClick={pl.invoices_count ? onInvoices : undefined}
        />
        <PlRow
          label="Supplier invoices"
          count={pl.supplier_invoices_count}
          amount={`−${formatCurrency(pl.supplier_invoices_total)}`}
          color="var(--danger)"
          onClick={pl.supplier_invoices_count ? onSupplierInvoices : undefined}
        />
        <div style={{ ...styles.plRow, borderBottom: 'none', marginTop: 4, paddingTop: 12, borderTop: '2px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {profit ? <TrendingUp size={16} color={accent} /> : <TrendingDown size={16} color={accent} />}
            <span style={{ fontSize: 14, fontWeight: 700 }}>{profit ? 'Profit' : 'Loss'}</span>
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: accent }}>{formatCurrency(pl.profit_loss)}</span>
        </div>
      </div>
    </div>
  )
}

function PlRow({ label, count, amount, color, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      title={onClick ? 'Click to see which invoices make up this total' : undefined}
      style={{
        ...styles.plRow,
        ...(onClick
          ? { width: '100%', font: 'inherit', color: 'inherit', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left' }
          : {}),
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          {label}
          {onClick && <ChevronRight size={13} color="var(--text-muted)" />}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {count} invoice{count !== 1 ? 's' : ''}
        </div>
      </div>
      <span style={{ fontWeight: 700, color }}>{amount}</span>
    </Tag>
  )
}

function StatCard({ icon, iconBg, iconColor, label, value, sub, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      className="stat-card"
      onClick={onClick}
      title={onClick ? 'Click to see what makes up this total' : undefined}
      style={onClick ? { textAlign: 'left', cursor: 'pointer', width: '100%', font: 'inherit', color: 'inherit' } : undefined}
    >
      <div className="stat-card-icon" style={{ background: iconBg, color: iconColor }}>{icon}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div className="stat-card-label">{label}</div>
        {onClick && <ChevronRight size={13} color="var(--text-muted)" />}
      </div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-sub">{sub}</div>
    </Tag>
  )
}

const styles = {
  page: { padding: 'var(--page-pad)', flex: 1 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700 },
  sub: { fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 },
  grid: { display: 'flex', gap: 20, alignItems: 'flex-start' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 14, fontWeight: 600 },
  entityChip: {
    background: 'var(--accent-dim)', color: 'var(--accent)',
    fontSize: 10, fontWeight: 700, padding: '2px 6px',
    borderRadius: 4, letterSpacing: 0.5,
  },
  entityRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 0', borderBottom: '1px solid var(--border)',
  },
  entityDot: {
    width: 8, height: 8, borderRadius: '50%',
    background: 'var(--accent)', flexShrink: 0,
  },
  payableRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12,
  },
  plRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12,
  },
}
