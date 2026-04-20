import { useEffect, useMemo, useState } from 'react'
import CandidateTile from './CandidateTile.jsx'

export default function Dashboard({ socket, onLogout }) {
  const [sessions, setSessions] = useState([])
  const [violationsBySession, setViolationsBySession] = useState({})

  useEffect(() => {
    const onList = (list) => setSessions(list)
    const onUpdated = (s) => {
      setSessions(prev => {
        const idx = prev.findIndex(x => x.sessionId === s.sessionId)
        if (idx === -1) return [...prev, s]
        const next = prev.slice()
        next[idx] = s
        return next
      })
    }
    const onViolation = ({ sessionId, title, message, at }) => {
      setViolationsBySession(prev => {
        const cur = prev[sessionId] || []
        const next = [{ title, message, at }, ...cur].slice(0, 20)
        return { ...prev, [sessionId]: next }
      })
    }

    socket.on('sessions:list', onList)
    socket.on('session:updated', onUpdated)
    socket.on('proctor:violation', onViolation)
    socket.emit('admin:list')

    return () => {
      socket.off('sessions:list', onList)
      socket.off('session:updated', onUpdated)
      socket.off('proctor:violation', onViolation)
    }
  }, [socket])

  const stats = useMemo(() => ({
    total: sessions.length,
    waiting: sessions.filter(s => s.status === 'waiting').length,
    active: sessions.filter(s => s.status === 'active').length,
    ended: sessions.filter(s => s.status === 'ended').length,
  }), [sessions])

  const startExam = (sessionId) => socket.emit('admin:start_exam', { sessionId })
  const stopExam = (sessionId) => socket.emit('admin:stop_exam', { sessionId })

  return (
    <div className="dash">
      <header className="dash-head">
        <div className="brand">
          <span style={{ fontSize: 17 }}>ProctorExam</span>
          <span className="badge">ADMIN</span>
        </div>
        <div className="dash-head-right">
          <span className="meta">
            {socket.connected ? <>Connected · {sessions.length} sessions</> : 'Disconnected'}
          </span>
          <button className="btn-ghost" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <div className="stats">
        <div className="stat"><div className="stat-label">Total</div><div className="stat-value">{stats.total}</div></div>
        <div className="stat"><div className="stat-label">Waiting</div><div className="stat-value" style={{ color: '#fbbf24' }}>{stats.waiting}</div></div>
        <div className="stat"><div className="stat-label">Active</div><div className="stat-value" style={{ color: '#4ade80' }}>{stats.active}</div></div>
        <div className="stat"><div className="stat-label">Ended</div><div className="stat-value" style={{ color: '#94a3b8' }}>{stats.ended}</div></div>
      </div>

      {sessions.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No active candidates</div>
          <div>Candidates will appear here once they log into the exam app.</div>
        </div>
      ) : (
        <div className="grid">
          {sessions.map(s => (
            <CandidateTile
              key={s.sessionId}
              session={s}
              socket={socket}
              violations={violationsBySession[s.sessionId] || []}
              onStart={() => startExam(s.sessionId)}
              onStop={() => stopExam(s.sessionId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
