import { useState } from 'react'
import { adminLoginHttp } from '../lib/adminClient.js'

export default function Login({ onLogin, pendingConnect, error }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setLocalError('')
    try {
      const token = await adminLoginHttp(username, password)
      if (!token) { setLocalError('Invalid credentials'); return }
      onLogin(token)
    } catch {
      setLocalError('Cannot reach proctoring server on port 4000.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>ProctorExam</span>
          <span className="badge">ADMIN</span>
        </div>
        <h1>Proctor sign in</h1>
        <p className="sub">Central control for all active exam sessions.</p>

        {(error || localError) && <div className="error">{error || localError}</div>}
        {pendingConnect && !error && <div className="sub">Connecting…</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="demo">Default: <code>admin</code> / <code>admin123</code> (set via env vars in production)</div>
      </div>
    </div>
  )
}
