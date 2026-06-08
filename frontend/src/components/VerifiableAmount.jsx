import VerifyBadge from './VerifyBadge'

/**
 * Inline per-value verification — reuses the exact Supplier-Invoice VerifyBadge
 * (click the step icons directly: Step 1 verify → Step 2 approve → Final lock),
 * attached to a single value via the generic /api/verifications overlay.
 * The value itself is highlighted yellow once the owner (step 3) locks it.
 *
 * Props:
 *   target, children (formatted amount), state (verification map entry or undefined),
 *   onVerify(target), onFinalize(target), currentUserId, isAdmin, align
 *   inline — lay the badge beside the value (row) instead of underneath (column)
 */
export default function VerifiableAmount({
  target, children, state, onVerify, onFinalize,
  currentUserId, isAdmin = false, align = 'right', inline = false,
}) {
  const lockedDone = !!(state && state.verified3_by)

  const valueStyle = {
    display: 'inline-flex', alignItems: 'center',
    padding: lockedDone ? '0 4px' : 0, borderRadius: 5,
    ...(lockedDone ? { background: 'rgba(245,158,11,0.22)', border: '1px solid rgba(245,158,11,0.7)' } : {}),
  }

  const wrapStyle = inline
    ? { display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6 }
    : { display: 'inline-flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', gap: 2 }

  return (
    <span style={wrapStyle}>
      <span style={valueStyle}>{children}</span>
      <VerifyBadge
        item={state || {}}
        onVerify={() => onVerify(target)}
        onFinalize={() => onFinalize(target)}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        adminFinalizeAnytime
      />
    </span>
  )
}
