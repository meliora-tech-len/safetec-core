import { MONTHS_LONG_0 } from '../utils/helpers'

const thisYear = new Date().getFullYear()
const YEARS = Array.from({ length: 6 }, (_, i) => thisYear - i)

export const defaultFinancialPeriod = () => {
  const d = new Date()
  return { mode: 'month', month: d.getMonth() + 1, year: d.getFullYear() }
}

/** Human-readable label for the selected period, for export titles etc. */
export const financialPeriodLabel = (p) =>
  p.mode === 'lifetime' ? 'Lifetime'
  : p.mode === 'year' ? String(p.year)
  : `${MONTHS_LONG_0[p.month - 1]} ${p.year}`

/**
 * Monthly / Yearly / Lifetime period selector for the overview financial
 * columns (Suppliers, Subcontractors). `value` is
 * { mode: 'month'|'year'|'lifetime', month, year }.
 */
export default function FinancialPeriodFilter({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch })
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select value={value.mode} onChange={e => set({ mode: e.target.value })} style={{ width: 110 }}>
        <option value="month">Monthly</option>
        <option value="year">Yearly</option>
        <option value="lifetime">Lifetime</option>
      </select>
      {value.mode === 'month' && (
        <select value={value.month} onChange={e => set({ month: Number(e.target.value) })} style={{ width: 120 }}>
          {MONTHS_LONG_0.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      )}
      {value.mode !== 'lifetime' && (
        <select value={value.year} onChange={e => set({ year: Number(e.target.value) })} style={{ width: 90 }}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
    </div>
  )
}
