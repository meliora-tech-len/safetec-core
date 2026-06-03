import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { Lock, Mail, Loader, Eye, EyeOff } from 'lucide-react'
import { errorMessage } from '../utils/helpers'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      toast.error(errorMessage(err, 'Invalid credentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>S</div>
          <h1 style={styles.title}>safetec_core</h1>
          <p style={styles.sub}>Business Management System</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div className="form-group">
            <label>Email Address</label>
            <div style={styles.inputWrap}>
              <Mail size={15} style={styles.inputIcon} />
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@safetec.co.za"
                required autoFocus
                style={{ paddingLeft: 36 }}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Password</label>
            <div style={styles.inputWrap}>
              <Lock size={15} style={styles.inputIcon} />
              <input
                type={showPw ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{ paddingLeft: 36, paddingRight: 36 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                style={styles.eyeBtn}
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}
            style={{ justifyContent: 'center', height: 42, marginTop: 8 }}>
            {loading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Signing in...</> : 'Sign In'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <Link to="/forgot-password" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Forgot password?
            </Link>
          </div>
        </form>
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
    position: 'absolute', right: 10, top: '50%',
    transform: 'translateY(-50%)', background: 'none', border: 'none',
    cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex',
  },
}
