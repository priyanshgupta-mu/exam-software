import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { createProctoringClient } from '../lib/proctoringClient'
import styles from './SessionGate.module.css'

/**
 * Sits between Login and Exam.
 * 1. Registers the desktop session with the backend
 * 2. Shows QR code for mobile pairing
 * 3. Waits for admin to emit `exam:start`
 * 4. Hands off to <Exam> with the session context
 */
export default function SessionGate({ user, onStart }) {
  const [status, setStatus] = useState('connecting') // connecting | waiting | starting | error
  const [errorMsg, setErrorMsg] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [mobileUrl, setMobileUrl] = useState('')
  const [mobilePaired, setMobilePaired] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const clientRef = useRef(null)

  useEffect(() => {
    const client = createProctoringClient()
    clientRef.current = client
    let canceled = false

    const onConnect = async () => {
      try {
        const res = await client.register({
          candidateId: user.studentId,
          candidateName: user.name,
          examCode: user.examCode,
        })
        if (canceled) return
        if (!res || res.error) {
          setStatus('error')
          setErrorMsg('Could not register session with proctoring server.')
          return
        }
        setSessionId(res.sessionId)
        setMobileUrl(res.mobileUrl)
        const png = await QRCode.toDataURL(res.mobileUrl, { margin: 1, scale: 6, color: { dark: '#0a0a0a', light: '#ffffff' } })
        if (!canceled) setQrDataUrl(png)
        setStatus('waiting')
      } catch (e) {
        setStatus('error')
        setErrorMsg(e?.message || 'Failed to register session.')
      }
    }

    client.socket.on('connect', onConnect)
    client.socket.on('connect_error', (err) => {
      setStatus('error')
      setErrorMsg(
        `Cannot reach proctoring server at ${client.serverUrl}. ` +
        `If this is a cloud deploy on a free plan, it may be cold-starting (wait ~30s and reload). ` +
        `Details: ${err?.message || 'connect_error'}`
      )
    })
    client.socket.on('mobile:paired', () => setMobilePaired(true))
    client.socket.on('mobile:disconnected', () => setMobilePaired(false))
    client.socket.on('exam:start', ({ sessionId: sid }) => {
      setStatus('starting')
      // Hand the live client to the parent; it will feed Exam the session context
      onStart({ sessionId: sid, client })
    })

    return () => {
      canceled = true
      // Client stays alive — parent takes ownership once exam starts.
      // If the gate unmounts before hand-off (e.g. error path), close it here.
      if (clientRef.current && status !== 'starting') {
        // Don't close on "starting" — Exam needs it
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="10" fill="#1e3a5f"/>
            <path d="M14 34V18l10-8 10 8v16H14z" fill="none" stroke="#fff" strokeWidth="2"/>
            <rect x="20" y="26" width="8" height="8" rx="1" fill="#fff"/>
          </svg>
          <span>ProctorExam</span>
        </div>

        <h1 className={styles.title}>
          {status === 'connecting' && 'Connecting to proctoring server…'}
          {status === 'waiting' && 'Waiting for proctor to start the exam'}
          {status === 'starting' && 'Starting exam…'}
          {status === 'error' && 'Could not connect'}
        </h1>

        <div className={styles.userRow}>
          <span>{user.name}</span>
          <span className={styles.divider}>|</span>
          <span>Exam <strong>{user.examCode}</strong></span>
        </div>

        {status === 'error' && (
          <div className={styles.error}>{errorMsg}</div>
        )}

        {status === 'waiting' && (
          <>
            <div className={styles.stepsRow}>
              <div className={`${styles.step} ${styles.stepDone}`}>
                <span className={styles.stepDot} />
                Desktop connected
              </div>
              <div className={`${styles.step} ${mobilePaired ? styles.stepDone : styles.stepPending}`}>
                <span className={styles.stepDot} />
                Mobile camera {mobilePaired ? 'paired' : 'pending'}
              </div>
              <div className={`${styles.step} ${styles.stepPending}`}>
                <span className={styles.stepDot} />
                Proctor start
              </div>
            </div>

            <div className={styles.qrBlock}>
              <div className={styles.qrBox}>
                {qrDataUrl
                  ? <img src={qrDataUrl} alt="Mobile pairing QR" className={styles.qrImg} />
                  : <div className={styles.qrPlaceholder}>Generating QR…</div>}
              </div>
              <div className={styles.qrHelp}>
                <div className={styles.qrTitle}>Scan to pair your mobile camera</div>
                <div className={styles.qrSub}>
                  Open your phone camera and scan this QR code. Your phone must be on the same Wi‑Fi network.
                </div>
                {mobileUrl && <div className={styles.qrUrl}>{mobileUrl}</div>}
                {sessionId && (
                  <div className={styles.sessionLabel}>
                    Session ID: <code>{sessionId.slice(0, 8)}</code>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className={styles.note}>
          Do not close this window. The exam will begin automatically when the proctor starts it.
        </div>
      </div>
    </div>
  )
}
