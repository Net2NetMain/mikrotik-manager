const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const { autoUpdater } = require('electron-updater')
const { MikroTikManager } = require('./mikrotik-api')
const { pingTest, tracerouteTest } = require('./ssh-test')

const APP_VERSION = '4.0.0'
let win, manager = null

// ── Auto updater ────────────────────────────────────────────
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-available', () => {
  if (win) win.webContents.send('update-status', { status: 'downloading' })
})
autoUpdater.on('update-downloaded', () => {
  if (win) win.webContents.send('update-status', { status: 'ready' })
})
autoUpdater.on('error', (err) => {
  if (win) win.webContents.send('update-status', { status: 'error', message: err.message })
})

// ── Window ──────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1340, height: 860, minWidth: 1000, minHeight: 660,
    title: 'Net2Net Manager',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#111110',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.loadFile('index.html')
  win.once('ready-to-show', () => {
    win.show()
    // Check for updates after 3s
    setTimeout(() => { try { autoUpdater.checkForUpdates() } catch(e) {} }, 3000)
  })
  Menu.setApplicationMenu(null)
  win.on('closed', () => { if (manager) try { manager.disconnect() } catch(e) {} })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── IPC: App ────────────────────────────────────────────────
ipcMain.handle('app-version', () => ({ version: APP_VERSION }))
ipcMain.handle('install-update', () => { autoUpdater.quitAndInstall(false, true) })

// ── IPC: Connection ─────────────────────────────────────────
ipcMain.handle('connect', async (_, { host, port, username, password }) => {
  try {
    if (manager) { try { manager.disconnect() } catch(e) {} }
    manager = new MikroTikManager()
    await manager.connect(host, port, username, password)
    return { ok: true, version: APP_VERSION }
  } catch(err) { manager = null; return { ok: false, error: err.message } }
})

ipcMain.handle('disconnect', async () => {
  try { if (manager) manager.disconnect() } catch(e) {}
  manager = null; return { ok: true }
})

// ── IPC: Users ───────────────────────────────────────────────
ipcMain.handle('get-users', async () => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try { return { ok: true, users: await manager.getUsers() } }
  catch(err) { return { ok: false, error: err.message } }
})

ipcMain.handle('add-user', async (_, user) => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try { await manager.addUser(user); return { ok: true } }
  catch(err) { return { ok: false, error: err.message } }
})

ipcMain.handle('edit-user', async (_, { id, ...user }) => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try { await manager.editUser(id, user); return { ok: true } }
  catch(err) { return { ok: false, error: err.message } }
})

ipcMain.handle('delete-user', async (_, id) => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try { await manager.deleteUser(id); return { ok: true } }
  catch(err) { return { ok: false, error: err.message } }
})

ipcMain.handle('toggle-user', async (_, { id, disabled }) => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try { await manager.setUserDisabled(id, disabled); return { ok: true } }
  catch(err) { return { ok: false, error: err.message } }
})

// ── IPC: Sessions ────────────────────────────────────────────
ipcMain.handle('get-sessions', async () => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try { return { ok: true, sessions: await manager.getActiveSessions() } }
  catch(err) { return { ok: false, error: err.message } }
})

ipcMain.handle('get-session-history', async (_, { limit }) => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try { return { ok: true, history: await manager.getSessionHistory(limit || 500) } }
  catch(err) { return { ok: false, error: err.message } }
})

ipcMain.handle('close-session', async (_, user) => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try { return { ok: true, count: await manager.closeSession(user) } }
  catch(err) { return { ok: false, error: err.message } }
})

// ── IPC: Backup / Restore ─────────────────────────────────────
ipcMain.handle('get-backup', async () => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try {
    const users = await manager.getUsers()
    const lines = [
      `# Net2Net Manager Backup`,
      `# Date: ${new Date().toISOString()}`,
      `# Users: ${users.length}`,
      '',
      ...users.map(u => {
        const attrs = []
        if (u.ul != null && u.dl != null) attrs.push(`Mikrotik-Rate-Limit:${u.ul}M/${u.dl}M`)
        attrs.push(`Framed-IP-Address:${u.ip}`)
        let cmd = `/user-manager/user/add name=${u.name} attributes=${attrs.join(',')}`
        if (u.group && u.group !== 'default') cmd += ` group=${u.group}`
        if (u.disabled) cmd += ` disabled=yes`
        return cmd
      }),
      '',
      '# User profiles',
      ...users.map(u => `/user-manager/user-profile/add user=${u.name} profile=Smart`)
    ]
    return { ok: true, content: lines.join('\n'), count: users.length }
  } catch(err) { return { ok: false, error: err.message } }
})

ipcMain.handle('restore-backup', async (_, { content }) => {
  if (!manager) return { ok: false, error: 'Not connected' }
  try {
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
    let added = 0, errors = []
    for (const line of lines) {
      try {
        if (line.startsWith('/user-manager/user/add')) {
          const nameM = line.match(/name=(\S+)/)
          const attrM = line.match(/attributes=(\S+)/)
          const groupM = line.match(/group=(\S+)/)
          const disabled = line.includes('disabled=yes')
          if (nameM) {
            await manager.addUser({
              name: nameM[1],
              attributes: attrM ? attrM[1] : '',
              group: groupM ? groupM[1] : '',
              disabled,
            })
            added++
          }
        }
      } catch(e) { errors.push(e.message) }
    }
    return { ok: true, added, errors }
  } catch(err) { return { ok: false, error: err.message } }
})

// ── IPC: Tests ────────────────────────────────────────────────
ipcMain.handle('run-ping', async (_, targetIp) => {
  const lines = []
  try {
    await pingTest(targetIp, line => {
      lines.push(line)
      if (win && !win.isDestroyed()) win.webContents.send('test-line', { line, type: 'ping' })
    })
    return { ok: true, lines }
  } catch(err) { return { ok: false, error: err.message } }
})

ipcMain.handle('run-traceroute', async (_, targetIp) => {
  const lines = []
  try {
    await tracerouteTest(targetIp, line => {
      lines.push(line)
      if (win && !win.isDestroyed()) win.webContents.send('test-line', { line, type: 'traceroute' })
    })
    return { ok: true, lines }
  } catch(err) { return { ok: false, error: err.message } }
})
