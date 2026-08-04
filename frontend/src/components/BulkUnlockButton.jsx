import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Unlock, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { errorMessage } from '../utils/helpers'

/**
 * "Remove final locks" — the bulk counterpart of the per-record final lock, for
 * the modules whose verification lives on a VerifyBadge / VerifiableAmount per
 * row or per value (payroll, truck load profile, budgets, subcontractors) rather
 * than in a checkbox-driven bulk bar.
 *
 * It sits in a section header and clears the final lock from every locked record
 * in that section — but only the ones THIS admin locked, mirroring the
 * single-record rule in apply_finalize_step (only the admin who applied the lock
 * can reverse it). Records locked by someone else are left alone instead of
 * firing a row of 403 toasts.
 *
 * Props:
 *   items         — the section's records (anything carrying verified3_by), or the
 *                   values of a per-value verification map
 *   onUnlock      — async fn(item) that removes the lock for one item
 *                   (e.g. finalizeValue(item.target, entityId, 'remove')). Let it
 *                   throw on failure — the button reports success/failure itself.
 *   currentUserId — logged-in user's ID
 *   isAdmin       — whether the logged-in user is an admin
 *   noun          — what's being unlocked, for the confirm text ("entry", "value")
 *   nounPlural    — its plural, when adding "s" doesn't work ("entries")
 *   onDone        — optional callback(okCount) once the batch finishes, for pages
 *                   that need to refresh derived totals afterwards
 */
export default function BulkUnlockButton({
  items = [], onUnlock, currentUserId, isAdmin = false,
  noun = 'record', nounPlural, onDone,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const targets = (items || []).filter(i => i && i.verified3_by && i.verified3_by === currentUserId)

  if (!isAdmin || targets.length === 0) return null

  const plural = targets.length === 1 ? noun : (nounPlural || `${noun}s`)

  const run = async () => {
    setConfirmOpen(false)
    setBusy(true)
    let ok = 0
    let firstError = null
    for (const item of targets) {
      try { await onUnlock(item); ok++ }
      catch (e) { firstError = firstError || e }
    }
    setBusy(false)
    if (ok) toast.success(`Final lock removed from ${ok} ${ok === 1 ? noun : (nounPlural || `${noun}s`)}`)
    if (firstError) toast.error(errorMessage(firstError, 'Unlock failed'))
    onDone?.(ok)
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setConfirmOpen(true) }}
        disabled={busy}
        title={`Remove the final lock from all ${targets.length} ${plural} you locked here`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 6,
          border: '1px solid rgba(217,119,6,0.45)', background: 'transparent',
          color: '#d97706', fontWeight: 600, fontSize: 12,
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
        }}>
        <Unlock size={13} />
        {busy ? 'Unlocking…' : `Remove final locks (${targets.length})`}
      </button>

      {confirmOpen && createPortal(
        <div className="modal-overlay" onClick={() => setConfirmOpen(false)} style={{ zIndex: 1000 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Remove Final Locks</span>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <div style={{ padding: '12px 14px', borderRadius: 6, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                This removes the final lock from <strong>{targets.length} {plural}</strong> you locked here.
                They become editable again — existing step 1/2 verifications are kept.
                {' '}Locks applied by another admin are not touched.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button onClick={run} style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: '#d97706', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Remove {targets.length} Final Lock{targets.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
