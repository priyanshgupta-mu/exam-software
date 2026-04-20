// Socket.io client wrapper for the candidate (desktop) app.
// Handles: register, pairing events, start/stop dispatch, WebRTC publisher
// toward any number of admin viewers.
import { io } from 'socket.io-client'
import proctorConfig from '../../proctor.config.json'

// Priority: Vite env var (build-time override) > proctor.config.json > localhost
// eslint-disable-next-line no-undef
const SERVER_URL =
  (import.meta.env && import.meta.env.VITE_PROCTOR_SERVER) ||
  proctorConfig.serverUrl ||
  'http://localhost:4000'

// Wake the server before opening a socket — on free cloud tiers (Render, etc.)
// an idle service can take ~30s to cold-start, which exceeds the default
// socket.io handshake timeout. Hitting /api/health first warms the dyno.
async function wakeServer(url) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45_000)
    await fetch(`${url}/api/health`, { signal: controller.signal }).catch(() => {})
    clearTimeout(timer)
  } catch { /* ignore — the socket will still retry */ }
}

// Default STUN-only config used if /api/ice-servers hasn't returned yet.
const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }]

async function fetchIceServers(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/api/ice-servers`)
    const data = await res.json()
    if (Array.isArray(data.iceServers) && data.iceServers.length) return data.iceServers
  } catch {}
  return DEFAULT_ICE
}

export function createProctoringClient() {
  // Fire-and-forget — don't block client creation, but give the server a head start
  wakeServer(SERVER_URL)

  const socket = io(SERVER_URL, {
    query: { role: 'desktop' },
    transports: ['websocket', 'polling'],  // fallback for restrictive networks
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10_000,
    timeout: 45_000,  // tolerate Render cold starts
  })

  const peers = new Map() // adminSocketId -> RTCPeerConnection
  let localStream = null
  let iceServers = DEFAULT_ICE
  // Load ICE servers once; retry on miss is fine — new PCs will pick up the next result
  fetchIceServers(SERVER_URL).then(servers => { iceServers = servers })

  function attachLocalStream(stream) {
    localStream = stream
    // If admins were connected before stream was ready, replace tracks now
    for (const pc of peers.values()) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
      const videoTrack = stream.getVideoTracks()[0]
      if (sender && videoTrack) sender.replaceTrack(videoTrack)
      else if (videoTrack) pc.addTrack(videoTrack, stream)
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack && !pc.getSenders().some(s => s.track && s.track.kind === 'audio')) {
        pc.addTrack(audioTrack, stream)
      }
    }
    // Tell admins the stream is live so they can (re-)request a fresh offer
    socket.emit('stream:ready', { source: 'desktop' })
  }

  async function handleOfferRequest({ sessionId, adminSocketId, source }) {
    if (source !== 'desktop') return
    const pc = new RTCPeerConnection({ iceServers })
    peers.set(adminSocketId, pc)

    if (localStream) {
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream)
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc:signal', {
          sessionId, toRole: 'admin', toSocketId: adminSocketId,
          source: 'desktop', kind: 'ice', data: e.candidate,
        })
      }
    }

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        peers.delete(adminSocketId)
      }
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('webrtc:signal', {
      sessionId, toRole: 'admin', toSocketId: adminSocketId,
      source: 'desktop', kind: 'offer', data: offer,
    })
  }

  socket.on('webrtc:request_offer', handleOfferRequest)

  socket.on('webrtc:signal', async (msg) => {
    if (msg.source !== 'desktop') return
    const pc = peers.get(msg.fromSocketId)
    if (!pc) return
    try {
      if (msg.kind === 'answer') {
        await pc.setRemoteDescription(msg.data)
      } else if (msg.kind === 'ice') {
        await pc.addIceCandidate(msg.data)
      }
    } catch (e) {
      console.error('[proctoring] signal error', e)
    }
  })

  function register({ candidateId, candidateName, examCode }) {
    return new Promise((resolve) => {
      socket.emit('register:desktop', { candidateId, candidateName, examCode }, (res) => {
        resolve(res)
      })
    })
  }

  function reportViolation(violation) {
    socket.emit('proctor:violation', violation)
  }

  function close() {
    for (const pc of peers.values()) pc.close()
    peers.clear()
    socket.close()
  }

  return { socket, register, attachLocalStream, reportViolation, close, serverUrl: SERVER_URL }
}
