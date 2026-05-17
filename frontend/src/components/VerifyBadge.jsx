import { CheckCircle, CheckCheck } from 'lucide-react'

/**
 * 2-step verification cell.
 *
 * Props:
 *   item     — the record (must have is_verified/verified, verified_by_initials,
 *              verified_by_date, verified2_by_initials, verified2_by_date)
 *   onVerify — async fn called when the user clicks; receives the item
 *   disabled — prevent interaction (e.g. while saving)
 *
 * States rendered:
 *   0 steps  → grey circle, clickable → triggers step 1
 *   1 step   → single green check + "LE · 2026.05.10", clickable → triggers step 2
 *   2 steps  → double check + both badges, admin-only click resets
 */
export default function VerifyBadge({ item, onVerify, disabled = false }) {
  // Normalise: diesel uses `verified`, others use `is_verified`
  const step1Done = !!(item.verified || item.is_verified)
  const step2Done = !!(item.verified2_by_initials)

  const badge = (initials, date) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
      color: 'var(--text-muted)', whiteSpace: 'nowrap',
    }}>
      {initials} · {date}
    </span>
  )

  const handleClick = (e) => {
    e.stopPropagation()
    if (!disabled) onVerify(item)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
      onClick={handleClick}
      title={
        !step1Done      ? 'Click to verify (step 1 of 2)' :
        !step2Done      ? 'Click to approve (step 2 of 2 — administrator only, must be a different person)' :
                          'Fully verified — admin can click to reset'
      }
      style={{
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
      }}>

      {/* Step 1 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <CheckCircle
          size={15}
          style={{ color: step1Done ? '#16a34a' : 'var(--border)', flexShrink: 0 }}
        />
        {step1Done && item.verified_by_initials
          ? badge(item.verified_by_initials, item.verified_by_date)
          : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Step 1</span>
        }
      </div>

      {/* Step 2 — only show row once step 1 is done */}
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
        </div>
      )}
    </div>
  )
}
