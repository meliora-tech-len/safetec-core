import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../services/api'
import { Mail, ArrowLeft } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await forgotPassword(email)
    } catch {
      // Always show success to avoid leaking whether the email exists
    } finally {
      setLoading(false)
      setSubmitted(true)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>S</div>
          <h1 style={styles.title}>Forgot Password</h1>
          <p style={styles.sub}>
            {submitted
              ? 'Check your inbox for a reset link.'
              : 'Enter your email and we\'ll send you a reset link.'}
          </p>
        </div>

        {!submitted ? (
          <form onSubmit={handleSubmit} style={styles.form}>
            <div className="form-group">
              <label>Email Address</label>
              <div style={styles.inputWrap}>
                <Mail size={15} style={styles.inputIcon} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required autoFocus
                  style={{ paddingLeft: 36 }}
                />
              </div>
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}
              style={{ justifyContent: 'center', height: 42, marginTop: 8 }}>
              {loading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Sending...</> : 'Send Reset Link'}
            </button>
          </form>
        ) : (
          <div style={styles.successBox}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              If an account exists for <strong>{email}</strong>, a reset link has been sent.
              The link expires in <strong>1 hour</strong>.
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              No email? Check your spam folder, or ask your admin to reset your password.
            </p>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link to="/login" style={{ fontSize: 13, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ArrowLeft size={13} /> Back to sign in
          </Link>
        </div>
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
  successBox: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '16px 18px',
  },
}
