import express from 'express'
import http from 'node:http'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server as SocketIOServer } from 'socket.io'

import {
  createSession, getSession, detachSocket, listPublicSessions,
  setStatus, createPairingToken, consumePairingToken, publicSessionView,
  findSessionByDesktopSocket, findSessionByMobileSocket,
} from './sessions.js'
import { adminLogin, isAdminToken } from './auth.js'
import { primaryLanAddress } from './netinfo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 4000)
const LAN = primaryLanAddress()

// The URL browsers/phones will use to reach this server.
// Priority: explicit PUBLIC_URL → Render → Railway → LAN IP (dev).
function publicBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '')
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  return `http://${LAN}:${PORT}`
}

const app = express()
app.use(cors())
app.use(express.json())

// ── Mobile page (served over LAN to the candidate's phone) ─
app.use('/m', express.static(path.join(__dirname, 'public', 'mobile')))

// ── Admin panel (built) — served at /admin ─────────────────
const adminDist = path.resolve(__dirname, '..', 'admin', 'dist')
app.use('/admin', express.static(adminDist))
// SPA fallback so deep links work
app.get(/^\/admin(\/.*)?$/, (req, res, next) => {
  if (req.path.includes('.')) return next() // let static handle assets
  res.sendFile(path.join(adminDist, 'index.html'), (err) => {
    if (err) res.status(503).send(
      'Admin panel is not built yet. Run: npm run build:admin'
    )
  })
})

app.get('/', (_req, res) => {
  res.send(
    `<html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#e5e7eb">
      <h1>ProctorExam Server</h1>
      <ul>
        <li><a style="color:#BF991A" href="/admin/">/admin/</a> — Proctor dashboard</li>
        <li><a style="color:#BF991A" href="/api/health">/api/health</a> — Server health</li>
      </ul>
      <p style="color:#94a3b8">Mobile page is served at <code>/m/?t=&lt;token&gt;</code> (opened via QR).</p>
    </body></html>`
  )
})

// ── Admin login endpoint ────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {}
  const token = adminLogin(username, password)
  if (!token) return res.status(401).json({ error: 'invalid_credentials' })
  res.json({ token })
})

// ── Health / debug ──────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    lan: LAN,
    port: PORT,
    publicUrl: publicBaseUrl(),
    sessions: listPublicSessions().length,
  })
})

// ── ICE server list for WebRTC clients ──────────────────────
// STUN is free public, TURN is needed for NAT traversal across networks.
// Configure your own TURN via Render env vars: TURN_URL, TURN_USERNAME, TURN_PASSWORD
// (e.g. sign up at metered.ca / xirsys / twilio — free tiers available).
// Without env vars, we fall back to OpenRelay (public, best-effort, may be slow).
app.get('/api/ice-servers', (_req, res) => {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || '',
    })
  } else {
    // Public baseline — OpenRelay by Metered.ca. Works for most setups but has
    // a bandwidth cap and no SLA. Replace with your own in production.
    servers.push(
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    )
  }
  res.json({ iceServers: servers })
})

// Exchange a pairing token for its session id (used by mobile page bootstrap)
app.get('/api/pair/:token', (req, res) => {
  const sessionId = consumePairingToken(req.params.token)
  if (!sessionId) return res.status(404).json({ error: 'invalid_or_expired' })
  res.json({ sessionId })
})

const server = http.createServer(app)
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

// Socket namespaces by role via handshake query
const adminSockets = new Set()

function broadcastSessions() {
  const list = listPublicSessions()
  for (const id of adminSockets) {
    io.to(id).emit('sessions:list', list)
  }
}

function notifyAdmins(event, payload) {
  for (const id of adminSockets) io.to(id).emit(event, payload)
}

io.on('connection', (socket) => {
  const role = socket.handshake.query.role
  console.log(`[io] connect ${socket.id} role=${role}`)

  // ── Desktop (candidate Electron app) ──────────────────────
  socket.on('register:desktop', ({ candidateId, candidateName, examCode }, ack) => {
    const session = createSession({
      candidateId, candidateName, examCode, desktopSocketId: socket.id,
    })
    socket.data.sessionId = session.sessionId
    socket.data.role = 'desktop'
    socket.join(`session:${session.sessionId}`)

    const pairingToken = createPairingToken(session.sessionId)
    const mobileUrl = `${publicBaseUrl()}/m/?t=${pairingToken}`

    ack?.({
      sessionId: session.sessionId,
      pairingToken,
      mobileUrl,
    })
    broadcastSessions()
  })

  // ── Mobile (second camera) ────────────────────────────────
  socket.on('register:mobile', ({ token }, ack) => {
    const sessionId = consumePairingToken(token)
    if (!sessionId) return ack?.({ error: 'invalid_or_expired_token' })
    const session = getSession(sessionId)
    if (!session) return ack?.({ error: 'session_not_found' })

    session.mobileSocketId = socket.id
    socket.data.sessionId = sessionId
    socket.data.role = 'mobile'
    socket.join(`session:${sessionId}`)

    ack?.({ sessionId, candidateName: session.candidateName })

    // Tell the desktop its mobile is paired
    if (session.desktopSocketId) {
      io.to(session.desktopSocketId).emit('mobile:paired', { sessionId })
    }
    notifyAdmins('session:updated', publicSessionView(session))
    broadcastSessions()
  })

  // ── Admin panel ───────────────────────────────────────────
  socket.on('register:admin', ({ token }, ack) => {
    if (!isAdminToken(token)) return ack?.({ error: 'unauthorized' })
    adminSockets.add(socket.id)
    socket.data.role = 'admin'
    ack?.({ ok: true })
    socket.emit('sessions:list', listPublicSessions())
  })

  // ── Admin control events ──────────────────────────────────
  socket.on('admin:start_exam', ({ sessionId }) => {
    if (socket.data.role !== 'admin') return
    const s = setStatus(sessionId, 'active')
    if (!s) return
    io.to(`session:${sessionId}`).emit('exam:start', { sessionId })
    notifyAdmins('session:updated', publicSessionView(s))
  })

  socket.on('admin:stop_exam', ({ sessionId }) => {
    if (socket.data.role !== 'admin') return
    const s = setStatus(sessionId, 'ended')
    if (!s) return
    io.to(`session:${sessionId}`).emit('exam:stop', { sessionId })
    notifyAdmins('session:updated', publicSessionView(s))
  })

  // ── Admin requests fresh session list ─────────────────────
  socket.on('admin:list', () => {
    if (socket.data.role !== 'admin') return
    socket.emit('sessions:list', listPublicSessions())
  })

  // ── Proctoring events from desktop → forward to admins ───
  socket.on('proctor:violation', (payload) => {
    if (socket.data.role !== 'desktop') return
    const sid = socket.data.sessionId
    if (!sid) return
    notifyAdmins('proctor:violation', { sessionId: sid, ...payload })
  })

  // ── Stream readiness: emitted when desktop/mobile has its camera
  //    attached. Admins re-request offers so the new offer includes tracks.
  socket.on('stream:ready', ({ source }) => {
    const role = socket.data.role
    if (role !== 'desktop' && role !== 'mobile') return
    const sid = socket.data.sessionId
    if (!sid) return
    notifyAdmins('stream:ready', { sessionId: sid, source: source || role })
  })

  // ── WebRTC signaling relay ────────────────────────────────
  // payload shape: { sessionId, fromRole, toRole, source, data }
  socket.on('webrtc:signal', (msg) => {
    const { sessionId, toRole, source } = msg || {}
    const session = getSession(sessionId)
    if (!session) return

    // from is implicit — derive from socket.data.role
    const fromRole = socket.data.role
    const outgoing = { ...msg, fromRole, fromSocketId: socket.id }

    if (toRole === 'admin') {
      for (const id of adminSockets) io.to(id).emit('webrtc:signal', outgoing)
      return
    }
    if (toRole === 'desktop' && session.desktopSocketId) {
      io.to(session.desktopSocketId).emit('webrtc:signal', outgoing)
      return
    }
    if (toRole === 'mobile' && session.mobileSocketId) {
      io.to(session.mobileSocketId).emit('webrtc:signal', outgoing)
      return
    }
    // If toRole is an admin socket id (point-to-point for answers), honor it
    if (typeof msg.toSocketId === 'string') {
      io.to(msg.toSocketId).emit('webrtc:signal', outgoing)
    }
  })

  // ── Admin requests video from a specific source ──────────
  socket.on('admin:request_stream', ({ sessionId, source }) => {
    if (socket.data.role !== 'admin') return
    const session = getSession(sessionId)
    if (!session) return
    const targetSocketId = source === 'mobile' ? session.mobileSocketId : session.desktopSocketId
    if (!targetSocketId) return
    io.to(targetSocketId).emit('webrtc:request_offer', {
      sessionId,
      adminSocketId: socket.id,
      source,
    })
  })

  socket.on('disconnect', () => {
    adminSockets.delete(socket.id)
    const affected = detachSocket(socket.id)
    for (const { session, role } of affected) {
      if (role === 'desktop') {
        // Desktop dropped — notify mobile + admins
        if (session.mobileSocketId) {
          io.to(session.mobileSocketId).emit('desktop:disconnected')
        }
      }
      if (role === 'mobile') {
        if (session.desktopSocketId) {
          io.to(session.desktopSocketId).emit('mobile:disconnected')
        }
      }
      notifyAdmins('session:updated', publicSessionView(session))
    }
    broadcastSessions()
  })
})

// Trust proxy so Railway's TLS terminator reports correct protocol/hostname
app.set('trust proxy', 1)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on 0.0.0.0:${PORT}`)
  console.log(`[server] public URL: ${publicBaseUrl()}`)
  console.log(`[server] admin UI: ${publicBaseUrl()}/admin/`)
})
