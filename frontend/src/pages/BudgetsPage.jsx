import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import {
  getBudgets, getBudget, createBudget, deleteBudget,
  addBudgetSection, updateBudgetSection, deleteBudgetSection,
  addBudgetLine, deleteBudgetLine, upsertBudgetLineValue, refreshBudgetFromSystem,
  getVerifications, verifyValue, finalizeValue, getSuppliers, updateSupplier,
  getBudgetLineTemplates, createBudgetLineTemplate, updateBudgetLineTemplate, deleteBudgetLineTemplate,
} from '../services/api'
import { Wallet, Plus, Trash2, Lock, X, RefreshCw, TrendingUp, TrendingDown, ChevronUp, ChevronDown, ChevronsUpDown, Ban, Search, ListChecks } from 'lucide-react'
import toast from 'react-hot-toast'
import { errorMessage, formatCurrency } from '../utils/helpers'
import DeleteModal from '../components/DeleteModal'
import VerifiableAmount from '../components/VerifiableAmount'
import SearchableSelect from '../components/SearchableSelect'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The spreadsheets track the base month plus the two following months
// (rolling "TO PAY / PAID" column pairs), so the grid shows three months.
const VISIBLE_MONTHS = 3

// Entities whose budget is a single STATEMENT PERIOD: the selected month is the
// statement period and the grid shows [statement-1, statement]. 30-day invoices
// land in the previous month, cash in the statement month. Empty for now — OBHI
// used to be statement-period but now uses the standard rolling window like every
// other entity (selecting May shows May/June/July). (Mirror the backend
// STATEMENT_PERIOD_ENTITIES.)
const STATEMENT_PERIOD_ENTITIES = []

// Mirrors the backend's DEFAULT_SECTIONS names — the set a constant line can target.
const CONSTANT_SECTION_OPTIONS = [
  'INCOME', '30 DAY SUPPLIERS', 'CASH / CURRENT SUPPLIERS', 'DIESEL',
  'INTERCOMPANY INVOICES', 'SUB CONTRACTORS', 'DEBIT ORDERS', 'WAGES', 'OTHER',
]

function periodMonths(month, year, statementMode = false) {
  if (statementMode) {
    const prevM = month === 1 ? 12 : month - 1
    const prevY = month === 1 ? year - 1 : year
    return [{ month: prevM, year: prevY }, { month, year }]
  }
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
  const [verif, setVerif] = useState({})           // target -> ValueVerification
  const [sortByCol, setSortByCol] = useState({})   // sectionId -> { key, dir }
  const [suppliers, setSuppliers] = useState([])   // suppliers for the selected entity (Add Expense picker)
  const [showExclusions, setShowExclusions] = useState(false)
  const [exclSaving, setExclSaving] = useState({}) // supplierId -> boolean (in flight)
  const [exclSearch, setExclSearch] = useState('')
  const [showConstants, setShowConstants] = useState(false)
  const [constants, setConstants] = useState([])   // BudgetLineTemplate rows (admin-managed, global)
  const [constantsLoading, setConstantsLoading] = useState(false)
  const [constantSaving, setConstantSaving] = useState({}) // templateId -> boolean (in flight)
  const [newConstant, setNewConstant] = useState({ name: '', section_name: 'OTHER', entity_id: '' })

  // Entities this user can see budgets for (admin: all)
  const budgetEntities = useMemo(() => {
    if (isAdmin) return entities || []
    return (entities || []).filter(e =>
      user?.entity_access?.some(a =>
        a.entity_id === e.id && (a.allowed_modules || []).includes('budgets')
      )
    )
  }, [entities, isAdmin, user])

  const selectedEntityCode = (entities || []).find(e => String(e.id) === String(entityId))?.code
  const statementMode = STATEMENT_PERIOD_ENTITIES.includes((selectedEntityCode || '').toUpperCase())
  const months = useMemo(
    () => periodMonths(Number(month), Number(year), statementMode),
    [month, year, statementMode],
  )

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

  // Suppliers for the selected entity — feeds the "Supplier" picker in Add Expense.
  useEffect(() => {
    if (!entityId) { setSuppliers([]); return }
    getSuppliers({ entity_id: entityId })
      .then(r => setSuppliers(r.data || []))
      .catch(() => setSuppliers([]))
  }, [entityId])

  // ── Per-value verification overlay (reuses the generic /api/verifications) ────
  const verifReqId = useRef(0)
  const loadVerif = useCallback((budgetId) => {
    if (!budgetId) { setVerif({}); return }
    const reqId = ++verifReqId.current
    getVerifications(`budget:${budgetId}:`)
      .then(r => {
        if (reqId !== verifReqId.current) return
        const map = {}
        for (const v of r.data) map[v.target] = v
        setVerif(map)
      })
      .catch(() => { if (reqId === verifReqId.current) setVerif({}) })
  }, [])

  useEffect(() => { loadVerif(budget?.id) }, [budget?.id, loadVerif])

  const handleVerifyValue = async (target, intent) => {
    try { const { data } = await verifyValue(target, budget?.entity_id, intent); setVerif(prev => ({ ...prev, [data.target]: data })) }
    catch (e) { toast.error(errorMessage(e, 'Verification failed')) }
  }
  const handleFinalizeValue = async (target, intent) => {
    try { const { data } = await finalizeValue(target, budget?.entity_id, intent); setVerif(prev => ({ ...prev, [data.target]: data })) }
    catch (e) { toast.error(errorMessage(e, 'Lock failed')) }
  }

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

  const toggleSupplierExclusion = async (supplier) => {
    const next = !supplier.exclude_from_budget
    setExclSaving(p => ({ ...p, [supplier.id]: true }))
    try {
      await updateSupplier(supplier.id, { exclude_from_budget: next })
      setSuppliers(list => list.map(s => s.id === supplier.id ? { ...s, exclude_from_budget: next } : s))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update supplier'))
    } finally {
      setExclSaving(p => { const q = { ...p }; delete q[supplier.id]; return q })
    }
  }

  const loadConstants = useCallback(() => {
    setConstantsLoading(true)
    getBudgetLineTemplates()
      .then(r => setConstants(r.data || []))
      .catch(e => toast.error(errorMessage(e, 'Failed to load budget constants')))
      .finally(() => setConstantsLoading(false))
  }, [])

  const openConstants = () => { setShowConstants(true); loadConstants() }

  const addConstant = async () => {
    if (!newConstant.name.trim()) return
    setConstantSaving(p => ({ ...p, __new: true }))
    try {
      const res = await createBudgetLineTemplate({
        name: newConstant.name.trim(),
        section_name: newConstant.section_name,
        entity_id: newConstant.entity_id ? Number(newConstant.entity_id) : null,
        sort_order: constants.length,
      })
      setConstants(list => [...list, res.data])
      setNewConstant({ name: '', section_name: newConstant.section_name, entity_id: newConstant.entity_id })
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to add constant'))
    } finally {
      setConstantSaving(p => { const q = { ...p }; delete q.__new; return q })
    }
  }

  const updateConstant = async (template, changes) => {
    setConstantSaving(p => ({ ...p, [template.id]: true }))
    try {
      const res = await updateBudgetLineTemplate(template.id, changes)
      setConstants(list => list.map(c => c.id === template.id ? res.data : c))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update constant'))
    } finally {
      setConstantSaving(p => { const q = { ...p }; delete q[template.id]; return q })
    }
  }

  const removeConstant = async (template) => {
    setConstantSaving(p => ({ ...p, [template.id]: true }))
    try {
      await deleteBudgetLineTemplate(template.id)
      setConstants(list => list.filter(c => c.id !== template.id))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete constant'))
      setConstantSaving(p => { const q = { ...p }; delete q[template.id]; return q })
    }
  }

  // Quick "Add Income" / "Add Expense": pick a matching section + name the line.
  // Expenses mirror the costing "Add Expense": choose a once-off (free-typed) name
  // or pick a Supplier from a searchable list. Either way it's just the line name.
  const openQuickAdd = (kind) => {
    const sec = budget?.sections?.find(s => s.section_type === kind)
    setQuickAdd({ kind, sectionId: sec ? sec.id : '', name: '', mode: 'once_off' })
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

  // Stable per-value target for the verification overlay (unique per budget/line/month/field)
  const cellTarget = (lineId, m, y, field) => `budget:${budget.id}:${lineId}:${m}:${y}:${field}`

  // ── Column sorting (view-only; defaults to alphabetical by Item name) ─────────
  const colKey = (m, y, field) => `${m}:${y}:${field}`
  const getSort = (sectionId) => sortByCol[sectionId] || { key: 'name', dir: 'asc' }
  const toggleSort = (sectionId, key) => setSortByCol(p => {
    const cur = p[sectionId] || { key: 'name', dir: 'asc' }
    if (cur.key === key) return { ...p, [sectionId]: { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } }
    return { ...p, [sectionId]: { key, dir: 'asc' } }
  })
  const sortArrow = (sectionId, key) => {
    const s = getSort(sectionId)
    if (s.key !== key) return <ChevronsUpDown size={12} style={{ opacity: 0.35, flexShrink: 0 }} />
    return s.dir === 'asc'
      ? <ChevronUp size={12} style={{ flexShrink: 0 }} />
      : <ChevronDown size={12} style={{ flexShrink: 0 }} />
  }
  const sortedLines = (section) => {
    const s = getSort(section.id)
    const lines = [...section.lines]
    lines.sort((a, b) => {
      let cmp
      if (s.key === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
      } else {
        const [m, y, field] = s.key.split(':')
        cmp = num(valueFor(a, Number(m), Number(y))?.[field]) - num(valueFor(b, Number(m), Number(y))?.[field])
      }
      return s.dir === 'asc' ? cmp : -cmp
    })
    return lines
  }

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
    // Only count cells inside the visible window so a different window (e.g. an
    // OBHI statement period vs an old rolling one) never carries stale figures in.
    const monthSet = new Set(months.map(({ month: m, year: y }) => `${m}:${y}`))
    let income = 0, expensesDue = 0, expensesPaid = 0
    for (const s of budget.sections) {
      for (const l of s.lines) {
        for (const v of l.values || []) {
          if (!monthSet.has(`${v.month}:${v.year}`)) continue
          if (s.section_type === 'income') income += num(v.amount_due)
          else { expensesDue += num(v.amount_due); expensesPaid += num(v.amount_paid) }
        }
      }
    }
    return { income, expensesDue, expensesPaid, leftOver: income - expensesDue - expensesPaid }
  }, [budget, months])

  const selectedEntity = budgetEntities.find(e => String(e.id) === String(entityId))

  const sortedSuppliers = useMemo(
    () => [...suppliers].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })),
    [suppliers],
  )
  const filteredSuppliers = useMemo(() => {
    const q = exclSearch.trim().toLowerCase()
    return q ? sortedSuppliers.filter(s => (s.name || '').toLowerCase().includes(q)) : sortedSuppliers
  }, [sortedSuppliers, exclSearch])
  const excludedCount = suppliers.filter(s => s.exclude_from_budget).length

  const closeExclusions = () => { setShowExclusions(false); setExclSearch('') }

  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1 }}>
      {/* Header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wallet size={22} style={{ color: 'var(--accent)' }} />
            Budgets
          </div>
          <div className="page-subtitle">
            {statementMode
              ? `Statement period budget — pick the statement month; 30-day invoices show in ${MONTHS[(Number(month) === 1 ? 12 : Number(month) - 1) - 1]}, cash in ${MONTHS[Number(month) - 1]}`
              : 'Entity cash-flow budget — income vs supplier payments per month'}
          </div>
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
            <button className="btn-ghost btn-sm" onClick={() => setShowExclusions(true)}>
              <Ban size={14} /> Supplier Exclusions
            </button>
            {isAdmin && (
              <button className="btn-ghost btn-sm" onClick={openConstants}>
                <ListChecks size={14} /> Manage Constants
              </button>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
              Tip: click any amount cell to type a figure. Lines marked <span className="badge badge-sent" style={{ fontSize: 10 }}>auto</span> come from the system — editing a cell pins it. Lines marked <span className="badge badge-paid" style={{ fontSize: 10 }}>fixed</span> are recurring constants you fill in yourself.
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

              {/* Expense: once-off vs supplier (mirrors the costing Add Expense) */}
              {quickAdd.kind === 'expense' && (
                <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  {[['once_off', 'Once-off'], ['supplier', 'Supplier']].map(([m, label]) => (
                    <button key={m} type="button"
                      onClick={() => setQuickAdd(p => ({ ...p, mode: m, name: '' }))}
                      style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                        background: quickAdd.mode === m ? 'var(--accent)' : 'var(--bg-surface)',
                        color: quickAdd.mode === m ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s' }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {quickAdd.kind === 'expense' && quickAdd.mode === 'supplier' ? (
                <div style={{ width: 260 }}>
                  <SearchableSelect
                    value={quickAdd.name}
                    onChange={v => setQuickAdd(p => ({ ...p, name: v }))}
                    options={suppliers}
                    getValue={s => s.name}
                    getLabel={s => s.name}
                    placeholder="Search supplier…"
                    creatable
                  />
                </div>
              ) : (
                <input className="form-input" autoFocus style={{ width: 260, fontSize: 12 }}
                  placeholder={quickAdd.kind === 'income' ? 'Income source name' : 'Expense name'}
                  value={quickAdd.name}
                  onChange={e => setQuickAdd(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') submitQuickAdd() }} />
              )}

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
                        <th onClick={() => toggleSort(section.id, 'name')} style={thSortLeft} title="Sort by name">
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Item {sortArrow(section.id, 'name')}</span>
                        </th>
                        {months.map(({ month: m, year: y }) => (
                          isIncome
                            ? <th key={`${m}-${y}`} onClick={() => toggleSort(section.id, colKey(m, y, 'amount_due'))} style={thSortRight} title="Sort by amount">
                                <span style={thSortLabel}>{MONTHS[m - 1]} {y} {sortArrow(section.id, colKey(m, y, 'amount_due'))}</span>
                              </th>
                            : [
                                <th key={`${m}-${y}-due`} onClick={() => toggleSort(section.id, colKey(m, y, 'amount_due'))} style={thSortRight} title="Sort by amount">
                                  <span style={thSortLabel}>{MONTHS[m - 1]} To Pay {sortArrow(section.id, colKey(m, y, 'amount_due'))}</span>
                                </th>,
                                <th key={`${m}-${y}-paid`} onClick={() => toggleSort(section.id, colKey(m, y, 'amount_paid'))} style={thSortRight} title="Sort by amount">
                                  <span style={thSortLabel}>{MONTHS[m - 1]} Paid {sortArrow(section.id, colKey(m, y, 'amount_paid'))}</span>
                                </th>,
                              ]
                        ))}
                        <th style={{ width: 36 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLines(section).map(line => (
                        <tr key={line.id}>
                          <td style={{ fontWeight: 500, minWidth: 180, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'top' }} title={line.name}>
                            {line.name}
                            {line.source === 'auto' && (
                              <span className="badge badge-sent" style={{ fontSize: 9, marginLeft: 6, verticalAlign: 'middle' }}>auto</span>
                            )}
                            {line.source === 'constant' && (
                              <span className="badge badge-paid" style={{ fontSize: 9, marginLeft: 6, verticalAlign: 'middle' }} title="A recurring line seeded from Manage Constants">fixed</span>
                            )}
                          </td>
                          {months.map(({ month: m, year: y }) => {
                            const fields = isIncome ? ['amount_due'] : ['amount_due', 'amount_paid']
                            return fields.map(field => {
                              const overridden = !!valueFor(line, m, y)?.is_overridden
                              const target = cellTarget(line.id, m, y, field)
                              const vstate = verif[target]
                              const locked = !!vstate?.verified3_by
                              return (
                              <td key={`${m}-${y}-${field}`} style={{ textAlign: 'right', minWidth: 118, padding: '3px 8px', verticalAlign: 'top' }}>
                                <VerifiableAmount
                                  target={target} state={vstate}
                                  onVerify={handleVerifyValue} onFinalize={handleFinalizeValue}
                                  currentUserId={user?.id} isAdmin={isAdmin}
                                >
                                  <input
                                    type="number" step="0.01"
                                    value={cellValue(line, m, y, field)}
                                    onChange={e => setCellEdits(p => ({ ...p, [cellKey(line.id, m, y, field)]: e.target.value }))}
                                    onBlur={() => commitCell(line, m, y, field)}
                                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                    readOnly={locked}
                                    placeholder="0.00"
                                    title={locked ? 'Locked by final verification — remove the lock to edit'
                                      : overridden ? 'Manually edited — a system refresh will not change this' : undefined}
                                    style={locked ? cellInputLocked : overridden ? cellInputOverridden : cellInputStyle}
                                  />
                                </VerifiableAmount>
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

      {showExclusions && (
        <div className="modal-overlay" onClick={closeExclusions}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 520, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Ban size={18} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Supplier Exclusions</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedEntity?.code} — {selectedEntity?.name}</div>
                </div>
              </div>
              <button className="btn-icon" onClick={closeExclusions}><X size={16} /></button>
            </div>

            {/* Body */}
            <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Excluded suppliers are skipped entirely by &quot;Pull from system&quot; — they never appear or update in any budget section, in any period.
              </p>

              <div className="search-bar">
                <Search size={14} />
                <input
                  autoFocus
                  placeholder="Search suppliers…"
                  value={exclSearch}
                  onChange={e => setExclSearch(e.target.value)}
                />
                {exclSearch && <button className="btn-icon" onClick={() => setExclSearch('')}><X size={13} /></button>}
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {filteredSuppliers.length} of {suppliers.length} supplier{suppliers.length === 1 ? '' : 's'}
                {excludedCount > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{excludedCount} excluded</strong></>}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, minHeight: 200 }}>
                {suppliers.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No suppliers for this entity</div>
                )}
                {suppliers.length > 0 && filteredSuppliers.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No suppliers match &quot;{exclSearch}&quot;</div>
                )}
                {filteredSuppliers.map((s, i) => (
                  <label
                    key={s.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                      borderBottom: i < filteredSuppliers.length - 1 ? '1px solid var(--border)' : 'none',
                      fontSize: 13, cursor: 'pointer',
                      background: s.exclude_from_budget ? 'var(--danger-bg, rgba(220,38,38,0.06))' : 'transparent',
                      opacity: exclSaving[s.id] ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!s.exclude_from_budget}
                      disabled={!!exclSaving[s.id]}
                      onChange={() => toggleSupplierExclusion(s)}
                      style={{ width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }}
                    />
                    <span style={{ flex: 1, fontWeight: s.exclude_from_budget ? 600 : 400 }}>{s.name}</span>
                    {s.exclude_from_budget && <span className="badge badge-overdue" style={{ fontSize: 10, flexShrink: 0 }}>excluded</span>}
                  </label>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn-primary btn-sm" onClick={closeExclusions}>Done</button>
            </div>
          </div>
        </div>
      )}

      {showConstants && (
        <div className="modal-overlay" onClick={() => setShowConstants(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 560, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ListChecks size={18} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Manage Budget Constants</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Applies to every entity's budgets</div>
                </div>
              </div>
              <button className="btn-icon" onClick={() => setShowConstants(false)}><X size={16} /></button>
            </div>

            {/* Body */}
            <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                A constant is seeded — with no amount, blank for the user to fill in — into the matching
                section of every budget on creation, and added to any existing budget missing it on the
                next &quot;Pull from system&quot;. Renaming or deleting a constant here only affects
                future/refreshed budgets; a budget's own copy of the line can still be freely edited or
                removed without touching this list.
              </p>

              {constantsLoading && (
                <div className="loading-center" style={{ padding: 20 }}><div className="spinner" /></div>
              )}

              {!constantsLoading && (
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, minHeight: 160 }}>
                  {constants.length === 0 && (
                    <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No constants defined yet</div>
                  )}
                  {constants.map((c, i) => (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px',
                        borderBottom: i < constants.length - 1 ? '1px solid var(--border)' : 'none',
                        opacity: constantSaving[c.id] ? 0.6 : (c.is_active ? 1 : 0.55),
                      }}
                    >
                      <input
                        className="form-input"
                        style={{ width: '100%', fontSize: 13, padding: '5px 8px' }}
                        value={c.name}
                        disabled={!!constantSaving[c.id]}
                        onChange={e => setConstants(list => list.map(x => x.id === c.id ? { ...x, name: e.target.value } : x))}
                        onBlur={e => { if (e.target.value.trim() && e.target.value !== c.name) updateConstant(c, { name: e.target.value.trim() }) }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <select
                          className="form-input"
                          style={{ width: 180, fontSize: 12, padding: '5px 8px' }}
                          value={c.section_name}
                          disabled={!!constantSaving[c.id]}
                          onChange={e => updateConstant(c, { section_name: e.target.value })}
                        >
                          {CONSTANT_SECTION_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <select
                          className="form-input"
                          style={{ width: 170, fontSize: 12, padding: '5px 8px' }}
                          value={c.entity_id ?? ''}
                          disabled={!!constantSaving[c.id]}
                          onChange={e => updateConstant(c, { entity_id: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">All entities</option>
                          {(entities || []).map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
                        </select>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={c.is_active}
                            disabled={!!constantSaving[c.id]}
                            onChange={() => updateConstant(c, { is_active: !c.is_active })}
                          />
                          Active
                        </label>
                        <button className="btn-icon" onClick={() => removeConstant(c)} disabled={!!constantSaving[c.id]}
                          title="Delete constant" style={{ color: 'var(--danger)', marginLeft: 'auto' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <input
                  className="form-input"
                  style={{ width: '100%', fontSize: 13 }}
                  placeholder="New constant name…"
                  value={newConstant.name}
                  onChange={e => setNewConstant(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addConstant() }}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    className="form-input"
                    style={{ width: 180, fontSize: 12 }}
                    value={newConstant.section_name}
                    onChange={e => setNewConstant(p => ({ ...p, section_name: e.target.value }))}
                  >
                    {CONSTANT_SECTION_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select
                    className="form-input"
                    style={{ width: 170, fontSize: 12 }}
                    value={newConstant.entity_id}
                    onChange={e => setNewConstant(p => ({ ...p, entity_id: e.target.value }))}
                  >
                    <option value="">All entities</option>
                    {(entities || []).map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
                  </select>
                  <button className="btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={addConstant} disabled={!newConstant.name.trim() || !!constantSaving.__new}>
                    <Plus size={13} /> Add
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn-primary btn-sm" onClick={() => setShowConstants(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Amount cells are editable — give them a visible input look (border + surface fill)
// so it's obvious they can be typed into, not just static figures.
const cellInputStyle = {
  width: 100, textAlign: 'right', fontSize: 12.5,
  background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5,
  padding: '4px 6px', color: 'var(--text-primary)', outline: 'none',
  cursor: 'text',
}

// A pinned (manually edited) auto cell — subtle accent border so the user can see
// which figures they've overridden and that a refresh won't touch them.
const cellInputOverridden = {
  ...cellInputStyle,
  border: '1px solid var(--accent)',
  fontWeight: 600,
}

// A value locked by final verification — not editable until the lock is removed.
const cellInputLocked = {
  ...cellInputStyle,
  cursor: 'not-allowed',
  color: 'var(--text-secondary)',
  background: 'var(--bg-surface)',
  borderColor: 'transparent',
}

// Clickable sort headers.
const thSortLeft = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }
const thSortRight = { ...thSortLeft, textAlign: 'right' }
const thSortLabel = { display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }
