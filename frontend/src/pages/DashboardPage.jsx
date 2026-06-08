import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getDashboardStats, getSupplierPayablesDashboard, getDieselWarnings } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, statusBadgeClass } from '../utils/helpers'
import { TrendingUp, AlertCircle, FileText, Clock, Building2, ChevronRight, ChevronDown, CreditCard, Fuel } from 'lucide-react'

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function DashboardPage() {
  const { entities, activeEntity, setActiveEntity, isAdmin } = useAuth()
  const [stats, setStats] = useState(null)
  const [payables, setPayables] = useState(null)
  const [dieselWarnings, setDieselWarnings] = useState(null)
  const [showOtherPeriods, setShowOtherPeriods] = useState(false)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return { month: d.getMonth() + 1, year: d.getFullYear() }
  })
  const navigate = useNavigate()

  const periodLabel = `${MONTH_NAMES[period.month]} ${period.year}`
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
    ]).then(([statsRes, payablesRes, warningsRes]) => {
      if (!ignore) {
        setStats(statsRes.data)
        setPayables(payablesRes.data)
        setDieselWarnings(warningsRes.data)
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
          {/* ── PRIMARY: Supplier Payables ───────────────────────────── */}
          <SectionLabel icon={<CreditCard size={13} />} label="Supplier Payables" />
          <div className="grid-4" style={{ marginBottom: 24 }}>
            <StatCard
              icon={<CreditCard size={20} />}
              iconBg="#ef444420"
              iconColor="var(--danger)"
              label="Total Outstanding"
              value={formatCurrency(payables?.total_all_outstanding || 0)}
              sub="All unpaid supplier invoices"
            />
            <StatCard
              icon={<TrendingUp size={20} />}
              iconBg="#22c55e20"
              iconColor="var(--success)"
              label={`Paid in ${MONTH_NAMES[period.month]}`}
              value={formatCurrency(payables?.total_paid_this_month || 0)}
              sub="Supplier payments made"
            />
            <StatCard
              icon={<Clock size={20} />}
              iconBg="#22c55e20"
              iconColor="#16a34a"
              label="Current / Cash"
              value={formatCurrency(payables?.total_current || 0)}
              sub={`Statement ${MONTH_NAMES[period.month]}`}
            />
            <StatCard
              icon={<AlertCircle size={20} />}
              iconBg="#f59e0b20"
              iconColor="var(--warning)"
              label="30-Day"
              value={formatCurrency(payables?.total_30_days || 0)}
              sub="Due 7th of next month"
            />
          </div>

          {payables && (payables.current_payables.length > 0 || payables.days_30_payables.length > 0 || payables.total_paid_this_month > 0) && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Breakdown by supplier</span>
              </div>
              {(payables.current_payables.length > 0 || payables.days_30_payables.length > 0) && <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {payables.current_payables.length > 0 && (
                  <div className="card" style={{ flex: 1, minWidth: 260 }}>
                    <div style={styles.cardHeader}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Current / Cash</span>
                      <span style={styles.greenBadge}>Due this month</span>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {payables.current_payables.map(p => (
                        <div key={p.supplier_id} style={styles.payableRow}>
                          <div>
                            <Link to={`/suppliers/${p.supplier_id}`} style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none' }}>
                              {p.supplier_name}
                            </Link>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.invoice_count} invoice{p.invoice_count !== 1 ? 's' : ''}</div>
                          </div>
                          <span style={{ fontWeight: 700 }}>{formatCurrency(p.total_outstanding)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {payables.days_30_payables.length > 0 && (
                  <div className="card" style={{ flex: 1, minWidth: 260 }}>
                    <div style={styles.cardHeader}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>30 Days</span>
                      <span style={styles.amberBadge}>Pay on 7th</span>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {payables.days_30_payables.map(p => (
                        <div key={`${p.supplier_id}-${p.statement_year}-${p.statement_month}`} style={styles.payableRow}>
                          <div>
                            <Link to={`/suppliers/${p.supplier_id}`} style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none' }}>
                              {p.supplier_name}
                            </Link>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {MONTH_NAMES[p.statement_month]} {p.statement_year} · {p.invoice_count} invoice{p.invoice_count !== 1 ? 's' : ''}
                              {p.due_date && ` · Due ${formatDate(p.due_date)}`}
                            </div>
                          </div>
                          <span style={{ fontWeight: 700 }}>{formatCurrency(p.total_outstanding)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>}
            </div>
          )}

          {/* Diesel Warnings */}
          {dieselWarnings && (dieselWarnings.missing_slip_count > 0 || dieselWarnings.missing_invoice_count > 0) && (
            <div style={{ marginBottom: 24 }}>
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
            <div style={{ marginBottom: 24 }}>
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

          {/* ── SECONDARY: Outgoing Invoices ────────────────────────── */}
          {stats && (
            <>
              <SectionLabel icon={<FileText size={13} />} label="Outgoing Invoices" />
              <div className="grid-4" style={{ marginBottom: 24 }}>
                <StatCard
                  icon={<FileText size={20} />}
                  iconBg="#4f8ef720"
                  iconColor="var(--accent)"
                  label="Outstanding"
                  value={formatCurrency(stats.outstanding_total)}
                  sub={`${stats.total_invoices} invoices total`}
                />
                <StatCard
                  icon={<TrendingUp size={20} />}
                  iconBg="#22c55e20"
                  iconColor="var(--success)"
                  label={`Collected in ${MONTH_NAMES[period.month]}`}
                  value={formatCurrency(stats.paid_this_month)}
                  sub="Revenue received"
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
    </div>
  )
}

function SectionLabel({ icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {icon}{label}
    </div>
  )
}

function StatCard({ icon, iconBg, iconColor, label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ background: iconBg, color: iconColor }}>{icon}</div>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-sub">{sub}</div>
    </div>
  )
}

const styles = {
  page: { padding: 'var(--page-pad)', flex: 1 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
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
  greenBadge: {
    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
    background: 'rgba(34,197,94,0.15)', color: '#16a34a',
  },
  amberBadge: {
    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
    background: 'rgba(245,158,11,0.15)', color: '#d97706',
  },
}
