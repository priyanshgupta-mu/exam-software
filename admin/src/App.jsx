import { useEffect, useRef, useState } from 'react'
import Login from './components/Login.jsx'
import Dashboard from './components/Dashboard.jsx'
import { connectAdminSocket } from './lib/adminClient.js'

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('admin_token') || '')
  const [socket, setSocket] = useState(null)
  const [error, setError] = useState('')
  const socketRef = useRef(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    connectAdminSocket(token)
      .then((s) => {
        if (cancelled) { s.close(); return }
        socketRef.current = s
        setSocket(s)
      })
      .catch((e) => {
        setError('Could not connect to proctoring server: ' + (e?.message || 'error'))
        sessionStorage.removeItem('admin_token')
        setToken('')
      })
    return () => {
      cancelled = true
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [token])

  const handleLogin = (t) => {
    sessionStorage.setItem('admin_token', t)
    setError('')
    setToken(t)
  }

  const handleLogout = () => {
    socketRef.current?.close()
    sessionStorage.removeItem('admin_token')
    setSocket(null)
    setToken('')
  }

  if (!token || !socket) {
    return <Login onLogin={handleLogin} pendingConnect={!!token} error={error} />
  }
  return <Dashboard socket={socket} onLogout={handleLogout} />
}
