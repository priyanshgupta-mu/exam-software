import styles from './ViolationOverlay.module.css'

export default function ViolationOverlay({ title, message, count, maxViolations, onResume }) {
  const autoSubmit = count >= maxViolations

  return (
    <div className={styles.overlay}>
      <div className={styles.box}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className={styles.count}>
          Violations: <strong>{count}</strong> / {maxViolations}
        </div>
        {autoSubmit
          ? <p className={styles.autoMsg}>Exam will be auto-submitted…</p>
          : <button className={styles.btnResume} onClick={onResume}>Resume Exam</button>
        }
      </div>
    </div>
  )
}
