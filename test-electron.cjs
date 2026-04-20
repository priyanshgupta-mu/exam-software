console.log('process.type:', process.type)
// In Electron 28+, APIs split into electron/main and electron/renderer
try {
  const m = require('electron/main')
  console.log('electron/main type:', typeof m)
  console.log('electron/main app:', typeof m.app)
} catch(e) { console.log('electron/main error:', e.message) }

try {
  const m = require('electron')
  console.log('electron type:', typeof m, typeof m === 'object' ? Object.keys(m).slice(0,5) : m.slice(0,40))
} catch(e) { console.log('electron error:', e.message) }

process.exit(0)
