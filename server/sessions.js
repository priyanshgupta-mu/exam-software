import crypto from 'node:crypto'

const sessions = new Map()
const pairingTokens = new Map()

export function createSession({ candidateId, candidateName, examCode, desktopSocketId }) {
  const sessionId = crypto.randomUUID()
  const session = {
    sessionId,
    candidateId,
    candidateName,
    examCode,
    desktopSocketId,
    mobileSocketId: null,
    status: 'waiting',
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
  }
  sessions.set(sessionId, session)
  return session
}

export function getSession(id) {
  return sessions.get(id)
}

export function findSessionByDesktopSocket(socketId) {
  for (const s of sessions.values()) {
    if (s.desktopSocketId === socketId) return s
  }
  return null
}

export function findSessionByMobileSocket(socketId) {
  for (const s of sessions.values()) {
    if (s.mobileSocketId === socketId) return s
  }
  return null
}

export function detachSocket(socketId) {
  const affected = []
  for (const s of sessions.values()) {
    if (s.desktopSocketId === socketId) {
      s.desktopSocketId = null
      affected.push({ session: s, role: 'desktop' })
    }
    if (s.mobileSocketId === socketId) {
      s.mobileSocketId = null
      affected.push({ session: s, role: 'mobile' })
    }
  }
  return affected
}

export function publicSessionView(s) {
  return {
    sessionId: s.sessionId,
    candidateId: s.candidateId,
    candidateName: s.candidateName,
    examCode: s.examCode,
    status: s.status,
    desktopConnected: !!s.desktopSocketId,
    mobilePaired: !!s.mobileSocketId,
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
  }
}

export function listPublicSessions() {
  return Array.from(sessions.values()).map(publicSessionView)
}

export function setStatus(sessionId, status) {
  const s = sessions.get(sessionId)
  if (!s) return null
  s.status = status
  if (status === 'active' && !s.startedAt) s.startedAt = Date.now()
  if (status === 'ended' && !s.endedAt) s.endedAt = Date.now()
  return s
}

export function removeSession(sessionId) {
  sessions.delete(sessionId)
}

// ── QR pairing tokens ─────────────────────────────────────
export function createPairingToken(sessionId, ttlMs = 120_000) {
  const token = crypto.randomBytes(16).toString('hex')
  pairingTokens.set(token, { sessionId, expiresAt: Date.now() + ttlMs })
  setTimeout(() => pairingTokens.delete(token), ttlMs + 2000).unref?.()
  return token
}

export function consumePairingToken(token) {
  const entry = pairingTokens.get(token)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    pairingTokens.delete(token)
    return null
  }
  pairingTokens.delete(token)
  return entry.sessionId
}
