import styles from './CameraOverlay.module.css'

export default function CameraOverlay({ onAllow, error }) {
  if (error === 'denied') {
    return (
      <div className={styles.overlay}>
        <div className={styles.errorCard}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ color: '#dc2626' }}>Camera Access Blocked</h2>
          <p>Chrome has blocked camera access. To fix it:</p>
          <ol className={styles.steps}>
            <li>Click the <strong>camera icon</strong> in the address bar</li>
            <li>Set Camera &amp; Microphone to <strong>Allow</strong></li>
            <li>Reload the page</li>
          </ol>
          <button className={styles.btnAllow} onClick={() => window.location.reload()}>
            Reload &amp; Try Again
          </button>
        </div>
      </div>
    )
  }

  if (error === 'busy') {
    return (
      <div className={styles.overlay}>
        <div className={styles.errorCard}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />


            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ color: '#d97706' }}>Camera In Use</h2>
          <p>Your camera is being used by another application (Zoom, Teams, etc.).</p>
          <ol className={styles.steps}>
            <li>Close all other apps using the camera</li>
            <li>Click Try Again below</li>
          </ol>
          <button className={styles.btnAllow} onClick={onAllow}>Try Again</button>
        </div>
      </div>
    )
  }

  // ── Default: pre-exam disclaimer ─────────────────────────────────────────
  return (
    <div className={styles.overlay}>
      <div className={styles.disclaimer}>

        {/* Header */}
        <div className={styles.disclaimerHeader}>
          <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="10" fill="#1e3a5f" />
            <path d="M14 34V18l10-8 10 8v16H14z" fill="none" stroke="#fff" strokeWidth="2" />
            <rect x="19" y="24" width="4" height="10" fill="#fff" />
            <rect x="25" y="24" width="4" height="10" fill="#fff" />
          </svg>
          <div>
            <h1 className={styles.disclaimerTitle}>Before You Begin</h1>
            <p className={styles.disclaimerSub}>Read the exam rules carefully before enabling your camera</p>
          </div>
        </div>

        <div className={styles.disclaimerBody}>

          {/* Camera requirement banner */}
          <div className={styles.cameraBanner}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1e3a5f" strokeWidth="2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            <span>
              <strong>Camera &amp; microphone are required.</strong> The exam will not start until they are enabled and working.
            </span>
          </div>

          {/* Rules grid */}
          <div className={styles.rulesGrid}>
            <Rule icon="👁" label="You must be visible in the camera at all times." />
            <Rule icon="🎯" label="Keep your eyes focused on the screen. Eye gaze is tracked — looking away triggers a warning." />
            <Rule icon="👤" label="Only you may be present — no other person in the room." />
            <Rule icon="🔇" label="You must be in a quiet environment. No talking allowed." />
            <Rule icon="💡" label="Ensure your face is well-lit and clearly visible." />
            <Rule icon="⌨️" label="Keyboard shortcuts, alt-tab and screenshots are blocked." />
            <Rule icon="📵" label="No phones, notes, or extra screens — including below your laptop." />
            <Rule icon="🚫" label="Do not let anyone show you answers or hold objects near the camera." />
            <Rule icon="⚠️" label="3 violations will result in automatic submission." />
            <Rule icon="⏱" label="The exam is timed. It auto-submits when time expires." />
          </div>

          <p className={styles.consentText}>
            By clicking <strong>Enable Camera &amp; Start Exam</strong> you confirm you have read and agree to these rules.
            All activity is recorded for review.
          </p>
        </div>

        <div className={styles.disclaimerFooter}>
          <button onClick={onAllow} className={styles.btnStart}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Enable Camera &amp; Start Exam
          </button>
          <p className={styles.footerNote}>
            Camera feed is used for live proctoring only. It is not recorded or stored.
          </p>
        </div>

      </div>
    </div>
  )
}

function Rule({ icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.5 }}>{label}</span>
    </div>
  )
}
