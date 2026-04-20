import { useState, useEffect, useRef, useCallback } from 'react'
import styles from './HardwareCheck.module.css'

export default function HardwareCheck({ onAllPassed, onBack }) {
  const [cameraOk, setCameraOk] = useState(false)
  const [micOk, setMicOk] = useState(false)
  const [keyboardOk, setKeyboardOk] = useState(false)
  const [speakerOk, setSpeakerOk] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [micLevel, setMicLevel] = useState(0)
  const [keysPressed, setKeysPressed] = useState(new Set())
  const [stream, setStream] = useState(null)
  const [checking, setChecking] = useState(true)

  const videoRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const audioCtxRef = useRef(null)

  // Request camera + mic
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
        setStream(s)
        setCameraOk(true)

        // Check if audio track is live
        const audioTrack = s.getAudioTracks()[0]
        if (audioTrack && audioTrack.readyState === 'live') {
          setMicOk(true)
        }

        // Set up audio analyser
        try {
          const ac = new AudioContext()
          audioCtxRef.current = ac
          const source = ac.createMediaStreamSource(s)
          const analyser = ac.createAnalyser()
          analyser.fftSize = 512
          source.connect(analyser)
          analyserRef.current = analyser
        } catch {}

        setChecking(false)
      } catch (err) {
        if (cancelled) return
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          setCameraError('denied')
        } else {
          setCameraError('unavailable')
        }
        // Try video-only
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
          setStream(s)
          setCameraOk(true)
        } catch {
          setCameraError('denied')
        }
        setChecking(false)
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  // Attach stream to video element
  useEffect(() => {
    if (!stream || !videoRef.current) return
    videoRef.current.srcObject = stream
    videoRef.current.play().catch(() => {})
  }, [stream])

  // Audio level monitoring
  useEffect(() => {
    if (!analyserRef.current) return
    const analyser = analyserRef.current
    const data = new Uint8Array(analyser.frequencyBinCount)
    let micDetected = false

    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      const level = Math.min(100, Math.round(rms * 500))
      setMicLevel(level)

      if (!micDetected && level > 5) {
        micDetected = true
        setMicOk(true)
      }

      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [stream])

  // Keyboard test
  useEffect(() => {
    const onKey = (e) => {
      setKeysPressed(prev => {
        const next = new Set(prev)
        next.add(e.key)
        if (next.size >= 3) setKeyboardOk(true)
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach(t => t.stop())
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    }
  }, [stream])

  // Speaker test
  const testSpeaker = useCallback(() => {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = 440
      gain.gain.value = 0.15
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5)
      osc.stop(ac.currentTime + 0.5)
      setSpeakerOk(true)
    } catch {}
  }, [])

  const allPassed = cameraOk && micOk && keyboardOk && speakerOk

  const handleStart = () => {
    // Stop our preview stream — Exam.jsx will create its own
    stream?.getTracks().forEach(t => t.stop())
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    onAllPassed()
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>

        {/* Header */}
        <div className={styles.header}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1e3a5f" strokeWidth="2">
            <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18"/>
          </svg>
          <div>
            <h1 className={styles.title}>System Check</h1>
            <p className={styles.subtitle}>Verify your hardware before starting the exam</p>
          </div>
        </div>

        <div className={styles.body}>

          {/* Camera Check */}
          <div className={styles.checkSection}>
            <div className={styles.checkHeader}>
              <StatusIcon ok={cameraOk} error={!!cameraError} />
              <div>
                <h3 className={styles.checkTitle}>Camera</h3>
                <p className={styles.checkDesc}>
                  {checking ? 'Requesting access...' :
                   cameraOk ? 'Camera is working properly' :
                   cameraError === 'denied' ? 'Camera access denied. Please allow camera access and reload.' :
                   'Camera unavailable. Please connect a camera.'}
                </p>
              </div>
            </div>
            <div className={styles.preview}>
              {cameraOk ? (
                <video ref={videoRef} className={styles.video} autoPlay playsInline muted />
              ) : (
                <div className={styles.noCamera}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5">
                    <path d="M23 7l-7 5 7 5V7z"/>
                    <rect x="1" y="5" width="15" height="14" rx="2"/>
                    <line x1="1" y1="1" x2="23" y2="23" stroke="#dc2626" strokeWidth="2"/>
                  </svg>
                  <span>No camera detected</span>
                </div>
              )}
            </div>
          </div>

          {/* Microphone Check */}
          <div className={styles.checkSection}>
            <div className={styles.checkHeader}>
              <StatusIcon ok={micOk} />
              <div>
                <h3 className={styles.checkTitle}>Microphone</h3>
                <p className={styles.checkDesc}>
                  {micOk ? 'Microphone detected and working' : 'Speak or make a sound to test your microphone'}
                </p>
              </div>
            </div>
            <div className={styles.meterContainer}>
              <div className={styles.meterTrack}>
                <div
                  className={`${styles.meterFill} ${micOk ? styles.meterGreen : ''}`}
                  style={{ width: `${micLevel}%` }}
                />
              </div>
              <span className={styles.meterLabel}>{micOk ? 'Detected' : 'Listening...'}</span>
            </div>
          </div>

          {/* Speaker Check */}
          <div className={styles.checkSection}>
            <div className={styles.checkHeader}>
              <StatusIcon ok={speakerOk} />
              <div>
                <h3 className={styles.checkTitle}>Speaker / Audio Output</h3>
                <p className={styles.checkDesc}>
                  {speakerOk ? 'Speaker test completed' : 'Click the button to play a test tone'}
                </p>
              </div>
            </div>
            {!speakerOk ? (
              <button className={styles.testBtn} onClick={testSpeaker}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>
                </svg>
                Play Test Tone
              </button>
            ) : (
              <div className={styles.passedNote}>Test tone played successfully</div>
            )}
          </div>

          {/* Keyboard Check */}
          <div className={styles.checkSection}>
            <div className={styles.checkHeader}>
              <StatusIcon ok={keyboardOk} />
              <div>
                <h3 className={styles.checkTitle}>Keyboard</h3>
                <p className={styles.checkDesc}>
                  {keyboardOk ? 'Keyboard is working properly' : 'Press any 3 keys to verify your keyboard'}
                </p>
              </div>
            </div>
            <div className={styles.keyboardTest}>
              {keysPressed.size > 0 ? (
                <div className={styles.keys}>
                  {[...keysPressed].slice(0, 8).map((k, i) => (
                    <span key={i} className={styles.keyBadge}>{k.length === 1 ? k.toUpperCase() : k}</span>
                  ))}
                </div>
              ) : (
                <div className={styles.keyPrompt}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5">
                    <rect x="2" y="6" width="20" height="12" rx="2"/>
                    <line x1="6" y1="10" x2="6" y2="10.01"/><line x1="10" y1="10" x2="10" y2="10.01"/>
                    <line x1="14" y1="10" x2="14" y2="10.01"/><line x1="18" y1="10" x2="18" y2="10.01"/>
                    <line x1="8" y1="14" x2="16" y2="14"/>
                  </svg>
                  <span>Waiting for key presses...</span>
                </div>
              )}
              {!keyboardOk && keysPressed.size > 0 && (
                <div className={styles.keyCount}>{keysPressed.size}/3 keys pressed</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.statusSummary}>
            <CheckItem label="Camera" ok={cameraOk} />
            <CheckItem label="Microphone" ok={micOk} />
            <CheckItem label="Speaker" ok={speakerOk} />
            <CheckItem label="Keyboard" ok={keyboardOk} />
          </div>

          <button
            className={`${styles.startBtn} ${allPassed ? styles.startBtnReady : ''}`}
            disabled={!allPassed}
            onClick={handleStart}
          >
            {allPassed ? (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                All Checks Passed — Start Exam
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                Complete All Checks to Continue
              </>
            )}
          </button>

          {onBack && (
            <button className={styles.backBtn} onClick={onBack}>
              Go Back
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusIcon({ ok, error }) {
  if (ok) {
    return (
      <div className={styles.statusIcon} style={{ background: '#dcfce7', color: '#16a34a' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
    )
  }
  if (error) {
    return (
      <div className={styles.statusIcon} style={{ background: '#fee2e2', color: '#dc2626' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </div>
    )
  }
  return (
    <div className={styles.statusIcon} style={{ background: '#fef3c7', color: '#d97706' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    </div>
  )
}

function CheckItem({ label, ok }) {
  return (
    <div className={styles.checkItem}>
      {ok ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
        </svg>
      )}
      <span style={{ color: ok ? '#16a34a' : '#6b7280' }}>{label}</span>
    </div>
  )
}
