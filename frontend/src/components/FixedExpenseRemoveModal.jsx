import { useState } from 'react'
import { AlertTriangle, CalendarOff, Trash2 } from 'lucide-react'

/**
 * Removal modal for a recurring (FIXED) general expense.
 *
 * A fixed expense carries forward into every later month, so a plain delete of
 * one month's row is re-created by the carry-forward. This modal offers the two
 * removals that actually stick:
 *   - Stop from this month onward — keeps earlier months, ends the recurrence.
 *   - Remove from all months      — wipes every occurrence (requires "DELETE").
 *
 * Props:
 *   isOpen       boolean
 *   onClose      () => void
 *   onForward    () => Promise<void>  — scope='forward'
 *   onAll        () => Promise<void>  — scope='all'
 *   title        string
 *   description  string | node
 *   saving       boolean
 */
export default function FixedExpenseRemoveModal({
  isOpen,
  onClose,
  onForward,
  onAll,
  title = 'Remove Recurring Expense',
  description,
  saving = false,
}) {
  const [mode, setMode]               = useState(null)   // null | 'forward' | 'all'
  const [confirmText, setConfirmText] = useState('')

  if (!isOpen) return null

  const deleteConfirmed = confirmText.trim().toUpperCase() === 'DELETE'
  const reset       = () => { setMode(null); setConfirmText('') }
  const handleClose = () => { reset(); onClose() }
  const handleFwd   = async () => { await onForward?.(); handleClose() }
  const handleAll   = async () => { await onAll?.();     handleClose() }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, padding: 0, overflow: 'hidden' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <AlertTriangle size={18} color="var(--danger)" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '20px 20px' }}>
          {description && (
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {description}
            </p>
          )}

          {!mode && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                This is a recurring expense — choose how to remove it:
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button onClick={() => setMode('forward')} style={optionBtn('#d97706', 'rgba(217,119,6,0.08)')}>
                  <CalendarOff size={20} color="#d97706" style={{ marginBottom: 8, flexShrink: 0 }} />
                  <strong style={{ fontSize: 13, marginBottom: 4 }}>Stop from this month</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    Removes it from this month and stops it carrying into future months. Earlier months are kept.
                  </span>
                </button>
                <button onClick={() => setMode('all')} style={optionBtn('#dc2626', 'rgba(220,38,38,0.08)')}>
                  <Trash2 size={20} color="#dc2626" style={{ marginBottom: 8, flexShrink: 0 }} />
                  <strong style={{ fontSize: 13, marginBottom: 4 }}>Remove all months</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    Permanently deletes every occurrence of this expense across all months. Cannot be undone.
                  </span>
                </button>
              </div>
            </>
          )}

          {mode === 'forward' && (
            <div style={warningBox('#d97706')}>
              This expense will be removed from <strong>this month onward</strong>. Earlier months keep their record;
              it will no longer carry forward into future months.
            </div>
          )}

          {mode === 'all' && (
            <>
              <div style={{ ...warningBox('#dc2626'), marginBottom: 14 }}>
                This will <strong>permanently remove</strong> every occurrence of this recurring expense, in all months,
                and cannot be undone.
              </div>
              <DeleteConfirmField value={confirmText} onChange={setConfirmText} />
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <div>
            {mode && (
              <button className="btn-ghost btn-sm" onClick={reset} disabled={saving}>
                ← Back
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-ghost" onClick={handleClose} disabled={saving}>Cancel</button>

            {mode === 'forward' && (
              <ActionBtn color="#d97706" onClick={handleFwd} disabled={saving}>
                {saving ? 'Removing…' : 'Stop from this month'}
              </ActionBtn>
            )}

            {mode === 'all' && (
              <ActionBtn color="#dc2626" onClick={handleAll} disabled={saving || !deleteConfirmed}>
                {saving ? 'Removing…' : 'Remove All Months'}
              </ActionBtn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmField({ value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
        Type <strong style={{ color: 'var(--danger)', fontFamily: 'monospace' }}>DELETE</strong> to confirm removing all months
      </label>
      <input
        className="form-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="DELETE"
        autoFocus
        style={{ fontFamily: 'monospace', letterSpacing: 1 }}
      />
    </div>
  )
}

function ActionBtn({ color, onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 18px', borderRadius: 7, border: 'none',
        background: disabled ? 'var(--border)' : color,
        color: disabled ? 'var(--text-muted)' : '#fff',
        fontWeight: 600, fontSize: 13,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {children}
    </button>
  )
}

const optionBtn = (color, bg) => ({
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  padding: '14px 16px', borderRadius: 8,
  border: `1px solid ${color}40`, background: bg,
  cursor: 'pointer', textAlign: 'left',
  transition: 'background 0.1s', width: '100%',
})

const warningBox = (color) => ({
  padding: '12px 14px', borderRadius: 6,
  background: `${color}12`,
  border: `1px solid ${color}40`,
  fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55,
})
