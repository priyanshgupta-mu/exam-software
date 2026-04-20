import { useState } from 'react'
import Login from './components/Login'
import SessionGate from './components/SessionGate'
import Exam from './components/Exam'

export default function App() {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null) // { sessionId, client }

  if (session) {
    return (
      <Exam
        user={user}
        session={session}
        onExit={() => { setUser(null); setSession(null) }}
      />
    )
  }

  if (user) {
    return <SessionGate user={user} onStart={(s) => setSession(s)} />
  }

  return <Login onLogin={setUser} />
}
