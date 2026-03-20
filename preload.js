const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('api', {
  // App
  appVersion:        ()    => ipcRenderer.invoke('app-version'),
  installUpdate:     ()    => ipcRenderer.invoke('install-update'),
  onUpdateStatus:    (cb)  => ipcRenderer.on('update-status', (_, d) => cb(d)),
  // Connection
  connect:           (a)   => ipcRenderer.invoke('connect', a),
  disconnect:        ()    => ipcRenderer.invoke('disconnect'),
  // Users
  getUsers:          ()    => ipcRenderer.invoke('get-users'),
  addUser:           (u)   => ipcRenderer.invoke('add-user', u),
  editUser:          (u)   => ipcRenderer.invoke('edit-user', u),
  deleteUser:        (id)  => ipcRenderer.invoke('delete-user', id),
  toggleUser:        (a)   => ipcRenderer.invoke('toggle-user', a),
  // Sessions
  getSessions:       ()    => ipcRenderer.invoke('get-sessions'),
  getSessionHistory: (a)   => ipcRenderer.invoke('get-session-history', a),
  closeSession:      (u)   => ipcRenderer.invoke('close-session', u),
  // Backup
  getBackup:         ()    => ipcRenderer.invoke('get-backup'),
  restoreBackup:     (a)   => ipcRenderer.invoke('restore-backup', a),
  // Tests
  runPing:           (ip)  => ipcRenderer.invoke('run-ping', ip),
  runTraceroute:     (ip)  => ipcRenderer.invoke('run-traceroute', ip),
  onTestLine:        (cb)  => ipcRenderer.on('test-line', (_, d) => cb(d)),
  offTestLine:       ()    => ipcRenderer.removeAllListeners('test-line'),
})
