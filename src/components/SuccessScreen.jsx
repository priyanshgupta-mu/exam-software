import styles from './SuccessScreen.module.css'

export default function SuccessScreen({ user, answeredCount, totalCount, violations }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <h2>Exam Submitted!</h2>
        <p>Your answers have been recorded. You may close this window.</p>
        <div className={styles.summary}>
          <div><span>Student</span><strong>{user.name}</strong></div>
          <div><span>Answered</span><strong>{answeredCount} / {totalCount}</strong></div>
          <div><span>Violations</span><strong>{violations}</strong></div>
          <div><span>Submitted at</span><strong>{new Date().toLocaleTimeString()}</strong></div>
        </div>
      </div>
    </div>
  )
}
