import { useState } from 'react'
import styles from './Login.module.css'

const DEMO_USERS = [
  { studentId: 'STU-2024-001', password: 'exam123', name: 'Alice Johnson', examCode: 'EXAM001' },
  { studentId: 'STU-2024-002', password: 'exam123', name: 'Bob Smith',     examCode: 'EXAM001' },
]

export default function Login({ onLogin }) {
  const [form, setForm] = useState({
    studentId: 'STU-2024-001',
    password:  'exam123',
    examCode:  'EXAM001',
  })
  const [showPwd, setShowPwd] = useState(false)
  const [error,   setError]   = useState('')

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    const user = DEMO_USERS.find(
      u =>
        u.studentId === form.studentId.trim() &&
        u.password  === form.password &&
        u.examCode  === form.examCode.trim().toUpperCase()
    )
    if (!user) { setError('Invalid credentials. Please try again.'); return }
    setError('')
    onLogin(user)
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#1e3a5f"/>
            <path d="M14 34V18l10-8 10 8v16H14z" fill="none" stroke="#fff" strokeWidth="2"/>
            <rect x="20" y="26" width="8" height="8" rx="1" fill="#fff"/>
            <circle cx="36" cy="14" r="6" fill="#e74c3c"/>
            <path d="M33.5 14h5M36 11.5v5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>

        <h1 className={styles.title}>ProctorExam</h1>
        <p className={styles.subtitle}>Secure Online Examination System</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.group}>
            <label>Student ID</label>
            <input
              type="text"
              value={form.studentId}
              onChange={set('studentId')}
              autoComplete="off"
              required
            />
          </div>

          <div className={styles.group}>
            <label>Password</label>
            <div className={styles.pwdWrapper}>
              <input
                type={showPwd ? 'text' : 'password'}
                value={form.password}
                onChange={set('password')}
                required
              />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowPwd(v => !v)}>
                {showPwd
                  ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          <div className={styles.group}>
            <label>Exam Code</label>
            <input
              type="text"
              value={form.examCode}
              onChange={set('examCode')}
              autoComplete="off"
              required
            />
          </div>

          <div className={styles.notice}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>Camera access is required. Tab switching and copy-paste are disabled during the exam.</span>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.btnLogin}>
            Start Exam
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </form>

        <p className={styles.demoHint}>
          Demo credentials are pre-filled — just click <strong>Start Exam</strong>.
        </p>
      </div>
    </div>
  )
}
