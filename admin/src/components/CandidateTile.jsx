import { useEffect, useRef, useState } from 'react'
import { SERVER_URL } from '../lib/adminClient.js'

const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }]
let iceServersCache = null
async function loadIceServers() {
  if (iceServersCache) return iceServersCache
  try {
    const res = await fetch(`${SERVER_URL}/api/ice-servers`)
    const data = await res.json()
    iceServersCache = Array.isArray(data.iceServers) && data.iceServers.length
      ? data.iceServers : DEFAULT_ICE
  } catch { iceServersCache = DEFAULT_ICE }
  return iceServersCache
}

/**
 * Each tile subscribes to two WebRTC streams (desktop + mobile) for its session.
 * Flow:
 *   - Emit `admin:request_stream` for each source
 *   - Desktop/mobile create an RTCPeerConnection and send us an `offer`
 *   - We answer and attach any ICE candidates
 *   - Their `ontrack` event delivers the remote video element
 */
export default function CandidateTile({ session, socket, violations, onStart, onStop }) {
  const desktopRef = useRef(null)
  const mobileRef = useRef(null)
  const pcsRef = useRef({ desktop: null, mobile: null })

  useEffect(() => {
    if (session.status === 'ended') return

    const makeConnection = (source, iceServers) => {
      const existing = pcsRef.current[source]
      if (existing) { try { existing.close() } catch {} }

      const pc = new RTCPeerConnection({ iceServers })
      pcsRef.current[source] = pc

      pc.ontrack = (e) => {
        const videoEl = source === 'desktop' ? desktopRef.current : mobileRef.current
        if (videoEl && e.streams && e.streams[0]) {
          videoEl.srcObject = e.streams[0]
        }
      }

      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          pcsRef.current[source] = null
        }
      }

      return pc
    }

    const onSignal = async (msg) => {
      if (msg.sessionId !== session.sessionId) return
      const source = msg.source
      let pc = pcsRef.current[source]

      if (msg.kind === 'offer') {
        const iceServers = await loadIceServers()
        pc = makeConnection(source, iceServers)
        await pc.setRemoteDescription(msg.data)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('webrtc:signal', {
          sessionId: session.sessionId,
          toRole: source,  // desktop or mobile
          toSocketId: msg.fromSocketId,
          source,
          kind: 'answer',
          data: answer,
        })
        // Flush any ICE candidates we might receive next
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            socket.emit('webrtc:signal', {
              sessionId: session.sessionId,
              toRole: source,
              toSocketId: msg.fromSocketId,
              source,
              kind: 'ice',
              data: e.candidate,
            })
          }
        }
      } else if (msg.kind === 'ice' && pc) {
        try { await pc.addIceCandidate(msg.data) } catch {}
      }
    }

    socket.on('webrtc:signal', onSignal)

    // Ask for streams from whichever sources are present
    const ask = () => {
      if (session.desktopConnected) {
        socket.emit('admin:request_stream', { sessionId: session.sessionId, source: 'desktop' })
      }
      if (session.mobilePaired) {
        socket.emit('admin:request_stream', { sessionId: session.sessionId, source: 'mobile' })
      }
    }
    ask()

    // When the candidate (re)gets their camera, re-issue the offer
    const onStreamReady = ({ sessionId: sid, source }) => {
      if (sid !== session.sessionId) return
      socket.emit('admin:request_stream', { sessionId: session.sessionId, source })
    }
    socket.on('stream:ready', onStreamReady)

    return () => {
      socket.off('webrtc:signal', onSignal)
      socket.off('stream:ready', onStreamReady)
      for (const source of ['desktop', 'mobile']) {
        const pc = pcsRef.current[source]
        if (pc) { try { pc.close() } catch {} }
        pcsRef.current[source] = null
      }
    }
  }, [session.sessionId, session.desktopConnected, session.mobilePaired, session.status, socket])

  const isWaiting = session.status === 'waiting'
  const isActive = session.status === 'active'
  const isEnded = session.status === 'ended'

  return (
    <div className="tile">
      <div className="tile-head">
        <div>
          <div className="tile-name">{session.candidateName}</div>
          <div className="tile-meta">
            {session.candidateId} · {session.examCode} · {session.sessionId.slice(0, 8)}
          </div>
        </div>
        <span className={`status-pill status-${session.status}`}>{session.status}</span>
      </div>

      <div className="feeds">
        <div className="feed">
          <span className="feed-label">Desktop</span>
          {session.desktopConnected
            ? <video ref={desktopRef} autoPlay playsInline muted />
            : <div className="feed-placeholder">Desktop not connected</div>}
        </div>
        <div className="feed">
          <span className="feed-label">Mobile</span>
          {session.mobilePaired
            ? <video ref={mobileRef} autoPlay playsInline muted />
            : <div className="feed-placeholder">Mobile not paired</div>}
        </div>
      </div>

      {violations.length > 0 && (
        <div className="violations">
          {violations.slice(0, 5).map((v, i) => (
            <div key={i} className="violation-row">
              <span>{v.title}</span>
              <span>{new Date(v.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      <div className="tile-actions">
        <button
          className="btn btn-start"
          onClick={onStart}
          disabled={!isWaiting || !session.desktopConnected}
        >
          Start Exam
        </button>
        <button
          className="btn btn-stop"
          onClick={onStop}
          disabled={!isActive}
        >
          Stop Exam
        </button>
      </div>
    </div>
  )
}
