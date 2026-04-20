import electron from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'

const { app, BrowserWindow, globalShortcut, powerSaveBlocker } = electron

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win
let psBlockerId

function blockSystemShortcuts() {
  const shortcuts = [
    'Super', 'Super+D', 'Super+E', 'Super+L', 'Super+R',
    'Super+Tab', 'Super+M', 'Super+Shift+M', 'Super+P',
    'Super+A', 'Super+S', 'Super+I', 'Super+X',
    'Alt+Tab', 'Alt+Shift+Tab', 'Alt+F4', 'Alt+Space', 'Alt+Escape',
    'Ctrl+Escape', 'Ctrl+Alt+Tab', 'Ctrl+Shift+Escape',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  ]
  shortcuts.forEach(sc => {
    try { globalShortcut.register(sc, () => {}) } catch {}
  })
}

function createWindow() {
  win = new BrowserWindow({
    kiosk: true,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    frame: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setMenuBarVisibility(false)

  win.loadURL('http://localhost:3000')

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost')) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.on('leave-full-screen', () => { win.setKiosk(true); win.setFullScreen(true) })
  win.on('minimize',          () => { win.restore(); win.setKiosk(true) })
  win.on('blur',              () => { win.focus(); win.setAlwaysOnTop(true, 'screen-saver') })

  psBlockerId = powerSaveBlocker.start('prevent-display-sleep')
}

app.whenReady().then(() => {
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')
  createWindow()
  blockSystemShortcuts()
})

app.on('second-instance', () => { if (win) { win.focus(); win.setKiosk(true) } })

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (psBlockerId !== undefined) powerSaveBlocker.stop(psBlockerId)
})

app.on('window-all-closed', (e) => e.preventDefault())
