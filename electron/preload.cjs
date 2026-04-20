const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  examSubmitted:   () => ipcRenderer.send('exam-submitted'),
  onSuspiciousApp: (cb) => {
    const handler = (_, name) => cb(name)
    ipcRenderer.on('suspicious-app', handler)
    // Return unsubscribe function so the renderer can clean up
    return () => ipcRenderer.removeListener('suspicious-app', handler)
  },
  saveSnapshot:    (dataUrl, filename) => ipcRenderer.send('save-snapshot', { dataUrl, filename }),
  // Tell main process to suppress focus-stealing while camera/mic permission dialogs are open
  mediaPermStart:  () => ipcRenderer.send('media-perm-start'),
  mediaPermEnd:    () => ipcRenderer.send('media-perm-end'),
})
