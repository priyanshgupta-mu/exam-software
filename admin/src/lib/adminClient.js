import { io } from 'socket.io-client'

// When the admin panel is served by the backend (same origin), use that origin.
// In dev on port 5174, fall back to the local backend on 4000.
const SERVER_URL =
  import.meta.env.VITE_PROCTOR_SERVER ||
  (typeof window !== 'undefined' && window.location.port !== '5174'
    ? window.location.origin
    : 'http://localhost:4000')

export async function adminLoginHttp(username, password) {
  const res = await fetch(`${SERVER_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.token || null
}

export function connectAdminSocket(token) {
  const socket = io(SERVER_URL, { query: { role: 'admin' }, transports: ['websocket'] })
  return new Promise((resolve, reject) => {
    let resolved = false
    socket.on('connect', () => {
      socket.emit('register:admin', { token }, (res) => {
        if (res?.ok) { resolved = true; resolve(socket) }
        else reject(new Error(res?.error || 'register_failed'))
      })
    })
    socket.on('connect_error', (e) => {
      if (!resolved) reject(e)
    })
  })
}

export { SERVER_URL }
