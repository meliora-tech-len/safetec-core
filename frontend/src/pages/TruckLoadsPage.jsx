import { useState, useEffect, useCallback, Fragment, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Package, Search, X, ChevronRight, AlertCircle, CheckCircle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import { getFleetTrucks, getTruckFleetSummary, getDieselInvoiceReconciliation } from '../services/api'
import { formatCurrency } from '../utils/helpers'
import toast from 'react-hot-toast'

const STATUS_COLOURS = {
  active:      { badge: 'badge-paid',      label: 'Active' },
  inactive:    { badge: 'badge-cancelled', label: 'Inactive' },
  maintenance: { badge: 'badge-quote',     label: 'Maint.' },
}

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const currentMonth = () => new Date().getMonth() + 1
const currentYear  = () => new Date().getFullYear()

// ── Shared period + entity selector ──────────────────────────────────────────

function PeriodEntityBar({ month, setMonth, year, setYear, entityId, setEntityId, entities, isAdmin }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      {isAdmin && (
        <select value={entityId} onChange={e => setEntityId(e.target.value)} style={{ minWidth: 180 }}>
          <option value="">All entities</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      )}
      <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ minWidth: 130 }}>
        {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
      </select>
      <input type="number" value={year} onChange={e => setYear(Number(e.target.value))}
        style={{ width: 80 }} min={2020} max={2099} />
    </div>
  )
}

// ── Fleet tab ─────────────────────────────────────────────────────────────────

function FleetTab({ entities, isAdmin }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlEntityId = searchParams.get('entity_id') || ''

  const [trucks, setTrucks]             = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [filterEntity, setFilterEntity] = useEntityFilter(urlEntityId)
  const [filterSub, setFilterSub]       = useState('')

  const obhiId = useMemo(() => entities.find(e => e.code === 'OBHI')?.id?.toString(), [entities])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: 500 }
      if (filterEntity)     params.entity_id        = filterEntity
      if (filterSub !== '') params.is_subcontractor = filterSub
      if (filterEntity && filterEntity === obhiId) params.extra_context = 'Intsimbi'
      const res = await getFleetTrucks(params)
      setTrucks(res.data)
    } catch {
      toast.error('Failed to load trucks')
    } finally {
      setLoading(false)
    }
  }, [filterEntity, filterSub, obhiId])

  useEffect(() => { load() }, [load])

  const entityCode = (id) => entities.find(e => e.id === id)?.code || ''

  const displayGroup = (t) =>
    t.is_subcontractor
      ? (t.subcontractor_display_name || t.contract_context || 'Unknown Subcontractor')
      : (entityCode(t.entity_id) || 'Own Fleet')

  const sorted = useMemo(() => {
    const base = search
      ? trucks.filter(t =>
          t.registration.toLowerCase().includes(search.toLowerCase()) ||
          (t.make || '').toLowerCase().includes(search.toLowerCase()) ||
          (t.operator || '').toLowerCase().includes(search.toLowerCase()) ||
          (t.subcontractor_display_name || '').toLowerCase().includes(search.toLowerCase())
        )
      : trucks
    return [...base].sort((a, b) => {
      const ga = displayGroup(a), gb = displayGroup(b)
      if (ga !== gb) return ga.localeCompare(gb)
      const fa = parseInt(a.fleet_number) || 9999
      const fb = parseInt(b.fleet_number) || 9999
      if (fa !== fb) return fa - fb
      return a.registration.localeCompare(b.registration)
    })
  }, [trucks, search])

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-bar" style={{ flex: '1 1 200px', minWidth: 180 }}>
          <Search size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter' && sorted.length === 1) navigate(`/truck-loads/${sorted[0].id}`) }}
                 placeholder="Search reg, make, sub-fleet…" />
          {search && <button className="btn-icon" onClick={() => setSearch('')} style={{ padding: 0, background: 'none' }}><X size={13} /></button>}
        </div>
        {isAdmin && (
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
            <option value="">All entities</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty-state"><Package size={40} /><p>No trucks found{search ? ` for "${search}"` : ''}</p></div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Registration</th><th>Make / Model</th><th>Status</th><th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((truck, i) => {
                const prev = i > 0 ? sorted[i - 1] : null
                const sc = STATUS_COLOURS[truck.status] || STATUS_COLOURS.active
                const groupChanged = !prev || displayGroup(prev) !== displayGroup(truck)
                return (
                  <Fragment key={truck.id}>
                    {groupChanged && (
                      <tr style={{ background: 'var(--bg-base)', borderTop: i === 0 ? 'none' : '2px solid var(--border)' }}>
                        <td colSpan={4} style={{ padding: '12px 16px 6px', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          {displayGroup(truck)}
                        </td>
                      </tr>
                    )}
                    <tr style={{ cursor: 'pointer' }} className="hoverable-row" onClick={() => navigate(`/truck-loads/${truck.id}`)}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, paddingLeft: 28 }}>{truck.registration}</td>
                      <td style={{ color: 'var(--text-secondary)', paddingLeft: 28 }}>{truck.make}{truck.model ? ` ${truck.model}` : ''}</td>
                      <td><span className={`badge ${sc.badge}`}>{sc.label}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}><ChevronRight size={15} /></td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ── Summary tab (entity-specific) ────────────────────────────────────────────

function SummaryTab({ entities, isAdmin }) {
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useSessionState('period:truck-loads:month', currentMonth())
  const [year, setYear]       = useSessionState('period:truck-loads:year', currentYear())
  const [entityId, setEntityId] = useEntityFilter()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { statement_month: month, statement_year: year }
      if (entityId) params.entity_id = entityId
      const res = await getTruckFleetSummary(params)
      setRows(res.data)
    } catch {
      toast.error('Failed to load summary')
    } finally {
      setLoading(false)
    }
  }, [month, year, entityId])

  useEffect(() => { load() }, [load])

  const totalMissing = rows.reduce((s, r) => s + r.loads_missing_invoice, 0)
  const fmt2 = (v) => Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const totals = useMemo(() => ({
    loads:   rows.reduce((s, r) => s + r.total_loads, 0),
    tonnes:  rows.reduce((s, r) => s + Number(r.total_tonnes), 0),
    excl:    rows.reduce((s, r) => s + Number(r.total_excl_vat), 0),
    incl:    rows.reduce((s, r) => s + Number(r.total_incl_vat), 0),
    missing: totalMissing,
  }), [rows])

  return (
    <>
      <PeriodEntityBar month={month} setMonth={setMonth} year={year} setYear={setYear}
        entityId={entityId} setEntityId={setEntityId} entities={entities} isAdmin={isAdmin} />

      {totalMissing > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14,
                      padding: '8px 14px', borderRadius: 6, background: 'rgba(217,119,6,0.08)',
                      border: '1px solid rgba(217,119,6,0.3)', fontSize: 13, color: '#d97706', fontWeight: 600 }}>
          <AlertCircle size={14} />
          {totalMissing} load{totalMissing !== 1 ? 's' : ''} missing diesel invoice
        </div>
      )}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><Package size={40} /><p>No loads found for {MONTHS[month]} {year}</p></div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Fleet #</th>
                <th>Registration</th>
                <th style={{ textAlign: 'right' }}>Loads</th>
                <th style={{ textAlign: 'right' }}>Tonnes</th>
                <th style={{ textAlign: 'right' }}>Excl VAT</th>
                <th style={{ textAlign: 'right' }}>Incl VAT</th>
                <th style={{ textAlign: 'right' }}>Missing Invoice</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.truck_id} className="hoverable-row" style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/truck-loads/${r.truck_id}`)}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.fleet_number || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.truck_registration}</td>
                  <td style={{ textAlign: 'right' }}>{r.total_loads}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{fmt2(r.total_tonnes)} t</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{formatCurrency(r.total_excl_vat)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{formatCurrency(r.total_incl_vat)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.loads_missing_invoice > 0 ? (
                      <span style={{ color: '#d97706', fontWeight: 700, fontSize: 12,
                                     padding: '2px 8px', background: 'rgba(217,119,6,0.1)', borderRadius: 4 }}>
                        ⚠ {r.loads_missing_invoice}
                      </span>
                    ) : (
                      <span style={{ color: '#16a34a', fontSize: 12 }}>✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)', fontWeight: 700 }}>
                <td colSpan={2} style={{ padding: '8px 12px', fontSize: 12 }}>Total</td>
                <td style={{ textAlign: 'right', padding: '8px 12px' }}>{totals.loads}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px 12px' }}>{fmt2(totals.tonnes)} t</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px 12px' }}>{formatCurrency(totals.excl)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px 12px' }}>{formatCurrency(totals.incl)}</td>
                <td style={{ textAlign: 'right', padding: '8px 12px', color: totals.missing > 0 ? '#d97706' : '#16a34a' }}>
                  {totals.missing > 0 ? `⚠ ${totals.missing}` : '✓ All linked'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  )
}

// ── Diesel Totals tab ─────────────────────────────────────────────────────────

function DieselTotalsTab({ entities, isAdmin }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useSessionState('period:truck-loads:month', currentMonth())
  const [year, setYear]       = useSessionState('period:truck-loads:year', currentYear())
  const [entityId, setEntityId] = useEntityFilter()

  const load = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    try {
      const res = await getDieselInvoiceReconciliation({
        entity_id: entityId,
        statement_month: month,
        statement_year: year,
      })
      setRows(res.data)
    } catch {
      toast.error('Failed to load diesel totals')
    } finally {
      setLoading(false)
    }
  }, [entityId, month, year])

  useEffect(() => { load() }, [load])

  const hasDiscrepancy = rows.some(r => !r.is_matched)
  const fmt2 = (v) => Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <>
      <PeriodEntityBar month={month} setMonth={setMonth} year={year} setYear={setYear}
        entityId={entityId} setEntityId={setEntityId} entities={entities} isAdmin={isAdmin} />

      {!entityId ? (
        <div className="empty-state"><Package size={40} /><p>Select an entity to view diesel totals</p></div>
      ) : loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><Package size={40} /><p>No diesel invoices for {MONTHS[month]} {year}</p></div>
      ) : (
        <>
          {hasDiscrepancy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14,
                          padding: '8px 14px', borderRadius: 6, background: 'rgba(220,38,38,0.07)',
                          border: '1px solid rgba(220,38,38,0.25)', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
              <AlertCircle size={14} />
              Discrepancy found — invoice and fill-up totals do not match
            </div>
          )}
          {!hasDiscrepancy && rows.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14,
                          padding: '8px 14px', borderRadius: 6, background: 'rgba(22,163,74,0.07)',
                          border: '1px solid rgba(22,163,74,0.25)', fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
              <CheckCircle size={14} />
              All diesel totals reconciled — invoices match fill-up records
            </div>
          )}

          <div className="card" style={{ overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th style={{ textAlign: 'right' }}>Invoices</th>
                  <th style={{ textAlign: 'right' }}>Invoice Total</th>
                  <th style={{ textAlign: 'right' }}>Fill-up Records</th>
                  <th style={{ textAlign: 'right' }}>Fill-up Total</th>
                  <th style={{ textAlign: 'right' }}>Difference</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.supplier_id} style={{ background: !r.is_matched ? 'rgba(220,38,38,0.04)' : 'transparent' }}>
                    <td style={{ fontWeight: 600 }}>{r.supplier_name}</td>
                    <td style={{ textAlign: 'right' }}>{r.invoice_count}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      R&nbsp;{fmt2(r.invoice_total)}
                    </td>
                    <td style={{ textAlign: 'right', color: r.fillup_count === 0 ? '#d97706' : 'inherit' }}>
                      {r.fillup_count === 0 ? '⚠ 0' : r.fillup_count}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      R&nbsp;{fmt2(r.fillup_total)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                                 color: Number(r.difference) === 0 ? 'var(--text-muted)'
                                      : Number(r.difference) > 0 ? '#dc2626' : '#d97706',
                                 fontWeight: Number(r.difference) !== 0 ? 700 : 400 }}>
                      {Number(r.difference) === 0 ? '—' : `R ${fmt2(r.difference)}`}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.is_matched ? (
                        <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>✓ Matched</span>
                      ) : (
                        <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 12 }}>✕ Mismatch</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)', fontWeight: 700 }}>
                  <td style={{ padding: '8px 12px', fontSize: 12 }}>Total</td>
                  <td style={{ textAlign: 'right', padding: '8px 12px' }}>
                    {rows.reduce((s, r) => s + r.invoice_count, 0)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px 12px' }}>
                    R&nbsp;{fmt2(rows.reduce((s, r) => s + Number(r.invoice_total), 0))}
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 12px' }}>
                    {rows.reduce((s, r) => s + r.fillup_count, 0)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px 12px' }}>
                    R&nbsp;{fmt2(rows.reduce((s, r) => s + Number(r.fillup_total), 0))}
                  </td>
                  <td colSpan={2} style={{ padding: '8px 12px' }} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  )
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function TruckLoadsPage() {
  const { entities, isAdmin } = useAuth()
  const [tab, setTab] = useState('fleet')

  const TABS = [
    ['fleet',   'Fleet'],
    ['summary', 'Summary'],
    ['diesel',  'Diesel Totals'],
  ]

  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>

      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Package size={22} style={{ color: 'var(--accent)' }} />
            Truck Loads
          </div>
          <div className="page-subtitle">
            {tab === 'fleet'   ? 'Select a truck to view and log its loads'
           : tab === 'summary' ? 'Loads overview per truck for the selected period'
           :                     'Diesel invoice vs fill-up reconciliation'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: tab === key ? 700 : 400,
              color: tab === key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -2,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'fleet'   && <FleetTab entities={entities} isAdmin={isAdmin} />}
      {tab === 'summary' && <SummaryTab entities={entities} isAdmin={isAdmin} />}
      {tab === 'diesel'  && <DieselTotalsTab entities={entities} isAdmin={isAdmin} />}
    </div>
  )
}
