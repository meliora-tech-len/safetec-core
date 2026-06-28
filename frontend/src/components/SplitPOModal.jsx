import { useState, useRef } from 'react'
import { Upload, X, Scissors, AlertCircle, CheckCircle, Loader } from 'lucide-react'
import { splitPoPdf } from '../services/api'

// Read an axios blob error body (the server sends JSON detail even on blob requests).
async function blobErrorMessage(err, fallback) {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const json = JSON.parse(await data.text())
      if (typeof json?.detail === 'string') return json.detail
    } catch { /* fall through */ }
  }
  return fallback
}

export default function SplitPOModal({ onClose }) {
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null) // PO count after a successful split
  const fileRef = useRef(null)

  const handleFile = async (file) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file.')
      return
    }
    setError('')
    setDone(null)
    setBusy(true)
    try {
      const count = await splitPoPdf(file)
      setDone(count)
    } catch (err) {
      setError(await blobErrorMessage(err, 'Failed to split the PO file.'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); if (!busy) handleFile(e.dataTransfer.files[0]) }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scissors size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>Split PO</span>
          </div>
          <button onClick={() => { if (!busy) onClose() }} disabled={busy} style={{ background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(220,38,38,0.08)', color: '#dc2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
          </div>
        )}

        {done != null ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '12px 14px', background: 'rgba(16,185,129,0.08)', borderRadius: 8 }}>
              <CheckCircle size={16} style={{ color: '#059669', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>
                Split into {done} PO{done !== 1 ? 's' : ''} — your ZIP download has started.
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setDone(null); setError('') }}>Split another</button>
              <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Upload the combined PO PDF. Each purchase order is separated into its own PDF and
              downloaded as a ZIP. Nothing is saved — this only splits the file.
            </p>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => { if (!busy) fileRef.current?.click() }}
              style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '40px 20px', textAlign: 'center', cursor: busy ? 'not-allowed' : 'pointer', background: 'var(--bg-secondary)', transition: 'border-color 0.15s' }}
            >
              {busy
                ? <Loader size={28} className="spin" style={{ color: 'var(--accent)', marginBottom: 10 }} />
                : <Upload size={28} style={{ color: 'var(--text-muted)', marginBottom: 10 }} />}
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {busy ? 'Splitting…' : 'Drop PO PDF here or click to browse'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>.pdf</div>
            </div>
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          </>
        )}
      </div>
    </div>
  )
}
