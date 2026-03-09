import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDashboardStats } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { formatCurrency, formatDate, statusBadgeClass } from '../utils/helpers'
import { TrendingUp, AlertCircle, FileText, Clock, Building2, ChevronRight } from 'lucide-react'

export default function DashboardPage() {
  const { entities, activeEntity, setActiveEntity, isAdmin } = useAuth()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    getDashboardStats(activeEntity?.id || undefined)
      .then(r => setStats(r.data))
      .finally(() => setLoading(false))
  }, [activeEntity])

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
          <p style={styles.sub}>Business overview across all entities</p>
        </div>
        <select value={activeEntity?.id?.toString() || ''} onChange={handleEntityChange} style={{ width: 200 }}>
          {isAdmin && <option value="">All Entities</option>}
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : stats && (
        <>
          {/* Stat Cards */}
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
              label="Paid This Month"
              value={formatCurrency(stats.paid_this_month)}
              sub="Collected revenue"
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

          <div style={styles.grid}>
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
          </div>
        </>
      )}
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
  page: { padding: '28px 32px', flex: 1 },
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
}
