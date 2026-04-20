// ── Render (headless Linux) shim ───────────────────────────────────────────
// Render invokes this file as the start command but has no display/Electron.
// When running on Render (RENDER env var is injected automatically),
// hand off to the proctoring server instead of booting Electron.
if (process.env.RENDER) {
  require(require('path').join(__dirname, '..', 'server', 'index.js'))
  return
}

const { app, BrowserWindow, globalShortcut, powerSaveBlocker, ipcMain, dialog, systemPreferences, screen } = require('electron')
const { exec } = require('child_process')
const fs   = require('fs')
const path = require('path')

const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'

// ── Proctoring server allowlist (loaded from proctor.config.json) ─────────
// This is how the candidate Electron app knows which remote host to trust.
// In dev: file at repo root. In packaged app: bundled at resources/app/proctor.config.json
// (electron-builder copies anything matching "files" into the asar).
let PROCTOR_SERVER_HOST = ''
const cfgCandidates = [
  path.join(__dirname, '..', 'proctor.config.json'),          // dev
  path.join(process.resourcesPath || '', 'app', 'proctor.config.json'), // packaged (unpacked)
  path.join(process.resourcesPath || '', 'app.asar', 'proctor.config.json'), // packaged (asar)
]
for (const p of cfgCandidates) {
  try {
    const cfg = require(p)
    if (cfg && cfg.serverUrl) {
      PROCTOR_SERVER_HOST = new URL(cfg.serverUrl).host.toLowerCase()
      console.log('[proctor] loaded config from:', p)
      break
    }
  } catch {}
}
if (!PROCTOR_SERVER_HOST) {
  console.error('[proctor] proctor.config.json NOT FOUND — network filter will block the remote server. Tried:', cfgCandidates)
}
console.log('[proctor] proctor server host:', PROCTOR_SERVER_HOST || '(none)')

// ── Blocked processes (checked on both platforms) ──────────────────────────
// Windows: matched against tasklist output (process image names)
const BLOCKED_PROCESSES_WIN = [
  // VPN clients
  'nordvpn', 'nordvpnservice',
  'expressvpn', 'expressvpnservice',
  'protonvpn', 'protonvpnservice',
  'windscribe', 'windscribeservice',
  'mullvad-vpn', 'mullvad-daemon',
  'surfshark', 'surfsharksvc',
  'hotspotshield', 'hotspotshieldsvc',
  'tunnelbear', 'tunnelbearhelper',
  'cyberghost', 'cyberghostsvc',
  'openvpn', 'openvpnserv',
  'wireguard', 'wireguardtunnel',
  'ipvanish', 'purevpn', 'pia_manager', 'privateinternetaccess',
  'hideguard', 'ultrasurf', 'psiphon',
  // AI / GPT answer assistants — desktop apps
  'copilot', 'windowscopilot', 'microsoft copilot',
  'cursor.exe', 'windsurf', 'windsurf.exe',
  'monica', 'merlin',
  'superwhisper', 'whisperdesktop',
  'chatgpt', 'chatgpt.exe', 'com.openai.chatgpt',
  'claude', 'claude.exe',
  'gemini', 'gemini.exe',
  'perplexity', 'perplexity.exe', 'poe', 'poe.exe',
  'deepseek', 'deepseek.exe',
  'tabnine', 'tabnine.exe', 'codeium', 'codeium.exe', 'sourcegraph',
  'grammarly', 'quillbot', 'wordtune',
  // AI local runners / coding assistants
  'ollama', 'ollama.exe', 'ollama_llama_server',
  'lmstudio', 'lm studio', 'lm-studio',
  'gpt4all', 'gpt4all.exe',
  'jan', 'jan.exe',
  'msty', 'msty.exe',
  'koboldcpp', 'llamacpp', 'llama-server',
  'oobabooga', 'text-generation-webui',
  'open-interpreter', 'interpreter',
  'aider', 'aider.exe',
  'continue', 'pieces', 'pieces.exe', 'piecesos',
  // AI browser extensions that run as separate processes
  'sider', 'sider.exe',
  'maxai', 'maxai.exe',
  'harpa', 'harpa.exe',
  'typingmind', 'usechatgpt',
  // Amazon / JetBrains AI
  'amazonq', 'amazon-q', 'codewhisperer',
  // IDEs with AI
  'code.exe', 'code - insiders', 'zed', 'zed.exe',
  'jetbrains', 'idea64.exe', 'pycharm64.exe', 'webstorm64.exe', 'goland64.exe',
  'rider64.exe', 'clion64.exe', 'phpstorm64.exe', 'rubymine64.exe', 'datagrip64.exe',
  'replit', 'replit.exe',
  'warp.exe',
  // Screen capture / broadcast / virtual camera
  'obs64', 'obs32', 'obs.exe',
  'streamlabs', 'streamlabsobs',
  'xsplit', 'bandicam', 'camtasia', 'fraps',
  'shadowplay', 'nvcplui',
  'loom', 'screenflow', 'snagit',
  'snap camera', 'nvidia broadcast', 'mmhmm',
  'cleanshot', 'textsniper',
  // Remote desktop / access
  'teamviewer', 'teamviewer_service',
  'anydesk', 'rustdesk',
  'ultravnc', 'tvnserver', 'vncserver',
  'rdpclip', 'mstsc',
  'parsec', 'ammyy_admin', 'logmein', 'splashtop',
  // Communication apps
  'discord', 'slack', 'telegram',
  'whatsapp', 'signal',
  'zoom', 'teams', 'msteams', 'webex', 'skype',
  // Clipboard managers
  'ditto', 'clipy', 'pastebot', 'pasta',
  // Overlay / always-on-top / PiP tools
  'ontopreplica', 'deskpins', 'pennywise', 'helium',
  'pipmytool', 'windowtop', 'always on top',
  'glasswire', 'rainmeter', 'rainmeter.exe',
  'widgets.exe', 'widget',
  'stickies', 'stickynotes', 'microsoft.notes',
  'notezilla', 'simple sticky notes',
  // Automation / macro / scripting tools
  'autohotkey', 'autohotkey.exe', 'autohotkey64.exe', 'autohotkey32.exe',
  'ahk', 'ahk.exe',
  'autoit', 'autoit3.exe', 'autoit3_x64.exe',
  'tinytask', 'tinytask.exe',
  'macro recorder', 'jitbit',
  'pyautogui', 'xdotool',
  'nircmd', 'nircmd.exe',
  // Script hosts (can run overlay/cheat scripts)
  'powershell_ise', 'powershell_ise.exe',
  'cmd.exe', 'conhost.exe', 'windowsterminal.exe', 'wt.exe',
  'terminal.exe', 'mintty.exe', 'gitbash.exe',
  'python.exe', 'pythonw.exe', 'python3.exe',
  'node.exe', 'bun.exe', 'deno.exe',
  // Accessibility exploits
  'magnify.exe', 'narrator.exe',
  // Notification / toast spammers
  'pushbullet', 'pushover',
]

// macOS: matched against the process command (last path component from ps)
// Must be specific to avoid matching system processes (e.g. 'cursor' matches macOS cursor agent)
const BLOCKED_PROCESSES_MAC = [
  // VPN clients
  'nordvpn', 'nordvpnservice', 'nordvpnd',
  'expressvpn', 'expressvpnservice', 'expressvpnd',
  'protonvpn', 'protonvpnservice', 'protonvpnd',
  'windscribe', 'windscribeservice',
  'mullvad-vpn', 'mullvad-daemon', 'mullvadvpn',
  'surfshark', 'tunnelbear', 'tunnelbearhelper',
  'cyberghost', 'openvpn', 'wireguard',
  'ipvanish', 'purevpn', 'psiphon',
  // AI / GPT answer assistants — use the exact .app binary names
  'cursor helper', 'cursor helper (plugin)',
  'windsurf', 'monica', 'merlin',
  'superwhisper', 'raycast', 'alfred',
  'chatgpt', 'claude', 'gemini', 'perplexity', 'poe',
  'deepseek',
  'tabnine', 'codeium', 'sourcegraph',
  'grammarly', 'quillbot', 'wordtune',
  // AI local runners / coding assistants
  'ollama', 'ollama_llama_server',
  'lmstudio', 'lm studio',
  'gpt4all', 'jan', 'msty',
  'koboldcpp', 'llama-server', 'llamacpp',
  'text-generation-webui',
  'open-interpreter', 'interpreter',
  'aider', 'continue', 'pieces', 'piecesos',
  // AI browser extensions that run as separate processes
  'sider', 'maxai', 'harpa',
  // Amazon / JetBrains AI
  'amazonq', 'amazon-q', 'codewhisperer',
  // IDEs with AI — match Electron helper names
  'code helper', 'code helper (plugin)', 'code - insiders',
  'zed',
  'idea', 'pycharm', 'webstorm', 'goland', 'rider', 'clion', 'phpstorm', 'rubymine', 'datagrip',
  'replit',
  'warp',
  // Screen capture / broadcast / virtual camera
  'obs', 'streamlabs', 'xsplit',
  'bandicam', 'camtasia',
  'loom', 'screenflow', 'snagit',
  'snap camera', 'mmhmm', 'ecamm',
  'cleanshot x', 'textsniper',
  // Remote desktop / access
  'teamviewer', 'teamviewerd',
  'anydesk', 'anydeskd', 'rustdesk',
  'parsec', 'logmein', 'splashtop',
  // Communication apps
  'discord', 'slack', 'telegram',
  'whatsapp', 'signal',
  'zoom.us', 'teams', 'msteams', 'webex', 'skype',
  // Clipboard managers
  'clipy', 'pastebot', 'pasta',
  // Overlay / always-on-top / PiP tools
  'helium', 'pennywise', 'deskpins',
  'windowtop', 'ontopreplica',
  'stickies', 'notezilla',
  // Automation / macro / scripting tools
  'automator', 'keyboard maestro',
  'hammerspoon', 'bettertouchtool',
  'karabiner', 'iterm2', 'terminal',
  // Script hosts
  'python3', 'python', 'node', 'bun', 'deno',
  // Notification / toast
  'pushbullet', 'pushover',
]

// ── Browser window title keywords (catches AI tools open in Chrome/Edge/Firefox) ──
const AI_WINDOW_TITLE_KEYWORDS = [
  'chatgpt', 'chat.openai.com', 'chatgpt.com',
  'claude.ai', 'claude - anthropic', 'anthropic',
  'gemini.google', 'gemini - google', 'google gemini',
  'copilot.microsoft', 'microsoft copilot',
  'perplexity.ai', 'perplexity -',
  'deepseek', 'chat.deepseek',
  'poe.com', 'poe -',
  'you.com', 'you.com/chat',
  'phind.com', 'phind -',
  'huggingface.co/chat', 'hugging face chat', 'huggingchat',
  'bard.google',
  'pi.ai',
  'character.ai', 'character.ai -',
  'mistral.ai', 'le chat - mistral', 'chat.mistral',
  'groq.com', 'groqcloud',
  'together.ai',
  'notebooklm',
  'meta.ai', 'meta ai',
  'grok', 'x.ai',
  'codeium.com', 'sourcegraph.com',
  'blackbox ai', 'blackbox.ai',
  'cody ai', 'cody -',
  'replit.com', 'replit -',
  'bolt.new', 'v0.dev', 'vercel v0',
  'cursor.sh', 'cursor -',
  'jasper.ai', 'jasper -',
  'copy.ai', 'writesonic', 'rytr',
  'quillbot.com', 'wordtune.com', 'grammarly',
  'otter.ai',
  'wolfram alpha', 'wolframalpha',
  'chegg', 'chegg.com',
  'coursehero', 'course hero',
  'brainly', 'brainly.com',
  'bartleby', 'studocu', 'numerade',
  'symbolab', 'mathway', 'photomath',
  'socratic', 'socratic.org',
]

// ── Virtual machine / emulation detection ──────────────────────────────────
function detectVirtualMachine (callback) {
  if (IS_WIN) {
    const cmd = 'wmic computersystem get manufacturer,model /format:list 2>nul'
    exec(cmd, (err, stdout) => {
      if (err || !stdout) {
        // Fallback: PowerShell (wmic deprecated in Win11 24H2+)
        exec('powershell -NoProfile -Command "Get-WmiObject Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json" 2>nul', (e2, out2) => {
          if (e2 || !out2) return callback(false, null)
          const lower = out2.toLowerCase()
          const hit = VM_STRINGS.find(v => lower.includes(v))
          callback(!!hit, hit || null)
        })
        return
      }
      const lower = stdout.toLowerCase()
      const hit = VM_STRINGS.find(v => lower.includes(v))
      callback(!!hit, hit || null)
    })
  } else if (IS_MAC) {
    exec('system_profiler SPHardwareDataType 2>/dev/null', (err, stdout) => {
      if (err || !stdout) return callback(false, null)
      const lower = stdout.toLowerCase()
      const hit = VM_STRINGS.find(v => lower.includes(v))
      callback(!!hit, hit || null)
    })
  } else {
    callback(false, null)
  }
}

const VM_STRINGS = [
  'vmware', 'virtualbox', 'vbox', 'qemu', 'xen', 'innotek',
  'parallels', 'hyper-v', 'microsoft virtual', 'bochs', 'kvm',
  'oracle vm', 'virtual machine',
]

let processMonitorInterval

// Prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win
let psBlockerId
let permissionDialogActive = false  // suppress focus-stealing during macOS permission dialogs

function blockSystemShortcuts() {
  // Shortcuts common to all platforms
  const common = [
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
    'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  ]

  // Windows-specific
  const windows = [
    'Super',             // Windows key
    'Super+D',           // Show desktop
    'Super+E',           // File Explorer
    'Super+L',           // Lock screen
    'Super+R',           // Run dialog
    'Super+Tab',         // Task View
    'Super+M',           // Minimise all
    'Super+Shift+M',     // Restore minimised
    'Super+P',           // Projection
    'Super+A',           // Action center
    'Super+S',           // Search
    'Super+I',           // Settings
    'Super+X',           // Power menu
    'Alt+Tab',           // Switch windows
    'Alt+Shift+Tab',
    'Alt+F4',            // Close window
    'Alt+Space',         // System menu
    'Alt+Escape',
    'Ctrl+Escape',       // Start menu
    'Ctrl+Alt+Tab',      // Persistent task switcher
    'Ctrl+Shift+Escape', // Task Manager
    'Super+Ctrl+Left',   // Switch virtual desktop left
    'Super+Ctrl+Right',  // Switch virtual desktop right
    'Super+Ctrl+D',      // New virtual desktop
    'Super+Ctrl+F4',     // Close virtual desktop
    'Super+Shift+S',     // Snipping tool
    'Super+G',           // Xbox Game Bar (screen recording)
    'Super+Alt+R',       // Xbox Game Bar recording
    'Super+V',           // Clipboard history
  ]

  // macOS-specific
  const mac = [
    'Command+Tab',           // App switcher
    'Command+Shift+Tab',
    'Command+Space',         // Spotlight
    'Command+Option+Space',  // Spotlight (alternate)
    'Command+Q',             // Quit app
    'Command+W',             // Close window
    'Command+H',             // Hide app
    'Command+M',             // Minimise
    'Command+Option+M',      // Minimise all
    'Command+Option+Escape', // Force quit dialog
    'Command+Shift+3',       // Screenshot full
    'Command+Shift+4',       // Screenshot region
    'Command+Shift+5',       // Screenshot/record picker
    'Command+Shift+6',       // Touch bar screenshot
    'Command+Option+D',      // Toggle Dock
    'Control+Up',            // Mission Control
    'Control+Down',          // App Expose
    'Control+Left',          // Switch Space left
    'Control+Right',         // Switch Space right
    'Control+1',             // Switch to Space 1
    'Control+2',             // Switch to Space 2
    'Control+3',             // Switch to Space 3
    'Control+4',             // Switch to Space 4
    'Command+F3',            // Show Desktop
    'Command+Control+Q',     // Lock screen
  ]

  const shortcuts = [...common, ...(IS_MAC ? mac : windows)]
  shortcuts.forEach(sc => {
    try { globalShortcut.register(sc, () => {}) } catch {}
  })
}

function createWindow() {
  const windowOpts = {
    show: false,
    backgroundColor: '#0f172a',
    closable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
      preload: require('path').join(__dirname, 'preload.cjs'),
    },
  }

  if (IS_MAC) {
    // macOS: use simpleFullscreen to avoid a separate Space; no kiosk
    Object.assign(windowOpts, {
      fullscreen: false,
      frame: false,
      titleBarStyle: 'customButtonsOnHover',
      trafficLightPosition: { x: -100, y: -100 },
      resizable: false,
      movable: false,
      skipTaskbar: true,
    })
  } else {
    // Windows / Linux: kiosk mode works reliably
    Object.assign(windowOpts, {
      kiosk: true,
      fullscreen: true,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
    })
  }

  win = new BrowserWindow(windowOpts)

  // Prevent the window from being captured by screen recorders / screenshot tools.
  // On Windows this uses DWM's SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE);
  // on macOS it sets NSWindow.sharingType to `none`. The captured frame will be black.
  try { win.setContentProtection(true) } catch {}

  if (IS_MAC) {
    // Use simpleFullscreen — stays on same Space, no animation glitch
    win.setSimpleFullScreen(true)
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else {
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  win.setFullScreenable(true)
  win.setMenuBarVisibility(false)

  // Grant camera + microphone access automatically
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'camera', 'microphone', 'audioCapture', 'videoCapture']
    callback(allowed.includes(permission))
  })
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    const allowed = ['media', 'camera', 'microphone', 'audioCapture', 'videoCapture']
    return allowed.includes(permission)
  })

  // Block ALL external network requests except TF.js model CDN hosts
  // and the configured proctoring server.
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['https://*/*', 'http://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const url = details.url
      const isLocal = url.startsWith('http://localhost') ||
                      url.startsWith('http://127.0.0.1') ||
                      url.startsWith('ws://localhost')   ||
                      url.startsWith('ws://127.0.0.1')
      // Allow TF.js model weight downloads (Google Storage, TF Hub, jsDelivr)
      const isTFModel = url.startsWith('https://storage.googleapis.com/') ||
                        url.startsWith('https://tfhub.dev/')               ||
                        url.startsWith('https://www.kaggle.com/models/')   ||
                        url.startsWith('https://cdn.jsdelivr.net/npm/@tensorflow')
      // Allow the configured proctoring server over HTTP(S) and WS(S)
      let isProctor = false
      if (PROCTOR_SERVER_HOST) {
        try {
          const host = new URL(url).host.toLowerCase()
          isProctor = host === PROCTOR_SERVER_HOST
        } catch {}
      }
      callback({ cancel: !(isLocal || isTFModel || isProctor) })
    }
  )

  // In production (packaged app), load from bundled dist/; in dev, load from localhost
  const isDev = !app.isPackaged
  if (isDev) {
    win.loadURL('http://localhost:3000')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Once content is ready, show the window
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    if (IS_MAC) {
      // Delay dock hide so macOS doesn't pull the window away
      setTimeout(() => {
        if (IS_MAC && app.dock) app.dock.hide()
        // Re-focus after dock hide
        setTimeout(() => { win.show(); win.focus() }, 200)
      }, 500)
    }
  })

  win.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('Page failed to load:', code, desc)
  })

  // Prevent navigation away from the app
  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && !url.startsWith('http://localhost')) event.preventDefault()
    if (!isDev && !url.startsWith('file://')) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Re-assert kiosk/fullscreen if anything escapes it
  if (IS_MAC) {
    win.on('leave-full-screen', () => {
      if (!permissionDialogActive) win.setSimpleFullScreen(true)
    })
    win.on('minimize', () => {
      if (!permissionDialogActive) { win.restore(); win.setSimpleFullScreen(true) }
    })
    win.on('hide', () => {
      if (!permissionDialogActive) { win.show(); win.focus() }
    })
    // Delay blur handling so macOS permission dialogs (camera, mic) aren't
    // immediately dismissed by the app re-stealing focus.
    // While permissionDialogActive is true, do NOT reclaim focus at all.
    win.on('blur', () => {
      if (permissionDialogActive) return
      setTimeout(() => {
        if (permissionDialogActive) return
        if (win && !win.isDestroyed() && !win.isFocused()) {
          win.focus()
          win.setAlwaysOnTop(true, 'floating')
        }
      }, 800)
    })
  } else {
    win.on('leave-full-screen', () => { win.setKiosk(true); win.setFullScreen(true) })
    win.on('minimize', () => { win.restore(); win.setKiosk(true) })
    win.on('blur', () => { win.focus(); win.setAlwaysOnTop(true, 'screen-saver') })
  }

  psBlockerId = powerSaveBlocker.start('prevent-display-sleep')
}

// ── Scan running processes for blocked software ────────────────────────────
function startProcessMonitor() {
  const blockedList = IS_MAC ? BLOCKED_PROCESSES_MAC : BLOCKED_PROCESSES_WIN
  // Track which processes have already been reported so we don't spam the
  // user with repeated violation overlays for the same app every 4 seconds.
  // A process is only re-reported after it disappears and comes back.
  const reportedApps = new Set()

  const checkWin = () => {
    exec('tasklist /fo csv /nh 2>nul', (err, stdout) => {
      if (err || !stdout || !win) return
      const lower = stdout.toLowerCase()
      const stillRunning = new Set()
      for (const proc of blockedList) {
        if (lower.includes(proc.toLowerCase())) {
          stillRunning.add(proc)
          if (!reportedApps.has(proc)) {
            console.warn('[proctor] blocked process detected:', proc)
            win.webContents.send('suspicious-app', proc)
            reportedApps.add(proc)
          }
        }
      }
      // Clear reported status for processes that are no longer running
      for (const p of reportedApps) {
        if (!stillRunning.has(p)) reportedApps.delete(p)
      }
    })
  }

  // On macOS, extract just the process command names to avoid false positives
  // from matching random path segments or arguments
  const checkMac = () => {
    exec('ps -eo comm= 2>/dev/null', (err, stdout) => {
      if (err || !stdout || !win) return
      // Extract just the binary name from each line (last path component)
      const running = stdout.split('\n').map(line => {
        const trimmed = line.trim()
        const name = trimmed.includes('/') ? trimmed.split('/').pop() : trimmed
        return name.toLowerCase()
      })
      const stillRunning = new Set()
      for (const proc of blockedList) {
        const target = proc.toLowerCase()
        if (running.some(name => name === target || name.startsWith(target))) {
          stillRunning.add(proc)
          if (!reportedApps.has(proc)) {
            console.warn('[proctor] blocked process detected:', proc)
            win.webContents.send('suspicious-app', proc)
            reportedApps.add(proc)
          }
        }
      }
      // Clear reported status for processes that are no longer running
      for (const p of reportedApps) {
        if (!stillRunning.has(p)) reportedApps.delete(p)
      }
    })
  }

  // ── Window title scanning (catches AI tools open in browser tabs) ──
  const reportedTitles = new Set()

  const checkWindowTitlesWin = () => {
    // PowerShell: get all visible window titles
    const cmd = 'powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -ExpandProperty MainWindowTitle" 2>nul'
    exec(cmd, (err, stdout) => {
      if (err || !stdout || !win) return
      const lower = stdout.toLowerCase()
      const stillVisible = new Set()
      for (const keyword of AI_WINDOW_TITLE_KEYWORDS) {
        if (lower.includes(keyword)) {
          stillVisible.add(keyword)
          if (!reportedTitles.has(keyword)) {
            const display = keyword.charAt(0).toUpperCase() + keyword.slice(1)
            console.warn('[proctor] AI tool detected in window title:', keyword)
            win.webContents.send('suspicious-app', display)
            reportedTitles.add(keyword)
          }
        }
      }
      for (const k of reportedTitles) {
        if (!stillVisible.has(k)) reportedTitles.delete(k)
      }
    })
  }

  const checkWindowTitlesMac = () => {
    const cmd = `osascript -e 'tell application "System Events" to get name of every window of (every process whose background only is false)' 2>/dev/null`
    exec(cmd, (err, stdout) => {
      if (err || !stdout || !win) return
      const lower = stdout.toLowerCase()
      const stillVisible = new Set()
      for (const keyword of AI_WINDOW_TITLE_KEYWORDS) {
        if (lower.includes(keyword)) {
          stillVisible.add(keyword)
          if (!reportedTitles.has(keyword)) {
            const display = keyword.charAt(0).toUpperCase() + keyword.slice(1)
            console.warn('[proctor] AI tool detected in window title:', keyword)
            win.webContents.send('suspicious-app', display)
            reportedTitles.add(keyword)
          }
        }
      }
      for (const k of reportedTitles) {
        if (!stillVisible.has(k)) reportedTitles.delete(k)
      }
    })
  }

  const checkTitles = IS_MAC ? checkWindowTitlesMac : checkWindowTitlesWin

  const check = IS_MAC ? checkMac : checkWin
  check() // immediate first scan
  checkTitles() // immediate first title scan
  processMonitorInterval = setInterval(() => { check(); checkTitles() }, 4000)
}

// ── Multi-monitor detection ────────────────────────────────────────────────
function startDisplayMonitor() {
  const check = () => {
    if (!win || win.isDestroyed()) return
    const displays = screen.getAllDisplays()
    if (displays.length > 1) {
      win.webContents.send('suspicious-app', 'Multiple Monitors (' + displays.length + ' screens)')
      // Move exam window to primary display and keep it there
      const primary = screen.getPrimaryDisplay()
      const { x, y, width, height } = primary.bounds
      win.setBounds({ x, y, width, height })
    }
  }
  check()
  screen.on('display-added', check)
  screen.on('display-removed', check)
  // Also poll in case events are missed
  setInterval(check, 5000)
}

// ── Overlay / topmost window detection (Windows) ───────────────────────────
// Detects any window sitting on top of the exam that isn't ours
function startOverlayMonitor() {
  if (!IS_WIN) return // macOS: our always-on-top + simpleFullscreen blocks overlays

  const reportedOverlays = new Set()

  setInterval(() => {
    if (!win || win.isDestroyed()) return

    // PowerShell: find all visible topmost windows, exclude our own process
    const cmd = `powershell -NoProfile -Command "` +
      `$myPid = ${process.pid}; ` +
      `Add-Type @'\\n` +
      `using System; using System.Runtime.InteropServices; using System.Text;\\n` +
      `public class WinAPI {\\n` +
      `  [DllImport(\\"user32.dll\\")] public static extern int GetWindowLong(IntPtr h, int i);\\n` +
      `  [DllImport(\\"user32.dll\\")] public static extern bool IsWindowVisible(IntPtr h);\\n` +
      `  [DllImport(\\"user32.dll\\")] public static extern IntPtr GetWindow(IntPtr h, uint c);\\n` +
      `  [DllImport(\\"user32.dll\\")] public static extern IntPtr GetDesktopWindow();\\n` +
      `  [DllImport(\\"user32.dll\\")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);\\n` +
      `  [DllImport(\\"user32.dll\\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);\\n` +
      `  public const int GWL_EXSTYLE = -20;\\n` +
      `  public const int WS_EX_TOPMOST = 0x8;\\n` +
      `  public const int WS_EX_LAYERED = 0x80000;\\n` +
      `  public const int WS_EX_TRANSPARENT = 0x20;\\n` +
      `}\\n` +
      `'@;\\n` +
      `$h = [WinAPI]::GetWindow([WinAPI]::GetDesktopWindow(), 5);\\n` +
      `while ($h -ne [IntPtr]::Zero) {\\n` +
      `  if ([WinAPI]::IsWindowVisible($h)) {\\n` +
      `    $ex = [WinAPI]::GetWindowLong($h, [WinAPI]::GWL_EXSTYLE);\\n` +
      `    $top = ($ex -band [WinAPI]::WS_EX_TOPMOST) -ne 0;\\n` +
      `    $lay = ($ex -band [WinAPI]::WS_EX_LAYERED) -ne 0;\\n` +
      `    $trn = ($ex -band [WinAPI]::WS_EX_TRANSPARENT) -ne 0;\\n` +
      `    if ($top -or $lay -or $trn) {\\n` +
      `      $pid = 0; [WinAPI]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null;\\n` +
      `      if ($pid -ne $myPid -and $pid -ne 0) {\\n` +
      `        $sb = New-Object Text.StringBuilder 256;\\n` +
      `        [WinAPI]::GetWindowText($h, $sb, 256) | Out-Null;\\n` +
      `        $t = $sb.ToString().Trim();\\n` +
      `        if ($t.Length -gt 0) { Write-Output \\"$pid|$t\\" }\\n` +
      `      }\\n` +
      `    }\\n` +
      `  }\\n` +
      `  $h = [WinAPI]::GetWindow($h, 2);\\n` +
      `}" 2>nul`

    exec(cmd, { timeout: 6000 }, (err, stdout) => {
      if (err || !stdout || !win || win.isDestroyed()) return
      const lines = stdout.trim().split('\n').filter(Boolean)
      const stillVisible = new Set()

      // Whitelist system tray / taskbar / shell windows
      const systemIgnore = [
        'program manager', 'windows input experience',
        'microsoft text input', 'windows shell experience',
        'search', 'start', 'task switching', 'taskbar',
        'notification', 'action center', 'cortana',
        'nvidia geforce overlay', 'geforce overlay',
        'msctfime', 'imejp', 'microsoft ime',
      ]

      for (const line of lines) {
        const idx = line.indexOf('|')
        if (idx < 0) continue
        const title = line.slice(idx + 1).trim()
        const lower = title.toLowerCase()
        if (!title || systemIgnore.some(s => lower.includes(s))) continue

        stillVisible.add(lower)
        if (!reportedOverlays.has(lower)) {
          console.warn('[proctor] overlay window detected:', title)
          win.webContents.send('suspicious-app', 'Overlay Window: ' + title)
          reportedOverlays.add(lower)
        }
      }
      for (const k of reportedOverlays) {
        if (!stillVisible.has(k)) reportedOverlays.delete(k)
      }
    })
  }, 5000)
}

// ── Media permission dialog guard (renderer → main) ────────────────────────
// When the renderer is about to call getUserMedia, it tells us to stop
// re-stealing focus so macOS permission dialogs aren't dismissed.
ipcMain.on('media-perm-start', () => { permissionDialogActive = true })
ipcMain.on('media-perm-end', () => {
  // Small delay so the last dialog can fully dismiss
  setTimeout(() => { permissionDialogActive = false }, 400)
})

// ── Save violation snapshot PNG ─────────────────────────────────────────────
ipcMain.on('save-snapshot', (_, { dataUrl, filename }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'violations')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'))
    console.log('[proctor] snapshot saved:', filename)
  } catch (e) {
    console.error('[proctor] snapshot save failed:', e.message)
  }
})

app.whenReady().then(async () => {
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

  // macOS: request camera & microphone at the OS level before creating the window.
  // Without this, Electron's permission handler alone is not enough — macOS will
  // silently block the media stream even though Chromium thinks it's granted.
  // We set permissionDialogActive to suppress blur/focus-stealing while dialogs are open.
  if (IS_MAC) {
    const camStatus = systemPreferences.getMediaAccessStatus('camera')
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')

    const needCam = camStatus !== 'granted'
    const needMic = micStatus !== 'granted'

    if (needCam || needMic) {
      permissionDialogActive = true
      if (needCam) {
        await systemPreferences.askForMediaAccess('camera')
      }
      if (needMic) {
        await systemPreferences.askForMediaAccess('microphone')
      }
      // Give macOS a moment to dismiss the last dialog before we start stealing focus
      await new Promise(resolve => setTimeout(resolve, 600))
      permissionDialogActive = false
    }
  }

  detectVirtualMachine((isVM, indicator) => {
    if (isVM) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Exam Cannot Start',
        message: 'Virtual machine detected.',
        detail: `This exam must be taken on a physical computer. Virtual machine detected: ${indicator}.\n\nThe application will now close.`,
        buttons: ['Exit'],
      })
      app.quit()
      return
    }

    createWindow()
    blockSystemShortcuts()
    registerAdminQuitShortcut()
    startProcessMonitor()
    startDisplayMonitor()
    startOverlayMonitor()

    ipcMain.once('exam-submitted', () => {
      teardownKioskState()
      setTimeout(() => app.quit(), 3000)
    })
  })
})

// Unwind kiosk/fullscreen/shortcuts so the app can quit cleanly.
function teardownKioskState() {
  try { clearInterval(processMonitorInterval) } catch {}
  try { globalShortcut.unregisterAll() } catch {}
  if (psBlockerId !== undefined) {
    try { powerSaveBlocker.stop(psBlockerId) } catch {}
  }
  if (win && !win.isDestroyed()) {
    try {
      win.setClosable(true)
      if (IS_MAC) {
        win.setSimpleFullScreen(false)
        if (app.dock) app.dock.show()
      } else {
        win.setKiosk(false)
      }
    } catch {}
  }
}

// Register an emergency/admin quit shortcut (Ctrl+P, and Cmd+P on macOS).
// globalShortcut fires at the OS level, so it works even if the renderer
// intercepts keyboard events. Use this to bail out of kiosk mode during
// testing or when a proctor physically has the machine.
function registerAdminQuitShortcut() {
  const keys = IS_MAC ? ['CommandOrControl+P'] : ['Control+P']
  for (const k of keys) {
    try {
      const ok = globalShortcut.register(k, () => {
        console.log('[proctor] admin quit shortcut pressed:', k)
        teardownKioskState()
        // Short delay so the kiosk state is visibly released before quit
        setTimeout(() => app.quit(), 100)
      })
      if (!ok) console.warn('[proctor] could not register quit shortcut:', k)
    } catch (e) {
      console.warn('[proctor] failed to register quit shortcut', k, e.message)
    }
  }
}

app.on('second-instance', () => {
  if (win) {
    win.focus()
    if (IS_MAC) win.setSimpleFullScreen(true)
    else win.setKiosk(true)
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (psBlockerId !== undefined) powerSaveBlocker.stop(psBlockerId)
})

app.on('window-all-closed', (e) => e.preventDefault())
