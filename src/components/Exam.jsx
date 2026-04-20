import { useState, useEffect, useRef, useCallback } from 'react'
import QUESTIONS from '../data/questions'
import CameraOverlay from './CameraOverlay'
import HardwareCheck from './HardwareCheck'
import ViolationOverlay from './ViolationOverlay'
import SubmitModal from './SubmitModal'
import SuccessScreen from './SuccessScreen'
import styles from './Exam.module.css'

const EXAM_SECONDS  = 60 * 60
const MAX_VIOLATIONS = 3

function formatTime(s) {
  const m   = Math.floor(s / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

export default function Exam({ user, session }) {
  const proctoringClient = session?.client
  // ── state ─────────────────────────────────────────
  const [hwCheckPhase,    setHwCheckPhase]    = useState(false)
  const [cameraReady,     setCameraReady]     = useState(false)
  const [submitted,       setSubmitted]       = useState(false)
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [currentQ,        setCurrentQ]        = useState(0)
  const [answers,         setAnswers]         = useState(Array(QUESTIONS.length).fill(null))
  const [secondsLeft,     setSecondsLeft]     = useState(EXAM_SECONDS)
  const [violations,      setViolations]      = useState(0)
  const [violation,       setViolation]       = useState(null)
  const [mediaStream,     setMediaStream]     = useState(null)
  const [cameraError,     setCameraError]     = useState(null)
  const [warning,         setWarning]         = useState(null) // { title, message, count }
  const [debugInfo,       setDebugInfo]       = useState({ faceReady: false, personReady: false, faces: 0, persons: 0, gazeOk: false, err: '' })

  const streamRef         = useRef(null)
  const videoRef          = useRef(null)
  const timerRef          = useRef(null)
  const submittedRef      = useRef(false)
  const cameraReadyRef    = useRef(false)
  const violationActive   = useRef(false)
  const faceModelRef        = useRef(null)
  const personModelRef      = useRef(null)   // COCO-SSD for full-body person detection
  const faceIntervalRef     = useRef(null)
  const bgPersonCountRef       = useRef(0)      // consecutive ticks with extra person in background
  const personDetectingRef     = useRef(false)  // guard: prevent overlapping COCO-SSD calls
  const forbiddenObjCountRef   = useRef({})     // per-class debounce for phone/book/laptop
  const noFaceCountRef         = useRef(0)
  const gazeAwayCountRef       = useRef(0)      // consecutive ticks looking away
  const faceBaselineRef        = useRef(null)   // landmark ratios captured at exam start
  const faceBaselineReadyRef   = useRef(false)
  const faceSwapCountRef       = useRef(0)
  const monitorCanvasRef       = useRef(null)   // offscreen canvas reused each tick
  const analyserRef         = useRef(null)
  const audioBaselineRef    = useRef(8)
  const recorderRef         = useRef(null)
  const triggerViolationRef = useRef(null)
  const warningCountsRef    = useRef({})
  const warningTimerRef     = useRef(null)
  const triggerWarningRef   = useRef(null)

  // ── eye gaze tracking refs ──────────────────────────
  const gazeCalibrated      = useRef(false)    // true after initial gaze baseline captured
  const gazeBaseline        = useRef(null)     // { leftIrisRatio, rightIrisRatio } at exam start
  const gazeDeviationCount  = useRef(0)        // consecutive ticks with gaze off-center
  const lookDownGazeCount   = useRef(0)        // eye-level downward gaze (iris at bottom of eye)
  const screenGlowCount     = useRef(0)        // consecutive ticks with bright glow below face
  const prevBottomBrightness = useRef(null)    // baseline brightness of bottom frame region
  const handNearCameraCount = useRef(0)        // consecutive ticks with hand/object near camera edge

  // ── helpers ────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  const lockKeys = useCallback(() => {
    if (!navigator.keyboard?.lock) return
    navigator.keyboard.lock([
      'Escape',
      'MetaLeft', 'MetaRight',
      'AltLeft',  'AltRight',
      'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
      'KeyW','KeyT','KeyN','KeyR','KeyQ',
    ]).catch(() => {})
  }, [])

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen
    if (!req) return
    req.call(el).then(lockKeys).catch(() => {})
  }, [lockKeys])

  const doSubmit = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    clearInterval(timerRef.current)
    clearInterval(faceIntervalRef.current)
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    stopCamera()
    if (navigator.keyboard?.unlock) navigator.keyboard.unlock()
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {})
    setSubmitted(true)
    // Tell Electron to quit after showing the success screen
    window.electronAPI?.examSubmitted()
  }, [stopCamera])

  // ── violation evidence snapshot ────────────────────
  const captureSnapshot = useCallback((label) => {
    if (!monitorCanvasRef.current || !window.electronAPI?.saveSnapshot) return
    try {
      const dataUrl  = monitorCanvasRef.current.toDataURL('image/png')
      const ts       = new Date().toISOString().replace(/[:.]/g, '-')
      const safe     = label.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)
      window.electronAPI.saveSnapshot(dataUrl, `violation_${ts}_${safe}.png`)
    } catch { /* canvas taint guard */ }
  }, [])

  const triggerViolation = useCallback((title, message) => {
    captureSnapshot(title)   // save evidence frame before anything else
    if (submittedRef.current || violationActive.current) return
    violationActive.current = true
    // Report to central admin dashboard in real time
    proctoringClient?.reportViolation({ title, message, at: Date.now() })
    setViolations(v => {
      const next = v + 1
      setViolation({ title, message, count: next })
      if (next >= MAX_VIOLATIONS) {
        setTimeout(doSubmit, 2000)
      }
      return next
    })
  }, [doSubmit, captureSnapshot, proctoringClient])
  triggerViolationRef.current = triggerViolation

  // ── blocked app / VPN detection (from Electron main) ─
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSuspiciousApp?.((appName) => {
      const display = appName.charAt(0).toUpperCase() + appName.slice(1)
      triggerViolation(
        'Blocked Application Detected',
        `"${display}" is running and is not permitted during the exam. Close it immediately.`
      )
    })
    return () => { unsubscribe?.() }
  }, [triggerViolation])

  // ── remote stop from admin proctor ────────────────
  useEffect(() => {
    if (!proctoringClient?.socket) return
    const onStop = () => {
      if (submittedRef.current) return
      setViolation({
        title: 'Exam Ended By Proctor',
        message: 'Your proctor has ended this exam. Your answers are being submitted.',
        count: violations,
      })
      setTimeout(doSubmit, 1500)
    }
    proctoringClient.socket.on('exam:stop', onStop)
    return () => { proctoringClient.socket.off('exam:stop', onStop) }
  }, [proctoringClient, doSubmit, violations])

  // ── warning system (3 warnings → violation) ────────
  const triggerWarning = useCallback((key, title, message) => {
    if (submittedRef.current) return
    const counts = warningCountsRef.current
    counts[key] = (counts[key] || 0) + 1
    const count = counts[key]

    if (count >= 3) {
      // Escalate to violation on 3rd warning
      counts[key] = 0
      triggerViolation(title, `${message} (Escalated after 3 warnings.)`)
      return
    }

    // Show warning toast — auto-dismiss after 6 s
    clearTimeout(warningTimerRef.current)
    setWarning({ title, message, count, max: 3 })
    warningTimerRef.current = setTimeout(() => setWarning(null), 6000)
  }, [triggerViolation])
  triggerWarningRef.current = triggerWarning

  const resumeExam = useCallback(() => {
    violationActive.current = false
    setViolation(null)
    enterFullscreen()
  }, [enterFullscreen])

  // ── face detection loop ────────────────────────────
  const startMonitoring = useCallback((triggerViol, triggerWarn) => {
    monitorCanvasRef.current = document.createElement('canvas')
    const ctx = monitorCanvasRef.current.getContext('2d', { willReadFrequently: true })

    // Per-run mutable counters (closured — not React state)
    const local = {
      talkingCount:      0,
      headEdgeCount:     0,
      faceSizeCount:     0,
      multiFaceCount:    0,
      headMoveCount:     0,
      lookDownCount:     0,
      headTurnCount:     0,
      prevFaceX:         null,
      prevFaceY:         null,
      prevFaceW:         null,
      prevMouthData:     null,
      faceBaselineTick:  0,   // counts ticks for baseline capture + 30s compare
      gazeCalibTicks:    0,   // ticks before gaze baseline is captured
      glowBaselineSamples: 0, // samples for bottom-frame brightness baseline
    }

    faceIntervalRef.current = setInterval(async () => {
      if (!faceModelRef.current || !videoRef.current || submittedRef.current) return
      const video = videoRef.current
      if (video.readyState < 2) return

      const W = video.videoWidth  || 320
      const H = video.videoHeight || 240
      monitorCanvasRef.current.width  = W
      monitorCanvasRef.current.height = H
      ctx.drawImage(video, 0, 0, W, H)

      // ── 1. Face analysis ───────────────────────────────
      let faceBox = null
      try {
        const faces = await faceModelRef.current.estimateFaces(video, false)
        const count = faces.length
        setDebugInfo(d => ({ ...d, faces: count }))

        if (count === 0) {
          noFaceCountRef.current += 1
          if (noFaceCountRef.current >= 2) {          // 2 × 500 ms = 1 s absent
            noFaceCountRef.current = 0
            triggerViol('No Face Detected', 'Your face is not visible. Please stay in front of the camera.')
          }
        } else {
          noFaceCountRef.current = 0

          if (count > 1) {
            // Debounce: require 2 consecutive ticks (1 s) so a single noisy frame doesn't fire
            local.multiFaceCount += 1
            if (local.multiFaceCount >= 2) {
              local.multiFaceCount = 0
              triggerViol('Multiple Persons Detected', 'Only one person is allowed during the exam.')
            }
          } else {
            local.multiFaceCount = 0
          }

          const face = faces[0]
          // landmarks: [0]=rightEye [1]=leftEye [2]=nose [3]=mouth [4]=rightEar [5]=leftEar
          const lm = face.landmarks
          faceBox = {
            x: face.topLeft[0],
            y: face.topLeft[1],
            w: face.bottomRight[0] - face.topLeft[0],
            h: face.bottomRight[1] - face.topLeft[1],
          }
          const fcx = (face.topLeft[0] + face.bottomRight[0]) / 2
          const fcy = (face.topLeft[1] + face.bottomRight[1]) / 2

          // ── a) Sustained gaze away (deliberate head turn left/right) ──
          // Only flag an obvious, sustained turn — not glancing at the question text.
          const eyeMidX = (lm[0][0] + lm[1][0]) / 2
          const hOffset = (eyeMidX - fcx) / (faceBox.w || 1)
          if (Math.abs(hOffset) > 0.20) {             // clear deliberate turn only
            gazeAwayCountRef.current += 1
            if (gazeAwayCountRef.current >= 10) {     // 5 s sustained before warning
              gazeAwayCountRef.current = 0
              const dir = hOffset > 0 ? 'right' : 'left'
              triggerWarn('gaze', 'Looking Away From Screen', `Your head has been turned ${dir} for an extended period. Please face the screen.`)
            }
          } else {
            gazeAwayCountRef.current = Math.max(0, gazeAwayCountRef.current - 2)
          }

          // ── b) Sustained downward tilt (reading notes / phone) ──
          // Deep downward tilt held for 5 s — not normal reading/typing glance.
          const eyeMidY = (lm[0][1] + lm[1][1]) / 2
          const vOffset = (eyeMidY - fcy) / (faceBox.h || 1)
          if (vOffset > 0.28) {                       // deep tilt only
            local.lookDownCount += 1
            if (local.lookDownCount >= 10) {          // 5 s sustained
              local.lookDownCount = 0
              triggerWarn('gaze_down', 'Head Tilted Down', 'Your head has been tilted down for an extended period. Keep your eyes on the screen.')
            }
          } else {
            local.lookDownCount = Math.max(0, local.lookDownCount - 2)
          }

          // ── b2) Iris gaze tracking — detect WHERE eyes are looking ──
          // Analyze pixel darkness in left/right halves of each eye region
          // to estimate iris position. If iris consistently drifts to one side
          // or downward, the student is looking away from the screen.
          if (lm[0] && lm[1] && faceBox.w > 40) {
            const analyzeIris = (eyeLm) => {
              const ex = Math.floor(eyeLm[0])
              const ey = Math.floor(eyeLm[1])
              const eyeW = Math.max(12, Math.floor(faceBox.w * 0.14))
              const eyeH = Math.max(8, Math.floor(eyeW * 0.55))
              const x1 = Math.max(0, ex - eyeW)
              const y1 = Math.max(0, ey - eyeH)
              const x2 = Math.min(W, ex + eyeW)
              const y2 = Math.min(H, ey + eyeH)
              const w = x2 - x1; const h = y2 - y1
              if (w < 6 || h < 4) return null
              try {
                const imgData = ctx.getImageData(x1, y1, w, h).data
                // Split into left/right halves and top/bottom halves
                const midX = Math.floor(w / 2)
                const midY = Math.floor(h / 2)
                let leftDark = 0, rightDark = 0, topDark = 0, bottomDark = 0
                let leftPx = 0, rightPx = 0, topPx = 0, bottomPx = 0
                for (let py = 0; py < h; py++) {
                  for (let px = 0; px < w; px++) {
                    const idx = (py * w + px) * 4
                    const brightness = imgData[idx] * 0.299 + imgData[idx+1] * 0.587 + imgData[idx+2] * 0.114
                    const darkness = 255 - brightness
                    if (px < midX) { leftDark += darkness; leftPx++ }
                    else { rightDark += darkness; rightPx++ }
                    if (py < midY) { topDark += darkness; topPx++ }
                    else { bottomDark += darkness; bottomPx++ }
                  }
                }
                const lAvg = leftPx > 0 ? leftDark / leftPx : 0
                const rAvg = rightPx > 0 ? rightDark / rightPx : 0
                const tAvg = topPx > 0 ? topDark / topPx : 0
                const bAvg = bottomPx > 0 ? bottomDark / bottomPx : 0
                const total = lAvg + rAvg || 1
                return {
                  hRatio: lAvg / total,  // <0.5 = looking right, >0.5 = looking left
                  vRatio: bAvg / (tAvg + bAvg || 1), // >0.5 = looking down
                }
              } catch { return null }
            }

            const leftIris  = analyzeIris(lm[1])  // left eye landmark
            const rightIris = analyzeIris(lm[0])   // right eye landmark

            if (leftIris && rightIris) {
              const avgH = (leftIris.hRatio + rightIris.hRatio) / 2
              const avgV = (leftIris.vRatio + rightIris.vRatio) / 2

              // Calibrate gaze baseline during first 4 seconds of exam
              if (!gazeCalibrated.current) {
                local.gazeCalibTicks++
                if (local.gazeCalibTicks >= 8) { // 4 seconds of stable gaze
                  gazeBaseline.current = { h: avgH, v: avgV }
                  gazeCalibrated.current = true
                  setDebugInfo(d => ({ ...d, gazeOk: true }))
                }
              } else {
                const baseH = gazeBaseline.current.h
                const baseV = gazeBaseline.current.v
                const hDrift = Math.abs(avgH - baseH)
                const vDrift = avgV - baseV  // positive = looking more downward

                // Horizontal gaze deviation — looking far left/right (not at screen)
                if (hDrift > 0.12) {
                  gazeDeviationCount.current++
                  if (gazeDeviationCount.current >= 8) { // 4s sustained
                    gazeDeviationCount.current = 0
                    const dir = avgH > baseH ? 'left' : 'right'
                    triggerWarn('eye_gaze', 'Eyes Not on Screen',
                      `Your eyes appear to be looking ${dir}. Keep your gaze on the screen at all times.`)
                  }
                } else {
                  gazeDeviationCount.current = Math.max(0, gazeDeviationCount.current - 2)
                }

                // Downward iris gaze — looking at phone/notes below screen
                if (vDrift > 0.10) {
                  lookDownGazeCount.current++
                  if (lookDownGazeCount.current >= 6) { // 3s sustained
                    lookDownGazeCount.current = 0
                    triggerWarn('eye_down', 'Eyes Looking Down',
                      'Your eyes are focused below the screen. This may indicate reading from a hidden device or notes.')
                  }
                } else {
                  lookDownGazeCount.current = Math.max(0, lookDownGazeCount.current - 2)
                }
              }
            }
          }

          // ── c) Head turned fully sideways (ear asymmetry) ─────
          // Only flag a near-profile turn held for 3 s — not normal glancing.
          if (lm[4] && lm[5]) {
            const rEarDist = Math.abs(lm[4][0] - fcx)
            const lEarDist = Math.abs(lm[5][0] - fcx)
            const earRatio = Math.min(rEarDist, lEarDist) / (Math.max(rEarDist, lEarDist) || 1)
            if (earRatio < 0.22) {                    // near-profile turn required
              local.headTurnCount += 1
              if (local.headTurnCount >= 6) {         // 3 s sustained
                local.headTurnCount = 0
                triggerWarn('head_turn', 'Head Turned Away', 'Please face the screen directly. Do not turn your head away.')
              }
            } else {
              local.headTurnCount = Math.max(0, local.headTurnCount - 2)
            }
          }

          // ── d) Face too small — student left camera view ───────
          const faceAreaRatio = (faceBox.w * faceBox.h) / (W * H)
          if (faceAreaRatio < 0.018) {                // very small = truly moved far away
            local.faceSizeCount += 1
            if (local.faceSizeCount >= 5) {
              local.faceSizeCount = 0
              triggerWarn('face_distance', 'Too Far From Camera', 'Move closer to the camera. Your face must be clearly visible at all times.')
            }
          } else {
            local.faceSizeCount = Math.max(0, local.faceSizeCount - 1)
          }

          // ── e) Face out of frame — student moving away ─────────
          const edgeMarginX = W * 0.08
          const edgeMarginY = H * 0.08
          if (
            faceBox.x < edgeMarginX ||
            faceBox.x + faceBox.w > W - edgeMarginX ||
            faceBox.y < edgeMarginY ||
            faceBox.y + faceBox.h > H - edgeMarginY
          ) {
            local.headEdgeCount += 1
            if (local.headEdgeCount >= 6) {           // 3 s before warning
              local.headEdgeCount = 0
              triggerWarn('head_edge', 'Face Out of Frame', 'Center your face in the camera. Do not move to the edge of the frame.')
            }
          } else {
            local.headEdgeCount = Math.max(0, local.headEdgeCount - 1)
          }

          // ── f) Large sustained position shift — leaning out of seat ──
          // Normal posture adjustments are fine; only flag extreme continuous drift.
          if (local.prevFaceX !== null) {
            const dx = Math.abs(faceBox.x - local.prevFaceX) / (faceBox.w || 1)
            const dy = Math.abs(faceBox.y - local.prevFaceY) / (faceBox.h || 1)
            if (dx > 0.50 || dy > 0.50) {             // large jump only (was 0.25)
              local.headMoveCount += 1
              if (local.headMoveCount >= 6) {         // 3 s sustained
                local.headMoveCount = 0
                triggerWarn('head_movement', 'Leaving Camera View', 'You appear to be moving away from the camera. Stay seated and face the screen.')
              }
            } else {
              local.headMoveCount = Math.max(0, local.headMoveCount - 1)
            }
          }
          local.prevFaceX = faceBox.x
          local.prevFaceY = faceBox.y
          local.prevFaceW = faceBox.w

          // ── g) Talking — sustained loud lip movement ───────────
          // Raised threshold and duration to ignore reading/silent mouthing.
          if (lm[3]) {
            const mouthX = Math.floor(lm[3][0])
            const mouthY = Math.floor(lm[3][1])
            const mr = Math.max(8, Math.floor(faceBox.w * 0.22))
            const mx1 = Math.max(0, mouthX - mr)
            const my1 = Math.max(0, mouthY - Math.floor(mr * 0.4))
            const mx2 = Math.min(W, mouthX + mr)
            const my2 = Math.min(H, mouthY + Math.floor(mr * 1.2))
            const mouthData = ctx.getImageData(mx1, my1, mx2 - mx1, my2 - my1)

            if (local.prevMouthData && local.prevMouthData.length === mouthData.data.length) {
              let mDiff = 0
              for (let i = 0; i < mouthData.data.length; i += 4) {
                mDiff += Math.abs(mouthData.data[i]   - local.prevMouthData[i])
                       + Math.abs(mouthData.data[i+1] - local.prevMouthData[i+1])
                       + Math.abs(mouthData.data[i+2] - local.prevMouthData[i+2])
              }
              const avgDiff = mDiff / (mouthData.data.length / 4)
              if (avgDiff > 40) {                     // higher: only active talking, not silent reading
                local.talkingCount += 1
                if (local.talkingCount >= 10) {       // 5 s continuous talking
                  local.talkingCount = 0
                  triggerWarn('talking', 'Talking Detected', 'Sustained lip movement detected. Talking during the exam is not permitted.')
                }
              } else {
                local.talkingCount = Math.max(0, local.talkingCount - 2)
              }
            }
            local.prevMouthData = mouthData.data.slice()
          }

          // ── h) Face consistency — detect person swap ───────────
          // Build a landmark-ratio signature at exam start; compare every 30 s.
          // Catches when a different person sits down mid-exam.
          if (count === 1) {
            const lm2 = faces[0].landmarks
            const eyeDx      = lm2[1][0] - lm2[0][0]
            const eyeDy      = lm2[1][1] - lm2[0][1]
            const eyeDist    = Math.hypot(eyeDx, eyeDy) || 1
            const eyeMidY2   = (lm2[0][1] + lm2[1][1]) / 2
            const sig = {
              eyeToNoseH:   Math.abs(lm2[2][1] - eyeMidY2) / eyeDist,
              eyeToMouthH:  Math.abs(lm2[3][1] - eyeMidY2) / eyeDist,
              noseToMouthH: Math.abs(lm2[3][1] - lm2[2][1]) / eyeDist,
            }
            local.faceBaselineTick += 1
            if (!faceBaselineReadyRef.current) {
              if (local.faceBaselineTick >= 6) {   // capture after 3 stable seconds
                faceBaselineRef.current    = sig
                faceBaselineReadyRef.current = true
                local.faceBaselineTick     = 0
              }
            } else if (local.faceBaselineTick >= 60) {  // compare every 30 s
              local.faceBaselineTick = 0
              const base  = faceBaselineRef.current
              const drift = Math.abs(sig.eyeToNoseH   - base.eyeToNoseH)
                          + Math.abs(sig.eyeToMouthH  - base.eyeToMouthH)
                          + Math.abs(sig.noseToMouthH - base.noseToMouthH)
              if (drift > 0.55) {
                faceSwapCountRef.current += 1
                if (faceSwapCountRef.current >= 2) {
                  faceSwapCountRef.current = 0
                  triggerViol('Identity Mismatch Detected',
                    'The facial geometry no longer matches the registered student. This incident has been recorded.')
                }
              } else {
                faceSwapCountRef.current = 0
              }
            }
          }
        }
      } catch { /* model tick error — skip frame */ }

      // ── 2. COCO-SSD: persons + forbidden objects ────────
      if (personModelRef.current && !personDetectingRef.current) {
        personDetectingRef.current = true
        personModelRef.current.detect(monitorCanvasRef.current)
          .then(predictions => {
            personDetectingRef.current = false
            const persons = predictions.filter(p => p.class === 'person' && p.score > 0.25)
            setDebugInfo(d => ({ ...d, persons: persons.length }))

            if (persons.length > 1) {
              bgPersonCountRef.current += 1
              if (bgPersonCountRef.current >= 2) {
                bgPersonCountRef.current = 0
                triggerViol(
                  'Another Person Detected',
                  'A second person has been detected in the camera. Only you may be present during the exam.'
                )
              }
            } else if (persons.length === 1 && faceBox) {
              const [bx, by, bw, bh] = persons[0].bbox
              const bodyCx = bx + bw / 2
              const bodyCy = by + bh / 2
              const faceCx = faceBox.x + faceBox.w / 2
              const faceCy = faceBox.y + faceBox.h / 2
              const distX  = Math.abs(bodyCx - faceCx) / W
              const distY  = Math.abs(bodyCy - faceCy) / H
              if (distX > 0.25 || distY > 0.30) {
                bgPersonCountRef.current += 1
                if (bgPersonCountRef.current >= 2) {
                  bgPersonCountRef.current = 0
                  triggerWarn('bgperson', 'Person Detected in Background',
                    'Another person appears to be present behind you. Ensure you are alone during the exam.')
                }
              } else {
                bgPersonCountRef.current = Math.max(0, bgPersonCountRef.current - 1)
              }
            } else {
              bgPersonCountRef.current = Math.max(0, bgPersonCountRef.current - 1)
            }

            // ── Forbidden objects: phone, book, laptop ─────────
            const FORBIDDEN = {
              'cell phone': { label: 'Phone Detected',  msg: 'A mobile phone has been detected in your camera view. Remove it immediately.' },
              'book':       { label: 'Book/Notes Detected', msg: 'A book or notes have been detected. No study materials are permitted.' },
              'laptop':     { label: 'Second Device Detected', msg: 'A laptop or second device has been detected. Only this computer is permitted.' },
            }
            for (const [cls, { label, msg }] of Object.entries(FORBIDDEN)) {
              const found = predictions.some(p => p.class === cls && p.score > 0.45)
              if (found) {
                forbiddenObjCountRef.current[cls] = (forbiddenObjCountRef.current[cls] || 0) + 1
                if (forbiddenObjCountRef.current[cls] >= 3) {  // 1.5 s sustained
                  forbiddenObjCountRef.current[cls] = 0
                  triggerViol(label, msg)
                }
              } else {
                forbiddenObjCountRef.current[cls] = Math.max(0, (forbiddenObjCountRef.current[cls] || 0) - 1)
              }
            }
            // ── Hand / suspicious object near camera edges ────
            // Detects someone holding a phone/paper near the webcam to show answers
            const hands = predictions.filter(p =>
              (p.class === 'person' || p.class === 'cell phone' || p.class === 'book' || p.class === 'remote') &&
              p.score > 0.30
            )
            const edgeObjects = hands.filter(p => {
              const [bx, , bw] = p.bbox
              // Object is at the far left/right edge of the frame (someone reaching in)
              return (bx < W * 0.08 || bx + bw > W * 0.92) && p.class !== 'person'
            })
            if (edgeObjects.length > 0) {
              handNearCameraCount.current++
              if (handNearCameraCount.current >= 4) { // 2s sustained
                handNearCameraCount.current = 0
                triggerWarn('hand_object', 'Object Near Camera',
                  'A suspicious object was detected at the edge of your camera. No one should be showing you materials during the exam.')
              }
            } else {
              handNearCameraCount.current = Math.max(0, handNearCameraCount.current - 1)
            }
          })
          .catch(() => { personDetectingRef.current = false })
      }

      // ── 3. Screen glow detection — phone hidden below laptop ──────
      // Analyzes the bottom portion of the frame for unusual brightness
      // (a phone screen placed below the laptop glows in the webcam view)
      try {
        const bottomY = Math.floor(H * 0.75)
        const bottomH = H - bottomY
        if (bottomH > 10) {
          const bottomData = ctx.getImageData(0, bottomY, W, bottomH).data
          let totalBrightness = 0
          const pixelCount = bottomData.length / 4
          for (let i = 0; i < bottomData.length; i += 4) {
            totalBrightness += bottomData[i] * 0.299 + bottomData[i+1] * 0.587 + bottomData[i+2] * 0.114
          }
          const avgBrightness = totalBrightness / pixelCount

          // Build baseline for first 10 ticks (5 seconds)
          if (local.glowBaselineSamples < 10) {
            local.glowBaselineSamples++
            if (!prevBottomBrightness.current) {
              prevBottomBrightness.current = avgBrightness
            } else {
              prevBottomBrightness.current = prevBottomBrightness.current * 0.8 + avgBrightness * 0.2
            }
          } else if (prevBottomBrightness.current !== null) {
            const baseline = prevBottomBrightness.current
            // Screen glow: sudden brightness increase >60% above baseline in bottom area
            // Must also be bright enough in absolute terms (>100) to avoid dark-room false positives
            if (avgBrightness > baseline * 1.6 && avgBrightness > 100) {
              screenGlowCount.current++
              if (screenGlowCount.current >= 6) { // 3s sustained glow
                screenGlowCount.current = 0
                triggerWarn('screen_glow', 'Hidden Screen Detected',
                  'Unusual brightness detected below the camera view. If you have a phone or device below your laptop, remove it immediately.')
              }
            } else {
              screenGlowCount.current = Math.max(0, screenGlowCount.current - 1)
              // Slowly adapt baseline to natural lighting changes
              prevBottomBrightness.current = baseline * 0.98 + avgBrightness * 0.02
            }
          }
        }
      } catch { /* canvas access error */ }

      // ── 4. Audio spike detection — loud sustained noise only ──
      // Normal ambient sounds / keyboard / mouse are fine.
      // Only flag sustained loud speech-level audio (conversation with someone).
      if (analyserRef.current) {
        try {
          const buf = new Uint8Array(analyserRef.current.fftSize)
          analyserRef.current.getByteTimeDomainData(buf)
          let rmsSum = 0
          for (let i = 0; i < buf.length; i++) rmsSum += (buf[i] - 128) ** 2
          const rms = Math.sqrt(rmsSum / buf.length)

          if (rms > audioBaselineRef.current * 4.0 && rms > 18) {  // needs very loud spike
            triggerWarn('audio', 'Loud Noise Detected', 'Loud audio detected. Ensure you are in a quiet environment and not talking to anyone.')
          }
          audioBaselineRef.current = Math.max(3, audioBaselineRef.current * 0.96 + rms * 0.04)
        } catch {}
      }

    }, 500)  // runs every 500 ms — 4× more frequent than before
  }, [])

  // ── attach stream to video via effect (React-safe) ──
  useEffect(() => {
    if (!mediaStream || !videoRef.current) return
    const video = videoRef.current
    video.srcObject = mediaStream
    video.play().catch(() => {})
  }, [mediaStream])

  // ── stop all tracks on unmount so camera is freed ──
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  // ── camera init ────────────────────────────────────
  const startCamera = useCallback(async () => {
    // Stop any leftover stream from a previous attempt
    streamRef.current?.getTracks().forEach(t => t.stop())

    // Tell Electron main process to stop re-stealing focus while
    // macOS may show camera/microphone permission dialogs
    window.electronAPI?.mediaPermStart?.()

    let stream
    let err
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch (e1) {
      err = e1
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        err = null
      } catch (e2) {
        err = e2
      }
    }

    // Permission dialogs are done — main process can resume focus management
    window.electronAPI?.mediaPermEnd?.()

    if (!stream) {
      const isDenied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
      setCameraError(isDenied ? 'denied' : 'busy')
      return
    }
    setCameraError(null)

    streamRef.current = stream
    setMediaStream(stream)

    // Publish the camera stream to any admin viewers via the proctoring client
    proctoringClient?.attachLocalStream(stream)

    if (stream.getAudioTracks().length > 0) {
      try {
        const recorder = new MediaRecorder(stream)
        recorderRef.current = recorder
        recorder.start()
      } catch { /* not supported */ }

      // Set up audio analyser for background noise detection
      try {
        const ac       = new AudioContext()
        const source   = ac.createMediaStreamSource(stream)
        const analyser = ac.createAnalyser()
        analyser.fftSize = 1024
        source.connect(analyser)
        analyserRef.current = analyser
      } catch { /* not supported */ }
    }

    setCameraReady(true)
    cameraReadyRef.current = true
    enterFullscreen()

    // Load TF.js once, then load both models independently.
    // Monitoring starts as soon as BlazeFace is ready; COCO-SSD attaches when it finishes.
    // If either model fails, the other still works.
    import('@tensorflow/tfjs').then(() => {
      // BlazeFace — start the monitoring loop immediately when ready
      import('@tensorflow-models/blazeface')
        .then(bf => bf.load())
        .then(model => {
          faceModelRef.current = model
          setDebugInfo(d => ({ ...d, faceReady: true }))
          startMonitoring(triggerViolationRef.current, triggerWarningRef.current)
        })
        .catch(e => { setDebugInfo(d => ({ ...d, err: 'Face model failed: ' + e.message })) })

      // COCO-SSD — attaches to the already-running loop when ready
      import('@tensorflow-models/coco-ssd')
        .then(cocoSsd => cocoSsd.load())
        .then(model => {
          personModelRef.current = model
          setDebugInfo(d => ({ ...d, personReady: true }))
        })
        .catch(e => { setDebugInfo(d => ({ ...d, err: 'Person model failed: ' + e.message })) })
    }).catch(() => {})

  }, [enterFullscreen, startMonitoring])

  // ── timer ──────────────────────────────────────────
  useEffect(() => {
    if (!cameraReady || submitted) return
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { doSubmit(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [cameraReady, submitted, doSubmit])

  // ── proctoring event listeners ─────────────────────
  useEffect(() => {
    const locked = () => cameraReadyRef.current && !submittedRef.current

    // ── screen share / getDisplayMedia patch ─────────────
    const origGetDisplayMedia = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices)
    if (navigator.mediaDevices?.getDisplayMedia) {
      navigator.mediaDevices.getDisplayMedia = async () => {
        triggerViolation('Screen Sharing Attempt', 'An attempt to share or record the screen was detected. This is not permitted during the exam.')
        throw new DOMException('Screen capture disabled during exam.', 'NotAllowedError')
      }
    }

    // ── Block Picture-in-Picture API ─────────────────────
    const origReqPiP = HTMLVideoElement.prototype.requestPictureInPicture
    HTMLVideoElement.prototype.requestPictureInPicture = function () {
      triggerViolation('PiP Attempt', 'Picture-in-Picture is not allowed during the exam.')
      return Promise.reject(new DOMException('PiP disabled during exam.', 'NotAllowedError'))
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {})
    }

    // ── Block Document PiP (documentPictureInPicture API) ──
    const origDocPiP = window.documentPictureInPicture?.requestWindow
    if (window.documentPictureInPicture) {
      window.documentPictureInPicture.requestWindow = () => {
        triggerViolation('PiP Attempt', 'Document Picture-in-Picture is not allowed during the exam.')
        return Promise.reject(new DOMException('Document PiP disabled during exam.', 'NotAllowedError'))
      }
    }

    // ── Block Notification API (can be abused to show AI answers) ──
    const OrigNotification = window.Notification
    window.Notification = function () {
      triggerViolation('Notification Blocked', 'Sending notifications is not allowed during the exam.')
      return {}
    }
    window.Notification.permission = 'denied'
    window.Notification.requestPermission = () => Promise.resolve('denied')

    // ── Block Web Speech API (speech recognition for voice-to-AI) ──
    const OrigSpeech = window.SpeechRecognition || window.webkitSpeechRecognition
    if (window.SpeechRecognition) window.SpeechRecognition = undefined
    if (window.webkitSpeechRecognition) window.webkitSpeechRecognition = undefined

    // ── Block WebSocket / fetch to external AI APIs ──────
    // Allow localhost + the configured proctoring server (from proctoringClient).
    const OrigWebSocket = window.WebSocket
    const proctorWsHost = (() => {
      try { return new URL(proctoringClient?.serverUrl || '').host.toLowerCase() } catch { return '' }
    })()
    window.WebSocket = function (url, ...args) {
      const lower = (typeof url === 'string' ? url : '').toLowerCase()
      let urlHost = ''
      try { urlHost = new URL(lower).host } catch {}
      const isLocal =
        lower.startsWith('ws://localhost') || lower.startsWith('ws://127.0.0.1') ||
        lower.startsWith('wss://localhost') || lower.startsWith('wss://127.0.0.1')
      const isProctor = proctorWsHost && urlHost === proctorWsHost
      if (!isLocal && !isProctor) {
        triggerViolation('Blocked Connection', 'An unauthorized WebSocket connection was attempted.')
        throw new DOMException('WebSocket blocked during exam.', 'SecurityError')
      }
      return new OrigWebSocket(url, ...args)
    }

    // ── DOM injection detection (catches overlay elements injected by extensions) ──
    const observer = new MutationObserver((mutations) => {
      if (!locked()) return
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue // only elements
          const el = node
          const tag = el.tagName?.toLowerCase()
          // Detect iframes injected by extensions
          if (tag === 'iframe') {
            const src = (el.src || '').toLowerCase()
            if (!src.startsWith('about:') && !src.startsWith('blob:') && src !== '') {
              el.remove()
              triggerViolation('Injected Iframe Detected', 'A hidden iframe was injected into the page. This may be a cheating tool.')
              continue
            }
          }
          // Detect fixed/absolute overlays with high z-index (extension overlays)
          const style = window.getComputedStyle(el)
          if ((style.position === 'fixed' || style.position === 'absolute') &&
              parseInt(style.zIndex || '0', 10) > 10000) {
            // Check if this is part of our app
            if (!el.closest('[data-exam-root]')) {
              el.remove()
              triggerViolation('Overlay Injection Detected', 'A suspicious overlay was injected into the page by an extension or script.')
            }
          }
        }
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })

    // ── Multi-screen detection (renderer side) ──────────
    const checkScreens = async () => {
      if (!locked()) return
      try {
        // Screen Enumeration API (Chromium-based browsers)
        if (window.getScreenDetails) {
          const details = await window.getScreenDetails()
          if (details.screens.length > 1) {
            triggerViolation('Multiple Monitors', 'Multiple displays detected. Only one screen is allowed during the exam. Disconnect extra monitors.')
          }
        }
      } catch {}
    }
    const screenCheckId = setInterval(checkScreens, 8000)
    checkScreens()

    // ── rapid text injection (paste / autofill / AI injection) ──
    const inputSnapshots = new Map()
    const onInput = (e) => {
      if (!locked()) return
      const el = e.target
      if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') return
      const now  = Date.now()
      const prev = inputSnapshots.get(el)
      const len  = el.value.length
      if (prev) {
        const delta   = len - prev.len
        const elapsed = now - prev.time
        if (delta >= 50 && elapsed < 400) {
          triggerViolation('Text Injection Detected',
            `${delta} characters appeared in ${elapsed}ms. Pasting or auto-fill is not permitted during the exam.`)
        }
      }
      inputSnapshots.set(el, { len, time: now })
    }

    // ── tab / window visibility ──────────────────────────
    const onVisibility = () => {
      if (document.hidden && locked()) {
        window.focus()
        triggerViolation('Tab Switch Detected', 'You switched tabs or minimised the window. This has been recorded.')
      }
    }

    // Re-grab focus the instant window loses it
    const onBlur = () => { if (locked()) { window.focus() } }

    // Block close / navigate away
    const onBeforeUnload = (e) => {
      if (locked()) { e.preventDefault(); e.returnValue = ''; return '' }
    }

    // ── keyboard lockdown ────────────────────────────────
    const onKeydown = (e) => {
      if (!locked()) return
      const inTextarea = document.activeElement?.tagName === 'TEXTAREA'

      // Silently re-enter fullscreen for Escape — no violation
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        enterFullscreen()
        return
      }

      // Block every F-key
      if (/^F\d{1,2}$/.test(e.key)) {
        e.preventDefault(); e.stopPropagation()
        triggerViolation('Key Blocked', `${e.key} is not allowed during the exam.`)
        return
      }

      // Block ALL Alt combos (Alt+Tab, Alt+F4, etc.)
      if (e.altKey) {
        e.preventDefault(); e.stopPropagation()
        triggerViolation('Key Blocked', 'Alt shortcuts are not allowed during the exam.')
        return
      }

      // Block Windows / Cmd key
      if (e.metaKey) {
        e.preventDefault(); e.stopPropagation()
        triggerViolation('Key Blocked', 'The Windows/Cmd key is not allowed during the exam.')
        return
      }

      // Block Tab (prevents focus leaving the page)
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation()
        return
      }

      // Block ALL Ctrl combos except Ctrl+A/Z/Y inside textarea
      if (e.ctrlKey) {
        const k = e.key.toLowerCase()
        const allowed = inTextarea && ['a','z','y'].includes(k)
        if (!allowed) {
          e.preventDefault(); e.stopPropagation()
          triggerViolation('Shortcut Blocked', `Ctrl+${e.key.toUpperCase()} is not allowed during the exam.`)
        }
        return
      }
    }

    // ── mouse / misc ─────────────────────────────────────
    const onContextMenu = (e) => {
      e.preventDefault()
      triggerViolation('Right-Click Blocked', 'Right-clicking is not allowed during the exam.')
    }

    const onPaste     = (e) => { e.preventDefault(); triggerViolation('Paste Blocked', 'Pasting is not allowed during the exam.') }
    const onCopy      = (e) => { if (document.activeElement?.tagName !== 'TEXTAREA') e.preventDefault() }
    const onDragstart = (e) => e.preventDefault()

    // Detect PrintScreen (key fires but we can blank the page briefly)
    const onKeyup = (e) => {
      if (!locked()) return
      if (e.key === 'PrintScreen') {
        triggerViolation('Screenshot Attempt', 'Taking screenshots is not allowed during the exam.')
      }
    }

    const onFullscreenChange = () => {
      const isFullscreen = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement
      )
      if (!isFullscreen && cameraReadyRef.current && !submittedRef.current) {
        // Re-enter immediately — fullscreenchange context allows this in Chrome
        enterFullscreen()
      }
    }

    document.addEventListener('visibilitychange',       onVisibility)
    document.addEventListener('keydown',                onKeydown,    true)
    document.addEventListener('keyup',                  onKeyup,      true)
    document.addEventListener('contextmenu',            onContextMenu)
    document.addEventListener('paste',                  onPaste,      true)
    document.addEventListener('copy',                   onCopy,       true)
    document.addEventListener('dragstart',              onDragstart)
    document.addEventListener('fullscreenchange',       onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    document.addEventListener('mozfullscreenchange',    onFullscreenChange)
    document.addEventListener('input',                  onInput,      true)
    window.addEventListener('beforeunload',             onBeforeUnload)
    window.addEventListener('blur',                     onBlur)

    return () => {
      document.removeEventListener('visibilitychange',       onVisibility)
      document.removeEventListener('keydown',                onKeydown,    true)
      document.removeEventListener('keyup',                  onKeyup,      true)
      document.removeEventListener('contextmenu',            onContextMenu)
      document.removeEventListener('paste',                  onPaste,      true)
      document.removeEventListener('copy',                   onCopy,       true)
      document.removeEventListener('dragstart',              onDragstart)
      document.removeEventListener('fullscreenchange',       onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      document.removeEventListener('mozfullscreenchange',    onFullscreenChange)
      document.removeEventListener('input',                  onInput,      true)
      window.removeEventListener('beforeunload',             onBeforeUnload)
      window.removeEventListener('blur',                     onBlur)
      // Restore original APIs on cleanup
      if (origGetDisplayMedia && navigator.mediaDevices) {
        navigator.mediaDevices.getDisplayMedia = origGetDisplayMedia
      }
      HTMLVideoElement.prototype.requestPictureInPicture = origReqPiP
      if (origDocPiP && window.documentPictureInPicture) {
        window.documentPictureInPicture.requestWindow = origDocPiP
      }
      window.Notification = OrigNotification
      if (OrigSpeech) {
        window.SpeechRecognition = OrigSpeech
        window.webkitSpeechRecognition = OrigSpeech
      }
      window.WebSocket = OrigWebSocket
      observer.disconnect()
      clearInterval(screenCheckId)
    }
  }, [triggerViolation, enterFullscreen])

  // DevTools size-based detection
  useEffect(() => {
    if (!cameraReady || submitted) return
    const id = setInterval(() => {
      if (window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160) {
        triggerViolation('DevTools Detected', 'Developer tools appear to be open. This has been recorded.')
      }
    }, 3000)
    return () => clearInterval(id)
  }, [cameraReady, submitted, triggerViolation])

  // Debugger-attached detection. `debugger;` is a no-op unless a debugger is
  // attached — when attached it pauses execution, which shows up as a large
  // wall-clock delay.
  useEffect(() => {
    if (!cameraReady || submitted) return
    const id = setInterval(() => {
      const t0 = performance.now()
      // eslint-disable-next-line no-debugger
      debugger
      const dt = performance.now() - t0
      if (dt > 120) {
        triggerViolation('Debugger Attached', 'A debugger appears to be attached to this window. This has been recorded.')
      }
    }, 4000)
    return () => clearInterval(id)
  }, [cameraReady, submitted, triggerViolation])

  // ── fullscreen watchdog — re-enters every 300 ms if lost ──────────────
  useEffect(() => {
    if (!cameraReady || submitted) return
    const id = setInterval(() => {
      const isFs = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement
      )
      if (!isFs) {
        enterFullscreen()
      } else {
        // Re-apply keyboard lock periodically so it never silently drops
        lockKeys()
      }
    }, 300)
    return () => clearInterval(id)
  }, [cameraReady, submitted, enterFullscreen, lockKeys])

  // ── question nav ───────────────────────────────────
  const saveAnswer = (val) => {
    setAnswers(prev => {
      const next = [...prev]
      next[currentQ] = val
      return next
    })
  }

  const goTo = (i) => setCurrentQ(i)

  const answeredCount = answers.filter(a => a !== null).length
  const isLast        = currentQ === QUESTIONS.length - 1
  const timerWarning  = secondsLeft <= 300

  // ── submit flow ────────────────────────────────────
  const handleSubmitClick = () => setShowSubmitModal(true)
  const confirmSubmit     = () => { setShowSubmitModal(false); doSubmit() }
  const cancelSubmit      = () => setShowSubmitModal(false)

  // ── render ─────────────────────────────────────────
  return (
    <div className={styles.root} style={{ userSelect: 'none' }} data-exam-root>

      {!cameraReady && !hwCheckPhase && <CameraOverlay onAllow={() => setHwCheckPhase(true)} error={cameraError} />}

      {!cameraReady && hwCheckPhase && (
        <HardwareCheck
          onAllPassed={startCamera}
          onBack={() => setHwCheckPhase(false)}
        />
      )}

      {violation && (
        <ViolationOverlay
          title={violation.title}
          message={violation.message}
          count={violation.count}
          maxViolations={MAX_VIOLATIONS}
          onResume={resumeExam}
        />
      )}

      {warning && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 9000,
          background: '#78350f', border: '1px solid #f59e0b',
          borderRadius: '10px', padding: '16px 20px', maxWidth: '360px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', gap: '14px',
          alignItems: 'flex-start',
        }}>
          <div style={{ flexShrink: 0, marginTop: '2px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#fde68a', marginBottom: '4px', fontSize: '15px' }}>
              Warning {warning.count}/{warning.max}: {warning.title}
            </div>
            <div style={{ color: '#fcd34d', fontSize: '13px', lineHeight: 1.45 }}>
              {warning.message}
            </div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#d97706' }}>
              {warning.max - warning.count} more warning{warning.max - warning.count !== 1 ? 's' : ''} before a violation is recorded.
            </div>
          </div>
        </div>
      )}

      {showSubmitModal && (
        <SubmitModal
          answeredCount={answeredCount}
          totalCount={QUESTIONS.length}
          onConfirm={confirmSubmit}
          onCancel={cancelSubmit}
        />
      )}

      {submitted && (
        <SuccessScreen
          user={user}
          answeredCount={answeredCount}
          totalCount={QUESTIONS.length}
          violations={violations}
        />
      )}

      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>
            <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="10" fill="#1e3a5f"/>
              <path d="M14 34V18l10-8 10 8v16H14z" fill="none" stroke="#fff" strokeWidth="2"/>
              <rect x="20" y="26" width="8" height="8" rx="1" fill="#fff"/>
            </svg>
            <span>ProctorExam</span>
          </div>
          <div className={styles.meta}>
            <span>{user.name}</span>
            <span className={styles.divider}>|</span>
            <span>Exam Code: <strong>EXAM001</strong></span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={`${styles.timerBox} ${timerWarning ? styles.timerWarning : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {formatTime(secondsLeft)}
          </div>
          <div
            className={`${styles.statusDot} ${cameraReady ? styles.dotOn : styles.dotOff}`}
            title={cameraReady ? 'Camera Active' : 'Camera Inactive'}
          />
        </div>
      </header>

      {/* LAYOUT */}
      <div className={styles.layout}>

        {/* QUESTION NAV */}
        <aside className={styles.qPanel}>
          <h3 className={styles.panelTitle}>Questions</h3>
          <div className={styles.qNav}>
            {QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={[
                  styles.qNavBtn,
                  i === currentQ          ? styles.qNavActive    : '',
                  answers[i] !== null     ? styles.qNavAnswered  : '',
                ].join(' ')}
              >
                <span className={styles.qNum}>Q{i + 1}</span>
                <span>{q.marks} M</span>
              </button>
            ))}
          </div>
          <div className={styles.legend}>
            <span><span className={`${styles.dot} ${styles.dotDone}`}/>Answered</span>
            <span><span className={`${styles.dot} ${styles.dotCurrent}`}/>Current</span>
            <span><span className={`${styles.dot} ${styles.dotEmpty}`}/>Unanswered</span>
          </div>
        </aside>

        {/* MAIN */}
        <main className={styles.main}>
          <div className={styles.qCard}>
            <div className={styles.qHeader}>
              <span className={styles.qBadge}>Q{currentQ + 1}</span>
              <span className={styles.qMarks}>{QUESTIONS[currentQ].marks} Marks</span>
            </div>
            <p className={styles.qText} style={{ userSelect: 'text' }}>
              {QUESTIONS[currentQ].text}
            </p>
            <div className={styles.answerArea}>
              <label>Choose the correct answer:</label>
              <div className={styles.mcqOptions}>
                {QUESTIONS[currentQ].options.map((opt, idx) => (
                  <button
                    key={idx}
                    className={`${styles.mcqOption} ${answers[currentQ] === idx ? styles.mcqSelected : ''}`}
                    onClick={() => saveAnswer(idx)}
                  >
                    <span className={styles.mcqLetter}>{String.fromCharCode(65 + idx)}</span>
                    <span className={styles.mcqText}>{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.navBtns}>
            <button
              className={styles.btnNav}
              onClick={() => goTo(currentQ - 1)}
              disabled={currentQ === 0}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Previous
            </button>

            {!isLast && (
              <button
                className={`${styles.btnNav} ${styles.btnNext}`}
                onClick={() => goTo(currentQ + 1)}
              >
                Next
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            )}

            {isLast && (
              <button className={styles.btnSubmit} onClick={handleSubmitClick}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Submit Exam
              </button>
            )}
          </div>
        </main>

        {/* CAMERA PANEL */}
        <aside className={styles.camPanel}>
          <div className={styles.camWrapper}>
            <video ref={videoRef} autoPlay muted={true} playsInline className={styles.camFeed} />
            <div className={styles.camLabel}>
              <span className={styles.recDot} />
              Live Monitoring
            </div>
          </div>

          {/* AI model status — shown below the camera feed */}
          <div style={{
            background: '#0f172a', border: '1px solid #1e293b',
            borderRadius: 8, padding: '8px 12px', fontSize: 11,
            color: '#94a3b8', fontFamily: 'monospace', lineHeight: 1.8,
            marginTop: 6,
          }}>
            <div>Face AI: <span style={{ color: debugInfo.faceReady ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>{debugInfo.faceReady ? 'READY' : 'Loading…'}</span>
              {debugInfo.faceReady && <span style={{ color: debugInfo.faces > 1 ? '#f87171' : '#4ade80', marginLeft: 8 }}>Faces: {debugInfo.faces}</span>}
            </div>
            <div>Person AI: <span style={{ color: debugInfo.personReady ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>{debugInfo.personReady ? 'READY' : 'Loading…'}</span>
              {debugInfo.personReady && <span style={{ color: debugInfo.persons > 1 ? '#f87171' : '#4ade80', marginLeft: 8 }}>Bodies: {debugInfo.persons}</span>}
            </div>
            <div>Eye Gaze: <span style={{ color: debugInfo.gazeOk ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>{debugInfo.gazeOk ? 'TRACKING' : 'Calibrating…'}</span></div>
            {debugInfo.err && <div style={{ color: '#f87171' }}>{debugInfo.err}</div>}
          </div>
          <div className={styles.proctorInfo}>
            <div className={styles.infoRow}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <span>{user.name}</span>
            </div>
            <div className={styles.infoRow}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>Violations: <strong style={{ color: '#f87171' }}>{violations}</strong> / {MAX_VIOLATIONS}</span>
            </div>
          </div>
        </aside>

      </div>
    </div>
  )
}
