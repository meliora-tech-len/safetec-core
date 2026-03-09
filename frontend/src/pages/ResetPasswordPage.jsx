import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { resetPassword } from '../services/api'
import { Lock, Eye, EyeOff, ArrowLeft, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const passwordsMatch = confirm.length > 0 && password === confirm
  const passwordsMismatch = confirm.length > 0 && password !== confirm

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) {
      toast.error('Passwords do not match')
      return
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      await resetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Reset failed. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logo}>
            <div style={styles.logoIcon}>S</div>
            <h1 style={styles.title}>Invalid Link</h1>
            <p style={styles.sub}>This reset link is missing or invalid.</p>
          </div>
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link to="/forgot-password" style={{ fontSize: 13, color: 'var(--accent)' }}>
              Request a new reset link
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>S</div>
          <h1 style={styles.title}>Reset Password</h1>
          <p style={styles.sub}>
            {done ? 'Password updated successfully.' : 'Enter your new password below.'}
          </p>
        </div>

        {done ? (
          <div style={styles.successBox}>
            <CheckCircle size={32} color="var(--accent)" style={{ margin: '0 auto 12px', display: 'block' }} />
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, textAlign: 'center', lineHeight: 1.6 }}>
              Your password has been updated. Redirecting you to sign in...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <div className="form-group">
              <label>New Password</label>
              <div style={styles.inputWrap}>
                <Lock size={15} style={styles.inputIcon} />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  required autoFocus minLength={8}
                  style={{ paddingLeft: 36, paddingRight: 36 }}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} style={styles.eyeBtn}>
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <div style={styles.inputWrap}>
                <Lock size={15} style={styles.inputIcon} />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat new password"
                  required
                  style={{ paddingLeft: 36, paddingRight: 36 }}
                />
                <button type="button" onClick={() => setShowConfirm(v => !v)} style={styles.eyeBtn}>
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {passwordsMatch && (
                <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>✓ Passwords match</p>
              )}
              {passwordsMismatch && (
                <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>Passwords do not match</p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}
              style={{ justifyContent: 'center', height: 42, marginTop: 8 }}>
              {loading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Updating...</> : 'Set New Password'}
            </button>
          </form>
        )}

        {!done && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link to="/login" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ArrowLeft size={13} /> Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg-base)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
  },
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '40px 36px',
    width: '100%', maxWidth: 400,
    boxShadow: 'var(--shadow)',
  },
  logo: { textAlign: 'center', marginBottom: 32 },
  logoIcon: {
    width: 56, height: 56, borderRadius: 14,
    background: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 900, fontSize: 26, color: 'white',
    margin: '0 auto 14px',
  },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 13, color: 'var(--text-secondary)' },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  inputWrap: { position: 'relative' },
  inputIcon: {
    position: 'absolute', left: 10, top: '50%',
    transform: 'translateY(-50%)', color: 'var(--text-muted)',
    pointerEvents: 'none',
  },
  eyeBtn: {
    position: 'absolute', right: 8, top: '50%',
    transform: 'translateY(-50%)', background: 'none', border: 'none',
    cursor: 'pointer', color: 'var(--text-muted)', padding: 2,
    display: 'flex', alignItems: 'center',
  },
  successBox: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '20px 18px',
  },
}
