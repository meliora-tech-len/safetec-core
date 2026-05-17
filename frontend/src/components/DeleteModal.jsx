import { useState } from 'react'
import { AlertTriangle, Archive, Trash2 } from 'lucide-react'

/**
 * Reusable deletion modal with two modes:
 *   - Archive (soft delete) — marks the record as void, keeps it in DB
 *   - Permanent delete     — removes from DB; requires typing "DELETE"
 *
 * Props:
 *   isOpen        boolean
 *   onClose       () => void          — called by Cancel / overlay click
 *   onArchive     () => Promise<void> — null = hide archive option
 *   onDelete      () => Promise<void> — null = hide permanent option
 *   title         string              — e.g. "Delete Truck Load"
 *   description   string | node       — optional detail shown to user
 *   saving        boolean             — disables buttons during API call
 */
export default function DeleteModal({
  isOpen,
  onClose,
  onArchive = null,
  onDelete  = null,
  title     = 'Delete Record',
  description,
  saving    = false,
}) {
  const [mode, setMode]              = useState(null)   // null | 'archive' | 'delete'
  const [confirmText, setConfirmText] = useState('')

  if (!isOpen) return null

  const showBothOptions  = onArchive && onDelete
  const deleteConfirmed  = confirmText.trim().toUpperCase() === 'DELETE'

  const reset = () => { setMode(null); setConfirmText('') }

  const handleClose = () => { reset(); onClose() }

  const handleArchive = async () => { await onArchive?.(); handleClose() }
  const handleDelete  = async () => { await onDelete?.();  handleClose() }

  // When there's only one option, skip mode selection and go straight to confirmation
  const archiveOnly = onArchive && !onDelete
  const deleteOnly  = onDelete  && !onArchive

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

          {/* Both options: show picker when no mode selected yet */}
          {showBothOptions && !mode && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                Choose how to delete this record:
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button onClick={() => setMode('archive')} style={optionBtn('#d97706', 'rgba(217,119,6,0.08)')}>
                  <Archive size={20} color="#d97706" style={{ marginBottom: 8, flexShrink: 0 }} />
                  <strong style={{ fontSize: 13, marginBottom: 4 }}>Archive</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    Keeps the record but marks it as void. Excluded from reports and calculations.
                  </span>
                </button>
                <button onClick={() => setMode('delete')} style={optionBtn('#dc2626', 'rgba(220,38,38,0.08)')}>
                  <Trash2 size={20} color="#dc2626" style={{ marginBottom: 8, flexShrink: 0 }} />
                  <strong style={{ fontSize: 13, marginBottom: 4 }}>Permanently Delete</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    Removes completely from the database. Cannot be undone.
                  </span>
                </button>
              </div>
            </>
          )}

          {/* Archive-only: straight to confirmation */}
          {archiveOnly && (
            <div style={warningBox('#d97706')}>
              This record will be <strong>archived</strong>. It stays in the database but is excluded from all reports, calculations, and payroll.
            </div>
          )}

          {/* Archive mode selected (from picker) */}
          {showBothOptions && mode === 'archive' && (
            <div style={warningBox('#d97706')}>
              This record will be <strong>archived</strong>. It stays in the database but is excluded from all reports, calculations, and payroll.
            </div>
          )}

          {/* Delete-only: skip picker, show typing field immediately */}
          {deleteOnly && (
            <>
              <div style={{ ...warningBox('#dc2626'), marginBottom: 14 }}>
                This will <strong>permanently remove</strong> the record from the database and cannot be undone.
              </div>
              <DeleteConfirmField value={confirmText} onChange={setConfirmText} />
            </>
          )}

          {/* Delete mode selected (from picker) */}
          {showBothOptions && mode === 'delete' && (
            <>
              <div style={{ ...warningBox('#dc2626'), marginBottom: 14 }}>
                This will <strong>permanently remove</strong> the record from the database and cannot be undone.
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

            {/* Archive-only confirm */}
            {archiveOnly && (
              <ActionBtn color="#d97706" onClick={handleArchive} disabled={saving}>
                {saving ? 'Archiving…' : 'Archive Record'}
              </ActionBtn>
            )}

            {/* Archive mode confirm */}
            {showBothOptions && mode === 'archive' && (
              <ActionBtn color="#d97706" onClick={handleArchive} disabled={saving}>
                {saving ? 'Archiving…' : 'Archive Record'}
              </ActionBtn>
            )}

            {/* Delete-only confirm */}
            {deleteOnly && (
              <ActionBtn color="#dc2626" onClick={handleDelete} disabled={saving || !deleteConfirmed}>
                {saving ? 'Deleting…' : 'Permanently Delete'}
              </ActionBtn>
            )}

            {/* Delete mode confirm */}
            {showBothOptions && mode === 'delete' && (
              <ActionBtn color="#dc2626" onClick={handleDelete} disabled={saving || !deleteConfirmed}>
                {saving ? 'Deleting…' : 'Permanently Delete'}
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
        Type <strong style={{ color: 'var(--danger)', fontFamily: 'monospace' }}>DELETE</strong> to confirm permanent deletion
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
