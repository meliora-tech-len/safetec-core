import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, CheckCheck, Lock, AlertTriangle, ShieldCheck } from 'lucide-react'

/**
 * 3-step verification cell.
 *
 * Props:
 *   item          — record with verified/is_verified, verified_by, verified2_by, verified3_by,
 *                   and their _initials / _date display fields
 *   onVerify      — async fn for steps 1 & 2
 *   onFinalize    — async fn for step 3 (admin final lock); omit to hide step-3 row
 *   disabled      — always disable
 *   currentUserId — logged-in user's ID
 *   isAdmin       — whether logged-in user is admin
 *
 * Lock rules:
 *   Step 3 done → existing ticks locked (only the step-3 admin can undo the lock),
 *                 but a user without a tick can still add theirs to an empty step.
 *   Step 2 done → only the step-2 user can undo it.
 *   Step 1 done → the step-1 user can undo it; any other user can add step 2.
 */
export default function VerifyBadge({
  item, onVerify, onFinalize, disabled = false, currentUserId, isAdmin = false,
  adminFinalizeAnytime = false,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [undoFinalizeOpen, setUndoFinalizeOpen] = useState(false)

  const step1Done = !!(item.verified || item.is_verified)
  const step2Done = !!(item.verified2_by || item.verified2_by_initials)
  const step3Done = !!(item.verified3_by || item.verified3_by_initials)

  const isOwnStep1 = step1Done && item.verified_by === currentUserId
  const isOwnStep2 = step2Done && item.verified2_by === currentUserId
  const isOwnStep3 = step3Done && item.verified3_by === currentUserId
  // A user without a tick can always add theirs to an empty step — even after
  // the final lock (the lock freezes existing ticks and values, not new ticks)
  const canAddStep2 = step1Done && !step2Done && item.verified_by !== currentUserId
  const canAddTick = !step1Done || canAddStep2
  const isUndo = !step3Done && (isOwnStep1 || isOwnStep2)

  const isSteps12Locked = disabled || (
    step3Done
      ? !canAddTick
      : step2Done ? !isOwnStep2 : step1Done ? (!isOwnStep1 && !canAddStep2) : false
  )

  const canDoStep3 = !!onFinalize && isAdmin && !step3Done && (step1Done || adminFinalizeAnytime)
  const showStep3Row = !!onFinalize && (step3Done || (isAdmin && (step1Done || adminFinalizeAnytime)))

  const badge = (initials, date) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
      color: 'var(--text-muted)', whiteSpace: 'nowrap',
    }}>
      {initials} · {date}
    </span>
  )

  const steps12Tooltip = !step1Done
    ? 'Click to verify (step 1)'
    : !step2Done
      ? isOwnStep1
        ? step3Done ? 'Locked by final approval' : 'Undo your verification'
        : canAddStep2
          ? 'Click to add your verification (step 2)'
          : `Verified by ${item.verified_by_initials || '?'} — locked`
      : isOwnStep2
        ? step3Done ? 'Locked by final approval' : 'Undo your step 2 verification'
        : step3Done ? 'Locked by final approval' : 'Verified — locked'

  const step3Tooltip = (!step1Done && !adminFinalizeAnytime)
    ? 'Requires at least one verification first'
    : step3Done
      ? isOwnStep3 ? 'Undo final lock' : 'Final lock — locked'
      : 'Click to apply final admin lock'

  const handleClick = (e) => {
    e.stopPropagation()
    if (isSteps12Locked) return
    if (isUndo) { setConfirmOpen(true); return }
    onVerify(item)
  }

  const handleConfirm = (e) => {
    e.stopPropagation()
    setConfirmOpen(false)
    onVerify(item)
  }

  const handleFinalizeClick = (e) => {
    e.stopPropagation()
    if (step3Done && isOwnStep3) { setUndoFinalizeOpen(true); return }
    if (canDoStep3) { setFinalizeOpen(true); return }
  }

  // Keyboard: Enter on the focused final-lock control applies the lock directly,
  // no confirmation dialog (per heavy-keyboard-use request). Undo still confirms.
  const handleFinalizeKeyDown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    if (canDoStep3) { onFinalize(item); return }
    if (step3Done && isOwnStep3) setUndoFinalizeOpen(true)
  }

  const handleFinalizeConfirm = (e) => {
    e.stopPropagation()
    setFinalizeOpen(false)
    onFinalize(item)
  }

  const handleUndoFinalizeConfirm = (e) => {
    e.stopPropagation()
    setUndoFinalizeOpen(false)
    onFinalize(item)
  }

  const handleCancel = (e) => {
    e.stopPropagation()
    setConfirmOpen(false)
    setFinalizeOpen(false)
    setUndoFinalizeOpen(false)
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>

        {/* Steps 1 & 2 */}
        <div
          onClick={handleClick}
          title={steps12Tooltip}
          style={{
            cursor: isSteps12Locked ? 'default' : 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
            opacity: isSteps12Locked && step1Done ? 0.7 : 1,
          }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle size={15} style={{ color: step1Done ? '#16a34a' : 'var(--border)', flexShrink: 0 }} />
            {step1Done && item.verified_by_initials
              ? badge(item.verified_by_initials, item.verified_by_date)
              : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Step 1</span>
            }
            {step1Done && !step2Done && isSteps12Locked && !step3Done && (
              <Lock size={9} style={{ color: 'var(--text-muted)', marginLeft: 2 }} />
            )}
          </div>

          {step1Done && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {step2Done
                ? <CheckCheck size={15} style={{ color: '#16a34a', flexShrink: 0 }} />
                : <CheckCircle size={15} style={{ color: 'var(--border)', flexShrink: 0 }} />
              }
              {step2Done && item.verified2_by_initials
                ? badge(item.verified2_by_initials, item.verified2_by_date)
                : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Step 2</span>
              }
              {step2Done && isSteps12Locked && !step3Done && (
                <Lock size={9} style={{ color: 'var(--text-muted)', marginLeft: 2 }} />
              )}
            </div>
          )}
        </div>

        {/* Step 3 — final admin lock */}
        {showStep3Row && (
          <div
            onClick={handleFinalizeClick}
            onKeyDown={(canDoStep3 || isOwnStep3) ? handleFinalizeKeyDown : undefined}
            tabIndex={(canDoStep3 || isOwnStep3) ? 0 : undefined}
            title={(canDoStep3 ? 'Press Enter to apply final lock — ' : '') + step3Tooltip}
            style={{
              cursor: (canDoStep3 || isOwnStep3) ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', gap: 4, marginTop: 1,
              borderRadius: 4,
              opacity: step3Done ? 1 : canDoStep3 ? 0.75 : 0.35,
            }}>
            <ShieldCheck
              size={13}
              style={{ color: step3Done ? '#7c3aed' : 'var(--accent)', flexShrink: 0 }}
            />
            {step3Done && item.verified3_by_initials
              ? badge(item.verified3_by_initials, item.verified3_by_date)
              : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {step3Done ? 'Locked' : 'Final Verification'}
                </span>
            }
          </div>
        )}
      </div>

      {(confirmOpen || finalizeOpen || undoFinalizeOpen) && createPortal(
      <>
      {/* Unverify steps 1/2 */}
      {confirmOpen && (
        <div className="modal-overlay" onClick={handleCancel} style={{ zIndex: 1000 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Remove Verification</span>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <div style={{ padding: '12px 14px', borderRadius: 6, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Are you sure you want to <strong>remove this verification</strong>?
                {isOwnStep2 ? ' The record will revert to step 1 only.' : ' The record will be marked as unverified.'}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
              <button onClick={handleConfirm} style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: '#d97706', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Remove Verification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply final lock */}
      {finalizeOpen && (
        <div className="modal-overlay" onClick={handleCancel} style={{ zIndex: 1000 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <ShieldCheck size={18} color="#7c3aed" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Apply Final Lock</span>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <div style={{ padding: '12px 14px', borderRadius: 6, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                This will <strong>lock the record permanently</strong>. No edits or verification changes will be possible afterwards — only you will be able to reverse this.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
              <button onClick={handleFinalizeConfirm} style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Apply Final Lock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo final lock */}
      {undoFinalizeOpen && (
        <div className="modal-overlay" onClick={handleCancel} style={{ zIndex: 1000 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Remove Final Lock</span>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <div style={{ padding: '12px 14px', borderRadius: 6, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Are you sure you want to <strong>remove the final lock</strong>? The record will become editable again (existing step 1/2 verifications are kept).
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
              <button onClick={handleUndoFinalizeConfirm} style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: '#d97706', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Remove Final Lock
              </button>
            </div>
          </div>
        </div>
      )}
      </>,
      document.body
      )}
    </>
  )
}
