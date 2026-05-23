import { CheckCircle, CheckCheck, Lock } from 'lucide-react'

/**
 * 2-step verification cell.
 *
 * Props:
 *   item          — record with verified/is_verified, verified_by (int), verified2_by (int),
 *                   verified_by_initials, verified_by_date, verified2_by_initials, verified2_by_date
 *   onVerify      — async fn called when clickable; receives the item
 *   disabled      — always disable (e.g. while saving)
 *   currentUserId — the logged-in user's ID (int)
 *   isAdmin       — whether the logged-in user is an admin
 *
 * Lock rules:
 *   Step 1 done: only the person who did step 1 OR a different admin can click.
 *   Step 2 done: only the person who did step 2 can click (to undo their own).
 */
export default function VerifyBadge({ item, onVerify, disabled = false, currentUserId, isAdmin = false }) {
  const step1Done = !!(item.verified || item.is_verified)
  const step2Done = !!(item.verified2_by || item.verified2_by_initials)

  // Compute whether the current user can interact
  const isOwnStep1 = step1Done && item.verified_by === currentUserId
  const isOwnStep2 = step2Done && item.verified2_by === currentUserId
  const canClickStep2 = isAdmin && item.verified_by !== currentUserId
  const isLocked = disabled || (
    step2Done ? !isOwnStep2
              : step1Done ? (!isOwnStep1 && !canClickStep2)
                          : false
  )

  const badge = (initials, date) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
      color: 'var(--text-muted)', whiteSpace: 'nowrap',
    }}>
      {initials} · {date}
    </span>
  )

  const tooltip = !step1Done
    ? 'Click to verify (step 1 of 2)'
    : !step2Done
      ? isOwnStep1
        ? 'Undo your verification'
        : canClickStep2
          ? 'Click to approve (step 2 of 2)'
          : `Verified by ${item.verified_by_initials || '?'} — locked`
      : isOwnStep2
        ? 'Undo your step 2 approval'
        : `Fully verified — locked`

  const isUndo = isOwnStep1 || isOwnStep2

  const handleClick = (e) => {
    e.stopPropagation()
    if (isLocked) return
    if (isUndo && !window.confirm('Are you sure you want to remove this verification?')) return
    onVerify(item)
  }

  return (
    <div
      onClick={handleClick}
      title={tooltip}
      style={{
        cursor: isLocked ? 'default' : 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
        opacity: isLocked && step1Done ? 0.7 : 1,
      }}>

      {/* Step 1 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <CheckCircle size={15} style={{ color: step1Done ? '#16a34a' : 'var(--border)', flexShrink: 0 }} />
        {step1Done && item.verified_by_initials
          ? badge(item.verified_by_initials, item.verified_by_date)
          : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Step 1</span>
        }
        {step1Done && !step2Done && isLocked && (
          <Lock size={9} style={{ color: 'var(--text-muted)', marginLeft: 2 }} />
        )}
      </div>

      {/* Step 2 — only show once step 1 is done */}
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
          {step2Done && isLocked && (
            <Lock size={9} style={{ color: 'var(--text-muted)', marginLeft: 2 }} />
          )}
        </div>
      )}
    </div>
  )
}
