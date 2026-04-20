// Mobile second-camera client.
// Flow:
//   1. Read pairing token from URL (?t=...)
//   2. Connect socket.io, register as mobile
//   3. Open camera, show preview
//   4. When admin requests a stream → create RTCPeerConnection offer → relay via server

const qs = new URLSearchParams(location.search)
const token = qs.get('t')

const statusEl = document.getElementById('status')
const overlay = document.getElementById('overlay')
const panelTitle = document.getElementById('panel-title')
const panelSub = document.getElementById('panel-sub')
const videoEl = document.getElementById('preview')
const flipBtn = document.getElementById('flip')
const sessionEl = document.getElementById('session')

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
  showPanel('Invalid link', 'This page must be opened from the QR code on the exam desktop.')
  setStatus('error', 'No token')
  throw new Error('missing token')
}

// ── Camera management ───────────────────────────────────────
let stream = null
let currentFacing = 'environment' // start rear (better for showing room + hands)

async function openCamera(facing) {
  if (stream) stream.getTracks().forEach(t => t.stop())
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
  } catch (e) {
    // Fallback with no facing constraint
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  }
  videoEl.srcObject = stream
  currentFacing = facing
  // Replace tracks in any active peer connection
  for (const pc of peerConnections.values()) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
    const videoTrack = stream.getVideoTracks()[0]
    if (sender && videoTrack) await sender.replaceTrack(videoTrack)
  }
}

flipBtn.addEventListener('click', async () => {
  const next = currentFacing === 'user' ? 'environment' : 'user'
  try { await openCamera(next) } catch { /* ignore */ }
})

// ── Socket + signaling ──────────────────────────────────────
const socket = io({
  query: { role: 'mobile' },
  transports: ['websocket', 'polling'],
  timeout: 45_000,
  reconnection: true,
  reconnectionDelay: 2000,
})
const peerConnections = new Map() // adminSocketId -> RTCPeerConnection
let sessionId = null

socket.on('connect', async () => {
  setStatus('pending', 'Pairing…')
  socket.emit('register:mobile', { token }, async (res) => {
    if (res?.error) {
      setStatus('error', 'Failed')
      showPanel('Pairing failed', 'Your link may have expired. Generate a new QR code from the exam app.')
      return
    }
    sessionId = res.sessionId
    sessionEl.textContent = 'Session ' + sessionId.slice(0, 8)
    setStatus('connected', 'Connected')
    hidePanel()
    try {
      await openCamera(currentFacing)
      // Announce camera-ready so admin viewers re-request a fresh offer with tracks
      socket.emit('stream:ready', { source: 'mobile' })
    } catch (e) {
      setStatus('error', 'Camera')
      showPanel('Camera access needed', 'Allow camera permission, then reload this page.')
    }
  })
})

socket.on('disconnect', () => {
  setStatus('error', 'Disconnected')
  showPanel('Connection lost', 'Attempting to reconnect…')
})

socket.on('desktop:disconnected', () => {
  showPanel('Desktop disconnected', 'The exam desktop is not connected. Check the student\u2019s computer.')
})

// When admin asks for the stream, create an offer toward that admin.
socket.on('webrtc:request_offer', async ({ adminSocketId, source }) => {
  if (source !== 'mobile') return
  try {
    if (!stream) await openCamera(currentFacing)

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    peerConnections.set(adminSocketId, pc)

    // Send our video to the admin
    for (const track of stream.getVideoTracks()) pc.addTrack(track, stream)

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc:signal', {
          sessionId, toRole: 'admin', toSocketId: adminSocketId,
          source: 'mobile', kind: 'ice', data: e.candidate,
        })
      }
    }

    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        peerConnections.delete(adminSocketId)
      }
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    socket.emit('webrtc:signal', {
      sessionId, toRole: 'admin', toSocketId: adminSocketId,
      source: 'mobile', kind: 'offer', data: offer,
    })
  } catch (e) {
    console.error('[mobile] offer error', e)
  }
})

socket.on('webrtc:signal', async (msg) => {
  if (msg.source !== 'mobile') return
  const pc = peerConnections.get(msg.fromSocketId)
  if (!pc) return
  try {
    if (msg.kind === 'answer') {
      await pc.setRemoteDescription(msg.data)
    } else if (msg.kind === 'ice') {
      await pc.addIceCandidate(msg.data)
    }
  } catch (e) {
    console.error('[mobile] signal error', e)
  }
})

// Keep phone awake — wake-lock best effort
;(async () => {
  try {
    if ('wakeLock' in navigator) {
      const lock = await navigator.wakeLock.request('screen')
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          try { await navigator.wakeLock.request('screen') } catch {}
        }
      })
    }
  } catch {}
})()
