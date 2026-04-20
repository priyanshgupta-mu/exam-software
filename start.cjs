const { spawn, spawnSync } = require('child_process')
const http = require('http')
const path = require('path')
const fs   = require('fs')

const electronBin = require('electron')
const ROOT = __dirname

const procs = []
function shutdown(code = 0) {
  for (const p of procs) { try { p.kill() } catch {} }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// ── 1. Ensure admin panel is built (so backend can serve it) ────────────
const adminDist = path.join(ROOT, 'admin', 'dist', 'index.html')
const adminSrc  = path.join(ROOT, 'admin', 'src')
function isAdminStale() {
  if (!fs.existsSync(adminDist)) return true
  try {
    const distMtime = fs.statSync(adminDist).mtimeMs
    let newestSrc = 0
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f)
        const st = fs.statSync(full)
        if (st.isDirectory()) walk(full)
        else if (st.mtimeMs > newestSrc) newestSrc = st.mtimeMs
      }
    }
    walk(adminSrc)
    return newestSrc > distMtime
  } catch { return true }
}
if (isAdminStale()) {
  console.log('[launcher] building admin panel (one-time)…')
  const r = spawnSync('npm', ['run', 'build:admin'], { stdio: 'inherit', shell: true, cwd: ROOT })
  if (r.status !== 0) {
    console.error('[launcher] admin build failed — aborting')
    process.exit(r.status || 1)
  }
}

// ── 2. Start the proctoring backend on port 4000 ───────────────────────
// Using `node` directly (not npm) so spawn issues on Windows don't swallow errors.
const serverScript = path.join(ROOT, 'server', 'index.js')
const server = spawn(process.execPath, [serverScript], {
  stdio: 'inherit',
  env: process.env,
  cwd: ROOT,
})
server.on('error', (e) => { console.error('[launcher] server error:', e); shutdown(1) })
server.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error('[launcher] server exited with code', code)
    shutdown(code)
  }
})
procs.push(server)

// ── 3. Start Vite dev server on port 3000 (candidate app) ──────────────
const vite = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true, cwd: ROOT })
vite.on('error', (e) => { console.error('[launcher] vite error:', e); shutdown(1) })
procs.push(vite)

// ── 4. Wait for both, then launch Electron ─────────────────────────────
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500) })
    req.on('error', () => resolve(false))
    req.setTimeout(800, () => { req.destroy(); resolve(false) })
  })
}

async function tryLaunch(attempts) {
  if (attempts <= 0) {
    console.error('[launcher] services never became ready (vite or server failed to start)')
    return shutdown(1)
  }
  const [viteOk, serverOk] = await Promise.all([
    ping('http://localhost:3000'),
    ping('http://localhost:4000/api/health'),
  ])
  if (!(viteOk && serverOk)) {
    if (attempts % 10 === 0) {
      console.log(`[launcher] waiting — vite=${viteOk} server=${serverOk}`)
    }
    return setTimeout(() => tryLaunch(attempts - 1), 500)
  }

  console.log('[launcher] ready — launching Electron')
  console.log('[launcher]   candidate : http://localhost:3000   (loaded in Electron)')
  console.log('[launcher]   admin     : http://localhost:4000/admin/')
  console.log('[launcher]   health    : http://localhost:4000/api/health')

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = spawn(electronBin, ['.'], { stdio: 'inherit', env, cwd: ROOT })
  procs.push(electron)

  electron.on('exit', () => shutdown(0))
  electron.on('error', (e) => { console.error('[launcher] electron error:', e); shutdown(1) })
}

setTimeout(() => tryLaunch(60), 1000)
