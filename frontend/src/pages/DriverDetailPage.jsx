import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Trash2, X, Edit2, Check, Download } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useSessionState } from '../hooks/useSessionState'
import toast from 'react-hot-toast'
import VerifyBadge from '../components/VerifyBadge'
import VerifiableAmount from '../components/VerifiableAmount'
import DateInput from '../components/DateInput'
import { errorMessage } from '../utils/helpers'
import { getVerifications, verifyValue, finalizeValue } from '../services/api'

const API = import.meta.env.VITE_API_URL || ''

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']

const GROUP_A_MINES = ['Mokala', 'Assmang', 'Sebilo', 'Tawana']
const GROUP_B_MINES = ['Glosam', 'Driehoek', 'Future', 'Afrimat', 'Boskop']
const ALL_MINES = [...GROUP_A_MINES, ...GROUP_B_MINES, 'Tshipi']

// ── API hook ──────────────────────────────────────────────────────────────────
function useApi() {
  const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` })
  const get   = (p)    => fetch(`${API}${p}`, { headers: h() }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  const post  = (p, b) => fetch(`${API}${p}`, { method: 'POST',   headers: h(), body: JSON.stringify(b) }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  const put   = (p, b) => fetch(`${API}${p}`, { method: 'PUT',    headers: h(), body: JSON.stringify(b) }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
  // Axios-style: call as patch(url, body, { params }). Returns { data } so callers
  // can destructure the row. The query params carry the verify/unverify `action`.
  const patch = (p, _body, opts) => {
    const qs = opts?.params ? new URLSearchParams(opts.params).toString() : ''
    return fetch(`${API}${p}${qs ? `?${qs}` : ''}`, { method: 'PATCH', headers: h() })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
      .then(data => ({ data }))
  }
  const del   = (p)    => fetch(`${API}${p}`, { method: 'DELETE', headers: h() }).then(r => { if (!r.ok) return r.json().then(e => Promise.reject(e)) })
  return { get, post, put, patch, del }
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (n) => `R ${parseFloat(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}
// A trip log row from a split load is 0.5 of a load (notes tagged "split load"); everything else is 1.
const isSplitTrip = (t) => !!(t.notes && t.notes.includes('split load'))
const tripCountValue = (t) => (isSplitTrip(t) ? 0.5 : 1)
const fmtTripCount = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

// Read a manual override: blank/null → null (use computed), else the number.
const ovNum = (v) => (v === '' || v === null || v === undefined) ? null : Number(v)

// ── Live calculator (mirrors payroll_calculator.py) ───────────────────────────
// `excludeMineBonus` (per-driver) forces the mine bonus to 0. `overrides` holds
// the four manual earnings overrides; a set value replaces the computed line.
function calcLive(inputs, settings, additionalLoads, driverType, excludeMineBonus = false, overrides = {}) {
  if (!settings) return null
  const s = settings
  const lBase  = Number(inputs.lohatla_base_loads  || 0)
  const lExtra = Number(inputs.lohatla_extra_loads || 0)
  const lTotal = lBase + lExtra
  const additionalTotal = (additionalLoads || []).reduce((sum, al) => sum + parseFloat(al.amount || 0), 0)
  // Assmang bonus applies only to loads delivered to the ASSMANG mine
  const assmangEff = Number(inputs.assmang_loads || 0) + Number(inputs.assmang_split_loads || 0) * 0.5
  const mineOv = ovNum(overrides.mine_bonus_override)

  if (driverType === 'casual') {
    const rateA      = parseFloat(s.casual_rate_group_a || 0)
    const rateB      = parseFloat(s.casual_rate_group_b || 0)
    const loadsA     = Number(inputs.casual_group_a_loads || 0)
    const loadsB     = Number(inputs.casual_group_b_loads || 0)
    const splitA     = Number(inputs.casual_split_group_a_loads || 0)
    const splitB     = Number(inputs.casual_split_group_b_loads || 0)
    const earningsA  = rateA * loadsA + (rateA / 2) * splitA
    const earningsB  = rateB * loadsB + (rateB / 2) * splitB
    const loadEarnings = earningsA + earningsB
    const effectiveTotal = loadsA + loadsB + (splitA + splitB) * 0.5
    const assmangComputed = parseFloat(s.assmang_bonus_per_load || 0) * assmangEff
    const assmang    = excludeMineBonus ? 0 : (mineOv != null ? mineOv : assmangComputed)
    const gross        = loadEarnings + assmang + additionalTotal
    return {
      grand: effectiveTotal, loadsA, loadsB, splitA, splitB, rateA, rateB,
      earningsA, earningsB, loadEarnings, assmang, assmangComputed, assmangEff, additionalTotal, gross,
      isCasual: true,
      basicSalary: 0, basicComputed: 0, subsL: 0, totalSubs: 0, subsComputed: 0,
      incL: 0, totalInc: 0, incComputed: 0,
    }
  }

  const splitCount   = Number(inputs.permanent_split_loads || 0)
  const lEffective   = lTotal + splitCount * 0.5
  const grand        = lEffective

  const basicComputed = lEffective > 0 ? parseFloat(s.lohatla_base_salary) : 0
  const ovBasic = ovNum(overrides.basic_salary_override)
  const basicSalary = ovBasic != null ? ovBasic : basicComputed

  const subsComputed = parseFloat(s.lohatla_subs_per_load) * lEffective
  const ovSubs = ovNum(overrides.subsistence_override)
  const subsL = ovSubs != null ? ovSubs : subsComputed
  const totalSubs = subsL

  const incComputed = parseFloat(s.lohatla_incentive_per_load) * Math.max(0, lEffective - 7)
  const ovInc = ovNum(overrides.load_incentive_override)
  const incL = ovInc != null ? ovInc : incComputed
  const totalInc = incL

  const assmangComputed = parseFloat(s.assmang_bonus_per_load) * assmangEff
  const assmang = excludeMineBonus ? 0 : (mineOv != null ? mineOv : assmangComputed)
  const gross = basicSalary + totalSubs + totalInc + assmang + additionalTotal

  return {
    grand, lTotal, lEffective, splitCount,
    basicSalary, basicComputed, subsL, totalSubs, subsComputed,
    incL, totalInc, incComputed, assmang, assmangComputed, assmangEff,
    additionalTotal, gross, isCasual: false,
  }
}

// ── Statutory deductions from calc result (permanent only) ───────────────────
function calcStatutory(basicSalary, settings) {
  if (!settings || !basicSalary) return null
  const s = settings
  // Fixed rand amounts per pay cycle from Payroll Rates (mirrors payroll_calculator).
  const nbcrfli    = parseFloat(s.nbcrfli_amount)
  const provident  = parseFloat(s.provident_amount)
  const wellness   = parseFloat(s.wellness_amount)
  const sickFund   = parseFloat(s.sick_fund_amount)
  const holidayFund = parseFloat(s.holiday_fund_amount)
  const leavePay   = parseFloat(s.leave_pay_amount)
  const paye       = parseFloat(s.paye_fixed)
  const total      = nbcrfli + provident + wellness + sickFund + holidayFund + leavePay + paye
  return { nbcrfli, provident, wellness, sickFund, holidayFund, leavePay, paye, total }
}

// ── Auto-calc summary rows ────────────────────────────────────────────────────
function SummaryRow({ label, val }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{val}</span>
    </div>
  )
}

// Editable earnings line — blank input uses the computed value (shown as the
// placeholder); typing a number overrides it. The reset button clears the override.
function OverrideRow({ label, hint, field, overrides, setOverrides, computed, disabled, disabledNote }) {
  const val = overrides[field]
  const has = val !== '' && val !== null && val !== undefined
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
      <span style={{ color: 'var(--text-secondary)' }}>
        {label}{hint && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> {hint}</span>}
      </span>
      {disabled ? (
        <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{disabledNote}</span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input className="form-input" type="number" step="0.01"
            value={has ? val : ''}
            placeholder={parseFloat(computed || 0).toFixed(2)}
            onChange={e => setOverrides(o => ({ ...o, [field]: e.target.value }))}
            style={{ width: 110, textAlign: 'right', padding: '2px 8px', height: 28, fontWeight: has ? 700 : 500, color: has ? 'var(--accent)' : 'inherit' }}
            title={has ? 'Manual override — clear to use the computed value' : `Computed: ${fmt(computed)}`} />
          <button type="button" className="btn-icon" title="Reset to computed"
            onClick={() => setOverrides(o => ({ ...o, [field]: '' }))}
            style={{ padding: 2, visibility: has ? 'visible' : 'hidden' }}><X size={12} /></button>
        </span>
      )}
    </div>
  )
}

// ── Modal components ──────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={mStyles.overlay}>
      <div style={mStyles.panel}>
        <div style={mStyles.header}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={mStyles.body}>{children}</div>
      </div>
    </div>
  )
}

function TripModal({ defaultDate, onSave, onClose }) {
  const [form, setForm] = useState({ trip_date: defaultDate || new Date().toISOString().slice(0,10), mine_name: '', notes: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <Modal title="Add Trip Date" onClose={onClose}>
      <label className="form-label">Date</label>
      <DateInput className="form-input" value={form.trip_date} onChange={e => set('trip_date', e.target.value)} />
      <label className="form-label" style={{ marginTop: 12 }}>Mine</label>
      <input className="form-input" list="mine-list" value={form.mine_name} onChange={e => set('mine_name', e.target.value)} placeholder="Mine name" />
      <datalist id="mine-list">{ALL_MINES.map(m => <option key={m} value={m} />)}</datalist>
      <label className="form-label" style={{ marginTop: 12 }}>Notes</label>
      <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: 1 }} onClick={() => onSave({ ...form, trip_date: new Date(form.trip_date + 'T12:00:00').toISOString() })}>Save</button>
      </div>
    </Modal>
  )
}

function AdditionalLoadModal({ entry, defaultTruckReg, onSave, onClose }) {
  const isEdit = !!entry?.id
  // Final verification lock: every field but Notes is read-only; save sends only notes.
  const locked = !!entry?.verified3_by
  const [form, setForm] = useState({
    load_date:          entry?.load_date  ? new Date(entry.load_date).toISOString().slice(0,10)  : new Date().toISOString().slice(0,10),
    route_name:         entry?.route_name         || '',
    truck_registration: entry?.truck_registration || defaultTruckReg || '',
    litres:             entry?.litres != null      ? String(entry.litres)   : '',
    amount:             entry?.amount  != null      ? String(entry.amount)   : '',
    is_verified:        entry?.is_verified         || false,
    notes:              entry?.notes               || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <Modal title={isEdit ? 'Edit Additional Load' : 'Add Additional Load'} onClose={onClose}>
      {locked && (
        <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(253,224,71,0.18)', fontSize: 12, color: 'var(--text-secondary)' }}>
          This load is locked by final verification — only the note can be changed.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: '12px 16px' }}>
        <div>
          <label className="form-label">Date *</label>
          <DateInput className="form-input" value={form.load_date} onChange={e => set('load_date', e.target.value)} disabled={locked} />
        </div>
        <div>
          <label className="form-label">Amount (R) *</label>
          <input className="form-input" type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" disabled={locked} />
        </div>
        <div>
          <label className="form-label">Route / Mine *</label>
          <input className="form-input" value={form.route_name} onChange={e => set('route_name', e.target.value)} placeholder="e.g. Droefontein" disabled={locked} />
        </div>
        <div>
          <label className="form-label">Truck Reg</label>
          <input className="form-input" value={form.truck_registration} onChange={e => set('truck_registration', e.target.value)} disabled={locked} />
        </div>
        <div>
          <label className="form-label">Litres</label>
          <input className="form-input" type="number" step="0.01" value={form.litres} onChange={e => set('litres', e.target.value)} placeholder="Optional" disabled={locked} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 22 }}>
          <input type="checkbox" id="al-verified" checked={form.is_verified} onChange={e => set('is_verified', e.target.checked)} disabled={locked} />
          <label htmlFor="al-verified" className="form-label" style={{ margin: 0 }}>Verified</label>
        </div>
      </div>
      <label className="form-label" style={{ marginTop: 12 }}>Notes</label>
      <input className="form-input" autoFocus={locked} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: 1 }} onClick={() => {
          if (locked) { onSave({ notes: form.notes.trim() }); return }
          if (!form.route_name.trim() || !form.amount) { toast.error('Route and amount are required'); return }
          onSave({ ...form, load_date: new Date(form.load_date + 'T12:00:00').toISOString(), litres: form.litres ? parseFloat(form.litres) : null, amount: parseFloat(form.amount) })
        }}>Save</button>
      </div>
    </Modal>
  )
}

function FoodPaymentModal({ entry, onSave, onClose }) {
  const isEdit = !!entry?.id
  // Final verification lock: every field but Notes is read-only; save sends only notes.
  const locked = !!entry?.verified3_by
  const [form, setForm] = useState({
    payment_date: entry?.payment_date ? new Date(entry.payment_date).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
    amount:       entry?.amount != null ? String(entry.amount) : '',
    paid_by:      entry?.paid_by  || '',
    is_verified:  entry?.is_verified || false,
    notes:        entry?.notes   || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <Modal title={isEdit ? 'Edit Food Payment' : 'Add Food Payment'} onClose={onClose}>
      {locked && (
        <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(253,224,71,0.18)', fontSize: 12, color: 'var(--text-secondary)' }}>
          This payment is locked by final verification — only the note can be changed.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: '12px 16px' }}>
        <div>
          <label className="form-label">Date *</label>
          <DateInput className="form-input" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} disabled={locked} />
        </div>
        <div>
          <label className="form-label">Amount (R) *</label>
          <input className="form-input" type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" disabled={locked} />
        </div>
        <div>
          <label className="form-label">Paid By</label>
          <input className="form-input" value={form.paid_by} onChange={e => set('paid_by', e.target.value)} placeholder="e.g. SAFETEC" disabled={locked} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 22 }}>
          <input type="checkbox" id="fp-verified" checked={form.is_verified} onChange={e => set('is_verified', e.target.checked)} disabled={locked} />
          <label htmlFor="fp-verified" className="form-label" style={{ margin: 0 }}>Verified</label>
        </div>
      </div>
      <label className="form-label" style={{ marginTop: 12 }}>Notes</label>
      <input className="form-input" autoFocus={locked} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: 1 }} onClick={() => {
          if (locked) { onSave({ notes: form.notes.trim() }); return }
          if (!form.amount) { toast.error('Amount is required'); return }
          onSave({ ...form, payment_date: new Date(form.payment_date + 'T12:00:00').toISOString(), amount: parseFloat(form.amount) })
        }}>Save</button>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DriverDetailPage() {
  const { driverId } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const { isAdmin, user } = useAuth()

  const now = new Date()
  const [year,  setYear]  = useSessionState('period:driver-pay:year', now.getFullYear())
  const [month, setMonth] = useSessionState('period:driver-pay:month', now.getMonth() + 1)

  const [driver,      setDriver]      = useState(null)
  const [cycle,       setCycle]       = useState(null)
  const [settings,    setSettings]    = useState(null)
  const [mineGroups,  setMineGroups]  = useState([])
  const [salaryHistory, setSalaryHistory] = useState([])
  const [entities,    setEntities]    = useState([])
  const [loading,     setLoading]     = useState(true)

  const [pdfLoading, setPdfLoading] = useState(false)

  // Modal state
  const [tripModal,   setTripModal]   = useState(false)
  const [alModal,     setAlModal]     = useState(null)   // null | entry (new if no id)
  const [fpModal,     setFpModal]     = useState(null)
  const [editModal,   setEditModal]   = useState(false)

  // Load inputs (controlled, live calc)
  const [loads, setLoads] = useState({ lohatla_base_loads: 0, lohatla_extra_loads: 0, casual_group_a_loads: 0, casual_group_b_loads: 0, permanent_split_loads: 0, casual_split_group_a_loads: 0, casual_split_group_b_loads: 0 })
  const [subsAdvance, setSubsAdvance] = useState(0)
  const [subsVerified, setSubsVerified] = useState(false)
  const [loanBal, setLoanBal]   = useState(0)
  const [loanDed, setLoanDed]   = useState(0)
  const [cashBal, setCashBal]   = useState(0)
  const [cashDed, setCashDed]   = useState(0)
  const [comments, setComments] = useState('')
  // Manual earnings + statutory overrides ('' = use computed value)
  const [overrides, setOverrides] = useState({
    basic_salary_override: '', subsistence_override: '', load_incentive_override: '', mine_bonus_override: '',
    nbcrfli_override: '', provident_override: '', wellness_override: '', sick_fund_override: '',
    holiday_fund_override: '', leave_pay_override: '', paye_override: '', ctc_override: '',
  })
  // Real SARS income tax for the cycle (manual, default 0)
  const [taxSars, setTaxSars] = useState(0)
  const [savingLoads, setSavingLoads] = useState(false)

  // Load driver + settings once
  useEffect(() => {
    Promise.all([
      api.get(`/api/drivers/${driverId}`),
      api.get('/api/payroll-settings'),
      api.get('/api/payroll-mine-groups'),
      api.get('/api/entities/'),
    ]).then(([d, s, groups, ents]) => {
      setDriver(d)
      setSettings(s)
      setMineGroups(groups)
      setEntities(ents)
      // Fetch salary config history for this driver once we have driver data
      const name = `${d.first_name} ${d.last_name}`.trim()
      if (isAdmin) {
        api.get(`/api/driver-salary-configs/history?entity_id=${d.entity_id}&driver_name=${encodeURIComponent(name)}`)
          .then(setSalaryHistory)
          .catch(() => {})
      }
    }).catch(() => toast.error('Failed to load driver'))
  }, [driverId])

  // Load cycle whenever month/year or driverId changes
  const loadCycle = useCallback(() => {
    setLoading(true)
    api.get(`/api/drivers/${driverId}/cycles/${year}/${month}`)
      .then(c => {
        setCycle(c)
        setLoads({
          lohatla_base_loads:        c.lohatla_base_loads,
          lohatla_extra_loads:       c.lohatla_extra_loads,
          casual_group_a_loads:      c.casual_group_a_loads      || 0,
          casual_group_b_loads:      c.casual_group_b_loads      || 0,
          permanent_split_loads:     c.permanent_split_loads     || 0,
          casual_split_group_a_loads: c.casual_split_group_a_loads || 0,
          casual_split_group_b_loads: c.casual_split_group_b_loads || 0,
          assmang_loads:             c.assmang_loads             || 0,
          assmang_split_loads:       c.assmang_split_loads       || 0,
        })
        setSubsAdvance(parseFloat(c.subsistence_advance_paid) || 0)
        setSubsVerified(c.subsistence_advance_verified || false)
        setLoanBal(parseFloat(c.staff_loan_balance)   || 0)
        setLoanDed(parseFloat(c.staff_loan_deduction) || 0)
        setCashBal(parseFloat(c.cash_advance_balance) || 0)
        setCashDed(parseFloat(c.cash_advance_deduction) || 0)
        setComments(c.comments || '')
        const ovStr = (v) => (v === null || v === undefined) ? '' : String(v)
        setOverrides({
          basic_salary_override:   ovStr(c.basic_salary_override),
          subsistence_override:    ovStr(c.subsistence_override),
          load_incentive_override: ovStr(c.load_incentive_override),
          mine_bonus_override:     ovStr(c.mine_bonus_override),
          nbcrfli_override:        ovStr(c.nbcrfli_override),
          provident_override:      ovStr(c.provident_override),
          wellness_override:       ovStr(c.wellness_override),
          sick_fund_override:      ovStr(c.sick_fund_override),
          holiday_fund_override:   ovStr(c.holiday_fund_override),
          leave_pay_override:      ovStr(c.leave_pay_override),
          paye_override:           ovStr(c.paye_override),
          ctc_override:            ovStr(c.ctc_override),
        })
        setTaxSars(parseFloat(c.tax_sars) || 0)
      })
      .catch(() => toast.error('Failed to load pay cycle'))
      .finally(() => setLoading(false))
  }, [driverId, year, month])

  useEffect(() => { loadCycle() }, [loadCycle])

  // ── Per-value verification overlay (payroll) ────────────────────────────────
  const [verif, setVerif] = useState({})
  const cyclePrefix = cycle?.id ? `paycycle:${cycle.id}` : null
  const loadVerif = useCallback(() => {
    if (!cyclePrefix) return
    getVerifications(cyclePrefix)
      .then(r => {
        const map = {}
        for (const v of r.data) map[v.target] = v
        setVerif(map)
      })
      .catch(() => setVerif({}))
  }, [cyclePrefix])
  useEffect(() => { loadVerif() }, [loadVerif])

  const handleVerifyValue = async (target, intent) => {
    try { const { data } = await verifyValue(target, driver?.entity_id, intent); setVerif(prev => ({ ...prev, [data.target]: data })) }
    catch (e) { toast.error(errorMessage(e, 'Verification failed')) }
  }
  const handleFinalizeValue = async (target, intent) => {
    try { const { data } = await finalizeValue(target, driver?.entity_id, intent); setVerif(prev => ({ ...prev, [data.target]: data })) }
    catch (e) { toast.error(errorMessage(e, 'Lock failed')) }
  }

  // Patch one row inside the loaded cycle (verify/finalize return the full row)
  // instead of reloading the whole cycle; verification doesn't affect calc totals.
  const patchCycleRow = (key, data) =>
    setCycle(prev => prev ? { ...prev, [key]: (prev[key] || []).map(r => r.id === data.id ? { ...r, ...data } : r) } : prev)

  // Month navigation
  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Merge mine group rates into settings so calcLive always uses current active rates.
  // PayrollSettings.lohatla_* can lag behind if mine groups were updated separately.
  const lohatlaGroup = mineGroups.find(g => g.is_active && g.name === 'Lohatla')
  const effectiveSettings = settings ? {
    ...settings,
    lohatla_base_salary:        lohatlaGroup?.base_salary         ?? settings.lohatla_base_salary,
    lohatla_subs_per_load:      lohatlaGroup?.subs_per_load       ?? settings.lohatla_subs_per_load,
    lohatla_incentive_per_load: lohatlaGroup?.incentive_per_load  ?? settings.lohatla_incentive_per_load,
  } : null

  // Live calc
  const liveCalc = calcLive(loads, effectiveSettings, cycle?.additional_loads, driver?.driver_type, driver?.exclude_mine_bonus, overrides)
  const statComputed = liveCalc && driver?.driver_type === 'permanent'
    ? calcStatutory(liveCalc.basicSalary, effectiveSettings)
    : null
  // Effective statutory lines — a per-cycle override ('' = none) wins over the
  // fixed rand amount from Payroll Rates.
  const ovNum = (field, computed) => {
    const v = overrides[field]
    return (v === '' || v === null || v === undefined) ? computed : parseFloat(v)
  }
  const stat = statComputed ? (() => {
    const nbcrfli     = ovNum('nbcrfli_override',      statComputed.nbcrfli)
    const provident   = ovNum('provident_override',    statComputed.provident)
    const wellness    = ovNum('wellness_override',     statComputed.wellness)
    const sickFund    = ovNum('sick_fund_override',    statComputed.sickFund)
    const holidayFund = ovNum('holiday_fund_override', statComputed.holidayFund)
    const leavePay    = ovNum('leave_pay_override',    statComputed.leavePay)
    const paye        = ovNum('paye_override',         statComputed.paye)
    const total = nbcrfli + provident + wellness + sickFund + holidayFund + leavePay + paye
    return { nbcrfli, provident, wellness, sickFund, holidayFund, leavePay, paye, total }
  })() : null
  const subsAdvanceParsed = parseFloat(subsAdvance || 0)
  const loanDedParsed = parseFloat(loanDed || 0)
  const cashDedParsed = parseFloat(cashDed || 0)
  const taxSarsParsed = parseFloat(taxSars || 0)
  const totalFoodPaid = cycle?.food_payments?.reduce((s, p) => s + parseFloat(p.amount || 0), 0) || 0
  const totalDeductions = (stat ? stat.total : 0) + (driver?.driver_type === 'permanent' ? subsAdvanceParsed + taxSarsParsed : 0) + loanDedParsed + cashDedParsed + totalFoodPaid
  // Sick/Holiday/Leave are part of the wage (earnings) AND withheld into their
  // funds (deductions), so they appear on both sides and net to zero in take-home.
  // Gross/total earnings therefore includes them; net = grossEarnings − deductions.
  const accrualOffset = stat ? (stat.sickFund + stat.holidayFund + stat.leavePay) : 0
  const grossEarnings = liveCalc ? liveCalc.gross + accrualOffset : 0
  const netPayable = liveCalc ? grossEarnings - totalDeductions : 0
  // Cost to Company — total earnings + company contributions (provident +
  // NBCRFLI + wellness). Display line only; never part of net payable.
  const ctcComputed = grossEarnings + (stat ? stat.provident + stat.nbcrfli + stat.wellness : 0)

  const downloadPayslip = async () => {
    setPdfLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`${API}/api/drivers/${driverId}/cycles/${year}/${month}/payslip-pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to generate payslip')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const name = driver ? `payslip_${driver.last_name}_${driver.first_name}_${year}_${String(month).padStart(2,'0')}.pdf` : `payslip_${year}_${String(month).padStart(2,'0')}.pdf`
      a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
    } catch { toast.error('Failed to generate payslip PDF') }
    finally { setPdfLoading(false) }
  }

  // Save loads
  const saveLoads = async () => {
    setSavingLoads(true)
    try {
      const ovOut = (v) => (v === '' || v === null || v === undefined) ? null : parseFloat(v)
      const updated = await api.put(`/api/drivers/${driverId}/cycles/${year}/${month}`, {
        ...loads,
        basic_salary_override:   ovOut(overrides.basic_salary_override),
        subsistence_override:    ovOut(overrides.subsistence_override),
        load_incentive_override: ovOut(overrides.load_incentive_override),
        mine_bonus_override:     ovOut(overrides.mine_bonus_override),
        nbcrfli_override:        ovOut(overrides.nbcrfli_override),
        provident_override:      ovOut(overrides.provident_override),
        wellness_override:       ovOut(overrides.wellness_override),
        sick_fund_override:      ovOut(overrides.sick_fund_override),
        holiday_fund_override:   ovOut(overrides.holiday_fund_override),
        leave_pay_override:      ovOut(overrides.leave_pay_override),
        paye_override:           ovOut(overrides.paye_override),
        ctc_override:            ovOut(overrides.ctc_override),
        tax_sars:                taxSarsParsed,
        subsistence_advance_paid:     subsAdvanceParsed,
        subsistence_advance_verified: subsVerified,
        staff_loan_balance:  parseFloat(loanBal || 0),
        staff_loan_deduction: loanDedParsed,
        cash_advance_balance: parseFloat(cashBal || 0),
        cash_advance_deduction: cashDedParsed,
        comments,
      })
      setCycle(updated)
      toast.success('Saved')
    } catch { toast.error('Save failed') }
    finally { setSavingLoads(false) }
  }

  // Additional loads grouped summary
  const alSummary = () => {
    if (!cycle?.additional_loads?.length) return null
    const groups = {}
    for (const al of cycle.additional_loads) {
      groups[al.route_name] = (groups[al.route_name] || 0) + parseFloat(al.amount)
    }
    return groups
  }

  const entityName = (id) => entities.find(e => e.id === id)?.name || '—'

  if (!driver) return <div style={{ padding: 40 }}><div className="spinner" /></div>

  const isPermanent = driver.driver_type === 'permanent'
  const tripLogEffectiveCount = (cycle?.trip_log || []).reduce((sum, t) => sum + tripCountValue(t), 0)

  return (
    <div style={{ padding: 'var(--page-pad)', flex: 1, maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-icon" onClick={() => navigate('/drivers')} style={{ padding: 6 }}><ArrowLeft size={16} /></button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{driver.first_name} {driver.last_name}</h1>
              {driver.employee_number && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>#{driver.employee_number}</span>}
              <span className={`badge ${isPermanent ? 'badge-sent' : 'badge-quote'}`}>{isPermanent ? 'Permanent' : 'Casual'}</span>
              <span className={`badge ${driver.is_active ? 'badge-paid' : 'badge-draft'}`}>{driver.is_active ? 'Active' : 'Inactive'}</span>
              <span className="badge badge-draft">{entityName(driver.entity_id)}</span>
            </div>
          </div>
        </div>
        {/* Month navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn-icon" onClick={prevMonth}><ChevronLeft size={16} /></button>
          <span style={{ fontWeight: 600, fontSize: 14, minWidth: 130, textAlign: 'center' }}>{MONTHS[month - 1]} {year}</span>
          <button className="btn-icon" onClick={nextMonth}><ChevronRight size={16} /></button>
          <button className="btn-secondary" onClick={downloadPayslip} disabled={pdfLoading} title="Download payslip PDF">
            <Download size={13} /> {pdfLoading ? 'Generating…' : 'Payslip PDF'}
          </button>
          <button className="btn-secondary" style={{ marginLeft: 4 }} onClick={() => setEditModal(true)}><Edit2 size={13} /> Edit driver</button>
        </div>
      </div>

      {/* Pre-populated from truck loads banner */}
      {cycle?.was_prefilled && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--accent-subtle)', borderRadius: 8, border: '1px solid var(--accent)', fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Load counts pre-populated from truck loads</span>
          <span style={{ color: 'var(--text-secondary)' }}>— verify and adjust if needed before saving.</span>
        </div>
      )}

      {/* Top stat row */}
      {liveCalc && (
        <div className="grid-4" style={{ marginBottom: 20 }}>
          {[
            { label: 'Total Loads',      value: liveCalc.grand,                   colour: 'var(--accent)', verifyField: 'total_loads' },
            { label: 'Gross Income',     value: fmt(grossEarnings),               colour: 'var(--success)' },
            { label: 'Total Deductions', value: fmt(totalDeductions),             colour: 'var(--danger)' },
            { label: 'Net Payable',      value: fmt(netPayable),                  colour: 'var(--accent)' },
          ].map(c => (
            <div key={c.label} className="stat-card">
              <div className="stat-card-label">{c.label}</div>
              <div className="stat-card-value" style={{ color: c.colour, fontSize: 20 }}>
                {c.verifyField && cyclePrefix ? (
                  <VerifiableAmount
                    target={`${cyclePrefix}:${c.verifyField}`}
                    state={verif[`${cyclePrefix}:${c.verifyField}`]}
                    onVerify={handleVerifyValue} onFinalize={handleFinalizeValue}
                    currentUserId={user?.id} isAdmin={isAdmin} align="left"
                  >
                    {c.value}
                  </VerifiableAmount>
                ) : c.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? <div className="spinner" style={{ margin: '40px auto' }} /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: 20, alignItems: 'start' }}>

          {/* ── LEFT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Load entry card */}
            <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Load Entry</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)', background: 'var(--accent-subtle)', borderRadius: 6, padding: '8px 10px' }}>
                {isPermanent
                  ? 'Enter loads per mine group — calculations update automatically.'
                  : 'Casual driver: enter total Lohatla loads. Rate × loads = earnings. No BC rules apply.'}
              </p>

              {/* Permanent: Lohatla Mine groups | Casual: Group A + Group B */}
              {isPermanent ? (
                <div style={{ background: 'rgba(22,163,74,0.06)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--success)', marginBottom: 10 }}>Lohatla Mine</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: 12 }}>
                    <div>
                      <label className="form-label">Base loads (max 7)</label>
                      <input className="form-input" type="number" min="0" max="7" value={loads.lohatla_base_loads}
                        onChange={e => setLoads(l => ({ ...l, lohatla_base_loads: parseInt(e.target.value) || 0 }))} />
                      {effectiveSettings && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Subs: {fmt(parseFloat(effectiveSettings.lohatla_subs_per_load) * loads.lohatla_base_loads)} · Base: {fmt(effectiveSettings.lohatla_base_salary)}
                      </div>}
                    </div>
                    <div>
                      <label className="form-label">Extra loads (&gt;7)</label>
                      {/* When auto-tracked split loads exist, the Extra field shows the
                          effective count (extra + split×0.5, e.g. 3.5) and locks — the
                          0.5 comes from the split lines and can't be hand-edited here. */}
                      {loads.permanent_split_loads > 0 ? (
                        <input className="form-input" type="number" readOnly disabled
                          value={loads.lohatla_extra_loads + loads.permanent_split_loads * 0.5} />
                      ) : (
                        <input className="form-input" type="number" min="0" value={loads.lohatla_extra_loads}
                          onChange={e => setLoads(l => ({ ...l, lohatla_extra_loads: parseInt(e.target.value) || 0 }))} />
                      )}
                      {effectiveSettings && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Subs: {fmt(parseFloat(effectiveSettings.lohatla_subs_per_load) * (loads.lohatla_extra_loads + loads.permanent_split_loads * 0.5))} · Inc: {fmt(parseFloat(effectiveSettings.lohatla_incentive_per_load) * (loads.lohatla_extra_loads + loads.permanent_split_loads * 0.5))}
                      </div>}
                    </div>
                  </div>
                  {loads.permanent_split_loads > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
                      Incl. {loads.permanent_split_loads} split load{loads.permanent_split_loads > 1 ? 's' : ''} (+{(loads.permanent_split_loads * 0.5).toFixed(1)} effective, auto) — folded into Extra loads above
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                  <div style={{ background: 'rgba(22,163,74,0.06)', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--success)', marginBottom: 2 }}>Group A</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>Mokala · Assmang · Sebilo · Tawana</div>
                    {loads.casual_split_group_a_loads > 0 ? (
                      <input className="form-input" type="number" readOnly disabled
                        value={loads.casual_group_a_loads + loads.casual_split_group_a_loads * 0.5} />
                    ) : (
                      <input className="form-input" type="number" min="0" value={loads.casual_group_a_loads}
                        onChange={e => setLoads(l => ({ ...l, casual_group_a_loads: parseInt(e.target.value) || 0 }))} />
                    )}
                    {effectiveSettings && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {fmt(effectiveSettings.casual_rate_group_a)} per load · Earnings: {fmt((parseFloat(effectiveSettings.casual_rate_group_a) || 0) * (loads.casual_group_a_loads + loads.casual_split_group_a_loads * 0.5))}
                    </div>}
                  </div>
                  <div style={{ background: 'rgba(59,130,246,0.06)', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent)', marginBottom: 2 }}>Group B</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>Glosam · Driehoek · Future · Afrimat · Boskop</div>
                    {loads.casual_split_group_b_loads > 0 ? (
                      <input className="form-input" type="number" readOnly disabled
                        value={loads.casual_group_b_loads + loads.casual_split_group_b_loads * 0.5} />
                    ) : (
                      <input className="form-input" type="number" min="0" value={loads.casual_group_b_loads}
                        onChange={e => setLoads(l => ({ ...l, casual_group_b_loads: parseInt(e.target.value) || 0 }))} />
                    )}
                    {effectiveSettings && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {fmt(effectiveSettings.casual_rate_group_b)} per load · Earnings: {fmt((parseFloat(effectiveSettings.casual_rate_group_b) || 0) * (loads.casual_group_b_loads + loads.casual_split_group_b_loads * 0.5))}
                    </div>}
                  </div>
                  {(loads.casual_split_group_a_loads > 0 || loads.casual_split_group_b_loads > 0) && effectiveSettings && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px',
                      background: 'var(--bg-surface)', borderRadius: 6 }}>
                      Incl. split loads — Group A: {loads.casual_split_group_a_loads} · Group B: {loads.casual_split_group_b_loads}
                      &nbsp;(+{((loads.casual_split_group_a_loads + loads.casual_split_group_b_loads) * 0.5).toFixed(1)} eff., folded into fields above ·&nbsp;
                      {fmt(
                        (loads.casual_split_group_a_loads * parseFloat(effectiveSettings.casual_rate_group_a || 0)) / 2 +
                        (loads.casual_split_group_b_loads * parseFloat(effectiveSettings.casual_rate_group_b || 0)) / 2
                      )})
                    </div>
                  )}
                </div>
              )}

              {/* Auto-calc summary — earnings lines are editable; a blank field uses
                  the computed value, a typed number overrides it (and flows to gross). */}
              {liveCalc && (
                <div style={{ background: 'var(--bg-page)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Override any line — blank uses the calculated value
                  </div>
                  {liveCalc.isCasual ? (
                    <>
                      {liveCalc.loadsA > 0 && <SummaryRow label={`Group A (${liveCalc.loadsA} × ${fmt(liveCalc.rateA)})`} val={fmt(liveCalc.loadsA * liveCalc.rateA)} />}
                      {liveCalc.loadsB > 0 && <SummaryRow label={`Group B (${liveCalc.loadsB} × ${fmt(liveCalc.rateB)})`} val={fmt(liveCalc.loadsB * liveCalc.rateB)} />}
                      {liveCalc.splitA > 0 && <SummaryRow label={`Group A split (${(liveCalc.splitA * 0.5).toFixed(1)} × ${fmt(liveCalc.rateA)})`} val={fmt(liveCalc.splitA * liveCalc.rateA / 2)} />}
                      {liveCalc.splitB > 0 && <SummaryRow label={`Group B split (${(liveCalc.splitB * 0.5).toFixed(1)} × ${fmt(liveCalc.rateB)})`} val={fmt(liveCalc.splitB * liveCalc.rateB / 2)} />}
                      <OverrideRow label="Mine bonus" hint={`(${liveCalc.assmangEff} × R${parseFloat(effectiveSettings?.assmang_bonus_per_load || 150).toFixed(0)})`}
                        field="mine_bonus_override" overrides={overrides} setOverrides={setOverrides}
                        computed={liveCalc.assmangComputed} disabled={driver.exclude_mine_bonus} disabledNote="Excluded" />
                      <SummaryRow label="Additional loads" val={fmt(liveCalc.additionalTotal)} />
                    </>
                  ) : (
                    <>
                      <OverrideRow label="Basic salary" field="basic_salary_override" overrides={overrides} setOverrides={setOverrides} computed={liveCalc.basicComputed} />
                      {stat && <>
                        <SummaryRow label="Sick Fund" val={fmt(stat.sickFund)} />
                        <SummaryRow label="Holiday Fund" val={fmt(stat.holidayFund)} />
                        <SummaryRow label="Leave Pay" val={fmt(stat.leavePay)} />
                      </>}
                      <OverrideRow label="Subsistence" field="subsistence_override" overrides={overrides} setOverrides={setOverrides} computed={liveCalc.subsComputed} />
                      <OverrideRow label="Load incentive" field="load_incentive_override" overrides={overrides} setOverrides={setOverrides} computed={liveCalc.incComputed} />
                      <OverrideRow label="Mine bonus" hint={`(${liveCalc.assmangEff} × R${parseFloat(effectiveSettings?.assmang_bonus_per_load || 150).toFixed(0)})`}
                        field="mine_bonus_override" overrides={overrides} setOverrides={setOverrides}
                        computed={liveCalc.assmangComputed} disabled={driver.exclude_mine_bonus} disabledNote="Excluded" />
                      <SummaryRow label="Additional loads" val={fmt(liveCalc.additionalTotal)} />
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontWeight: 700, color: 'var(--accent)', fontSize: 14 }}>
                    <span>Gross income</span><span>{fmt(grossEarnings)}</span>
                  </div>
                </div>
              )}

              {/* Subsistence advance — permanent only */}
              {isPermanent && (
                <div style={{ marginBottom: 12 }}>
                  <label className="form-label">Subsistence advance paid (R)</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="form-input" type="number" step="0.01" value={subsAdvance} onChange={e => setSubsAdvance(e.target.value)} style={{ flex: 1 }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
                      <input type="checkbox" checked={subsVerified} onChange={e => setSubsVerified(e.target.checked)} />Verified
                    </label>
                  </div>
                  {liveCalc && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Budgeted: {fmt(liveCalc.totalSubs)} · Paid: {fmt(subsAdvance)} ·{' '}
                      <span style={{ color: subsAdvanceParsed > liveCalc.totalSubs ? 'var(--danger)' : 'var(--success)' }}>
                        {subsAdvanceParsed > liveCalc.totalSubs ? `Overpaid ${fmt(subsAdvanceParsed - liveCalc.totalSubs)}` : `Within budget`}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Loans */}
              <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label">Staff loan balance</label>
                  <input className="form-input" type="number" step="0.01" value={loanBal} onChange={e => setLoanBal(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Staff loan deduction</label>
                  <input className="form-input" type="number" step="0.01" value={loanDed} onChange={e => setLoanDed(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Cash advance balance</label>
                  <input className="form-input" type="number" step="0.01" value={cashBal} onChange={e => setCashBal(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Cash advance deduction</label>
                  <input className="form-input" type="number" step="0.01" value={cashDed} onChange={e => setCashDed(e.target.value)} />
                </div>
              </div>

              <label className="form-label">Comments</label>
              <textarea className="form-input" value={comments} onChange={e => setComments(e.target.value)} rows={2} style={{ resize: 'vertical' }} />

              <button className="btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={saveLoads} disabled={savingLoads}>
                {savingLoads ? 'Saving…' : 'Save loads'}
              </button>
            </div>

            {/* Payslip summary card */}
            {liveCalc && (
              <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>Payslip Summary</h3>

                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Income</div>
                {liveCalc.isCasual ? [
                  ...(liveCalc.loadsA > 0 ? [[`Group A (${liveCalc.loadsA} × ${fmt(liveCalc.rateA)})`, fmt(liveCalc.earningsA)]] : []),
                  ...(liveCalc.loadsB > 0 ? [[`Group B (${liveCalc.loadsB} × ${fmt(liveCalc.rateB)})`, fmt(liveCalc.earningsB)]] : []),
                  ['Additional loads',   fmt(liveCalc.additionalTotal)],
                ].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{l}</span><span>{v}</span>
                  </div>
                )) : (
                  <>
                    <OverrideRow label="Basic salary" field="basic_salary_override" overrides={overrides} setOverrides={setOverrides} computed={liveCalc.basicComputed} />
                    {statComputed && <>
                      <OverrideRow label="Sick fund" field="sick_fund_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.sickFund} />
                      <OverrideRow label="Holiday fund" field="holiday_fund_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.holidayFund} />
                      <OverrideRow label="Leave pay" field="leave_pay_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.leavePay} />
                    </>}
                    <OverrideRow label="Load incentive" field="load_incentive_override" overrides={overrides} setOverrides={setOverrides} computed={liveCalc.incComputed} />
                    <OverrideRow label="Mine bonus" field="mine_bonus_override" overrides={overrides} setOverrides={setOverrides}
                      computed={liveCalc.assmangComputed} disabled={driver.exclude_mine_bonus} disabledNote="Excluded" />
                    <OverrideRow label="Subsistence" field="subsistence_override" overrides={overrides} setOverrides={setOverrides} computed={liveCalc.subsComputed} />
                    <SummaryRow label="Additional loads" val={fmt(liveCalc.additionalTotal)} />
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: 600, fontSize: 13 }}>
                  <span>Gross</span><span>{fmt(grossEarnings)}</span>
                </div>

                {isPermanent && stat && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 6px' }}>Deductions</div>
                    <OverrideRow label="NBCRFLI" field="nbcrfli_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.nbcrfli} />
                    <OverrideRow label="Provident" field="provident_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.provident} />
                    <OverrideRow label="Wellness" field="wellness_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.wellness} />
                    <OverrideRow label="Sick fund" field="sick_fund_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.sickFund} />
                    <OverrideRow label="Holiday fund" field="holiday_fund_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.holidayFund} />
                    <OverrideRow label="Leave pay" field="leave_pay_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.leavePay} />
                    <OverrideRow label="PAYE (TAX)" field="paye_override" overrides={overrides} setOverrides={setOverrides} computed={statComputed.paye} />
                    {/* UIF — manual per-cycle amount, no computed default (stored in tax_sars col) */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid var(--border)', gap: 8, fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>UIF</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input className="form-input" type="number" step="0.01" value={taxSars}
                          onChange={e => setTaxSars(e.target.value)}
                          style={{ width: 110, textAlign: 'right', padding: '2px 8px', height: 28, fontWeight: taxSarsParsed > 0 ? 700 : 500, color: taxSarsParsed > 0 ? 'var(--accent)' : 'inherit' }} />
                        <span style={{ width: 16 }} />
                      </span>
                    </div>
                    {[
                      ['Subs advance',     fmt(subsAdvanceParsed)],
                      ['Staff loan',       fmt(loanDedParsed)],
                      ['Cash advance',     fmt(cashDedParsed)],
                      ...(totalFoodPaid > 0 ? [['Food allowance', fmt(totalFoodPaid)]] : []),
                    ].map(([l, v]) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{l}</span><span style={{ color: 'var(--danger)' }}>({v})</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
                      <span>Total deductions</span><span style={{ color: 'var(--danger)' }}>({fmt(totalDeductions)})</span>
                    </div>
                  </>
                )}

                {!isPermanent && (loanDedParsed > 0 || cashDedParsed > 0 || totalFoodPaid > 0) && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 6px' }}>Deductions</div>
                    {[
                      ['Staff loan',      fmt(loanDedParsed)],
                      ['Cash advance',    fmt(cashDedParsed)],
                      ['Food allowance',  fmt(totalFoodPaid)],
                    ].filter(([, v]) => parseFloat(v.replace(/[^0-9.]/g, '')) > 0).map(([l, v]) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{l}</span><span style={{ color: 'var(--danger)' }}>({v})</span>
                      </div>
                    ))}
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>
                  <span>Net payable</span><span>{fmt(netPayable)}</span>
                </div>

                {isPermanent && stat && (
                  <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                    <OverrideRow label="CTC" hint="(cost to company)" field="ctc_override"
                      overrides={overrides} setOverrides={setOverrides} computed={ctcComputed} />
                  </div>
                )}

                <button className="btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={saveLoads} disabled={savingLoads}>
                  {savingLoads ? 'Saving…' : 'Save payslip changes'}
                </button>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Additional loads */}
            <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Additional Loads</h3>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {cycle?.additional_loads?.length || 0} entries · {fmt(liveCalc?.additionalTotal || 0)} total · {cycle?.additional_loads?.filter(a => a.is_verified).length || 0} verified
                  </span>
                </div>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setAlModal({})}><Plus size={13} /> Add</button>
              </div>
              {cycle?.additional_loads?.length > 0 ? (
                <div className="table-wrapper" style={{ marginBottom: 12 }}>
                  <table>
                    <thead><tr><th>Date</th><th>Route</th><th>Amount</th><th>Verified</th><th style={{ width: 60 }}></th></tr></thead>
                    <tbody>
                      {cycle.additional_loads.map(al => (
                        <tr key={al.id}>
                          <td style={{ fontSize: 12 }}>{fmtDate(al.load_date)}</td>
                          <td style={{ fontSize: 12 }}>{al.route_name}{al.truck_registration && <span style={{ color: 'var(--text-muted)' }}> · {al.truck_registration}</span>}</td>
                          <td style={{
                            fontSize: 12,
                            ...(al.verified2_by ? { background: 'rgba(253,224,71,0.55)', fontWeight: 700 } : {}),
                          }}>{fmt(al.amount)}</td>
                          <td>
                            <VerifyBadge item={al} currentUserId={user?.id} isAdmin={isAdmin} adminFinalizeAnytime
                              onVerify={async (item, intent) => {
                                try {
                                  const { data } = await api.patch(`/api/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${item.id}/verify`, null, { params: intent ? { action: intent } : {} })
                                  patchCycleRow('additional_loads', data)
                                } catch (e) { toast.error(errorMessage(e, 'Verification failed')) }
                              }}
                              onFinalize={async (item, intent) => {
                                try {
                                  const { data } = await api.patch(`/api/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${item.id}/finalize`, null, { params: intent ? { action: intent } : {} })
                                  patchCycleRow('additional_loads', data)
                                } catch (e) { toast.error(errorMessage(e, 'Finalise failed')) }
                              }}
                            />
                          </td>
                          <td style={{ display: 'flex', gap: 4 }}>
                            <button className="btn-icon" onClick={() => setAlModal(al)} style={{ padding: 4 }} title={al.verified3_by ? 'Locked — edit note only' : 'Edit'}><Edit2 size={11} /></button>
                            <button className="btn-icon" onClick={async () => {
                              if (!confirm('Delete this entry?')) return
                              try { await api.del(`/api/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${al.id}`); loadCycle() }
                              catch { toast.error('Delete failed') }
                            }} style={{ padding: 4, color: 'var(--danger)' }}><Trash2 size={11} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>No additional loads recorded.</div>}

              {/* Grouped summary */}
              {(() => {
                const groups = alSummary()
                if (!groups) return null
                return (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-page)', borderRadius: 6, padding: '8px 10px' }}>
                    {Object.entries(groups).map(([route, total]) => (
                      <span key={route} style={{ marginRight: 12 }}><strong>{route}</strong>: {fmt(total)}</span>
                    ))}
                    <span><strong>Total</strong>: {fmt(liveCalc?.additionalTotal || 0)}</span>
                  </div>
                )
              })()}
            </div>

            {/* Food allowance */}
            <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Food Allowance (Kosgelde)</h3>
                  <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Paid: <strong style={{ color: 'var(--text-primary)' }}>{fmt(totalFoodPaid)}</strong></span>
                    <span style={{ color: 'var(--text-muted)' }}>Verified: <strong>{cycle?.food_payments?.filter(f => f.is_verified).length || 0}/{cycle?.food_payments?.length || 0}</strong></span>
                  </div>
                </div>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setFpModal({})}><Plus size={13} /> Add</button>
              </div>
              {cycle?.food_payments?.length > 0 ? (
                <div className="table-wrapper">
                  <table>
                    <thead><tr><th>Date</th><th>Paid By</th><th>Amount</th><th style={{ width: 60 }}>✓</th><th style={{ width: 60 }}></th></tr></thead>
                    <tbody>
                      {cycle.food_payments.map(fp => (
                        <tr key={fp.id}>
                          <td style={{ fontSize: 12 }}>{fmtDate(fp.payment_date)}</td>
                          <td style={{ fontSize: 12 }}>{fp.paid_by || '—'}</td>
                          <td style={{
                            fontSize: 12,
                            ...(fp.verified2_by ? { background: 'rgba(253,224,71,0.55)', fontWeight: 700 } : {}),
                          }}>{fmt(fp.amount)}</td>
                          <td>
                            <VerifyBadge item={fp} currentUserId={user?.id} isAdmin={isAdmin} adminFinalizeAnytime
                              onVerify={async (item, intent) => {
                                try {
                                  const { data } = await api.patch(`/api/drivers/${driverId}/cycles/${year}/${month}/food-payments/${item.id}/verify`, null, { params: intent ? { action: intent } : {} })
                                  patchCycleRow('food_payments', data)
                                } catch (e) { toast.error(errorMessage(e, 'Verification failed')) }
                              }}
                              onFinalize={async (item, intent) => {
                                try {
                                  const { data } = await api.patch(`/api/drivers/${driverId}/cycles/${year}/${month}/food-payments/${item.id}/finalize`, null, { params: intent ? { action: intent } : {} })
                                  patchCycleRow('food_payments', data)
                                } catch (e) { toast.error(errorMessage(e, 'Finalise failed')) }
                              }}
                            />
                          </td>
                          <td style={{ display: 'flex', gap: 4 }}>
                            <button className="btn-icon" onClick={() => setFpModal(fp)} style={{ padding: 4 }} title={fp.verified3_by ? 'Locked — edit note only' : 'Edit'}><Edit2 size={11} /></button>
                            <button className="btn-icon" onClick={async () => {
                              if (!confirm('Delete?')) return
                              try { await api.del(`/api/drivers/${driverId}/cycles/${year}/${month}/food-payments/${fp.id}`); loadCycle() }
                              catch { toast.error('Delete failed') }
                            }} style={{ padding: 4, color: 'var(--danger)' }}><Trash2 size={11} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>No payments recorded.</div>}
            </div>

            {/* Trip log */}
            <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Trip Log <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>{fmtTripCount(tripLogEffectiveCount)} trips</span></h3>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setTripModal(true)}><Plus size={13} /> Add trip</button>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--text-muted)' }}>Auto-populated from Truck Loads. Manual entries can also be added.</p>
              {cycle?.trip_log?.length > 0 ? (
                <div className="table-wrapper">
                  <table>
                    <thead><tr><th>#</th><th>Date</th><th>Mine</th><th>Truck</th><th>Notes</th><th style={{ width: 40 }}></th></tr></thead>
                    <tbody>
                      {cycle.trip_log.map((t, i) => (
                        <tr key={t.id}>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td style={{ fontSize: 12 }}>{fmtDate(t.trip_date)}</td>
                          <td style={{ fontSize: 12 }}>
                            {t.mine_name}
                            {t.truck_load_id && (
                              <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 5px', borderRadius: 4 }}>auto</span>
                            )}
                            {isSplitTrip(t) && (
                              <span title="Split load — counts as 0.5 of a trip" style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: '#7c3aed', background: '#ede9fe', padding: '1px 5px', borderRadius: 4 }}>½</span>
                            )}
                            {t.already_paid && (
                              <span title="Paid in a prior period — not paid again here" style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '1px 5px', borderRadius: 4 }}>PAID</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            {t.vehicle_reg || '—'}
                            {t.cross_truck && (
                              <span title="Driven on another driver's truck — credited to this driver because they drove it" style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 5px', borderRadius: 4 }}>other truck</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {t.truck_load_id ? `Load #${t.truck_load_id}` : (t.notes || '—')}
                          </td>
                          <td>
                            {!t.truck_load_id && (
                              <button className="btn-icon" onClick={async () => {
                                if (!confirm('Delete trip?')) return
                                try { await api.del(`/api/drivers/${driverId}/cycles/${year}/${month}/trips/${t.id}`); loadCycle() }
                                catch { toast.error('Delete failed') }
                              }} style={{ padding: 4, color: 'var(--danger)' }}><Trash2 size={11} /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No trips recorded.</div>}
            </div>

            {/* Salary config history */}
            {salaryHistory.length > 0 && (
              <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Salary Config</h3>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Effective from</th>
                        <th style={{ textAlign: 'right' }}>Near route</th>
                        <th style={{ textAlign: 'right' }}>Far route</th>
                        <th style={{ textAlign: 'right' }}>Extra/load</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {salaryHistory.map(c => (
                        <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                          <td style={{ fontSize: 12 }}>
                            {fmtDate(c.effective_from || c.created_at)}
                            {c.is_active && (
                              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--success)', background: 'rgba(22,163,74,0.1)', padding: '1px 5px', borderRadius: 4 }}>current</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12, textAlign: 'right' }}>{c.base_salary_near_route != null ? fmt(c.base_salary_near_route) : '—'}</td>
                          <td style={{ fontSize: 12, textAlign: 'right' }}>{c.base_salary_far_route != null ? fmt(c.base_salary_far_route) : '—'}</td>
                          <td style={{ fontSize: 12, textAlign: 'right' }}>{c.extra_per_load_far != null ? fmt(c.extra_per_load_far) : '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.notes || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Driver info card */}
            <div className="bg-card" style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Driver Info</h3>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setEditModal(true)}><Edit2 size={13} /> Edit</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: '8px 16px', fontSize: 13 }}>
                {[
                  ['Employee #',     driver.employee_number || '—'],
                  ['ID Number',      driver.id_number       || '—'],
                  ['Tax Number',     driver.tax_number      || '—'],
                  ['Bank',           driver.bank_name       || '—'],
                  ['Account',        driver.bank_account_number || '—'],
                  ['Branch Code',    driver.branch_code     || '—'],
                  ['Job Title',      driver.job_title       || '—'],
                  ['Date Engaged',   driver.date_engaged ? new Date(driver.date_engaged).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'],
                  ['Truck',          driver.truck_registration  || '—'],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l}</div>
                    <div style={{ fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
              {driver.address && (
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Address</div>
                  <div style={{ fontWeight: 500, whiteSpace: 'pre-line' }}>{driver.address}</div>
                </div>
              )}
              {driver.notes && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{driver.notes}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {tripModal && (
        <TripModal
          onClose={() => setTripModal(false)}
          onSave={async (data) => {
            try { await api.post(`/api/drivers/${driverId}/cycles/${year}/${month}/trips`, data); loadCycle(); setTripModal(false); toast.success('Trip added') }
            catch { toast.error('Failed to add trip') }
          }}
        />
      )}
      {alModal !== null && (
        <AdditionalLoadModal
          entry={alModal.id ? alModal : null}
          defaultTruckReg={driver.truck_registration}
          onClose={() => setAlModal(null)}
          onSave={async (data) => {
            try {
              if (alModal.id) await api.put(`/api/drivers/${driverId}/cycles/${year}/${month}/additional-loads/${alModal.id}`, data)
              else await api.post(`/api/drivers/${driverId}/cycles/${year}/${month}/additional-loads`, data)
              loadCycle(); setAlModal(null); toast.success('Saved')
            } catch { toast.error('Save failed') }
          }}
        />
      )}
      {fpModal !== null && (
        <FoodPaymentModal
          entry={fpModal.id ? fpModal : null}
          onClose={() => setFpModal(null)}
          onSave={async (data) => {
            try {
              if (fpModal.id) await api.put(`/api/drivers/${driverId}/cycles/${year}/${month}/food-payments/${fpModal.id}`, data)
              else await api.post(`/api/drivers/${driverId}/cycles/${year}/${month}/food-payments`, data)
              loadCycle(); setFpModal(null); toast.success('Saved')
            } catch { toast.error('Save failed') }
          }}
        />
      )}
      {editModal && (
        <EditDriverModal
          driver={driver}
          entities={entities}
          onClose={() => setEditModal(false)}
          onSave={async (data) => {
            try {
              const updated = await api.put(`/api/drivers/${driverId}`, data)
              setDriver(updated)
              setEditModal(false)
              toast.success('Driver updated')
            } catch { toast.error('Update failed') }
          }}
        />
      )}
    </div>
  )
}

// ── Edit driver modal ─────────────────────────────────────────────────────────
function EditDriverModal({ driver, entities, onSave, onClose }) {
  const [form, setForm] = useState({
    entity_id:           driver.entity_id,
    employee_number:     driver.employee_number || '',
    first_name:          driver.first_name,
    last_name:           driver.last_name,
    driver_type:         driver.driver_type,
    id_number:           driver.id_number || '',
    tax_number:          driver.tax_number || '',
    bank_name:           driver.bank_name || '',
    bank_account_number: driver.bank_account_number || '',
    branch_code:         driver.branch_code || '',
    job_title:           driver.job_title || '',
    date_engaged:        driver.date_engaged ? driver.date_engaged.slice(0, 10) : '',
    address:             driver.address || '',
    is_active:           driver.is_active,
    exclude_mine_bonus:  driver.exclude_mine_bonus || false,
    notes:               driver.notes || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title="Edit Driver" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--col-2)', gap: '12px 16px' }}>
        <div>
          <label className="form-label">Entity</label>
          <select className="form-input" value={form.entity_id} onChange={e => set('entity_id', parseInt(e.target.value))}>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Driver Type</label>
          <select className="form-input" value={form.driver_type} onChange={e => set('driver_type', e.target.value)}>
            <option value="casual">Casual</option>
            <option value="permanent">Permanent</option>
          </select>
        </div>
        <div>
          <label className="form-label">First Name *</label>
          <input className="form-input" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Last Name *</label>
          <input className="form-input" value={form.last_name} onChange={e => set('last_name', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Employee Number</label>
          <input className="form-input" value={form.employee_number} onChange={e => set('employee_number', e.target.value)} />
        </div>
        <div>
          <label className="form-label">ID Number</label>
          <input className="form-input" value={form.id_number} onChange={e => set('id_number', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Tax Number</label>
          <input className="form-input" value={form.tax_number} onChange={e => set('tax_number', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Bank Name</label>
          <input className="form-input" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Account Number</label>
          <input className="form-input" value={form.bank_account_number} onChange={e => set('bank_account_number', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Branch Code</label>
          <input className="form-input" value={form.branch_code} onChange={e => set('branch_code', e.target.value)} placeholder="e.g. 470010" />
        </div>
        <div>
          <label className="form-label">Job Title</label>
          <input className="form-input" value={form.job_title} onChange={e => set('job_title', e.target.value)} placeholder="e.g. Code 14 Driver" />
        </div>
        <div>
          <label className="form-label">Date Engaged</label>
          <input type="date" className="form-input" value={form.date_engaged} onChange={e => set('date_engaged', e.target.value)} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="form-label">Employee Address</label>
          <textarea className="form-input" value={form.address} onChange={e => set('address', e.target.value)} rows={3} style={{ resize: 'vertical' }} placeholder="Street, Suburb, City, Postal Code" />
        </div>
        <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="edit-active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
          <label htmlFor="edit-active" className="form-label" style={{ margin: 0 }}>Active</label>
        </div>
        <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="edit-exclude-bonus" checked={form.exclude_mine_bonus} onChange={e => set('exclude_mine_bonus', e.target.checked)} />
          <label htmlFor="edit-exclude-bonus" className="form-label" style={{ margin: 0 }}>Exclude Mine (Assmang) bonus — never pay the per-load bonus to this driver</label>
        </div>
      </div>
      <label className="form-label" style={{ marginTop: 12 }}>Notes</label>
      <textarea className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: 1 }} onClick={() => {
          if (!form.first_name.trim() || !form.last_name.trim()) { toast.error('Name required'); return }
          // Empty optional date must be null, not '' (the backend rejects '' → 422)
          onSave({ ...form, date_engaged: form.date_engaged || null })
        }}>Save</button>
      </div>
    </Modal>
  )
}

const mStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  panel:   { background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--shadow-lg)' },
  header:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  body:    { padding: '20px' },
}
