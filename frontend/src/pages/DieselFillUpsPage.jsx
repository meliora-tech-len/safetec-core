import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react'
import {
  getDieselFillUps, getDieselFillUpSummary, createDieselFillUp,
  updateDieselFillUp, deleteDieselFillUp, archiveDieselFillUp, verifyDieselFillUp, finalizeDieselFillUp,
  getCurrentDieselRate, getEntities, getDieselSettings, getSuppliers,
  getDieselInvoiceLocks, setDieselInvoiceLock, setDieselInvoiceLocksBulk,
} from '../services/api'
import { formatCurrency, formatDate, errorMessage, dieselTypeForSupplier, entityVatRate } from '../utils/helpers'
import { useAuth } from '../hooks/useAuth'
import { useEntityFilter } from '../hooks/useEntityFilter'
import { useSessionState } from '../hooks/useSessionState'
import toast from 'react-hot-toast'
import { Plus, Search, X, Trash2, Fuel, Save, Upload, Pencil, Lock, Unlock, RotateCcw, CheckCircle } from 'lucide-react'
import ImportDieselModal from '../components/ImportDieselModal'
import ExportButton from '../components/ExportButton'
import SearchableSelect from '../components/SearchableSelect'
import VerifyBadge from '../components/VerifyBadge'
import DeleteModal from '../components/DeleteModal'
import SortableHeader, { useSort, applySort } from '../components/SortableHeader'
import DateInput from '../components/DateInput'

const API = import.meta.env.VITE_API_URL || ''
function rawApi(path, opts = {}) {
  const token = localStorage.getItem('token')
  return fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers },
    ...opts,
  }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
}

import { MONTHS_SHORT_1 as MONTHS } from '../utils/helpers'
const today = new Date().toISOString().slice(0, 10)

// Fixed display order for the truck registration dropdown on this standalone
// Diesel page (as supplied by Venessa's list, images 1–5). Trucks whose
// registration matches sort into this order; anything not listed follows after
// in registration order. Only affects the Diesel module — not Truck Loads.
const DIESEL_REG_ORDER = [
  'JTH936EC', 'JZF207EC', 'JPL694EC', 'JZS468EC', 'KGW055EC', 'KKP390EC', 'KKP393EC',
  'KRL688EC', 'KRR116EC', 'KDS053EC', 'KGY077EC', 'KJW398EC', 'KKL390EC', 'KTK577EC', 'KPV364EC',
  'KKY108EC', 'KMC765EC', 'KTH131EC', 'KRV199EC', 'DDM652NC', 'KTS596EC', 'KPS629EC', 'KST708EC',
  'KSC007EC', 'KKV898EC', 'KBB933EC', '207JGXEC', 'KMP690EC', '529FHREC', '907JLTEC', 'KFJ378EC',
  'JWM651EC', 'JXG657EC',
]
const _regKey = r => (r || '').toUpperCase().replace(/\s+/g, '')
const _regRank = new Map(DIESEL_REG_ORDER.map((r, i) => [_regKey(r), i]))
function orderDieselTrucks(list) {
  return [...(list || [])].sort((a, b) => {
    const ra = _regRank.has(_regKey(a.registration)) ? _regRank.get(_regKey(a.registration)) : Infinity
    const rb = _regRank.has(_regKey(b.registration)) ? _regRank.get(_regKey(b.registration)) : Infinity
    if (ra !== rb) return ra - rb
    return _regKey(a.registration).localeCompare(_regKey(b.registration))
  })
}

const BLANK = {
  entity_id: '', truck_id: '', supplier_id: '', fillup_date: today,
  litres: '', rate_per_litre: '', amount: '', invoice_number: '', slip_number: '', notes: '', diesel_type: 'fillup', rate_pending: false,
}

// Litres × Rate = Amount. The user may type any two and the third follows: litres
// or rate recompute the amount, while a typed amount back-computes the rate (litres
// come off the slip and are never derived). Entering the amount straight off the
// statement is the point — a 4dp rate can't always reproduce it to the cent, so the
// backend keeps whichever amount was typed.
const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n }

export default function DieselFillUpsPage() {
  const { activeEntity, isAdmin, entities: authEntities, user } = useAuth()
  const now = new Date()

  const [fillups, setFillups]     = useState([])
  const [summary, setSummary]     = useState(null)
  const [entities, setEntities]   = useState([])
  const [trucks, setTrucks]       = useState([])   // filter bar trucks
  const [suppliers, setSuppliers] = useState([])   // filter bar suppliers
  const [rowSuppliers, setRowSuppliers] = useState([]) // edit row suppliers (entity-scoped)
  const [loading, setLoading]     = useState(true)

  // Filters
  const [filterEntity,   setFilterEntity]   = useEntityFilter()
  const [filterYear,     setFilterYear]     = useSessionState('period:diesel-fillups:year', now.getFullYear())
  const [filterMonth,    setFilterMonth]    = useSessionState('period:diesel-fillups:month', now.getMonth() + 1)
  const [filterTruck,    setFilterTruck]    = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [filterVerified, setFilterVerified] = useState('')
  const [search,         setSearch]         = useState('')

  // Inline editing
  const [editingId,    setEditingId]    = useState(null)   // null | 'new' | fillup.id
  const [editForm,     setEditForm]     = useState({ ...BLANK })
  const [rowTrucks,    setRowTrucks]    = useState([])
  const [autoRate,     setAutoRate]     = useState(null)
  const [rateEdited,   setRateEdited]   = useState(false)
  const [preview,      setPreview]      = useState({ amount: null, fee: null, total: null })
  const [dieselSettings, setDieselSettings] = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showImport,   setShowImport]   = useState(false)
  // Note-only editing (allowed even on records under the final verification lock)
  const [noteEditId,   setNoteEditId]   = useState(null)
  const [noteText,     setNoteText]     = useState('')
  const [noteSaving,   setNoteSaving]   = useState(false)
  // Month lock — one row per entity + month/year; locked = no values in or out
  const [locks,        setLocks]        = useState([])
  const [lockModal,    setLockModal]    = useState(null)  // { groups: [{ invoiceId, invoiceNumber, rows, … }] } | null
  const [lockDate,     setLockDate]     = useState(today)
  const [lockSaving,   setLockSaving]   = useState(false)
  // Invoices ticked in the locks panel for "Lock selected"
  const [lockChecked,  setLockChecked]  = useState(new Set())
  // Panel stays shut by default — the page looks unchanged until locks are needed
  const [locksOpen,    setLocksOpen]    = useSessionState('diesel:invoice-locks-open', false)
  // Bulk verification — rows ticked for "Verify selected" / "Final lock selected"
  const [selectedIds,    setSelectedIds]    = useState(new Set())
  const [verifyingBulk,  setVerifyingBulk]  = useState(false)
  const [finalizingBulk, setFinalizingBulk] = useState(false)
  const [unfinalizingBulk, setUnfinalizingBulk] = useState(false)
  const firstInputRef = useRef(null)
  const { sort, onSort } = useSort('truck_registration', 'asc', 'diesel-fillups')

  // Reference data — entities once on mount
  useEffect(() => { getEntities().then(r => setEntities(r.data)) }, [])

  // Filter bar: trucks and suppliers scoped to the selected entity.
  // No entity selected ("All Entities") → show all accessible trucks/suppliers.
  useEffect(() => {
    const entityQs = filterEntity ? `&entity_id=${filterEntity}` : ''
    rawApi(`/api/fleet/trucks?limit=500${entityQs}`).then(r => setTrucks(orderDieselTrucks(r))).catch(() => setTrucks([]))
    const supParams = { is_diesel_supplier: true, limit: 500 }
    if (filterEntity) supParams.entity_id = filterEntity
    getSuppliers(supParams).then(r => setSuppliers(r.data || [])).catch(() => setSuppliers([]))
  }, [filterEntity])

  const buildParams = useCallback(() => {
    const p = {}
    if (filterEntity)       p.entity_id  = filterEntity
    if (filterYear)         p.year       = filterYear
    if (filterMonth)        p.month      = filterMonth
    if (filterTruck)        p.truck_id   = filterTruck
    if (filterSupplier)     p.supplier_id = filterSupplier
    if (filterVerified !== '') p.verified = filterVerified
    return p
  }, [filterEntity, filterYear, filterMonth, filterTruck, filterSupplier, filterVerified])

  const load = useCallback(() => {
    setLoading(true)
    // A new filter brings a different set of rows — drop any stale ticks with it
    setSelectedIds(new Set())
    const params = buildParams()
    Promise.all([
      getDieselFillUps(params).then(r => setFillups(r.data)),
      getDieselFillUpSummary(params).then(r => setSummary(r.data)),
    ]).finally(() => setLoading(false))
  }, [buildParams])

  useEffect(() => { load() }, [load])

  // Which invoices in the shown period have their diesel locked. Scoped to the
  // same filters as the rows (the API narrows by the invoice's statement period,
  // which is the bucket the Diesel Log itself uses).
  const loadLocks = useCallback(() => {
    const p = { year: filterYear, month: filterMonth }
    if (filterEntity)   p.entity_id   = filterEntity
    if (filterSupplier) p.supplier_id = filterSupplier
    // A new filter shows a different set of invoices — drop stale ticks with it
    setLockChecked(new Set())
    getDieselInvoiceLocks(p)
      .then(r => setLocks(r.data || []))
      .catch(() => setLocks([]))
  }, [filterEntity, filterSupplier, filterYear, filterMonth])

  useEffect(() => { loadLocks() }, [loadLocks])

  const lockByInvoiceId = useMemo(
    () => new Map(locks.map(l => [l.supplier_invoice_id, l])),
    [locks],
  )
  // A row is locked when the invoice it's linked to is. Rows still awaiting an
  // invoice have nothing to lock them by.
  const rowLocked = f => !!(f.supplier_invoice_id && lockByInvoiceId.has(f.supplier_invoice_id))

  const applyLock = async () => {
    if (!lockDate) { toast.error('Pick the date the invoices were locked'); return }
    const groups = lockModal.groups
    setLockSaving(true)
    try {
      await setDieselInvoiceLocksBulk({
        supplier_invoice_ids: groups.map(g => g.invoiceId),
        locked_date: lockDate,
      })
      toast.success(groups.length === 1
        ? `Invoice ${groups[0].invoiceNumber} locked`
        : `${groups.length} invoices locked`)
      setLockModal(null)
      setEditingId(null)
      setLockChecked(new Set())
      loadLocks()
    } catch (err) { toast.error(errorMessage(err)) }
    finally { setLockSaving(false) }
  }

  const removeLock = async (grp) => {
    if (!window.confirm(`Unlock the diesel on invoice ${grp.invoiceNumber}? Its ${grp.rows.length} log${grp.rows.length === 1 ? '' : 's'} can be changed again.`)) return
    try {
      await setDieselInvoiceLock({ supplier_invoice_id: grp.invoiceId }, { locked: false })
      toast.success('Invoice unlocked')
      loadLocks()
    } catch (err) { toast.error(errorMessage(err)) }
  }

  // Fetch trucks, suppliers, and diesel settings when edit row entity changes
  useEffect(() => {
    const eid = editForm.entity_id
    if (!eid) { setRowTrucks([]); setRowSuppliers([]); setDieselSettings(null); return }
    rawApi(`/api/fleet/trucks?entity_id=${eid}&limit=200`).then(r => setRowTrucks(orderDieselTrucks(r))).catch(() => setRowTrucks([]))
    getSuppliers({ entity_id: eid, is_diesel_supplier: true, limit: 500 }).then(r => setRowSuppliers(r.data || [])).catch(() => setRowSuppliers([]))
    getDieselSettings({ entity_id: eid }).then(r => setDieselSettings(r.data?.[0] || null)).catch(() => {})
  }, [editForm.entity_id])

  // Auto-fetch rate when supplier / entity / date change
  useEffect(() => {
    if (!editForm.supplier_id || !editForm.entity_id || !editForm.fillup_date) return
    getCurrentDieselRate(editForm.supplier_id, {
      entity_id: editForm.entity_id,
      on_date: editForm.fillup_date,
    }).then(r => {
      const rate = r.data
      if (rate && !rateEdited) {
        setAutoRate(rate.rate_per_litre)
        setEditForm(f => {
          const r = parseFloat(rate.rate_per_litre)
          const litres = num(f.litres)
          const next = { ...f, rate_per_litre: r.toFixed(2) }
          if (litres && litres > 0) next.amount = (litres * r).toFixed(2)
          return next
        })
      }
      if (!rate) setAutoRate(null)
    }).catch(() => {})
  }, [editForm.supplier_id, editForm.entity_id, editForm.fillup_date, rateEdited])

  // Live calc preview — the amount is whatever the form holds (typed, or computed
  // from litres × rate); fee, VAT and total are built on it, as the backend does.
  useEffect(() => {
    const amount = num(editForm.amount)
    if (amount === null || amount <= 0) {
      setPreview({ amount: null, fee: null, total: null }); return
    }
    const pct      = dieselSettings ? parseFloat(dieselSettings.admin_fee_pct) : 0
    const applyFee = dieselSettings ? dieselSettings.apply_admin_fee : false
    const feeExcl = applyFee && pct > 0 ? amount * pct : 0
    const feeVat  = feeExcl * entityVatRate(authEntities, editForm.entity_id)
    const feeIncl = feeExcl + feeVat
    setPreview({ amount: amount.toFixed(2), fee: feeExcl.toFixed(2), feeVat: feeVat.toFixed(2), feeIncl: feeIncl.toFixed(2), total: (amount + feeIncl).toFixed(2) })
  }, [editForm.amount, editForm.entity_id, dieselSettings, authEntities])

  // The three linked money fields. Each keeps the others consistent.
  const onLitres = (v) => setEditForm(f => {
    const litres = num(v), rate = num(f.rate_per_litre)
    const next = { ...f, litres: v }
    if (litres && litres > 0 && rate) next.amount = (litres * rate).toFixed(2)
    return next
  })

  const onRate = (v) => {
    setRateEdited(true)
    setEditForm(f => {
      const litres = num(f.litres), rate = num(v)
      const next = { ...f, rate_per_litre: v }
      if (litres && litres > 0 && rate) next.amount = (litres * rate).toFixed(2)
      return next
    })
  }

  const onAmount = (v) => {
    setRateEdited(true)   // stop the auto-rate fetch overwriting the derived rate
    setEditForm(f => {
      const litres = num(f.litres), amount = num(v)
      const next = { ...f, amount: v }
      if (litres && litres > 0 && amount !== null) {
        next.rate_per_litre = (amount / litres).toFixed(4)
      }
      return next
    })
  }

  // Focus first input when edit opens
  useEffect(() => {
    if (editingId && firstInputRef.current) firstInputRef.current.focus()
  }, [editingId])

  const startNew = () => {
    if (editingId !== null) return // guard — must intentionally exit first
    setEditForm({ ...BLANK, entity_id: filterEntity || '' })
    setAutoRate(null); setRateEdited(false)
    setEditingId('new')
  }

  const startEdit = (f) => {
    if (editingId !== null) return // guard — intentional exit only
    if (rowLocked(f)) return       // locked month — only the note is editable
    setEditForm({
      entity_id:     String(f.entity_id    || ''),
      truck_id:      String(f.truck_id     || ''),
      supplier_id:   String(f.supplier_id  || ''),
      fillup_date:   f.fillup_date || today,
      litres:        f.litres     != null ? String(f.litres)        : '',
      rate_per_litre: f.rate_per_litre != null ? parseFloat(f.rate_per_litre).toFixed(2) : '',
      amount:        f.amount     != null ? parseFloat(f.amount).toFixed(2)     : '',
      invoice_number: f.invoice_number || '',
      slip_number:   f.slip_number    || '',
      notes:         f.notes          || '',
      diesel_type:   f.diesel_type    || 'fillup',
    })
    setAutoRate(null); setRateEdited(true) // treat existing rate as manual
    setEditingId(f.id)
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({ ...BLANK }) }

  // Note-only edit — the one change still permitted on a locked (finalised) row.
  // Sends just `notes` so the server's final-lock whitelist lets it through.
  const startNoteEdit = (f) => {
    if (editingId !== null) return
    setNoteEditId(f.id)
    setNoteText(f.notes || '')
  }
  const cancelNoteEdit = () => { setNoteEditId(null); setNoteText('') }
  const saveNote = async () => {
    setNoteSaving(true)
    try {
      const { data } = await updateDieselFillUp(noteEditId, { notes: noteText.trim() })
      patchFillup(data)
      setNoteEditId(null)
      toast.success('Note saved')
    } catch (err) { toast.error(errorMessage(err)) }
    finally { setNoteSaving(false) }
  }
  const onNoteKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveNote() }
    if (e.key === 'Escape') cancelNoteEdit()
  }

  const handleSave = async () => {
    const f = editForm
    if (!f.entity_id)    return toast.error('Select an entity')
    if (!f.truck_id)     return toast.error('Select a truck')
    if (!f.supplier_id)  return toast.error('Select a supplier')
    if (!f.fillup_date)  return toast.error('Date required')
    if (!f.litres || isNaN(f.litres))           return toast.error('Enter valid litres')
    // Rate and amount imply each other, so either one is enough
    const amountVal = num(f.amount)
    if (!f.rate_pending && !num(f.rate_per_litre) && !amountVal) return toast.error('Enter a rate or an amount')
    setSaving(true)
    const payload = {
      entity_id:     parseInt(f.entity_id),
      truck_id:      parseInt(f.truck_id),
      supplier_id:   parseInt(f.supplier_id),
      fillup_date:   f.fillup_date,
      litres:        parseFloat(f.litres),
      rate_per_litre: f.rate_pending ? 0 : (num(f.rate_per_litre) || 0),
      amount:        f.rate_pending ? null : amountVal,
      rate_pending:  !!f.rate_pending,
      invoice_number: f.invoice_number || null,
      slip_number:   f.slip_number    || null,
      diesel_type:   f.diesel_type    || 'fillup',
      notes:         f.notes          || null,
    }
    try {
      if (editingId === 'new') {
        await createDieselFillUp(payload)
        toast.success('Entry added')
      } else {
        await updateDieselFillUp(editingId, payload)
        toast.success('Entry updated')
      }
      setEditingId(null)
      load()
    } catch (err) { toast.error(errorMessage(err)) }
    finally { setSaving(false) }
  }

  // Patch just the affected fill-up (endpoint returns the enriched row) rather
  // than reloading the whole list + summary; verification doesn't change totals.
  const patchFillup = (data) => setFillups(prev => prev.map(x => x.id === data.id ? { ...x, ...data } : x))

  const handleVerify = async (f, intent) => {
    try { const { data } = await verifyDieselFillUp(f.id, intent); patchFillup(data) }
    catch (err) { toast.error(errorMessage(err)) }
  }

  const handleFinalize = async (f, intent) => {
    try { const { data } = await finalizeDieselFillUp(f.id, intent); patchFillup(data) }
    catch (err) { toast.error(errorMessage(err)) }
  }

  // ── Bulk verification ────────────────────────────────────────────────────────
  // Whether the current user can still ADD a verification tick to this row —
  // mirrors VerifyBadge's add logic so the checkbox only appears where a
  // "Verify selected" would actually do something (step 1, or step 2 by another
  // user). Rows this user has already ticked, or that are fully handled, are out.
  const canUserVerify = (f) => {
    if (f.verified3_by || f.verified3_by_initials) return false  // final lock applied
    const step1 = !!f.verified
    const step2 = !!(f.verified2_by || f.verified2_by_initials)
    if (!step1) return true
    if (!step2 && f.verified_by !== user?.id) return true
    return false
  }

  // Admin only, not already locked. No step-1 prerequisite — the diesel finalize
  // endpoint runs with require_step1=False, so the admin may lock on her own and
  // others can still add ticks to empty steps afterwards.
  const canUserFinalize = (f) => isAdmin && !(f.verified3_by || f.verified3_by_initials)

  // The reverse of the above: rows this user can UNLOCK in bulk. Mirrors the
  // single-row rule in VerifyBadge/apply_finalize_step — only the admin who
  // applied the final lock can take it off, so rows locked by someone else stay
  // out of the selection instead of erroring one by one.
  const canUserUnfinalize = (f) => isAdmin && !!f.verified3_by && f.verified3_by === user?.id

  const canUserSelect = (f) => canUserVerify(f) || canUserFinalize(f) || canUserUnfinalize(f)

  const toggleSelect = (id) => setSelectedIds(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const clearSelection = () => setSelectedIds(new Set())

  // Apply the current user's next verification step to every selected row. Reuses
  // the single-row endpoint with the explicit 'add' intent (safe — it no-ops
  // server-side on anything this user can't tick), patching each row as it returns.
  const handleVerifySelected = async () => {
    const targets = visible.filter(f => selectedIds.has(f.id) && canUserVerify(f))
    if (!targets.length) return
    setVerifyingBulk(true)
    let ok = 0
    for (const f of targets) {
      try {
        const { data } = await verifyDieselFillUp(f.id, 'add')
        patchFillup(data)
        ok++
      } catch (err) { toast.error(errorMessage(err)) }
    }
    setVerifyingBulk(false)
    clearSelection()
    if (ok) toast.success(`Verified ${ok} log${ok === 1 ? '' : 's'}`)
  }

  // Admin final lock over the selection — explicit 'apply' intent, so anything
  // already locked is a server-side no-op rather than an accidental unlock.
  const handleFinalizeSelected = async () => {
    const targets = visible.filter(f => selectedIds.has(f.id) && canUserFinalize(f))
    if (!targets.length) return
    if (!window.confirm(`Apply the final lock to ${targets.length} diesel log${targets.length === 1 ? '' : 's'}? Locked logs can no longer be edited.`)) return
    setFinalizingBulk(true)
    let ok = 0
    for (const f of targets) {
      try {
        const { data } = await finalizeDieselFillUp(f.id, 'apply')
        patchFillup(data)
        ok++
      } catch (err) { toast.error(errorMessage(err)) }
    }
    setFinalizingBulk(false)
    clearSelection()
    if (ok) toast.success(`Final lock applied to ${ok} log${ok === 1 ? '' : 's'}`)
  }

  // Take the admin final lock back off the selection — the counterpart of the
  // above, for when a locked batch turns out to need a correction. Explicit
  // 'remove' intent, so anything already unlocked is a server-side no-op rather
  // than an accidental re-lock.
  const handleUnfinalizeSelected = async () => {
    const targets = visible.filter(f => selectedIds.has(f.id) && canUserUnfinalize(f))
    if (!targets.length) return
    if (!window.confirm(`Remove the final lock from ${targets.length} diesel log${targets.length === 1 ? '' : 's'}? They become editable again (step 1/2 verifications are kept).`)) return
    setUnfinalizingBulk(true)
    let ok = 0
    for (const f of targets) {
      try {
        const { data } = await finalizeDieselFillUp(f.id, 'remove')
        patchFillup(data)
        ok++
      } catch (err) { toast.error(errorMessage(err)) }
    }
    setUnfinalizingBulk(false)
    clearSelection()
    if (ok) toast.success(`Final lock removed from ${ok} log${ok === 1 ? '' : 's'}`)
  }

  const handleDelete = (f, e) => {
    e.stopPropagation()
    setDeleteTarget(f)
  }

  const confirmDelete = async () => {
    try { await deleteDieselFillUp(deleteTarget.id); toast.success('Deleted'); load() }
    catch (err) { toast.error(errorMessage(err)) }
    finally { setDeleteTarget(null) }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
    if (e.key === 'Escape') cancelEdit()
  }

  const set = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  const years = []
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) years.push(y)

  const visible = useMemo(() => {
    const base = search
      ? fillups.filter(f =>
          (f.truck_registration || '').toLowerCase().includes(search.toLowerCase()) ||
          (f.supplier_name      || '').toLowerCase().includes(search.toLowerCase()) ||
          (f.invoice_number     || '').toLowerCase().includes(search.toLowerCase()) ||
          (f.slip_number        || '').toLowerCase().includes(search.toLowerCase())
        )
      : fillups
    return applySort(base, sort)
  }, [fillups, search, sort])

  // When a free-text search is active it only filters client-side (into
  // `visible`), so the server-computed `summary` no longer matches what's on
  // screen. Recompute the totals from the visible rows in that case.
  const displaySummary = useMemo(() => {
    if (!summary || !search) return summary
    const sum = pick => visible.reduce((acc, f) => acc + (parseFloat(pick(f)) || 0), 0)
    return {
      ...summary,
      total_fillups:       visible.length,
      total_litres:        sum(f => f.litres),
      total_amount:        sum(f => f.amount),
      total_admin_fee:     sum(f => f.admin_fee_amount),
      total_admin_fee_vat: sum(f => f.admin_fee_vat),
      grand_total:         sum(f => f.total_amount),
    }
  }, [summary, search, visible])

  // The invoices the shown rows belong to — one entry each, and what a lock acts
  // on. Rows still awaiting an invoice are simply left out: there's nothing to
  // key a lock to until they have one.
  const lockableGroups = useMemo(() => {
    const byId = new Map()
    for (const f of visible) {
      if (!f.supplier_invoice_id) continue
      let g = byId.get(f.supplier_invoice_id)
      if (!g) {
        g = {
          invoiceId: f.supplier_invoice_id,
          invoiceNumber: f.supplier_invoice_number || f.invoice_number || `#${f.supplier_invoice_id}`,
          supplierName: f.supplier_name,
          rows: [],
        }
        byId.set(f.supplier_invoice_id, g)
      }
      g.rows.push(f)
    }
    const groups = [...byId.values()].sort((a, b) =>
      (a.supplierName || '').localeCompare(b.supplierName || '')
      || String(a.invoiceNumber).localeCompare(String(b.invoiceNumber)))
    for (const g of groups) {
      g.litres = g.rows.reduce((s, f) => s + (parseFloat(f.litres) || 0), 0)
      g.total  = g.rows.reduce((s, f) => s + (parseFloat(f.total_amount) || 0), 0)
      g.lock   = lockByInvoiceId.get(g.invoiceId) || null
    }
    return groups
  }, [visible, lockByInvoiceId])

  const lockedCount = lockableGroups.filter(g => g.lock).length
  const unlockedGroups = lockableGroups.filter(g => !g.lock)
  const checkedLockGroups = unlockedGroups.filter(g => lockChecked.has(g.invoiceId))
  const allLocksChecked = unlockedGroups.length > 0 && unlockedGroups.every(g => lockChecked.has(g.invoiceId))

  const multiEntity = entities.length > 1
  const COLS = multiEntity ? 16 : 15

  // Selection state derived from what's on screen — a row filtered away can't be
  // acted on, so it drops out of the counts too.
  const selectable         = visible.filter(canUserSelect)
  const selectedVerifiable  = visible.filter(f => selectedIds.has(f.id) && canUserVerify(f))
  const selectedFinalizable = visible.filter(f => selectedIds.has(f.id) && canUserFinalize(f))
  const selectedUnfinalizable = visible.filter(f => selectedIds.has(f.id) && canUserUnfinalize(f))
  const selectedCount      = visible.filter(f => selectedIds.has(f.id)).length
  const allSelected        = selectable.length > 0 && selectable.every(f => selectedIds.has(f.id))
  const bulkBusy           = verifyingBulk || finalizingBulk || unfinalizingBulk
  const toggleSelectAll = () => setSelectedIds(s => {
    const n = new Set(s)
    if (allSelected) selectable.forEach(f => n.delete(f.id))
    else selectable.forEach(f => n.add(f.id))
    return n
  })

  // Diesel-sheet import is restricted to Bokamosho (BKMO) only
  const importEntityId = filterEntity || activeEntity?.id
  const importEntity = entities.find(e => String(e.id) === String(importEntityId))
    || (String(activeEntity?.id) === String(importEntityId) ? activeEntity : null)
  const isBokamosho = importEntity?.code === 'BKMO'

  return (
    <div style={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Diesel Log</h1>
          <p className="page-subtitle">{fillups.length} records — {MONTHS[filterMonth]} {filterYear}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ExportButton
            title={`Diesel Logs — ${MONTHS[filterMonth]} ${filterYear}`}
            filename={`diesel-${filterYear}-${filterMonth}`}
            data={visible}
            columns={[
              { header: 'Date',          value: r => formatDate(r.fillup_date) },
              { header: 'Truck',         key: 'truck_registration' },
              { header: 'Supplier',      key: 'supplier_name' },
              { header: 'Litres',        value: r => parseFloat(r.litres).toFixed(2) },
              { header: 'Rate/L',        value: r => parseFloat(r.rate_per_litre).toFixed(2) },
              { header: 'Amount (excl)', value: r => parseFloat(r.amount).toFixed(2) },
              { header: 'Admin Fee %',        value: r => (parseFloat(r.admin_fee_pct) * 100).toFixed(2) + '%' },
              { header: 'Admin Fee (excl VAT)', value: r => parseFloat(r.admin_fee_amount).toFixed(2) },
              { header: 'Admin Fee VAT',        value: r => parseFloat(r.admin_fee_vat || 0).toFixed(2) },
              { header: 'Admin Fee (incl VAT)', value: r => (parseFloat(r.admin_fee_amount) + parseFloat(r.admin_fee_vat || 0)).toFixed(2) },
              { header: 'Total',                value: r => parseFloat(r.total_amount).toFixed(2) },
              { header: 'Invoice #',     key: 'invoice_number' },
              { header: 'Slip #',        key: 'slip_number' },
              { header: 'Verified',      value: r => r.verified ? 'Yes' : '' },
              { header: 'Notes',         key: 'notes' },
            ]}
          />
          {isBokamosho && (
            <button className="btn-ghost" onClick={() => setShowImport(true)}>
              <Upload size={15} /> Import
            </button>
          )}
          <button className="btn-primary" onClick={startNew} disabled={editingId !== null}>
            <Plus size={15} /> Log Diesel
          </button>
        </div>
      </div>

      {showImport && isBokamosho && (
        <ImportDieselModal
          entityId={Number(importEntityId)}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      {/* Filters */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 20 }}>
        {/* Row 1: Entity, Supplier, Search, Verified (right) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {isAdmin && (
            <div className="form-group" style={{ margin: 0, width: 180 }}>
              <label className="form-label">Entity</label>
              <select className="form-control" value={filterEntity} onChange={e => setFilterEntity(e.target.value)}>
                <option value="">All Entities</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ margin: 0, width: 160 }}>
            <label className="form-label">Supplier</label>
            <select className="form-control" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}>
              <option value="">All Suppliers</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <label className="form-label">Search</label>
            <div className="search-bar">
              <Search size={13} />
              <input placeholder="Truck / supplier / invoice…" value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button className="btn-icon" onClick={() => setSearch('')}><X size={12} /></button>}
            </div>
          </div>
          <div className="form-group" style={{ margin: 0, marginLeft: 'auto' }}>
            <label className="form-label">Verified</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {['', 'true', 'false'].map(v => (
                <button key={v}
                  className={`btn btn-sm ${filterVerified === v ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilterVerified(v)} style={{ fontSize: 12 }}>
                  {v === '' ? 'All' : v === 'true' ? 'Verified' : 'Unverified'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

        {/* Row 2: Truck, Month, Year */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, width: 160 }}>
            <label className="form-label">Truck</label>
            <SearchableSelect
              value={String(filterTruck)}
              onChange={v => setFilterTruck(v)}
              options={[{ id: '', registration: 'All Trucks' }, ...trucks]}
              getValue={t => String(t.id)}
              getLabel={t => t.registration}
              placeholder="All Trucks"
              formInput
            />
          </div>
          <div className="form-group" style={{ margin: 0, width: 110 }}>
            <label className="form-label">Month</label>
            <select className="form-control" value={filterMonth} onChange={e => setFilterMonth(parseInt(e.target.value))}>
              {MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, width: 90 }}>
            <label className="form-label">Year</label>
            <select className="form-control" value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {displaySummary && (
        <div className="grid-4" style={{ marginBottom: 16 }}>
          <SummaryCard label="Logs" value={displaySummary.total_fillups} />
          <SummaryCard label="Total Litres" value={`${parseFloat(displaySummary.total_litres).toLocaleString('en-ZA', { minimumFractionDigits: 2 })} L`} />
          <SummaryCard label="Admin Fee (incl VAT)" value={formatCurrency(parseFloat(displaySummary.total_admin_fee) + parseFloat(displaySummary.total_admin_fee_vat || 0))} />
          <SummaryCard label="Grand Total (incl. fee + VAT)" value={formatCurrency(displaySummary.grand_total)} accent />
        </div>
      )}

      {/* Invoice locks — collapsed to a single line so the page reads as it always
          has; open it to lock/unlock each invoice the shown rows belong to. */}
      {lockableGroups.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
          <div
            onClick={() => setLocksOpen(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', userSelect: 'none' }}
          >
            <Lock size={13} color="var(--text-muted)" />
            <span style={{ fontSize: 12, fontWeight: 700 }}>Invoice locks</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {lockableGroups.length} invoice{lockableGroups.length === 1 ? '' : 's'} in view
              {lockedCount > 0 && <> · <span style={{ color: '#16a34a', fontWeight: 700 }}>{lockedCount} locked</span></>}
            </span>
            {locksOpen && checkedLockGroups.length > 0 && (
              <button
                onClick={e => { e.stopPropagation(); setLockDate(today); setLockModal({ groups: checkedLockGroups }) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto',
                  padding: '4px 12px', borderRadius: 7, border: 'none',
                  background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <Lock size={13} /> Lock selected ({checkedLockGroups.length})
              </button>
            )}
            <span style={{ marginLeft: checkedLockGroups.length > 0 && locksOpen ? 0 : 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
              {locksOpen ? '▲ hide' : '▼ show'}
            </span>
          </div>

          {locksOpen && (
            <div style={{ maxHeight: 260, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
              <table className="compact-table">
                <thead>
                  <tr>
                    <th style={{ width: 28, textAlign: 'center' }}>
                      {unlockedGroups.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allLocksChecked}
                          onChange={() => setLockChecked(s => {
                            const n = new Set(s)
                            if (allLocksChecked) unlockedGroups.forEach(g => n.delete(g.invoiceId))
                            else unlockedGroups.forEach(g => n.add(g.invoiceId))
                            return n
                          })}
                          title="Select all unlocked invoices"
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                    </th>
                    <th>Invoice #</th>
                    <th>Supplier</th>
                    <th className="text-right">Logs</th>
                    <th className="text-right">Litres</th>
                    <th className="text-right">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lockableGroups.map(g => (
                    <tr key={g.invoiceId} style={g.lock ? { background: 'rgba(34,197,94,0.06)' } : undefined}>
                      <td style={{ width: 28, textAlign: 'center' }}>
                        {!g.lock && (
                          <input
                            type="checkbox"
                            checked={lockChecked.has(g.invoiceId)}
                            onChange={() => setLockChecked(s => {
                              const n = new Set(s)
                              if (n.has(g.invoiceId)) n.delete(g.invoiceId)
                              else n.add(g.invoiceId)
                              return n
                            })}
                            style={{ cursor: 'pointer' }}
                          />
                        )}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{g.invoiceNumber}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{g.supplierName || '—'}</td>
                      <td className="text-right" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {g.rows.length} log{g.rows.length === 1 ? '' : 's'}
                      </td>
                      <td className="text-right" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {g.litres.toLocaleString('en-ZA', { minimumFractionDigits: 2 })} L
                      </td>
                      <td className="text-right" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(g.total)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {g.lock ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              title={`Diesel locked${g.lock.locked_by_name ? ` by ${g.lock.locked_by_name}` : ''} — no values can be added, changed or removed against this invoice`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, background: 'rgba(34,197,94,0.15)', color: '#16a34a' }}
                            >
                              <Lock size={11} /> LOCKED {formatDate(g.lock.locked_at)}
                            </span>
                            <button className="btn-icon btn-ghost" title="Unlock this invoice"
                              onClick={() => removeLock(g)} style={{ padding: 2 }}>
                              <RotateCcw size={13} color="var(--text-muted)" />
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn-ghost btn-sm"
                            onClick={() => { setLockDate(today); setLockModal({ groups: [g] }) }}
                            title="Lock the diesel on this invoice — no values in or out"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}
                          >
                            <Lock size={12} /> Lock
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Table — always visible */}
      <div className="table-wrapper" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              {multiEntity && <SortableHeader label="Entity" col="entity_id" sort={sort} onSort={onSort} />}
              <SortableHeader label="Date" col="fillup_date" sort={sort} onSort={onSort} />
              <SortableHeader label="Truck" col="truck_registration" sort={sort} onSort={onSort} />
              <SortableHeader label="Supplier" col="supplier_name" sort={sort} onSort={onSort} />
              <th className="text-right">Litres</th>
              <th className="text-right">Rate/L</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Admin Fee (excl)</th>
              <th className="text-right">Admin Fee (incl)</th>
              <SortableHeader label="Total" col="total_amount" sort={sort} onSort={onSort} className="text-right" />
              <th>Type</th>
              <th>Invoice #</th>
              <th>Slip #</th>
              <th style={{ width: 28, textAlign: 'center' }}>
                {selectable.length > 0 && (
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                    title="Select all" style={{ cursor: 'pointer' }} />
                )}
              </th>
              <th>Verified</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {/* New row */}
            {editingId === 'new' && (
              <EditRow
                form={editForm} set={set} rowTrucks={rowTrucks} suppliers={rowSuppliers}
                entities={entities} multiEntity={multiEntity} isNew
                autoRate={autoRate} rateEdited={rateEdited} setRateEdited={setRateEdited}
                onLitres={onLitres} onRate={onRate} onAmount={onAmount}
                preview={preview} saving={saving}
                onSave={handleSave} onCancel={cancelEdit} onKeyDown={handleKeyDown}
                firstInputRef={firstInputRef}
              />
            )}

            {loading && (
              <tr><td colSpan={COLS} style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            )}

            {!loading && visible.length === 0 && editingId !== 'new' && (
              <tr><td colSpan={COLS}>
                <div className="empty-state"><Fuel size={32} /><p>No diesel logs found — click "Log Diesel" to start</p></div>
              </td></tr>
            )}

            {!loading && visible.map(f => {
              const isEditing = editingId === f.id
              return isEditing ? (
                <EditRow
                  key={f.id}
                  form={editForm} set={set} rowTrucks={rowTrucks} suppliers={rowSuppliers}
                  entities={entities} multiEntity={multiEntity} isNew={false}
                  autoRate={autoRate} rateEdited={rateEdited} setRateEdited={setRateEdited}
                  onLitres={onLitres} onRate={onRate} onAmount={onAmount}
                  preview={preview} saving={saving}
                  onSave={handleSave} onCancel={cancelEdit} onKeyDown={handleKeyDown}
                  firstInputRef={firstInputRef}
                />
              ) : (
                <Fragment key={f.id}>
                <tr
                  onClick={() => (f.verified3_by || rowLocked(f)) ? startNoteEdit(f) : startEdit(f)}
                  style={{ cursor: editingId !== null ? 'default' : 'pointer' }}>
                  {multiEntity && (
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {entities.find(e => e.id === f.entity_id)?.code || '—'}
                    </td>
                  )}
                  <td style={{ fontSize: 12 }}>{formatDate(f.fillup_date)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{f.truck_registration || '—'}</td>
                  <td>
                    <div style={{ fontSize: 13 }}>{f.supplier_name}</div>
                  </td>
                  <td className="text-right" style={{ fontSize: 13 }}>{parseFloat(f.litres).toFixed(2)}</td>
                  <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {f.rate_pending ? (
                      <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                        background: 'rgba(245,158,11,0.15)', color: '#d97706' }}>Rate pending</span>
                    ) : <>R&nbsp;{parseFloat(f.rate_per_litre).toFixed(2)}</>}
                  </td>
                  <td className="text-right">{f.rate_pending ? '—' : formatCurrency(f.amount)}</td>
                  <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {parseFloat(f.admin_fee_amount) > 0 ? formatCurrency(f.admin_fee_amount) : '—'}
                  </td>
                  <td className="text-right" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {parseFloat(f.admin_fee_amount) > 0
                      ? formatCurrency(parseFloat(f.admin_fee_amount) + parseFloat(f.admin_fee_vat || 0))
                      : '—'}
                  </td>
                  <td className="text-right" style={{
                    fontWeight: 700,
                    ...(f.verified2_by ? { background: 'rgba(253,224,71,0.55)' } : {}),
                  }}>{formatCurrency(f.total_amount)}</td>
                  <td>
                    <span style={{
                      padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                      background: f.diesel_type === 'topup' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
                      color: f.diesel_type === 'topup' ? '#d97706' : '#16a34a',
                    }}>
                      {f.diesel_type === 'topup' ? 'Top-up' : 'Fill-up'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{f.invoice_number || '—'}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {f.slip_number
                      || (f.supplier_invoice_id && !f.depot_slip_number ? (
                        <span
                          title="Captured off the invoice without a depot slip — add the Slip # to the invoice line when you have it"
                          style={{
                            padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                            whiteSpace: 'nowrap', fontFamily: 'var(--font-body, inherit)',
                            background: 'rgba(245,158,11,0.15)', color: '#d97706',
                          }}>
                          No slip
                        </span>
                      ) : '—')}
                  </td>
                  {/* Bulk-select checkbox */}
                  <td style={{ width: 28, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    {canUserSelect(f) && (
                      <input type="checkbox" checked={selectedIds.has(f.id)}
                        onChange={() => toggleSelect(f.id)}
                        title="Select" style={{ cursor: 'pointer' }} />
                    )}
                  </td>
                  <td>
                    <VerifyBadge item={f} onVerify={handleVerify} onFinalize={handleFinalize} currentUserId={user?.id} isAdmin={isAdmin} adminFinalizeAnytime />
                  </td>
                  <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    {(!!f.verified3_by || rowLocked(f)) && (
                      <button
                        className="btn-icon btn-ghost"
                        onClick={e => { e.stopPropagation(); startNoteEdit(f) }}
                        title={f.notes ? `Edit note: ${f.notes}` : 'Add note'}
                        style={{ marginRight: 4, color: f.notes ? '#d97706' : undefined }}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    {rowLocked(f) ? (
                      <span title="This invoice is locked — unlock it to change or remove values"
                        style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                        <Lock size={13} color="var(--text-muted)" />
                      </span>
                    ) : (
                      <button className="btn-icon btn-ghost" onClick={e => handleDelete(f, e)} title="Delete">
                        <Trash2 size={13} color="var(--danger)" />
                      </button>
                    )}
                  </td>
                </tr>
                {noteEditId === f.id && (
                  <tr style={{ background: 'var(--accent-subtle)' }}>
                    <td colSpan={COLS} style={{ padding: '6px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Note:</span>
                        <input
                          autoFocus
                          value={noteText}
                          onChange={e => setNoteText(e.target.value)}
                          onKeyDown={onNoteKeyDown}
                          placeholder="Add a note for this locked diesel log"
                          style={{ flex: 1, maxWidth: 420, padding: '4px 8px', fontSize: 13 }}
                        />
                        <button className="btn-icon btn-primary" onClick={saveNote} disabled={noteSaving} title="Save note (Enter)">
                          <Save size={13} />
                        </button>
                        <button className="btn-icon btn-ghost" onClick={cancelNoteEdit} title="Cancel (Esc)">
                          <X size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>

          {visible.length > 0 && displaySummary && (
            <tfoot>
              <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
                <td colSpan={multiEntity ? 4 : 3} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>Totals:</td>
                <td className="text-right" style={{ padding: '10px 12px' }}>{parseFloat(displaySummary.total_litres).toFixed(2)}</td>
                <td />
                <td className="text-right" style={{ padding: '10px 12px' }}>{formatCurrency(displaySummary.total_amount)}</td>
                <td className="text-right" style={{ padding: '10px 12px' }}>{formatCurrency(displaySummary.total_admin_fee)}</td>
                <td className="text-right" style={{ padding: '10px 12px' }}>
                  {formatCurrency((parseFloat(displaySummary.total_admin_fee) + parseFloat(displaySummary.total_admin_fee_vat || 0)))}
                </td>
                <td className="text-right" style={{ padding: '10px 12px' }}>{formatCurrency(displaySummary.grand_total)}</td>
                <td colSpan={6} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Bulk-action bar — floats while diesel logs are selected */}
      {selectedCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 14, zIndex: 900,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 16px',
          boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedCount} selected</span>
          {selectedVerifiable.length > 0 && (
            <button
              onClick={handleVerifySelected}
              disabled={bulkBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: verifyingBulk ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              <CheckCircle size={15} />
              {verifyingBulk ? 'Verifying…' : `Verify selected (${selectedVerifiable.length})`}
            </button>
          )}
          {selectedFinalizable.length > 0 && (
            <button
              onClick={handleFinalizeSelected}
              disabled={bulkBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: '#7c3aed', color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: finalizingBulk ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              <Lock size={15} />
              {finalizingBulk ? 'Locking…' : `Final lock selected (${selectedFinalizable.length})`}
            </button>
          )}
          {selectedUnfinalizable.length > 0 && (
            <button
              onClick={handleUnfinalizeSelected}
              disabled={bulkBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: '#d97706', color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: unfinalizingBulk ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1,
              }}>
              <Unlock size={15} />
              {unfinalizingBulk ? 'Unlocking…' : `Remove final lock (${selectedUnfinalizable.length})`}
            </button>
          )}
          <button onClick={clearSelection} disabled={bulkBusy} className="btn-ghost"
            style={{ fontSize: 13, padding: '6px 10px' }}>
            Clear
          </button>
        </div>
      )}

      {/* ── Lock Invoice Modal (one or several invoices, one shared date) ── */}
      {lockModal && (() => {
        const groups = lockModal.groups
        const multi = groups.length > 1
        const rowCount = groups.reduce((s, g) => s + g.rows.length, 0)
        const litresSum = groups.reduce((s, g) => s + g.litres, 0)
        const totalSum = groups.reduce((s, g) => s + g.total, 0)
        const allRows = groups.flatMap(g => g.rows.map(f => ({ ...f, _invoiceNumber: g.invoiceNumber })))
          .sort((a, b) => String(a._invoiceNumber).localeCompare(String(b._invoiceNumber))
            || String(a.fillup_date).localeCompare(String(b.fillup_date))
            || (a.truck_registration || '').localeCompare(b.truck_registration || ''))
        return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setLockModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <Lock size={16} style={{ color: 'var(--accent)' }} />
                Lock Diesel — {multi ? `${groups.length} invoices` : groups[0].invoiceNumber}
              </h2>
              <button className="btn-icon btn-ghost" onClick={() => setLockModal(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginTop: 0, lineHeight: 1.5 }}>
                This locks the diesel on{' '}
                {multi
                  ? <><strong>{groups.length} invoices</strong> ({groups.map(g => g.invoiceNumber).join(', ')})</>
                  : <>invoice <strong>{groups[0].invoiceNumber}</strong>
                      {groups[0].supplierName ? <> (<strong>{groups[0].supplierName}</strong>)</> : null}</>}
                {' '}— <strong>{rowCount} log{rowCount === 1 ? '' : 's'}</strong>,{' '}
                {litresSum.toLocaleString('en-ZA', { minimumFractionDigits: 2 })} L,{' '}
                {formatCurrency(totalSum)}. Nothing can be added, changed, imported or removed
                against {multi ? 'them' : 'it'}. Notes and verification ticks stay available.
              </p>

              {/* The logs being locked, so it's clear exactly what's covered */}
              <div className="table-wrapper" style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="compact-table">
                  <thead>
                    <tr>
                      {multi && <th>Invoice</th>}
                      <th>Date</th>
                      <th>Truck</th>
                      <th className="text-right">Litres</th>
                      <th className="text-right">Rate/L</th>
                      <th className="text-right">Total</th>
                      <th>Slip #</th>
                      <th>Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.map(f => (
                        <tr key={f.id}>
                          {multi && <td style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{f._invoiceNumber}</td>}
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(f.fillup_date)}</td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{f.truck_registration || '—'}</td>
                          <td className="text-right">{parseFloat(f.litres).toFixed(2)}</td>
                          <td className="text-right" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {f.rate_pending ? 'pending' : <>R&nbsp;{parseFloat(f.rate_per_litre).toFixed(2)}</>}
                          </td>
                          <td className="text-right" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(f.total_amount)}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{f.slip_number || '—'}</td>
                          <td style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                            {[f.verified_by_initials, f.verified2_by_initials, f.verified3_by_initials]
                              .filter(Boolean).join(' / ') || '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-surface)', fontWeight: 700 }}>
                      <td colSpan={multi ? 3 : 2} style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        {rowCount} log{rowCount === 1 ? '' : 's'}
                        {multi ? ` on ${groups.length} invoices` : ''}
                      </td>
                      <td className="text-right">{litresSum.toFixed(2)}</td>
                      <td />
                      <td className="text-right" style={{ whiteSpace: 'nowrap' }}>{formatCurrency(totalSum)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="form-group">
                <label>Locked on *</label>
                <DateInput className="form-input" value={lockDate} onChange={e => setLockDate(e.target.value)} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, display: 'block' }}>
                  If the invoice{multi ? 's were' : ' was'} actually reconciled earlier, pick that date — it's
                  recorded on {multi ? 'each lock' : 'the lock'} and in the audit log. Diesel logged after it
                  belongs to another invoice.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setLockModal(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={applyLock} disabled={lockSaving}>
                {lockSaving
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
                  : <><Lock size={14} /> {multi ? `Lock ${groups.length} Invoices` : 'Lock Invoice'}</>}
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      <DeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Diesel Log"
        description={deleteTarget ? `${parseFloat(deleteTarget.litres).toFixed(2)} L on ${formatDate(deleteTarget.fillup_date)}${deleteTarget.supplier_name ? ` — ${deleteTarget.supplier_name}` : ''}` : ''}
        onArchive={async () => {
          try { await archiveDieselFillUp(deleteTarget.id); toast.success('Entry archived'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
        onDelete={async () => {
          try { await deleteDieselFillUp(deleteTarget.id); toast.success('Entry deleted'); load() }
          catch (err) { toast.error(errorMessage(err)) }
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

// ── Inline edit row ────────────────────────────────────────────────────────────
function EditRow({ form, set, rowTrucks, suppliers, entities, multiEntity, isNew,
  autoRate, rateEdited, setRateEdited, onLitres, onRate, onAmount, preview, saving,
  onSave, onCancel, onKeyDown, firstInputRef }) {
  const isBokamosho = entities.find(e => String(e.id) === String(form.entity_id))?.code === 'BKMO'
  return (
    <tr style={{ background: 'var(--accent-subtle)', outline: '2px solid var(--accent)', outlineOffset: -1 }}
      onClick={e => e.stopPropagation()}>

      {multiEntity && (
        <td style={S.td}>
          <select value={form.entity_id} onChange={e => set('entity_id', e.target.value)} style={S.select}>
            <option value="">Entity…</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
          </select>
        </td>
      )}

      {/* Date */}
      <td style={S.td}>
        <DateInput ref={firstInputRef} value={form.fillup_date}
          onChange={e => set('fillup_date', e.target.value)} onKeyDown={onKeyDown}
          max={new Date().toISOString().slice(0, 10)} style={S.input} />
      </td>

      {/* Truck */}
      <td style={S.td}>
        <SearchableSelect
          value={String(form.truck_id)}
          onChange={v => set('truck_id', v)}
          options={rowTrucks}
          getValue={t => String(t.id)}
          getLabel={t => t.registration}
          placeholder="Truck…"
          style={{ minWidth: 110 }}
        />
      </td>

      {/* Supplier */}
      <td style={S.td}>
        <SearchableSelect
          value={String(form.supplier_id)}
          onChange={v => {
            set('supplier_id', v); setRateEdited(false)
            set('diesel_type', dieselTypeForSupplier(suppliers.find(s => String(s.id) === String(v))))
          }}
          options={suppliers}
          getValue={s => String(s.id)}
          getLabel={s => s.name}
          placeholder="Supplier…"
          style={{ minWidth: 130 }}
        />
      </td>

      {/* Litres */}
      <td style={S.td}>
        <input type="number" step="0.01" min="0.01" placeholder="0.00" value={form.litres}
          onChange={e => onLitres(e.target.value)} onKeyDown={onKeyDown}
          style={{ ...S.input, width: 72, textAlign: 'right' }} />
      </td>

      {/* Rate/L */}
      <td style={S.td}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ height: 13, fontSize: 9, fontWeight: 700,
            color: rateEdited && autoRate ? '#d97706' : '#16a34a' }}>
            {autoRate && !rateEdited ? 'auto' : rateEdited && autoRate ? 'manual' : ''}
          </span>
          <input type="number" step="0.0001" min="0" placeholder={form.rate_pending ? 'On import' : '0.00'}
            value={form.rate_pending ? '' : form.rate_per_litre} disabled={form.rate_pending}
            onChange={e => onRate(e.target.value)} onKeyDown={onKeyDown}
            style={{ ...S.input, width: 78, textAlign: 'right' }} />
          {isBokamosho && (
            <label title="Log it now — slip # optional; the diesel import fills the rate in (matched by slip #, or by litres + date when the slip doesn't match)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={!!form.rate_pending}
                onChange={e => { set('rate_pending', e.target.checked); if (e.target.checked) { set('rate_per_litre', ''); setRateEdited(false) } }}
                style={{ width: 11, height: 11 }} />
              rate on import
            </label>
          )}
        </div>
      </td>

      {/* Amount — editable; typing it back-computes Rate/L from the litres */}
      <td style={S.td}>
        <input type="number" step="0.01" min="0" placeholder={form.rate_pending ? 'On import' : '0.00'}
          value={form.rate_pending ? '' : form.amount} disabled={form.rate_pending}
          onChange={e => onAmount(e.target.value)} onKeyDown={onKeyDown}
          title="Amount excl VAT — type the figure off the statement and the rate follows"
          style={{ ...S.input, width: 90, textAlign: 'right' }} />
      </td>

      {/* Admin fee excl (calc) */}
      <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {preview.fee && parseFloat(preview.fee) > 0 ? formatCurrency(preview.fee) : '—'}
      </td>

      {/* Admin fee incl VAT (calc) */}
      <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {preview.feeIncl && parseFloat(preview.feeIncl) > 0 ? formatCurrency(preview.feeIncl) : '—'}
      </td>

      {/* Total (calc) */}
      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', color: 'var(--accent)' }}>
        {preview.total ? formatCurrency(preview.total) : '—'}
      </td>

      {/* Type — fixed per supplier (Merino & Oukop = top-up, everyone else = fill-up),
          shown for information only; the server derives it and ignores the client's value */}
      <td style={S.td}>
        <span
          title="Set by the supplier: Merino & Oukop are always top-up, all other suppliers fill-up"
          style={{
            padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
            background: form.diesel_type === 'topup' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
            color: form.diesel_type === 'topup' ? '#d97706' : '#16a34a',
          }}>
          {form.diesel_type === 'topup' ? 'Top-up' : 'Fill-up'}
        </span>
      </td>

      {/* Invoice # */}
      <td style={S.td}>
        <input value={form.invoice_number} placeholder="Invoice #"
          onChange={e => set('invoice_number', e.target.value)} onKeyDown={onKeyDown}
          style={{ ...S.input, width: 90 }} />
      </td>

      {/* Slip # */}
      <td style={S.td}>
        <input value={form.slip_number} placeholder="Slip #"
          onChange={e => set('slip_number', e.target.value)} onKeyDown={onKeyDown}
          style={{ ...S.input, width: 80 }} />
      </td>

      {/* Bulk-select + Verified — n/a while editing */}
      <td style={S.td} />
      <td style={S.td} />

      {/* Actions */}
      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
        <button onClick={onSave} disabled={saving} className="btn btn-icon btn-primary" style={{ marginRight: 4 }} title="Save (Enter)">
          <Save size={14} />
        </button>
        <button onClick={onCancel} className="btn btn-icon btn-ghost" title="Cancel (Esc)">
          <X size={14} />
        </button>
      </td>
    </tr>
  )
}

function SummaryCard({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={accent ? { color: 'var(--accent)' } : {}}>{value}</div>
    </div>
  )
}

const styles = {
  page: { padding: 'var(--page-pad)', flex: 1 },
}

const S = {
  td: { padding: '6px 8px', fontSize: 12, verticalAlign: 'bottom' },
  input: {
    padding: '4px 7px', fontSize: 12, borderRadius: 5,
    border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)', outline: 'none',
  },
  select: {
    padding: '4px 6px', fontSize: 12, borderRadius: 5,
    border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)',
  },
}