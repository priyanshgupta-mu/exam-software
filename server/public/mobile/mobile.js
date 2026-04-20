// Mobile second-camera client.
// Flow:
//   1. Pair with backend (socket.io registers mobile as second cam for a session)
//   2. Wait for admin to emit `exam:start`
//   3. User picks handedness
//   4. User does a "surroundings sweep" — rear camera, they pan around the room
//   5. User positions phone (diagram + checklist), confirms
//   6. Live monitoring: full-screen camera + running face detection via BlazeFace
//      Violations (no face / multiple faces) are reported to admin via socket.
//
// Note: what goes over WebRTC is the raw camera track — CSS mirror on the
// local preview does NOT affect the admin feed.

const qs = new URLSearchParams(location.search)
const token = qs.get('t')

const $ = (id) => document.getElementById(id)
const screens = {
  wait: $('screen-wait'),
  hand: $('screen-hand'),
  sweep: $('screen-sweep'),
  pos: $('screen-pos'),
  live: $('screen-live'),
}
function show(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle('hidden', k !== name)
}

const statusEl = $('status')
const overlay = $('overlay')
const panelTitle = $('panel-title')
const panelSub = $('panel-sub')
const videoEl = $('preview')
const sweepVideoEl = $('sweep-video')
const sessionLabel = $('live-session')
const waitTitle = $('wait-title')
const waitSub = $('wait-sub')
const liveHint = $('live-hint')

function setStatus(kind, text) {
  statusEl.className = 'status status-' + kind
  statusEl.textContent = text
}
function showPanel(title, sub) {
  panelTitle.textContent = title
  panelSub.textContent = sub || ''
  overlay.classList.add('show')
}
function hidePanel() { overlay.classList.remove('show') }

if (!token) {
  show('wait')
  showPanel('Invalid link', 'This page must be opened from the QR code on the exam desktop.')
  setStatus('error', 'No token')
  throw new Error('missing token')
}

// ── State ───────────────────────────────────────────────────
let sessionId = null
let handedness = null           // 'right' | 'left'
let stream = null
let currentFacing = 'user'      // start with front (selfie) for better face detection on desk
let proctoringActive = false    // admin can pause/resume
let faceModel = null            // BlazeFace
let faceLoopId = null
let noFaceTicks = 0
let multiFaceTicks = 0
let lastReportedViolation = 0   // throttle to 1 per 8 seconds

// ── ICE servers (STUN + TURN) ───────────────────────────────
let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
fetch('/api/ice-servers')
  .then(r => r.json())
  .then(d => { if (Array.isArray(d.iceServers) && d.iceServers.length) iceServers = d.iceServers })
  .catch(() => {})

// ── Socket ──────────────────────────────────────────────────
const socket = io({
  query: { role: 'mobile' },
  transports: ['websocket', 'polling'],
  timeout: 45_000,
  reconnection: true,
  reconnectionDelay: 2000,
})
const peerConnections = new Map() // adminSocketId -> RTCPeerConnection

socket.on('connect', () => {
  setStatus('pending', 'Pairing…')
  socket.emit('register:mobile', { token }, (res) => {
    if (res?.error) {
      setStatus('error', 'Failed')
      showPanel('Pairing failed', 'Your link may have expired. Generate a new QR from the exam app.')
      return
    }
    sessionId = res.sessionId
    sessionLabel.textContent = 'Session ' + sessionId.slice(0, 8)
    setStatus('connected', 'Paired')
    waitTitle.textContent = 'Waiting for proctor to start the exam'
    waitSub.textContent = 'Keep this page open. The camera will turn on automatically when the exam begins.'
  })
})

socket.on('disconnect', () => {
  setStatus('error', 'Disconnected')
})
socket.on('desktop:disconnected', () => {
  showPanel('Desktop disconnected', 'The student\u2019s computer is no longer connected.')
})

// Server tells us the exam has started → begin the wizard
socket.on('exam:start', async () => {
  hidePanel()
  show('hand')
})

// Admin can stop mid-exam
socket.on('exam:stop', () => {
  proctoringActive = false
  stopFaceLoop()
  if (stream) stream.getTracks().forEach(t => t.stop())
  stream = null
  show('wait')
  waitTitle.textContent = 'Exam ended'
  waitSub.textContent = 'You may close this page.'
})

// Admin can pause/resume mobile face detection mid-exam
socket.on('proctor:pause', () => { proctoringActive = false; liveHint.textContent = 'Proctor paused monitoring.' })
socket.on('proctor:resume', () => { proctoringActive = true; liveHint.textContent = 'Keep the phone steady. Do not touch it.' })

// ── Step: handedness ────────────────────────────────────────
document.querySelectorAll('.hand-card').forEach(btn => {
  btn.addEventListener('click', async () => {
    handedness = btn.dataset.hand
    socket.emit('mobile:handedness', { sessionId, handedness })
    // Start rear camera for the sweep
    await openCamera('environment', sweepVideoEl)
    show('sweep')
  })
})

// ── Step: surroundings sweep ────────────────────────────────
$('sweep-done').addEventListener('click', () => {
  // Prep position-step instructions
  const side = handedness === 'right' ? 'left' : 'right'
  const posInstruction = $('pos-instruction')
  posInstruction.innerHTML =
    `Place the phone on your <strong>${side}</strong> side, about 30–50 cm away from your head. ` +
    `Angle it roughly <strong>45°</strong> so it sees your face from the side AND your desk/hands in the same frame.`
  $('pos-side-label').textContent = `Phone on your ${side}`
  $('pos-phone-icon').textContent = '📱'
  const diagram = document.querySelector('.pos-diagram')
  diagram.classList.toggle('left', handedness === 'left')
  show('pos')
})

// ── Step: position confirmed → go live ──────────────────────
$('pos-done').addEventListener('click', async () => {
  // Switch to front camera (user-facing) for the actual monitoring
  await openCamera('user', videoEl)
  show('live')
  // Try to enter fullscreen for distraction-free view (user gesture required)
  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => {})
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen()
    }
  } catch { /* iOS Safari often blocks this — preview fills screen via CSS anyway */ }
  proctoringActive = true
  socket.emit('stream:ready', { source: 'mobile' })
  loadFaceModelAndStart()
})

// ── Camera management ───────────────────────────────────────
async function openCamera(facing, previewTarget) {
  if (stream) stream.getTracks().forEach(t => t.stop())
  try {
    // Mobile resolution cap: 640x480 at 15fps — enough for proctoring, huge drop
    // in CPU/bandwidth vs default 720p/30fps.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width:      { ideal: 640, max: 960 },
        height:     { ideal: 480, max: 720 },
        frameRate:  { ideal: 15, max: 20 },
      },
      audio: false,
    })
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  }
  currentFacing = facing
  if (previewTarget) {
    previewTarget.srcObject = stream
    // Mirror the local preview only for the user-facing (selfie) camera.
    // The stream sent to admin is NOT mirrored — admin sees real orientation.
    previewTarget.classList.toggle('mirror', facing === 'user')
  }
  // Swap track into any existing peer connections
  for (const pc of peerConnections.values()) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
    const videoTrack = stream.getVideoTracks()[0]
    if (sender && videoTrack) await sender.replaceTrack(videoTrack)
  }
}

// ── WebRTC: answer admin requests ───────────────────────────
socket.on('webrtc:request_offer', async ({ adminSocketId, source }) => {
  if (source !== 'mobile') return
  console.log('[mobile] webrtc:request_offer from admin', adminSocketId, 'stream?', !!stream)
  if (!stream) {
    console.log('[mobile] no stream yet — will respond on stream:ready')
    return
  }

  // Close any previous PC for this admin (prevents orphans on retries)
  const prev = peerConnections.get(adminSocketId)
  if (prev) { try { prev.close() } catch {} }

  const pc = new RTCPeerConnection({ iceServers })
  peerConnections.set(adminSocketId, pc)

  // Set handlers BEFORE adding tracks / creating offer so nothing is missed
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('webrtc:signal', {
        sessionId, toRole: 'admin', toSocketId: adminSocketId,
        source: 'mobile', kind: 'ice', data: e.candidate,
      })
    }
  }
  pc.oniceconnectionstatechange = () => {
    console.log('[mobile] iceConnectionState:', pc.iceConnectionState)
  }
  pc.onconnectionstatechange = () => {
    console.log('[mobile] connectionState:', pc.connectionState)
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      peerConnections.delete(adminSocketId)
    }
  }

  for (const track of stream.getVideoTracks()) pc.addTrack(track, stream)

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  console.log('[mobile] sent offer to admin', adminSocketId)
  socket.emit('webrtc:signal', {
    sessionId, toRole: 'admin', toSocketId: adminSocketId,
    source: 'mobile', kind: 'offer', data: offer,
  })

  // Cap sender bitrate → 400 kbps, 15fps. Proctoring doesn't need more.
  try {
    for (const sender of pc.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue
      const params = sender.getParameters()
      params.encodings = params.encodings?.length ? params.encodings : [{}]
      for (const enc of params.encodings) {
        enc.maxBitrate = 400_000
        enc.maxFramerate = 15
      }
      await sender.setParameters(params)
    }
  } catch {}
})

socket.on('webrtc:signal', async (msg) => {
  if (msg.source !== 'mobile') return
  const pc = peerConnections.get(msg.fromSocketId)
  if (!pc) {
    console.warn('[mobile] signal for unknown PC:', msg.kind, msg.fromSocketId)
    return
  }
  try {
    if (msg.kind === 'answer') {
      console.log('[mobile] received answer from admin', msg.fromSocketId)
      await pc.setRemoteDescription(msg.data)
    } else if (msg.kind === 'ice') {
      await pc.addIceCandidate(msg.data)
    }
  } catch (e) {
    console.error('[mobile] signal handler error', e)
  }
})

// ── Face detection (mobile-side proctoring) ─────────────────
async function loadFaceModelAndStart() {
  try {
    // Load TF.js + BlazeFace from CDN (served over HTTPS from Render, so OK on iOS)
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js')
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.1.0/dist/blazeface.min.js')
    // eslint-disable-next-line no-undef
    faceModel = await blazeface.load()
  } catch (e) {
    console.warn('[mobile] BlazeFace load failed — continuing without phone-side AI', e)
    return
  }

  // Reuse offscreen canvas so we don't allocate every tick
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  async function tick() {
    if (!proctoringActive || !faceModel || !videoEl || videoEl.readyState < 2) return
    try {
      const W = videoEl.videoWidth || 320
      const H = videoEl.videoHeight || 240
      canvas.width = W; canvas.height = H
      ctx.drawImage(videoEl, 0, 0, W, H)
      const faces = await faceModel.estimateFaces(videoEl, false)
      const count = faces.length

      if (count === 0) {
        noFaceTicks++
        multiFaceTicks = 0
        if (noFaceTicks >= 4) {  // 4 × ~700ms = ~3s of no face
          reportViolation('Mobile: No Face Visible',
            'The phone camera cannot see anyone. The candidate may have moved out of frame.')
          noFaceTicks = 0
        }
      } else if (count > 1) {
        multiFaceTicks++
        noFaceTicks = 0
        if (multiFaceTicks >= 2) {
          reportViolation('Mobile: Multiple People Detected',
            'More than one person is visible to the phone camera. Another person may be in the room.')
          multiFaceTicks = 0
        }
      } else {
        noFaceTicks = Math.max(0, noFaceTicks - 1)
        multiFaceTicks = 0
      }
    } catch { /* skip frame */ }
  }

  faceLoopId = setInterval(tick, 700)
}

function stopFaceLoop() {
  if (faceLoopId) { clearInterval(faceLoopId); faceLoopId = null }
}

function reportViolation(title, message) {
  const now = Date.now()
  if (now - lastReportedViolation < 8000) return  // 8s throttle
  lastReportedViolation = now
  socket.emit('proctor:violation', { title, message, source: 'mobile', at: now })
  liveHint.textContent = '⚠ ' + title
  liveHint.classList.add('alert')
  setTimeout(() => {
    liveHint.textContent = 'Keep the phone steady. Do not touch it.'
    liveHint.classList.remove('alert')
  }, 4000)
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('load failed: ' + src))
    document.head.appendChild(s)
  })
}

// ── Keep phone awake ─────────────────────────────────────────
;(async () => {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen').catch(() => {})
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          try { await navigator.wakeLock.request('screen') } catch {}
        }
      })
    }
  } catch {}
})()
