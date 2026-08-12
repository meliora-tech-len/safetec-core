import { useEffect, useState } from 'react'
import { Lock, X } from 'lucide-react'

/**
 * Global block screen for the Profit Sheet final lock.
 *
 * Any capture request refused with 423 profit_sheet_locked (truck loads, food
 * allowance, diesel, supplier-invoice expenses…) is caught by the api.js
 * response interceptor, which dispatches a 'profit-sheet-locked' window event
 * with the structured detail. This overlay renders it — one listener instead
 * of teaching every form on every page about the lock.
 */
export default function ProfitSheetLockedModal() {
  const [info, setInfo] = useState(null)

  useEffect(() => {
    const onLocked = (e) => setInfo(e.detail)
    window.addEventListener('profit-sheet-locked', onLocked)
    return () => window.removeEventListener('profit-sheet-locked', onLocked)
  }, [])

  if (!info) return null

  return (
    <div className="modal-overlay" style={{ zIndex: 1200 }}
         onClick={e => e.target === e.currentTarget && setInfo(null)}>
      <div className="modal" style={{ maxWidth: 440, textAlign: 'center' }}>
        <div className="modal-header" style={{ justifyContent: 'flex-end' }}>
          <button className="btn-icon btn-ghost" onClick={() => setInfo(null)}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ paddingTop: 0 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          }}>
            <Lock size={26} style={{ color: 'var(--accent)' }} />
          </div>
          <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>
            {info.period} is final locked{info.reg ? <> for <span style={{ fontFamily: 'monospace' }}>{info.reg}</span></> : null}
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)', margin: 0 }}>
            The Profit Sheet for <strong>{info.period}</strong> has been final locked, so
            nothing more can be captured or changed
            {info.reg ? <> for <strong>{info.reg}</strong></> : null} under this month.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: '12px 0 0' }}>
            To add this record, please ask <strong>{info.admin_name}</strong> to
            remove the final lock on the Profit Sheet report.
          </p>
        </div>
        <div className="modal-footer" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn-primary" onClick={() => setInfo(null)}>OK</button>
        </div>
      </div>
    </div>
  )
}
