import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import { useLocalState } from '../hooks/useLocalState'
import {
  getBudgets, getBudget, createBudget, deleteBudget,
  addBudgetSection, updateBudgetSection, deleteBudgetSection, restoreBudgetSections,
  addBudgetLine, updateBudgetLine, deleteBudgetLine, upsertBudgetLineValue, updateBudget,
  addBudgetBankRow, updateBudgetBankRow, deleteBudgetBankRow,
  pullBudgetSection, getBudgetIncomeCandidates, setBudgetIncomeLines, replicateBudget,
  getReplicatePreview, setBudgetLock, downloadBudgetPdf, downloadBudgetExcel,
  getVerifications, verifyValue, finalizeValue, getSuppliers, updateSupplier,
  getBudgetLineTemplates, createBudgetLineTemplate, updateBudgetLineTemplate, deleteBudgetLineTemplate,
} from '../services/api'
import { Wallet, Plus, Trash2, Lock, Unlock, X, RefreshCw, TrendingUp, ChevronUp, ChevronDown, ChevronsUpDown, Ban, Search, ListChecks, CopyPlus, FileDown, FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'
import { errorMessage, formatCurrency, formatDate } from '../utils/helpers'
import DeleteModal from '../components/DeleteModal'
import VerifiableAmount from '../components/VerifiableAmount'
import BulkUnlockButton from '../components/BulkUnlockButton'
import SearchableSelect from '../components/SearchableSelect'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'

import { MONTHS_SHORT_0 as MONTHS } from '../utils/helpers'

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

const INCOME_SECTION = 'INCOME'

// The two generic INCOME lines the modal assigns rows into — [bucket, short
// label]. Mirrors INCOME_BUCKETS in the backend budgets route, which owns the
// full line names (TRADEKOR INCOME ONLY / OTHER INCOME).
const INCOME_BUCKETS = [['tradekor', 'Tradekor'], ['other', 'Other']]

// Safetec's summary splits its expenses in two: what the trucks cost, and what was
// paid out of the same account but sits outside truck costing (the owners' personal
// spend and the non-truck business spend). Both still count as money that left, so
// they stay inside Expenses; they are then shown again as "Personal Expenses" and
// taken off Profit to land on Actual Profit — mirroring Johan's sheet.
const SFT_PERSONAL_SECTIONS = ['PERSONAL NOT ON TRUCK COSTING', 'BUSINESS NOT ON TRUCK COSTING']

// Entities that carry a Bank Info Summary — every trading entity; SP is dormant.
// (Mirror the backend BANK_INFO_ENTITIES, which is what seeds the rows.)
const BANK_INFO_ENTITIES = ['SFT', 'OBHI', 'BTP', 'TP', 'BKMO']

// A bank row labelled "Cash Flow Total" is computed, not captured: it shows the
// sum of the account rows above it. Typing an amount pins it (June's figure
// includes a refund the accounts alone don't carry); blanking the box goes back
// to the sum. (Mirror the backend CASH_FLOW_TOTAL_RE.)
const CASH_FLOW_TOTAL_RE = /cash\s*flow\s*total/i

// Entities whose summary is the two per-month-group cards (base month on its own;
// next month's income against next + following month's expenses) instead of the
// single window total.
const MONTH_SPLIT_ENTITIES = ['OBHI', 'BTP', 'TP']

// "vat back trailer" is derived, not typed. Almost every vehicle-finance line
// carries a note of the VAT that will come back on it — "… 01.03.R26915.38 - VAT
// BACK R133582.50 - END 01.02.2029" — so the note alone marks a dozen lines and
// means nothing on its own. What marks the month the VAT actually CAME back is the
// line billing its stated VAT-back figure instead of its usual instalment, so a
// line counts only when its amount for the month matches its own note.
// The "R" is required: some labels note a VAT-back *date* ("VAT BACK (01.08.2025)").
const VAT_BACK_RE = /VAT\s*BACK\s*R\s*([\d.,\s]+)/i
// Generous next to the gap between an instalment (~R27k) and a VAT back (~R133k+),
// tight enough that only the intended line can match.
const VAT_BACK_TOLERANCE = 5

function vatBackFromLine(line, amount) {
  const match = VAT_BACK_RE.exec(line.name || '')
  if (!match) return null
  const stated = parseFloat(match[1].replace(/[\s,]/g, '').replace(/\.$/, ''))
  if (!stated || Number.isNaN(stated)) return null
  return Math.abs(stated - amount) <= VAT_BACK_TOLERANCE ? { stated, amount } : null
}

// Sections the backend can pull system data into — mirrors SECTION_SOURCES in
// budget_autofill.py. Anything else (DEBIT ORDERS, a hand-added section) has no
// system source, so it gets no "Pull from System" button. INCOME is absent on
// purpose: it's chosen in the modal, never pulled wholesale.
const PULLABLE_SECTIONS = [
  '30 DAY SUPPLIERS', 'CASH / CURRENT SUPPLIERS', 'DIESEL',
  'INTERCOMPANY INVOICES', 'SUB CONTRACTORS', 'WAGES', 'OTHER',
]

// Sections fed by supplier invoices — these get the "Exclude" button, since
// excluding a supplier is what shapes what they pull.
const SUPPLIER_SECTIONS = [
  '30 DAY SUPPLIERS', 'CASH / CURRENT SUPPLIERS', 'DIESEL',
  'INTERCOMPANY INVOICES', 'OTHER',
]

// Which suppliers the Exclude modal lists for a given section — the ones that
// would classify into it. Mirrors the sectioning in budget_autofill._suppliers,
// where intercompany wins over diesel, which wins over payment term. OTHER holds
// free-text rows that match no supplier record, so it lists them all.
function suppliersForSection(sectionName, suppliers) {
  if (sectionName === 'OTHER') return suppliers
  return suppliers.filter(s => {
    if (s.is_intercompany) return sectionName === 'INTERCOMPANY INVOICES'
    if (s.is_diesel_supplier) return sectionName === 'DIESEL'
    // The API serialises PaymentTermType.days_30 as its value, "30_days".
    if (s.payment_term === '30_days') return sectionName === '30 DAY SUPPLIERS'
    return sectionName === 'CASH / CURRENT SUPPLIERS'
  })
}

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

// Income modal columns → the value each one sorts on.
const incomeSortVal = (c, col) => {
  switch (col) {
    case 'invoice': return c.invoice_number || ''
    case 'po': return c.po_number || ''
    case 'customer': return c.customer_name || ''
    case 'months': {
      const v = c.issue_months?.[0] || c.values?.[0]
      return v ? v.year * 12 + v.month : 0
    }
    case 'total': return num(c.total)
    default: return ''
  }
}

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
  const [nameEdits, setNameEdits] = useState({})   // lineId -> string (absent = not editing)
  const [newSection, setNewSection] = useState(null) // null | { name, section_type }
  const [confirmDeleteSection, setConfirmDeleteSection] = useState(null) // section object
  const [restoring, setRestoring] = useState(false)  // "Restore <section>" in flight
  const [pulling, setPulling] = useState({})       // sectionId -> boolean (in flight)
  const [replicating, setReplicating] = useState(false)
  // "Match exactly" — remembered per session, and the preview of what it will remove.
  const [pruneOnReplicate, setPruneOnReplicate] = useSessionState('budgets.pruneOnReplicate', false)
  const [pruneModal, setPruneModal] = useState(null)   // null | BudgetPrunePreviewOut
  const [quickAdd, setQuickAdd] = useState(null)   // null | { kind: 'income'|'expense', sectionId, name }
  const [verif, setVerif] = useState({})           // target -> ValueVerification
  const [sortByCol, setSortByCol] = useLocalState('sort:budgets.sections', {})   // sectionId -> { key, dir }
  const [suppliers, setSuppliers] = useState([])   // suppliers for the selected entity (Add Expense picker)
  const [showExclusions, setShowExclusions] = useState(null) // null | section name being filtered on
  // Income picker: null | { loading, candidates, picked: Set<source_key>, saving }
  const [incomeModal, setIncomeModal] = useState(null)
  const [incomeSearch, setIncomeSearch] = useState('')
  // Opens on invoice number; no persistence key — a modal always opens on its default order.
  const { sort: incomeSort, onSort: onIncomeSort } = useSort('invoice', 'asc')
  const [exclSaving, setExclSaving] = useState({}) // supplierId -> boolean (in flight)
  const [exclSearch, setExclSearch] = useState('')
  const [showConstants, setShowConstants] = useState(false)
  const [constants, setConstants] = useState([])   // BudgetLineTemplate rows (admin-managed, global)
  const [constantsLoading, setConstantsLoading] = useState(false)
  const [constantSaving, setConstantSaving] = useState({}) // templateId -> boolean (in flight)
  const [newConstant, setNewConstant] = useState({ name: '', section_name: 'OTHER', entity_id: '' })
  // Inline edits on the Safetec summary/bank block. Budget-level numeric fields are
  // keyed by column name; bank rows by `${rowId}:${field}`. Absent key = not editing.
  const [budgetFieldEdits, setBudgetFieldEdits] = useState({})
  const [bankEdits, setBankEdits] = useState({})
  // sessionStorage-backed so the block stays as the user left it across navigation.
  const [bankInfoOpen, setBankInfoOpen] = useSessionState('budgets.bankInfoOpen', true)
  const [lockSaving, setLockSaving] = useState(false)
  const [exportLoading, setExportLoading] = useState(null)  // 'pdf' | 'excel' | null

  // A locked budget is final (mirrors the costing "Sent" lock): every editing
  // control below hides or goes read-only, and the server enforces it anyway.
  const isLocked = !!budget?.locked_at

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
      setNameEdits({})
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

  const handlePullSection = async (section) => {
    if (!budget) return
    setPulling(p => ({ ...p, [section.id]: true }))
    try {
      const res = await pullBudgetSection(budget.id, section.id)
      setBudget(res.data)
      setCellEdits({})
      setNameEdits({})
      toast.success(`Pulled ${section.name} from the system`)
    } catch (e) {
      toast.error(errorMessage(e, `Failed to pull ${section.name}`))
    } finally {
      setPulling(p => { const q = { ...p }; delete q[section.id]; return q })
    }
  }

  const runReplicate = async (prune) => {
    if (!budget) return
    setReplicating(true)
    try {
      const { data } = await replicateBudget(budget.id, prune)
      const { period_month: pm, period_year: py } = data.budget
      toast.success(
        `${data.created ? 'Created' : 'Updated'} ${MONTHS[pm - 1]} ${py} — `
        + `${data.lines_added} line(s) added, ${data.values_filled} amount(s) carried over`
        + (data.bank_rows_added || data.bank_amounts_filled
          ? `, bank info ${data.bank_rows_added} row(s) / ${data.bank_amounts_filled} amount(s)` : '')
        + (prune ? `, ${data.lines_removed + data.bank_rows_removed} extra line(s) removed` : '')
      )
      const kept = data.lines_kept + (prune ? data.bank_rows_kept : 0)
      if (prune && kept) {
        toast(`${kept} extra line(s) kept — they hold figures someone typed in.`,
          { icon: '✋', duration: 6000 })
      }
      setPruneModal(null)
      // Jump to the month we just filled so the result is visible, rather than
      // leaving the user on the source month wondering whether anything happened.
      setMonth(pm)
      setYear(py)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to replicate budget'))
    } finally {
      setReplicating(false)
    }
  }

  // Plain replicate goes straight through: it only ever adds. Pruning deletes, so
  // it shows what will go first — unless there's nothing to remove.
  const handleReplicate = async () => {
    if (!budget) return
    if (!pruneOnReplicate) return runReplicate(false)
    setReplicating(true)
    try {
      const { data } = await getReplicatePreview(budget.id)
      if (!data.target_exists || (!data.remove.length && !data.sections_removed.length
                                  && !data.bank_remove.length)) {
        setReplicating(false)
        return runReplicate(true)
      }
      setPruneModal(data)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to check next month'))
    } finally {
      setReplicating(false)
    }
  }

  // ── Lock & export (mirror the costing Sent flag + PDF/Excel export) ─────────
  const handleLockToggle = async () => {
    if (!budget) return
    const label = `${MONTHS[budget.period_month - 1]} ${budget.period_year} budget for ${selectedEntity?.code || 'this entity'}`
    const ok = isLocked
      ? window.confirm(`Unlock the ${label}? Its figures can be changed again.`)
      : window.confirm(`Lock the ${label}? Nothing can be added or changed until it is unlocked.`)
    if (!ok) return
    setLockSaving(true)
    try {
      const { data } = await setBudgetLock(budget.id, !isLocked)
      setBudget(b => ({ ...b, locked_at: data.locked_at, locked_by_name: data.locked_by_name }))
      setCellEdits({})
      setNameEdits({})
      toast.success(data.locked_at ? 'Budget locked' : 'Budget unlocked')
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update the lock'))
    } finally {
      setLockSaving(false)
    }
  }

  const handleExport = async (type) => {
    if (!budget) return
    setExportLoading(type)
    try {
      const fn = type === 'pdf' ? downloadBudgetPdf : downloadBudgetExcel
      const r = await fn(budget.id)
      const ext = type === 'pdf' ? 'pdf' : 'xlsx'
      const mime = type === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const base = `budget-${(selectedEntity?.code || 'entity').toLowerCase()}-${budget.period_year}-${String(budget.period_month).padStart(2, '0')}`
      const url = URL.createObjectURL(new Blob([r.data], { type: mime }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${base}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(`Failed to export ${type.toUpperCase()}`)
    } finally {
      setExportLoading(null)
    }
  }

  // ── Income picker ───────────────────────────────────────────────────────────
  // `picked` maps source_key -> 'tradekor' | 'other': which of the two generic
  // income lines a ticked row feeds. Absent key = not counted at all.
  const openIncomeModal = async () => {
    if (!budget) return
    setIncomeSearch('')
    setIncomeModal({ loading: true, candidates: [], picked: {}, saving: false })
    try {
      const { data } = await getBudgetIncomeCandidates(budget.id)
      setIncomeModal({
        loading: false,
        candidates: data || [],
        picked: Object.fromEntries((data || []).filter(c => c.selected).map(c => [c.source_key, c.bucket])),
        saving: false,
      })
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load income'))
      setIncomeModal(null)
    }
  }

  const toggleIncomePick = (key) => setIncomeModal(m => {
    const picked = { ...m.picked }
    if (key in picked) delete picked[key]
    else picked[key] = m.candidates.find(c => c.source_key === key)?.bucket || 'other'
    return { ...m, picked }
  })

  // Assigning a row to a line ticks it too — choosing where it goes is choosing it.
  const setIncomeBucket = (key, bucket) => setIncomeModal(m => (
    { ...m, picked: { ...m.picked, [key]: bucket } }
  ))

  // Bulk tick/untick acts on what's currently visible, so a search narrows what
  // "Select all" means — a real period can run to 70+ POs, and ticking those one
  // at a time is not a reasonable ask. Ticking keeps an existing assignment and
  // defaults the rest (Tradekor customers → Tradekor line, others → Other).
  const setIncomePicks = (keys, on) => setIncomeModal(m => {
    const picked = { ...m.picked }
    const defaults = Object.fromEntries(m.candidates.map(c => [c.source_key, c.bucket]))
    for (const k of keys) {
      if (on) picked[k] = picked[k] || defaults[k] || 'other'
      else delete picked[k]
    }
    return { ...m, picked }
  })

  const submitIncome = async () => {
    setIncomeModal(m => ({ ...m, saving: true }))
    try {
      const res = await setBudgetIncomeLines(budget.id, incomeModal.picked)
      setBudget(res.data)
      setCellEdits({})
      setNameEdits({})
      setIncomeModal(null)
      toast.success('Income updated')
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update income'))
      setIncomeModal(m => ({ ...m, saving: false }))
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

  // A section header's "Add": name a line that this section owns. Expenses mirror
  // the costing "Add Expense": choose a once-off (free-typed) name or pick a
  // Supplier from a searchable list. Either way it's just the line name.
  const openQuickAdd = (kind, sectionId) => {
    setQuickAdd({ kind, sectionId, name: '', mode: 'once_off' })
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

  const handleDeleteSection = async () => {
    const section = confirmDeleteSection
    if (!section) return
    try {
      await deleteBudgetSection(section.id)
      // The backend recomputes which standard sections are now missing, so reload
      // rather than splicing — that's what puts the "Restore <section>" button up.
      const res = await getBudget(budget.id)
      setBudget(res.data)
      setConfirmDeleteSection(null)
      toast.success(`Deleted ${section.name}`)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete section'))
    }
  }

  // Put back a standard section that was deleted (or never existed on an older
  // budget). Comes back empty — the figures are refilled from its own header.
  const handleRestoreSections = async (names = null) => {
    setRestoring(true)
    try {
      const res = await restoreBudgetSections(budget.id, names)
      setBudget(res.data)
      toast.success(names?.length === 1 ? `${names[0]} restored` : 'Missing sections restored')
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to restore the section'))
    } finally {
      setRestoring(false)
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
  const getSort = (sectionId) => {
    const s = sortByCol[sectionId]
    if (!s) return { key: 'name', dir: 'asc' }
    // A remembered month column can fall outside the months now on screen
    // (statement mode toggled) — sorting on a column nobody can see reads as
    // "not sorted at all", so drop back to name.
    if (s.key !== 'name' && !months.some(({ month: m, year: y }) => s.key.startsWith(`${m}:${y}:`)))
      return { key: 'name', dir: 'asc' }
    return s
  }
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

  // Line names are hand-editable, including on system-pulled lines: the backend
  // flags a typed name so the next pull refreshes the amounts but keeps the name.
  const commitLineName = async (line) => {
    const raw = nameEdits[line.id]
    if (raw == null) return
    const name = raw.trim()
    const clear = () => setNameEdits(p => { const q = { ...p }; delete q[line.id]; return q })
    if (!name) { toast.error('A name is required'); return }
    if (name === line.name) { clear(); return }
    try {
      const res = await updateBudgetLine(line.id, { name })
      setBudget(b => ({
        ...b,
        sections: b.sections.map(s => ({
          ...s,
          lines: s.lines.map(l => (l.id === line.id
            ? { ...l, name: res.data.name, name_overridden: res.data.name_overridden }
            : l)),
        })),
      }))
      clear()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to rename line'))
    }
  }

  // ── Totals ──────────────────────────────────────────────────────────────────
  const sectionTotal = (section, m, y, field) =>
    section.lines.reduce((sum, l) => sum + num(valueFor(l, m, y)?.[field]), 0)

  const totals = useMemo(() => {
    if (!budget) return null
    // Only count cells inside the visible window so a different window (e.g. an
    // OBHI statement period vs an old rolling one) never carries stale figures in.
    const key = (m, y) => `${m}:${y}`
    const monthList = months.map(({ month: m, year: y }) => key(m, y))
    const monthSet = new Set(monthList)
    let income = 0, expensesDue = 0, expensesPaid = 0
    // Per-month breakdowns feed the OBHI split totals below. Expense-per-month is
    // To Pay + Paid combined, matching the OBHI budget sheet's EXPENSES row.
    const incomeByKey = Object.fromEntries(monthList.map(k => [k, 0]))
    const expenseByKey = Object.fromEntries(monthList.map(k => [k, 0]))
    for (const s of budget.sections) {
      for (const l of s.lines) {
        for (const v of l.values || []) {
          const k = key(v.month, v.year)
          if (!monthSet.has(k)) continue
          if (s.section_type === 'income') {
            income += num(v.amount_due)
            incomeByKey[k] += num(v.amount_due)
          } else {
            expensesDue += num(v.amount_due); expensesPaid += num(v.amount_paid)
            expenseByKey[k] += num(v.amount_due) + num(v.amount_paid)
          }
        }
      }
    }
    return { income, expensesDue, expensesPaid, leftOver: income - expensesDue - expensesPaid, incomeByKey, expenseByKey }
  }, [budget, months])

  // OBHI, BTP and TP reconcile month by month, not across the whole window: the
  // base month's income covers only its own expenses, while the next month's income
  // covers that month AND the one after it (mirrors the OBHI budget sheet's
  // APRIL / MAY columns; BTP and TP follow the same layout).
  const hasMonthSplit = MONTH_SPLIT_ENTITIES.includes((selectedEntityCode || '').toUpperCase())
  const monthSplit = useMemo(() => {
    if (!totals || !hasMonthSplit || months.length < 3) return null
    const key = (o) => `${o.month}:${o.year}`
    const [m0, m1, m2] = months
    const nm = (o) => `${MONTHS[o.month - 1]} ${o.year}`
    const g1Income = totals.incomeByKey[key(m0)] || 0
    const g1Exp = totals.expenseByKey[key(m0)] || 0
    const g2Income = totals.incomeByKey[key(m1)] || 0
    const g2Exp = (totals.expenseByKey[key(m1)] || 0) + (totals.expenseByKey[key(m2)] || 0)
    return {
      g1: { title: nm(m0), sub: `${MONTHS[m0.month - 1]} income − ${MONTHS[m0.month - 1]} expenses`,
            income: g1Income, expenses: g1Exp, leftOver: g1Income - g1Exp },
      g2: { title: nm(m1), sub: `${MONTHS[m1.month - 1]} income − ${MONTHS[m1.month - 1]} & ${MONTHS[m2.month - 1]} expenses`,
            income: g2Income, expenses: g2Exp, leftOver: g2Income - g2Exp },
    }
  }, [totals, hasMonthSplit, months])

  // A profit statement for the BASE month alone, not the three-month window: it
  // answers "what did May earn and what did May cost". The two forward columns in
  // the grid are cash-flow planning and stay out of it. Safetec shows this as its
  // summary cards; every entity uses its profit figure in the Bank Info Summary,
  // so it is computed for all of them (the personal split only means anything to
  // Safetec, whose sections are the only ones that carry it).
  const isSft = (selectedEntityCode || '').toUpperCase() === 'SFT'
  const baseSummary = useMemo(() => {
    if (!budget || !months.length) return null
    const { month: bm, year: by } = months[0]
    let income = 0, expenses = 0, personal = 0
    for (const s of budget.sections) {
      const isPersonal = SFT_PERSONAL_SECTIONS.includes((s.name || '').toUpperCase())
      for (const l of s.lines) {
        for (const v of l.values || []) {
          if (v.month !== bm || v.year !== by) continue
          if (s.section_type === 'income') { income += num(v.amount_due); continue }
          const amount = num(v.amount_due) + num(v.amount_paid)
          expenses += amount
          if (isPersonal) personal += amount
        }
      }
    }
    const profit = income - expenses
    return { income, expenses, profit, personal, actualProfit: profit - personal, baseLabel: `${MONTHS[bm - 1]} ${by}` }
  }, [budget, months])

  // Numeric fields stored straight on the budget — the typed-in figures (Johan's
  // profit, vat back) and the override columns that pin an otherwise-calculated
  // one. Blank clears the field, which for an override restores the calculation.
  const startBudgetFieldEdit = (field) => setBudgetFieldEdits(p => ({
    ...p, [field]: budget[field] == null ? '' : String(parseFloat(budget[field])),
  }))
  const cancelBudgetFieldEdit = (field) =>
    setBudgetFieldEdits(p => { const q = { ...p }; delete q[field]; return q })

  const saveBudgetField = async (field) => {
    const raw = (budgetFieldEdits[field] ?? '').trim()
    cancelBudgetFieldEdit(field)
    if (raw !== '' && Number.isNaN(parseFloat(raw))) { toast.error('Enter a number'); return }
    const value = raw === '' ? null : parseFloat(raw)
    const current = budget[field] == null ? null : parseFloat(budget[field])
    if (value === current) return
    try {
      const res = await updateBudget(budget.id, { [field]: value })
      setBudget(b => ({ ...b, [field]: res.data[field] }))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save amount'))
    }
  }

  // Bank Info Summary rows — label, note and amount are all hand-captured.
  const saveBankRow = async (row, field) => {
    const key = `${row.id}:${field}`
    const raw = (bankEdits[key] ?? '').trim()
    setBankEdits(p => { const q = { ...p }; delete q[key]; return q })
    let value = raw === '' ? null : raw
    if (field === 'amount') {
      if (raw !== '' && Number.isNaN(parseFloat(raw))) { toast.error('Enter a number'); return }
      value = raw === '' ? null : parseFloat(raw)
      if (value === (row.amount == null ? null : parseFloat(row.amount))) return
    } else {
      if (field === 'label' && !value) { toast.error('A label is required'); return }
      if ((value || '') === (row[field] || '')) return
    }
    try {
      const res = await updateBudgetBankRow(row.id, { [field]: value })
      setBudget(b => ({ ...b, bank_rows: b.bank_rows.map(r => (r.id === row.id ? res.data : r)) }))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save row'))
    }
  }

  const handleAddBankRow = async (kind) => {
    try {
      const res = await addBudgetBankRow(budget.id, { kind, label: 'New row' })
      setBudget(b => ({ ...b, bank_rows: [...(b.bank_rows || []), res.data] }))
      setBankEdits(p => ({ ...p, [`${res.data.id}:label`]: '' }))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to add row'))
    }
  }

  const handleDeleteBankRow = async (row) => {
    try {
      await deleteBudgetBankRow(row.id)
      setBudget(b => ({ ...b, bank_rows: b.bank_rows.filter(r => r.id !== row.id) }))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete row'))
    }
  }

  // The block's figures — all of them this entity's own: the profit comes off the
  // budget on screen and the vat back is scanned out of its lines. Every calculated
  // one can be pinned by its *_override column; a blank override falls back to the
  // calculation.
  const hasBankInfo = BANK_INFO_ENTITIES.includes((selectedEntityCode || '').toUpperCase())
  const bankInfo = useMemo(() => {
    if (!budget || !baseSummary || !hasBankInfo) return null
    const rows = budget.bank_rows || []
    const pick = (o, calc) => (o == null ? calc : parseFloat(o))
    const profit = pick(budget.bank_profit_override, baseSummary.profit)

    // Lines that billed their stated VAT back this month (see VAT_BACK_RE).
    const { month: bm, year: by } = months[0]
    const vatBackHits = []
    for (const s of budget.sections) {
      if (s.section_type === 'income') continue
      for (const l of s.lines) {
        const v = (l.values || []).find(x => x.month === bm && x.year === by)
        if (!v) continue
        const hit = vatBackFromLine(l, num(v.amount_due) + num(v.amount_paid))
        if (hit) vatBackHits.push({ ...hit, name: l.name })
      }
    }
    const vatBackPulled = vatBackHits.reduce((s, h) => s + h.amount, 0)
    const vatBack = pick(budget.vat_back_trailer, vatBackPulled)

    // The Cash Flow Total row sits apart from the accounts it sums. Rendered
    // last regardless of its stored order, so an account added after it still
    // counts — the total is always "everything above".
    const bankRows = rows.filter(r => r.kind === 'bank')
    const cashFlowRow = bankRows.find(r => CASH_FLOW_TOTAL_RE.test(r.label || '')) || null
    const accounts = bankRows.filter(r => r !== cashFlowRow)
    return {
      accounts,
      cashFlowRow,
      cashFlowCalc: accounts.reduce((s, r) => s + num(r.amount), 0),
      toBePaid: rows.filter(r => r.kind === 'to_be_paid'),
      profit,
      vatBack,
      vatBackHits,
      // The sheet ADDS the vat back: it is VAT paid out that comes back, so profit
      // without having had to lay it out would have been higher.
      profitExclVatBack: pick(budget.profit_excl_vat_back_override, profit + vatBack),
      toBePaidTotal: rows.filter(r => r.kind === 'to_be_paid').reduce((s, r) => s + num(r.amount), 0),
    }
  }, [budget, baseSummary, hasBankInfo, months])

  // Render helpers for the bank block. Plain functions, not components, so typing
  // into a cell doesn't remount the input and lose focus on every keystroke.
  // `calculated` (amounts only) turns the cell into a computed-but-pinnable one:
  // a blank amount shows the calculated figure, a typed amount pins it, and
  // blanking the box goes back to the calculation — the Cash Flow Total row.
  const bankCell = (row, field, { placeholder, style, calculated } = {}) => {
    const key = `${row.id}:${field}`
    const editing = bankEdits[key] != null
    const isAmount = field === 'amount'
    if (editing) {
      return (
        <input
          className="form-input" autoFocus
          type={isAmount ? 'number' : 'text'} step={isAmount ? '0.01' : undefined}
          style={{ padding: '2px 6px', textAlign: isAmount ? 'right' : 'left', ...style }}
          value={bankEdits[key]}
          onChange={e => setBankEdits(p => ({ ...p, [key]: e.target.value }))}
          onBlur={() => saveBankRow(row, field)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setBankEdits(p => { const q = { ...p }; delete q[key]; return q })
          }}
        />
      )
    }
    const raw = row[field]
    const hasCalc = isAmount && calculated !== undefined
    const shown = isAmount
      ? (raw == null ? (hasCalc ? formatCurrency(calculated) : '—') : formatCurrency(raw))
      : (raw || placeholder || '—')
    return (
      <span
        onClick={() => { if (isLocked) return; setBankEdits(p => ({
          ...p, [key]: raw == null ? '' : (isAmount ? String(parseFloat(raw)) : String(raw)),
        })) }}
        style={{ cursor: isLocked ? 'default' : 'pointer', color: raw || hasCalc ? undefined : 'var(--text-muted)', ...style }}
        title={isLocked ? 'Budget is locked'
          : hasCalc
          ? (raw != null
            ? 'Typed in by hand — blank it to go back to the sum of the accounts above'
            : 'Sum of the accounts above — click to type your own figure')
          : 'Click to edit'}
      >
        {shown}
        {hasCalc && raw != null && (
          <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>edited</span>
        )}
      </span>
    )
  }

  // A figure the system calculates but the user may pin. Blank the input to unpin.
  const overridableAmount = (field, calculated, style) => {
    const editing = budgetFieldEdits[field] != null
    const pinned = budget[field] != null
    if (editing) {
      return (
        <input
          className="form-input" type="number" step="0.01" autoFocus
          style={{ padding: '2px 6px', textAlign: 'right', ...style }}
          value={budgetFieldEdits[field]}
          onChange={e => setBudgetFieldEdits(p => ({ ...p, [field]: e.target.value }))}
          onBlur={() => saveBudgetField(field)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') cancelBudgetFieldEdit(field)
          }}
        />
      )
    }
    return (
      <span
        onClick={() => { if (!isLocked) startBudgetFieldEdit(field) }}
        style={{ cursor: isLocked ? 'default' : 'pointer', ...style }}
        title={isLocked ? 'Budget is locked'
          : pinned ? 'Edited by hand — blank it to go back to the calculated figure' : 'Click to edit'}
      >
        {formatCurrency(calculated)}
        {pinned && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>edited</span>}
      </span>
    )
  }

  const selectedEntity = budgetEntities.find(e => String(e.id) === String(entityId))

  // The Exclude modal opens from a section header, so it lists that section's
  // suppliers — the ones that would classify into it on a pull.
  const sectionSuppliers = useMemo(
    () => (showExclusions ? suppliersForSection(showExclusions, suppliers) : []),
    [showExclusions, suppliers],
  )
  const sortedSuppliers = useMemo(
    () => [...sectionSuppliers].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })),
    [sectionSuppliers],
  )
  const filteredSuppliers = useMemo(() => {
    const q = exclSearch.trim().toLowerCase()
    return q ? sortedSuppliers.filter(s => (s.name || '').toLowerCase().includes(q)) : sortedSuppliers
  }, [sortedSuppliers, exclSearch])
  const excludedCount = sectionSuppliers.filter(s => s.exclude_from_budget).length

  const closeExclusions = () => { setShowExclusions(null); setExclSearch('') }

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
              Creating it lays out every section, empty. You then fill each one from its own header —
              pull suppliers, sub-contractors and wages from the system, pick the income that belongs,
              and type in the rest.
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
          {/* Locked banner — the whole budget is read-only until it is unlocked. */}
          {isLocked && (
            <div
              className="card"
              style={{
                marginBottom: 16, padding: '10px 14px', display: 'flex', alignItems: 'center',
                gap: 10, flexWrap: 'wrap', border: '1px solid var(--success)',
                background: 'rgba(34, 197, 94, 0.08)',
              }}
            >
              <Lock size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span style={{ fontSize: 13 }}>
                <strong>Locked</strong>
                {budget.locked_by_name ? ` by ${budget.locked_by_name}` : ''} on {formatDate(budget.locked_at)} —
                nothing can be added or changed. Exporting still works.
              </span>
              <button className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
                onClick={handleLockToggle} disabled={lockSaving}>
                <Unlock size={13} /> {lockSaving ? 'Unlocking…' : 'Unlock'}
              </button>
            </div>
          )}

          {/* Summary — Safetec shows a base-month profit statement; OBHI, BTP and
              TP reconcile per month-group (income vs the expenses that income has
              to cover); every other entity uses the single window total. */}
          {isSft && baseSummary ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
                {[
                  { label: 'Income', value: baseSummary.income },
                  { label: 'Expenses', value: baseSummary.expenses,
                    hint: 'Every expense section, To Pay + Paid' },
                  { label: 'Profit', value: baseSummary.profit, big: true,
                    hint: 'Income − Expenses',
                    cls: baseSummary.profit < 0 ? ' text-danger' : ' text-success' },
                  { label: "Profit — Johan's Profit Sheet", value: budget.external_profit,
                    hint: 'Click to enter', editable: true },
                  { label: 'Personal Expenses', value: baseSummary.personal,
                    hint: 'Personal + Business not on truck costing' },
                  { label: 'Actual Profit', value: baseSummary.actualProfit, big: true,
                    hint: 'Profit − Personal Expenses',
                    cls: baseSummary.actualProfit < 0 ? ' text-danger' : ' text-success' },
                ].map(c => (
                  <div
                    key={c.label} className="stat-card"
                    style={c.editable && !isLocked ? { cursor: 'pointer' } : undefined}
                    onClick={c.editable && !isLocked && budgetFieldEdits.external_profit == null
                      ? () => startBudgetFieldEdit('external_profit')
                      : undefined}
                  >
                    <div className="stat-card-label">{c.label}</div>
                    {c.editable && budgetFieldEdits.external_profit != null ? (
                      <input
                        className="form-input" type="number" step="0.01" autoFocus
                        style={{ fontSize: 20, fontWeight: 700, padding: '2px 6px' }}
                        value={budgetFieldEdits.external_profit}
                        onChange={e => setBudgetFieldEdits(p => ({ ...p, external_profit: e.target.value }))}
                        onBlur={() => saveBudgetField('external_profit')}
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') cancelBudgetFieldEdit('external_profit')
                        }}
                      />
                    ) : (
                      <div className={`stat-card-value${c.cls || ''}`} style={{ fontSize: c.big ? 26 : 22 }}>
                        {c.value == null ? '—' : formatCurrency(c.value)}
                      </div>
                    )}
                    {c.hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{c.hint}</div>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                {baseSummary.baseLabel} only — the two months that follow are shown in the grid for cash-flow planning and don&apos;t affect these figures.
              </div>
            </div>
          ) : hasMonthSplit && monthSplit ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 16 }}>
              {[monthSplit.g1, monthSplit.g2].map(g => (
                <div key={g.title} className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div className="stat-card-label" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{g.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.sub}</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Income</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(g.income)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Expenses</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(g.expenses)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <span style={{ fontWeight: 700 }}>Left Over</span>
                    <span className={g.leftOver < 0 ? 'text-danger' : 'text-success'} style={{ fontWeight: 700, fontSize: 22 }}>
                      {formatCurrency(g.leftOver)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid-4" style={{ marginBottom: 16 }}>
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
          )}

          {/* Bank Info Summary — this entity's account balances, read off the
              banking system by hand; the profit line below them is pulled from
              the budget on screen. Rows are the user's to rename or delete. */}
          {bankInfo && (
            <div className="card" style={{ marginBottom: 16, padding: 16 }}>
              <button
                onClick={() => setBankInfoOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
                  padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit',
                  fontWeight: 700, fontSize: 15, marginBottom: bankInfoOpen ? 12 : 0, width: '100%',
                }}
                aria-expanded={bankInfoOpen}
              >
                {bankInfoOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                <span style={{ textDecoration: 'underline' }}>Bank Info Summary</span>
                {!bankInfoOpen && isSft && (
                  <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13, color: 'var(--text-muted)' }}>
                    Profit {formatCurrency(bankInfo.profit)}
                  </span>
                )}
              </button>

              {bankInfoOpen && (<>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {bankInfo.accounts.map(row => (
                    <tr key={row.id}>
                      <td style={{ padding: '4px 8px 4px 0', whiteSpace: 'nowrap' }}>{bankCell(row, 'label')}</td>
                      <td style={{ padding: '4px 8px', width: '45%', color: 'var(--text-muted)', fontSize: 12 }}>
                        {bankCell(row, 'note', { placeholder: '+ note', style: { fontSize: 12 } })}
                      </td>
                      <td style={{ padding: '4px 0', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {bankCell(row, 'amount')}
                      </td>
                      <td style={{ width: 28, textAlign: 'right' }}>
                        {!isLocked && (
                          <button className="btn-icon" title="Delete row" onClick={() => handleDeleteBankRow(row)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}

                  {/* Cash Flow Total — computed off the rows above; typing pins it. */}
                  {bankInfo.cashFlowRow && (
                    <tr>
                      <td style={{ padding: '7px 8px 4px 0', whiteSpace: 'nowrap', fontWeight: 700, borderTop: '1px solid var(--border)' }}>
                        {bankCell(bankInfo.cashFlowRow, 'label')}
                      </td>
                      <td style={{ padding: '7px 8px 4px', color: 'var(--text-muted)', fontSize: 11, borderTop: '1px solid var(--border)' }}>
                        {bankInfo.cashFlowRow.amount == null && 'Sum of the accounts above'}
                      </td>
                      <td style={{ padding: '7px 0 4px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, borderTop: '1px solid var(--border)' }}>
                        {bankCell(bankInfo.cashFlowRow, 'amount', { calculated: bankInfo.cashFlowCalc })}
                      </td>
                      <td style={{ width: 28, textAlign: 'right', borderTop: '1px solid var(--border)' }}>
                        {!isLocked && (
                          <button className="btn-icon" title="Delete row" onClick={() => handleDeleteBankRow(bankInfo.cashFlowRow)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {!isLocked && (
                <button className="btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => handleAddBankRow('bank')}>
                  <Plus size={13} /> Add account
                </button>
              )}

              {/* Everything below the account list is Safetec's sheet: the profit
                  line, the trailer VAT-back adjustment off it, and the TO BE PAID
                  block. The other entities keep the account balances only. */}
              {isSft && (<>
              {/* Profit — pulled from the budget above, then adjusted for the VAT back. */}
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, textTransform: 'uppercase' }}>
                    Profit for {baseSummary.baseLabel}
                  </span>
                  {overridableAmount('bank_profit_override', bankInfo.profit, { fontSize: 17, fontWeight: 700 })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Pulled from this budget — Income − Expenses
                </div>
              </div>

              <div
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
                  background: 'rgba(150, 190, 90, 0.22)', padding: '6px 8px', margin: '10px 0 0',
                  fontStyle: 'italic', fontWeight: 600,
                }}
              >
                <span>vat back trailer</span>
                {overridableAmount('vat_back_trailer', bankInfo.vatBack, { fontWeight: 700, fontStyle: 'normal' })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '3px 8px 0' }}>
                {budget.vat_back_trailer != null
                  ? 'Typed in — blank it to go back to the lines below'
                  : bankInfo.vatBackHits.length
                    ? `Pulled from ${bankInfo.vatBackHits.length} line${bankInfo.vatBackHits.length > 1 ? 's' : ''} billing their stated VAT back this month: ${bankInfo.vatBackHits.map(h => h.name.split(' - ')[0]).join(', ')}`
                    : 'No line billed its stated VAT back this month — click to enter one'}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 8px 0' }}>
                <span>profit would have been without vat back</span>
                {overridableAmount('profit_excl_vat_back_override', bankInfo.profitExclVatBack, { fontWeight: 700 })}
              </div>

              {/* TO BE PAID */}
              <div style={{ border: '1px solid var(--border)', padding: 12, marginTop: 16 }}>
                <div style={{ fontWeight: 700, fontStyle: 'italic', textDecoration: 'underline', marginBottom: 6 }}>
                  TO BE PAID:
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {bankInfo.toBePaid.map(row => (
                      <tr key={row.id}>
                        <td style={{ padding: '3px 8px 3px 0' }}>{bankCell(row, 'label')}</td>
                        <td style={{ padding: '3px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {bankCell(row, 'amount')}
                        </td>
                        <td style={{ width: 28, textAlign: 'right' }}>
                          {!isLocked && (
                            <button className="btn-icon" title="Delete row" onClick={() => handleDeleteBankRow(row)}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ padding: '6px 8px 0 0' }} />
                      <td style={{
                        padding: '6px 0 0', textAlign: 'right', fontWeight: 700, fontStyle: 'italic',
                        borderTop: '1px solid var(--border)', whiteSpace: 'nowrap',
                      }}>
                        {formatCurrency(bankInfo.toBePaidTotal)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
                {!isLocked && (
                  <button className="btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => handleAddBankRow('to_be_paid')}>
                    <Plus size={13} /> Add line
                  </button>
                )}
              </div>
              </>)}
              </>)}
            </div>
          )}

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <button
              className="btn-primary btn-sm" onClick={handleReplicate} disabled={replicating}
              title={`Carry this budget forward into ${MONTHS[(Number(month) % 12)]} ${Number(month) === 12 ? Number(year) + 1 : year}. Lines and amounts come along; amounts keep their own month, so ${MONTHS[Number(month) - 1]} drops off the front. Existing figures there are never overwritten.`}
            >
              <CopyPlus size={14} /> {replicating ? 'Replicating…' : `Replicate to ${MONTHS[(Number(month) % 12)]}`}
            </button>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}
              title={`Also REMOVE lines ${MONTHS[(Number(month) % 12)]} has that ${MONTHS[Number(month) - 1]} doesn't, and put it in the same order — so the two months read the same. Lines holding figures someone typed in are never removed. You'll see exactly what goes before anything happens.`}
            >
              <input type="checkbox" checked={pruneOnReplicate}
                onChange={e => setPruneOnReplicate(e.target.checked)} />
              Match exactly
            </label>
            {isAdmin && (
              <button className="btn-ghost btn-sm" onClick={openConstants}>
                <ListChecks size={14} /> Manage Constants
              </button>
            )}
            <button className="btn-ghost btn-sm" onClick={() => handleExport('excel')} disabled={!!exportLoading}
              title="Download this budget as a branded Excel sheet">
              <FileSpreadsheet size={14} /> {exportLoading === 'excel' ? 'Exporting…' : 'Excel'}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => handleExport('pdf')} disabled={!!exportLoading}
              title="Download this budget as a branded PDF">
              <FileDown size={14} /> {exportLoading === 'pdf' ? 'Exporting…' : 'PDF'}
            </button>
            {!isLocked && (
              <button className="btn-ghost btn-sm" onClick={handleLockToggle} disabled={lockSaving}
                title="Lock this budget — nothing can be added or changed until it is unlocked. Works like the costing Sent flag.">
                <Lock size={14} /> {lockSaving ? 'Locking…' : 'Lock Budget'}
              </button>
            )}
            {/* Undo a bad batch of final locks across every cell on this budget. */}
            <BulkUnlockButton
              items={Object.values(verif)}
              currentUserId={user?.id} isAdmin={isAdmin} noun="cell"
              onUnlock={async (item) => {
                const { data } = await finalizeValue(item.target, budget?.entity_id, 'remove')
                setVerif(prev => ({ ...prev, [data.target]: data }))
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
              Tip: fill each box from its own header — <strong>Pull from System</strong> for supplier, sub-contractor and wage figures, <strong>Add</strong> for anything you type yourself. Lines marked <span className="badge badge-sent" style={{ fontSize: 10 }}>auto</span> come from the system — editing a cell pins it. Lines marked <span className="badge badge-paid" style={{ fontSize: 10 }}>fixed</span> are recurring constants you fill in yourself.
            </span>
          </div>

          {/* Sections */}
          {budget.sections.map(section => {
            const isIncome = section.section_type === 'income'
            const isIncomeSection = section.name === INCOME_SECTION
            const canPull = PULLABLE_SECTIONS.includes(section.name)
            const canExclude = SUPPLIER_SECTIONS.includes(section.name)
            const isPulling = !!pulling[section.id]
            return (
              <div key={section.id} className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{section.name}</span>
                    <span className={`badge ${isIncome ? 'badge-paid' : 'badge-sent'}`}>
                      {isIncome ? 'Income' : 'Expense'}
                    </span>
                  </div>
                  {/* All editing controls disappear while the budget is locked. */}
                  {!isLocked && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button className="btn-ghost btn-sm" onClick={() => openQuickAdd(section.section_type, section.id)}
                      title={`Add a line to ${section.name} that you fill in yourself`}>
                      <Plus size={13} /> Add
                    </button>

                    {/* Income is chosen, not pulled — the modal lists one row per
                        PO plus one row per invoice that has no PO, to tick. */}
                    {isIncomeSection && (
                      <button className="btn-ghost btn-sm" onClick={openIncomeModal}
                        title="Choose which income on the system belongs in this budget">
                        <TrendingUp size={13} /> Pull from System
                      </button>
                    )}

                    {!isIncomeSection && canPull && (
                      <button className="btn-ghost btn-sm" onClick={() => handlePullSection(section)} disabled={isPulling}
                        title={`Pull ${section.name} figures from the system. Your manual lines and edited cells are kept.`}>
                        <RefreshCw size={13} className={isPulling ? 'spin' : undefined} /> {isPulling ? 'Pulling…' : 'Pull from System'}
                      </button>
                    )}

                    {canExclude && (
                      <button className="btn-ghost btn-sm" onClick={() => setShowExclusions(section.name)}
                        title={`Choose which suppliers ${section.name} should skip`}>
                        <Ban size={13} /> Exclude
                      </button>
                    )}

                    <button className="btn-icon" onClick={() => setConfirmDeleteSection(section)} title="Delete section"
                      style={{ color: 'var(--danger)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  )}
                </div>

                {/* Quick add — sits in the section its "Add" was clicked from, so
                    the input appears where the user is looking. */}
                {quickAdd?.sectionId === section.id && (
                  <div style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
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
                          options={suppliersForSection(section.name, suppliers)}
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

                    <button className="btn-primary btn-sm" onClick={submitQuickAdd} disabled={!quickAdd.name.trim()}>Add</button>
                    <button className="btn-ghost btn-sm" onClick={() => setQuickAdd(null)}>Cancel</button>
                  </div>
                )}

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
                          <td style={{ fontWeight: 500, minWidth: 180, maxWidth: 260, verticalAlign: 'top' }}>
                            {nameEdits[line.id] != null ? (
                              <textarea
                                className="form-input" autoFocus rows={1}
                                ref={autoGrow}
                                style={lineNameInput}
                                value={nameEdits[line.id]}
                                onChange={e => { autoGrow(e.target); setNameEdits(p => ({ ...p, [line.id]: e.target.value })) }}
                                onBlur={() => commitLineName(line)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                                  if (e.key === 'Escape') setNameEdits(p => { const q = { ...p }; delete q[line.id]; return q })
                                }}
                              />
                            ) : (
                              <span
                                onClick={() => { if (!isLocked) setNameEdits(p => ({ ...p, [line.id]: line.name })) }}
                                style={{ cursor: isLocked ? 'default' : 'text', wordBreak: 'break-word' }}
                                title={isLocked ? 'Budget is locked'
                                  : line.name_overridden ? 'Renamed by hand — a pull keeps this name. Click to edit'
                                  : 'Click to edit'}
                              >
                                {line.name}
                              </span>
                            )}
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
                                    readOnly={locked || isLocked}
                                    placeholder={isLocked ? '' : '0.00'}
                                    title={isLocked ? 'Budget is locked — nothing can be changed until it is unlocked'
                                      : locked ? 'Locked by final verification — remove the lock to edit'
                                      : overridden ? (isIncome
                                        ? 'Manually edited — a system refresh will not change this. Clear the box to go back to the system figure.'
                                        : 'Manually edited — a system refresh will not change this. Clear both boxes for this month to go back to the system figure.')
                                      : undefined}
                                    style={isLocked ? cellInputBudgetLocked : locked ? cellInputLocked : overridden ? cellInputOverridden : cellInputStyle}
                                  />
                                </VerifiableAmount>
                              </td>
                              )
                            })
                          })}
                          <td style={{ textAlign: 'center' }}>
                            {!isLocked && (
                              <button className="btn-icon" onClick={() => handleDeleteLine(section, line)} title="Delete line"
                                style={{ color: 'var(--text-muted)', padding: 3 }}>
                                <X size={13} />
                              </button>
                            )}
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

                      {section.lines.length === 0 && (
                        <tr>
                          <td colSpan={1 + months.length * (isIncome ? 1 : 2) + 1}
                            style={{ padding: '14px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                            Nothing here yet — {canPull ? <>use <strong>Pull from System</strong> for the system&apos;s figures, or </>
                              : isIncomeSection ? <>use <strong>Pull from System</strong> to pick the income, or </> : ''}
                            <strong>Add</strong> a line to type in yourself.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* Add section + delete budget — none of it while the budget is locked. */}
          {!isLocked && (
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
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn-ghost btn-sm" onClick={() => setNewSection({ name: '', section_type: 'expense' })}>
                  <Plus size={13} /> Add Section
                </button>

                {/* A standard section this budget hasn't got — deleted by mistake, pruned
                    when it was empty, or added to the defaults after the budget was made.
                    Offered by name rather than left to retyping: the name has to match
                    exactly for Pull from System and the income modal to find the section. */}
                {(budget.missing_sections || []).map(s => (
                  <button key={s.name} className="btn-ghost btn-sm" disabled={restoring}
                    onClick={() => handleRestoreSections([s.name])}
                    title={`Put the ${s.name} section back where it belongs, empty — then fill it from its own header. Amounts it used to hold are not recovered.`}>
                    <RefreshCw size={13} className={restoring ? 'spin' : undefined} /> Restore {s.name}
                  </button>
                ))}
              </div>
            )}

            <button className="btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(budget)}>
              <Trash2 size={13} /> Delete Budget
            </button>
          </div>
          )}
        </>
      )}

      {/* Deleting a section takes every line and amount in it with it, and there is no
          undo — so it asks first, and says how much is about to go. */}
      <DeleteModal
        isOpen={!!confirmDeleteSection}
        onClose={() => setConfirmDeleteSection(null)}
        onDelete={handleDeleteSection}
        title="Delete Section"
        description={confirmDeleteSection
          ? `Delete the ${confirmDeleteSection.name} section? Its ${confirmDeleteSection.lines?.length || 0} line(s) and all their amounts go with it. `
            + (CONSTANT_SECTION_OPTIONS.includes(confirmDeleteSection.name)
                ? `A "Restore ${confirmDeleteSection.name}" button appears afterwards to put the empty section back, but the amounts are not recovered.`
                : 'This is not one of the standard sections, so there is no Restore button for it — you would have to add it again by hand.')
          : ''}
      />

      <DeleteModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onDelete={handleDelete}
        title="Delete Budget"
        description={confirmDelete
          ? `Delete the ${MONTHS[confirmDelete.period_month - 1]} ${confirmDelete.period_year} budget for ${selectedEntity?.code || ''}? All sections, lines and amounts will be removed.`
          : ''}
      />

      {/* "Match exactly" — what pruning will remove from next month, before it does. */}
      {pruneModal && (
        <div className="modal-overlay" onClick={() => setPruneModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 560, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CopyPlus size={18} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    Match {MONTHS[pruneModal.target_month - 1]} {pruneModal.target_year} to {MONTHS[Number(month) - 1]} {year}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedEntity?.code} — {selectedEntity?.name}</div>
                </div>
              </div>
              <button className="btn-icon" onClick={() => setPruneModal(null)}><X size={16} /></button>
            </div>

            <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1, overflowY: 'auto' }}>
              {pruneModal.remove.length > 0 && (
                <>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {MONTHS[pruneModal.target_month - 1]} will get every line {MONTHS[Number(month) - 1]} has, in the same
                    order, and these <strong>{pruneModal.remove.length}</strong> line(s) it has on its own will be
                    removed. Their figures came from the system — <strong>Pull from System</strong> brings them back.
                  </p>

                  <div style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
                    {pruneModal.remove.map(item => (
                      <div key={item.line_id}
                        style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, minWidth: 150, flexShrink: 0 }}>{item.section}</span>
                        <span style={{ flex: 1, wordBreak: 'break-word' }}>{item.name}</span>
                        {item.has_figures && (
                          <span className="badge badge-sent" style={{ fontSize: 9 }} title="Has figures on it — they can be pulled again">has figures</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {pruneModal.sections_removed.length > 0 && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Empty section(s) going too: <strong>{pruneModal.sections_removed.join(', ')}</strong>
                </p>
              )}

              {/* Bank Info Summary extras, kept apart from the lines above: nothing
                  in that block is pulled, so a removed row is typed back in by hand. */}
              {pruneModal.bank_remove.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong>{pruneModal.bank_remove.length}</strong> empty Bank Info Summary row(s) will go too —
                    {MONTHS[Number(month) - 1]} has no such row. Nothing is lost: they have no amount on them.
                  </p>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
                    {pruneModal.bank_remove.map(item => (
                      <div key={`bank:${item.row_id}`}
                        style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, minWidth: 150, flexShrink: 0 }}>
                          {item.kind === 'bank' ? 'Bank Info — accounts' : 'Bank Info — to be paid'}
                        </span>
                        <span style={{ flex: 1, wordBreak: 'break-word' }}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(pruneModal.keep.length > 0 || pruneModal.bank_keep.length > 0) && (
                <div>
                  <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-secondary)' }}>
                    Kept — someone typed these figures in, so they stay even though {MONTHS[Number(month) - 1]} has no such line:
                  </p>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {[...pruneModal.keep.map(i => `${i.section} — ${i.name}`),
                      ...pruneModal.bank_keep.map(i => `Bank Info — ${i.label}`)].join(' · ')}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn-ghost" onClick={() => setPruneModal(null)} disabled={replicating}>Cancel</button>
              <button className="btn-primary" onClick={() => runReplicate(true)} disabled={replicating}>
                {replicating ? 'Replicating…'
                  : `Replicate & remove ${pruneModal.remove.length + pruneModal.bank_remove.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExclusions && (
        <div className="modal-overlay" onClick={closeExclusions}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 520, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Ban size={18} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Exclude Suppliers — {showExclusions}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedEntity?.code} — {selectedEntity?.name}</div>
                </div>
              </div>
              <button className="btn-icon" onClick={closeExclusions}><X size={16} /></button>
            </div>

            {/* Body */}
            <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                The suppliers that fall under <strong>{showExclusions}</strong>. Ticking one excludes it
                from &quot;Pull from System&quot; <strong>everywhere</strong> — it won&apos;t appear or
                update in any budget section, for any entity, in any period. Lines already pulled into a
                budget stay put; untick to start pulling it again.
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
                {filteredSuppliers.length} of {sectionSuppliers.length} supplier{sectionSuppliers.length === 1 ? '' : 's'}
                {excludedCount > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{excludedCount} excluded</strong></>}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, minHeight: 200 }}>
                {sectionSuppliers.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No suppliers fall under {showExclusions}</div>
                )}
                {sectionSuppliers.length > 0 && filteredSuppliers.length === 0 && (
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

      {incomeModal && (
        <div className="modal-overlay" onClick={() => !incomeModal.saving && setIncomeModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 820, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <TrendingUp size={18} style={{ color: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Select Income</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {selectedEntity?.code} — {months.map(({ month: m, year: y }) => `${MONTHS[m - 1]} ${y}`).join(', ')}
                  </div>
                </div>
              </div>
              <button className="btn-icon" onClick={() => setIncomeModal(null)} disabled={incomeModal.saving}><X size={16} /></button>
            </div>

            {/* Body */}
            <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
              {incomeModal.loading && (
                <div className="loading-center" style={{ padding: 20 }}><div className="spinner" /></div>
              )}

              {!incomeModal.loading && incomeModal.candidates.length > 0 && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Tick the income that belongs in this budget and choose which line each row counts
                  toward. The INCOME section shows just the two generic lines — <strong>TRADEKOR
                  INCOME ONLY</strong> and <strong>OTHER INCOME</strong> — each totalling its
                  assigned rows.
                </p>
              )}

              {!incomeModal.loading && incomeModal.candidates.length > 0 && (
                <div className="search-bar">
                  <Search size={14} />
                  <input
                    autoFocus
                    placeholder="Search invoice number, PO or customer…"
                    value={incomeSearch}
                    onChange={e => setIncomeSearch(e.target.value)}
                  />
                  {incomeSearch && <button className="btn-icon" onClick={() => setIncomeSearch('')}><X size={13} /></button>}
                </div>
              )}

              {!incomeModal.loading && (() => {
                const q = incomeSearch.trim().toLowerCase()
                const filtered = q
                  ? incomeModal.candidates.filter(c =>
                      c.line_name.toLowerCase().includes(q) ||
                      (c.invoice_number || '').toLowerCase().includes(q))
                  : incomeModal.candidates
                const shown = applySort(filtered, incomeSort, incomeSortVal)
                const shownKeys = shown.map(c => c.source_key)
                const allOn = shown.length > 0 && shownKeys.every(k => k in incomeModal.picked)
                const pickedCount = Object.keys(incomeModal.picked).length
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span>
                        {shown.length} of {incomeModal.candidates.length} shown · <strong style={{ color: 'var(--accent)' }}>{pickedCount} selected</strong>
                      </span>
                      {shown.length > 0 && (
                        <button className="btn-ghost btn-sm" style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 8px' }}
                          onClick={() => setIncomePicks(shownKeys, !allOn)}>
                          {allOn ? 'Clear' : 'Select'} {q ? 'these' : 'all'}
                        </button>
                      )}
                    </div>

                    <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, minHeight: 180 }}>
                      <table className="compact-table" style={{ width: '100%' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-card)' }}>
                          <tr>
                            <th style={{ width: 30 }}></th>
                            <SortableHeader label="Invoice #" col="invoice" sort={incomeSort} onSort={onIncomeSort} />
                            <SortableHeader label="PO Number" col="po" sort={incomeSort} onSort={onIncomeSort} />
                            <SortableHeader label="Customer" col="customer" sort={incomeSort} onSort={onIncomeSort} />
                            <SortableHeader label="Month" col="months" sort={incomeSort} onSort={onIncomeSort} />
                            <th>Income Line</th>
                            <SortableHeader label="Amount" col="total" sort={incomeSort} onSort={onIncomeSort} style={{ textAlign: 'right' }} />
                          </tr>
                        </thead>
                        <tbody>
                          {incomeModal.candidates.length === 0 && (
                            <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                              No income on the system for this period
                            </td></tr>
                          )}
                          {incomeModal.candidates.length > 0 && shown.length === 0 && (
                            <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                              Nothing matches &quot;{incomeSearch}&quot;
                            </td></tr>
                          )}
                          {shown.map(c => {
                            const bucket = incomeModal.picked[c.source_key]
                            const on = bucket != null
                            return (
                              <tr
                                key={c.source_key}
                                onClick={() => toggleIncomePick(c.source_key)}
                                style={{ cursor: 'pointer', background: on ? 'var(--accent-bg, rgba(37,99,235,0.06))' : 'transparent' }}
                              >
                                <td>
                                  <input
                                    type="checkbox" checked={on}
                                    onChange={() => toggleIncomePick(c.source_key)}
                                    onClick={e => e.stopPropagation()}
                                    style={{ width: 15, height: 15, cursor: 'pointer' }}
                                  />
                                </td>
                                <td style={{ color: 'var(--accent)', fontWeight: 600, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  title={c.invoice_number || ''}>
                                  {c.invoice_number || '—'}
                                </td>
                                <td style={{ whiteSpace: 'nowrap', fontWeight: on ? 600 : 400 }}>{c.po_number || '—'}</td>
                                <td style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  title={c.customer_name || ''}>
                                  {c.customer_name || '—'}
                                </td>
                                {/* The month the invoice was actually issued — not the
                                    window months the figure lands in, which overlap for
                                    arrears entities and would show two months. */}
                                <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {(c.issue_months?.length ? c.issue_months : c.values).map(v => MONTHS[v.month - 1]).join(', ')}
                                </td>
                                {/* Which generic line this row feeds. Clicking a side
                                    ticks the row too — assigning it is choosing it. */}
                                <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'inline-flex', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border)' }}>
                                    {INCOME_BUCKETS.map(([b, label]) => (
                                      <button
                                        key={b} type="button"
                                        onClick={() => setIncomeBucket(c.source_key, b)}
                                        title={`Count this row in ${b === 'tradekor' ? 'TRADEKOR INCOME ONLY' : 'OTHER INCOME'}`}
                                        style={{
                                          padding: '3px 9px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                                          background: (bucket ?? c.bucket) === b && on ? 'var(--accent)' : 'var(--bg-surface)',
                                          color: (bucket ?? c.bucket) === b && on ? '#fff' : 'var(--text-muted)',
                                          transition: 'all 0.15s',
                                        }}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  {formatCurrency(c.total)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Totals the whole selection, not just what the search shows,
                        so a filter can't make the figure look wrong. One total per
                        generic income line — these are the figures the budget's
                        TRADEKOR INCOME ONLY and OTHER INCOME lines will carry. */}
                    {(() => {
                      const bucketTotal = (b) => incomeModal.candidates
                        .filter(c => incomeModal.picked[c.source_key] === b)
                        .reduce((sum, c) => sum + num(c.total), 0)
                      const tradekor = bucketTotal('tradekor')
                      const other = bucketTotal('other')
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Tradekor Income Only</span>
                            <span style={{ fontWeight: 600 }}>{formatCurrency(tradekor)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Other Income</span>
                            <span style={{ fontWeight: 600 }}>{formatCurrency(other)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                            <span>Selected total</span>
                            <span>{formatCurrency(tradekor + other)}</span>
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )
              })()}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn-ghost btn-sm" onClick={() => setIncomeModal(null)} disabled={incomeModal.saving}>Cancel</button>
              <button className="btn-primary btn-sm" onClick={submitIncome} disabled={incomeModal.loading || incomeModal.saving}>
                {incomeModal.saving ? 'Saving…' : 'Apply'}
              </button>
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
                section of every budget on creation, and added to any existing budget missing it the next
                time that section is pulled. Renaming or deleting a constant here only affects
                future budgets; a budget&apos;s own copy of the line can still be freely edited or
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
// which figures they've overridden and that a refresh won't touch them. Clearing the
// cell (both boxes) releases the pin, so the accent border disappears and the next
// pull fills it from the system again.
const cellInputOverridden = {
  ...cellInputStyle,
  border: '1px solid var(--accent)',
  fontWeight: 600,
}

// A value locked by final verification — not editable until the lock is removed.
// Green (not the brand accent) so the owner can spot final-verified figures at a glance.
const cellInputLocked = {
  ...cellInputStyle,
  cursor: 'not-allowed',
  color: 'var(--text-primary)',
  fontWeight: 600,
  background: 'rgba(34, 197, 94, 0.08)',
  border: '1px solid var(--success)',
}

// A cell on a LOCKED budget — the whole sheet is read-only, so the cells drop
// their input look and read as plain figures.
const cellInputBudgetLocked = {
  ...cellInputStyle,
  cursor: 'not-allowed',
  background: 'transparent',
  border: '1px solid transparent',
}

// Line names wrap over as many rows as they need, so they're edited in a textarea
// that grows to fit rather than an input that scrolls the text out of sight.
const lineNameInput = {
  width: '100%', fontSize: 12.5, fontWeight: 500, lineHeight: 1.35,
  background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 5,
  padding: '3px 6px', color: 'var(--text-primary)', outline: 'none',
  resize: 'none', overflow: 'hidden', display: 'block',
}

const autoGrow = (el) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Clickable sort headers.
const thSortLeft = { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }
const thSortRight = { ...thSortLeft, textAlign: 'right' }
const thSortLabel = { display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }
