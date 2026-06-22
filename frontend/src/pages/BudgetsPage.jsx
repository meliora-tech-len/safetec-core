import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import {
  getBudgets, getBudget, createBudget, deleteBudget,
  addBudgetSection, updateBudgetSection, deleteBudgetSection,
  addBudgetLine, deleteBudgetLine, upsertBudgetLineValue, refreshBudgetFromSystem,
} from '../services/api'
import { Wallet, Plus, Trash2, Lock, X, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { errorMessage, formatCurrency } from '../utils/helpers'
import DeleteModal from '../components/DeleteModal'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The spreadsheets track the base month plus the two following months
// (rolling "TO PAY / PAID" column pairs), so the grid shows three months.
const VISIBLE_MONTHS = 3

function periodMonths(month, year) {
  const out = []
  for (let i = 0; i < VISIBLE_MONTHS; i++) {
    const m = ((month - 1 + i) % 12) + 1
    const y = year + Math.floor((month - 1 + i) / 12)
    out.push({ month: m, year: y })
  }
  return out
}

const num = (v) => (v == null || v === '' ? 0 : parseFloat(v) || 0)

export default function BudgetsPage() {
  const { user, isAdmin, entities } = useAuth()
  const now = new Date()

  const [entityId, setEntityId] = useEntityFilter()
  const [month, setMonth] = useSessionState('budgets.month', now.getMonth() + 1)
  const [year, setYear] = useSessionState('budgets.year', now.getFullYear())

  const [budget, setBudget] = useState(null)       // full detail or null
  const [loading, setLoading] = useState(false)
  const [noAccess, setNoAccess] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // budget object
  const [cellEdits, setCellEdits] = useState({})   // `${lineId}:${m}:${y}:${field}` -> string
  const [newLine, setNewLine] = useState({})       // sectionId -> name
  const [newSection, setNewSection] = useState(null) // null | { name, section_type }
  const [refreshing, setRefreshing] = useState(false)
  const [quickAdd, setQuickAdd] = useState(null)   // null | { kind: 'income'|'expense', sectionId, name }

  // Entities this user can see budgets for (admin: all)
  const budgetEntities = useMemo(() => {
    if (isAdmin) return entities || []
    return (entities || []).filter(e =>
      user?.entity_access?.some(a =>
        a.entity_id === e.id && (a.allowed_modules || []).includes('budgets')
      )
    )
  }, [entities, isAdmin, user])

  const months = periodMonths(Number(month), Number(year))

  const loadBudget = useCallback(async () => {
    if (!entityId) { setBudget(null); return }
    setLoading(true)
    setNoAccess(false)
    try {
      const res = await getBudgets({ entity_id: entityId, year })
      const match = (res.data || []).find(b => b.period_month === Number(month) && b.period_year === Number(year))
      if (!match) { setBudget(null); return }
      const detail = await getBudget(match.id)
      setBudget(detail.data)
      setCellEdits({})
    } catch (e) {
      if (e.response?.status === 403) {
        setNoAccess(true)
        setBudget(null)
      } else {
        toast.error(errorMessage(e, 'Failed to load budget'))
      }
    } finally {
      setLoading(false)
    }
  }, [entityId, month, year])

  useEffect(() => { loadBudget() }, [loadBudget])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await createBudget({ entity_id: Number(entityId), period_month: Number(month), period_year: Number(year) })
      setBudget(res.data)
      toast.success('Budget created')
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to create budget'))
    } finally {
      setCreating(false)
    }
  }

  const handleRefresh = async () => {
    if (!budget) return
    setRefreshing(true)
    try {
      const res = await refreshBudgetFromSystem(budget.id)
      setBudget(res.data)
      setCellEdits({})
      toast.success('Pulled latest figures from the system')
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to pull from system'))
    } finally {
      setRefreshing(false)
    }
  }

  // Quick "Add Income" / "Add Expense": pick a matching section + name the line.
  const openQuickAdd = (kind) => {
    const sec = budget?.sections?.find(s => s.section_type === kind)
    setQuickAdd({ kind, sectionId: sec ? sec.id : '', name: '' })
  }

  const submitQuickAdd = async () => {
    if (!quickAdd?.name.trim() || !quickAdd.sectionId) return
    const section = budget.sections.find(s => s.id === Number(quickAdd.sectionId))
    if (!section) return
    try {
      const res = await addBudgetLine(section.id, { name: quickAdd.name.trim() })
      setBudget(b => ({
        ...b,
        sections: b.sections.map(s =>
          s.id === section.id ? { ...s, lines: [...s.lines, { ...res.data, values: [] }] } : s
        ),
      }))
      setQuickAdd(null)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to add line'))
    }
  }

  const handleDelete = async () => {
    try {
      await deleteBudget(confirmDelete.id)
      toast.success('Budget deleted')
      setConfirmDelete(null)
      setBudget(null)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete budget'))
    }
  }

  const handleAddSection = async () => {
    if (!newSection?.name?.trim()) return
    try {
      const res = await addBudgetSection(budget.id, { name: newSection.name.trim(), section_type: newSection.section_type })
      setBudget(b => ({ ...b, sections: [...b.sections, { ...res.data, lines: [] }] }))
      setNewSection(null)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to add section'))
    }
  }

  const handleDeleteSection = async (section) => {
    try {
      await deleteBudgetSection(section.id)
      setBudget(b => ({ ...b, sections: b.sections.filter(s => s.id !== section.id) }))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete section'))
    }
  }

  const handleAddLine = async (section) => {
    const name = (newLine[section.id] || '').trim()
    if (!name) return
    try {
      const res = await addBudgetLine(section.id, { name })
      setBudget(b => ({
        ...b,
        sections: b.sections.map(s =>
          s.id === section.id ? { ...s, lines: [...s.lines, { ...res.data, values: [] }] } : s
        ),
      }))
      setNewLine(p => ({ ...p, [section.id]: '' }))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to add line'))
    }
  }

  const handleDeleteLine = async (section, line) => {
    try {
      await deleteBudgetLine(line.id)
      setBudget(b => ({
        ...b,
        sections: b.sections.map(s =>
          s.id === section.id ? { ...s, lines: s.lines.filter(l => l.id !== line.id) } : s
        ),
      }))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete line'))
    }
  }

  const valueFor = (line, m, y) => (line.values || []).find(v => v.month === m && v.year === y)

  const cellKey = (lineId, m, y, field) => `${lineId}:${m}:${y}:${field}`

  const cellValue = (line, m, y, field) => {
    const key = cellKey(line.id, m, y, field)
    if (key in cellEdits) return cellEdits[key]
    const v = valueFor(line, m, y)?.[field]
    return v == null ? '' : String(parseFloat(v))
  }

  const commitCell = async (line, m, y, field) => {
    const key = cellKey(line.id, m, y, field)
    if (!(key in cellEdits)) return
    const raw = cellEdits[key]
    const stored = valueFor(line, m, y)?.[field]
    const storedStr = stored == null ? '' : String(parseFloat(stored))
    if (raw === storedStr) {
      setCellEdits(p => { const q = { ...p }; delete q[key]; return q })
      return
    }
    try {
      const res = await upsertBudgetLineValue(line.id, {
        month: m, year: y, [field]: raw === '' ? null : parseFloat(raw),
      })
      setBudget(b => ({
        ...b,
        sections: b.sections.map(s => ({
          ...s,
          lines: s.lines.map(l => {
            if (l.id !== line.id) return l
            const others = (l.values || []).filter(v => !(v.month === m && v.year === y))
            return { ...l, values: [...others, res.data] }
          }),
        })),
      }))
      setCellEdits(p => { const q = { ...p }; delete q[key]; return q })
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save amount'))
    }
  }

  // ── Totals ──────────────────────────────────────────────────────────────────
  const sectionTotal = (section, m, y, field) =>
    section.lines.reduce((sum, l) => sum + num(valueFor(l, m, y)?.[field]), 0)

  const totals = useMemo(() => {
    if (!budget) return null
    let income = 0, expensesDue = 0, expensesPaid = 0
    for (const s of budget.sections) {
      for (const l of s.lines) {
        for (const v of l.values || []) {
          if (s.section_type === 'income') income += num(v.amount_due)
          else { expensesDue += num(v.amount_due); expensesPaid += num(v.amount_paid) }
        }
      }
    }
    return { income, expensesDue, expensesPaid, leftOver: income - expensesDue - expensesPaid }
  }, [budget])

  const selectedEntity = budgetEntities.find(e => String(e.id) === String(entityId))

  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>
      {/* Header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wallet size={22} style={{ color: 'var(--accent)' }} />
            Budgets
          </div>
          <div className="page-subtitle">Entity cash-flow budget — income vs supplier payments per month</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="form-input" style={{ width: 'auto' }} value={entityId} onChange={e => setEntityId(e.target.value)}>
            <option value="">Select entity…</option>
            {budgetEntities.map(e => (
              <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
            ))}
          </select>
          <select className="form-input" style={{ width: 'auto' }} value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="form-input" style={{ width: 'auto' }} value={year} onChange={e => setYear(Number(e.target.value))}>
            {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* No entity selected */}
      {!entityId && (
        <div className="card" style={{ padding: 0 }}>
          <div className="empty-state">
            <Wallet size={32} />
            <p>Select an entity to view its budget</p>
          </div>
        </div>
      )}

      {/* No budget permission for this entity */}
      {entityId && noAccess && (
        <div className="card" style={{ padding: 0 }}>
          <div className="empty-state">
            <Lock size={32} />
            <p>You don&apos;t have permission to view budgets for {selectedEntity?.code || 'this entity'}</p>
          </div>
        </div>
      )}

      {entityId && !noAccess && loading && (
        <div className="loading-center">
          <div className="spinner" />
        </div>
      )}

      {/* No budget yet for this period */}
      {entityId && !noAccess && !loading && !budget && (
        <div className="card" style={{ padding: 0 }}>
          <div className="empty-state">
            <Wallet size={32} />
            <p>No budget for {selectedEntity?.code} — {MONTHS[Number(month) - 1]} {year}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6 }}>
              Creating it pulls suppliers, income, sub-contractors and wages from the system — then you edit and add the rest.
            </p>
            <button className="btn-primary" onClick={handleCreate} disabled={creating}>
              <Plus size={15} /> {creating ? 'Creating…' : 'Create Budget'}
            </button>
          </div>
        </div>
      )}

      {/* Budget grid */}
      {entityId && !noAccess && !loading && budget && (
        <>
          {/* Summary */}
          <div className="grid-4" style={{ marginBottom: 24 }}>
            {[
              { label: 'Income', value: totals.income },
              { label: 'Expenses — To Pay', value: totals.expensesDue },
              { label: 'Expenses — Paid', value: totals.expensesPaid },
              { label: 'Left Over', value: totals.leftOver, cls: totals.leftOver < 0 ? ' text-danger' : ' text-success' },
            ].map(c => (
              <div key={c.label} className="stat-card">
                <div className="stat-card-label">{c.label}</div>
                <div className={`stat-card-value${c.cls || ''}`} style={{ fontSize: 24 }}>{formatCurrency(c.value)}</div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <button className="btn-primary btn-sm" onClick={handleRefresh} disabled={refreshing} title="Re-pull suppliers, income, sub-contractors and wages from the system. Your manual lines and edits are kept.">
              <RefreshCw size={14} className={refreshing ? 'spin' : undefined} /> {refreshing ? 'Pulling…' : 'Pull from system'}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => openQuickAdd('income')}>
              <TrendingUp size={14} /> Add Income
            </button>
            <button className="btn-ghost btn-sm" onClick={() => openQuickAdd('expense')}>
              <TrendingDown size={14} /> Add Expense
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
              Lines marked <span className="badge badge-sent" style={{ fontSize: 10 }}>auto</span> come from the system — edit any cell to pin it.
            </span>
          </div>

          {/* Quick add income/expense */}
          {quickAdd && (
            <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13 }}>{quickAdd.kind === 'income' ? 'Add income line' : 'Add expense line'}</strong>
              <select className="form-input" style={{ width: 'auto', fontSize: 12 }} value={quickAdd.sectionId}
                onChange={e => setQuickAdd(p => ({ ...p, sectionId: e.target.value }))}>
                <option value="">Section…</option>
                {budget.sections.filter(s => s.section_type === quickAdd.kind).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input className="form-input" autoFocus style={{ width: 260, fontSize: 12 }}
                placeholder={quickAdd.kind === 'income' ? 'Income source name' : 'Expense / supplier name'}
                value={quickAdd.name}
                onChange={e => setQuickAdd(p => ({ ...p, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') submitQuickAdd() }} />
              <button className="btn-primary btn-sm" onClick={submitQuickAdd} disabled={!quickAdd.name.trim() || !quickAdd.sectionId}>Add</button>
              <button className="btn-ghost btn-sm" onClick={() => setQuickAdd(null)}>Cancel</button>
            </div>
          )}

          {/* Sections */}
          {budget.sections.map(section => {
            const isIncome = section.section_type === 'income'
            return (
              <div key={section.id} className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{section.name}</span>
                    <span className={`badge ${isIncome ? 'badge-paid' : 'badge-sent'}`}>
                      {isIncome ? 'Income' : 'Expense'}
                    </span>
                  </div>
                  <button className="btn-icon" onClick={() => handleDeleteSection(section)} title="Delete section"
                    style={{ color: 'var(--danger)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="compact-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        {months.map(({ month: m, year: y }) => (
                          isIncome
                            ? <th key={`${m}-${y}`} style={{ textAlign: 'right' }}>{MONTHS[m - 1]} {y}</th>
                            : [
                                <th key={`${m}-${y}-due`} style={{ textAlign: 'right' }}>{MONTHS[m - 1]} To Pay</th>,
                                <th key={`${m}-${y}-paid`} style={{ textAlign: 'right' }}>{MONTHS[m - 1]} Paid</th>,
                              ]
                        ))}
                        <th style={{ width: 36 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.lines.map(line => (
                        <tr key={line.id}>
                          <td style={{ fontWeight: 500, minWidth: 180, whiteSpace: 'nowrap' }}>
                            {line.name}
                            {line.source === 'auto' && (
                              <span className="badge badge-sent" style={{ fontSize: 9, marginLeft: 6, verticalAlign: 'middle' }}>auto</span>
                            )}
                          </td>
                          {months.map(({ month: m, year: y }) => {
                            const fields = isIncome ? ['amount_due'] : ['amount_due', 'amount_paid']
                            return fields.map(field => {
                              const overridden = !!valueFor(line, m, y)?.is_overridden
                              return (
                              <td key={`${m}-${y}-${field}`} style={{ textAlign: 'right', width: 110, padding: '3px 8px' }}>
                                <input
                                  type="number" step="0.01"
                                  value={cellValue(line, m, y, field)}
                                  onChange={e => setCellEdits(p => ({ ...p, [cellKey(line.id, m, y, field)]: e.target.value }))}
                                  onBlur={() => commitCell(line, m, y, field)}
                                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                  placeholder="—"
                                  title={overridden ? 'Manually edited — a system refresh will not change this' : undefined}
                                  style={overridden ? cellInputOverridden : cellInputStyle}
                                />
                              </td>
                              )
                            })
                          })}
                          <td style={{ textAlign: 'center' }}>
                            <button className="btn-icon" onClick={() => handleDeleteLine(section, line)} title="Delete line"
                              style={{ color: 'var(--text-muted)', padding: 3 }}>
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}

                      {/* Section totals */}
                      {section.lines.length > 0 && (
                        <tr style={{ background: 'var(--bg-surface)' }}>
                          <td style={{ fontWeight: 700 }}>Total</td>
                          {months.map(({ month: m, year: y }) => {
                            const fields = isIncome ? ['amount_due'] : ['amount_due', 'amount_paid']
                            return fields.map(field => (
                              <td key={`${m}-${y}-${field}`} style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {formatCurrency(sectionTotal(section, m, y, field))}
                              </td>
                            ))
                          })}
                          <td></td>
                        </tr>
                      )}

                      {/* Add line */}
                      <tr>
                        <td colSpan={1 + months.length * (isIncome ? 1 : 2) + 1}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              style={{ maxWidth: 320, fontSize: 12, padding: '5px 9px' }}
                              placeholder="Add item (supplier, income source…)"
                              value={newLine[section.id] || ''}
                              onChange={e => setNewLine(p => ({ ...p, [section.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') handleAddLine(section) }}
                            />
                            <button className="btn-ghost btn-sm" onClick={() => handleAddLine(section)} disabled={!(newLine[section.id] || '').trim()}>
                              <Plus size={13} /> Add
                            </button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* Add section + delete budget */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            {newSection ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="form-input" autoFocus
                  style={{ width: 240, fontSize: 12 }}
                  placeholder="Section name"
                  value={newSection.name}
                  onChange={e => setNewSection(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddSection() }}
                />
                <select className="form-input" style={{ width: 'auto', fontSize: 12 }} value={newSection.section_type}
                  onChange={e => setNewSection(p => ({ ...p, section_type: e.target.value }))}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <button className="btn-primary btn-sm" onClick={handleAddSection}>Add</button>
                <button className="btn-ghost btn-sm" onClick={() => setNewSection(null)}>Cancel</button>
              </div>
            ) : (
              <button className="btn-ghost btn-sm" onClick={() => setNewSection({ name: '', section_type: 'expense' })}>
                <Plus size={13} /> Add Section
              </button>
            )}

            <button className="btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(budget)}>
              <Trash2 size={13} /> Delete Budget
            </button>
          </div>
        </>
      )}

      <DeleteModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onDelete={handleDelete}
        title="Delete Budget"
        description={confirmDelete
          ? `Delete the ${MONTHS[confirmDelete.period_month - 1]} ${confirmDelete.period_year} budget for ${selectedEntity?.code || ''}? All sections, lines and amounts will be removed.`
          : ''}
      />
    </div>
  )
}

const cellInputStyle = {
  width: 100, textAlign: 'right', fontSize: 12.5,
  background: 'transparent', border: '1px solid transparent', borderRadius: 5,
  padding: '4px 6px', color: 'var(--text-primary)', outline: 'none',
}

// A pinned (manually edited) auto cell — subtle accent border so the user can see
// which figures they've overridden and that a refresh won't touch them.
const cellInputOverridden = {
  ...cellInputStyle,
  border: '1px solid var(--accent)',
  fontWeight: 600,
}
