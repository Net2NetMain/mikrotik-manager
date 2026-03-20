const { RouterOSAPI } = require('node-routeros')

class MikroTikManager {
  constructor() { this.conn = null }

  connect(host, port, username, password) {
    return new Promise((resolve, reject) => {
      this.conn = new RouterOSAPI({ host, port: parseInt(port)||8728, user: username, password, timeout: 10, keepalive: true })
      this.conn.connect().then(() => resolve()).catch(err => { this.conn = null; reject(new Error(err.message||'Connection failed')) })
    })
  }

  disconnect() { try { if (this.conn) this.conn.close() } catch(e) {} this.conn = null }

  _toParams(obj) { return Object.entries(obj).map(([k,v]) => `=${k}=${v}`) }

  _parseAttrs(s) {
    const r = { dl: null, ul: null, ip: '' }
    if (!s) return r
    for (const part of s.split(',')) {
      const c = part.indexOf(':')
      if (c === -1) continue
      const k = part.slice(0,c).trim(), v = part.slice(c+1).trim()
      if (k === 'Mikrotik-Rate-Limit') {
        // MikroTik format is TX/RX = upload/download
        const m = v.match(/^(\d+)M\/(\d+)M$/)
        if (m) { r.ul = parseInt(m[1]); r.dl = parseInt(m[2]) }
      }
      if (k === 'Framed-IP-Address') r.ip = v
    }
    return r
  }

  _buildAttrs(ip, dl, ul) {
    const p = []
    // MikroTik format is TX/RX = upload/download
    if (dl!=null && ul!=null) p.push(`Mikrotik-Rate-Limit:${ul}M/${dl}M`)
    if (ip) p.push(`Framed-IP-Address:${ip}`)
    return p.join(',')
  }

  async closeSession(user) {
    // Find the session ID(s) for this user then close them
    const data = await this.conn.write('/user-manager/session/print', [`?user=${user}`])
    const active = data.filter(r => !r.ended || r.ended.trim() === '')
    for (const s of active) {
      await this.conn.write('/user-manager/session/close-session', [`=.id=${s['.id']}`])
    }
    return active.length
  }

  async getUsers() {
    const data = await this.conn.write('/user-manager/user/print')
    return data.map(r => {
      const a = this._parseAttrs(r.attributes)
      return { id: r['.id'], name: r.name, ip: a.ip, dl: a.dl, ul: a.ul, group: r.group||'', disabled: r.disabled==='true'||r.disabled==='yes', attributes: r.attributes||'' }
    })
  }

  async addUser({ name, password, ip, dl, ul, group, profile, disabled }) {
    const p = { name, attributes: this._buildAttrs(ip, dl, ul) }
    if (password) p.password = password
    if (group)    p.group = group
    if (disabled) p.disabled = 'yes'
    await this.conn.write('/user-manager/user/add', this._toParams(p))
    // Assign to profile (default: Smart)
    const prof = profile || 'Smart'
    await this.conn.write('/user-manager/user-profile/add', [`=user=${name}`, `=profile=${prof}`])
    return true
  }

  async editUser(id, { name, password, ip, dl, ul, group, disabled }) {
    const p = { '.id': id, name, attributes: this._buildAttrs(ip, dl, ul), disabled: disabled?'yes':'no' }
    if (password) p.password = password
    if (group !== undefined) p.group = group
    await this.conn.write('/user-manager/user/set', this._toParams(p))
    return true
  }

  async deleteUser(id) { await this.conn.write('/user-manager/user/remove', [`=.id=${id}`]); return true }

  async setUserDisabled(id, disabled) {
    await this.conn.write('/user-manager/user/set', [`=.id=${id}`, `=disabled=${disabled?'yes':'no'}`])
    return true
  }

  async getSessionHistory(limit = 500) {
    const data = await this.conn.write('/user-manager/session/print')
    return data.slice(0, limit).map(r => ({
      id: r['.id'],
      user: r.user || '',
      ip: r['user-address'] || '',
      nasIp: r['nas-ip-address'] || '',
      download: parseInt(r.download || '0'),
      upload: parseInt(r.upload || '0'),
      started: r.started || '',
      ended: r.ended || '',
      uptime: r.uptime || '',
      active: r.active === 'true',
      status: r.status || '',
    }))
  }

  async getActiveSessions() {
    const data = await this.conn.write('/user-manager/session/print')
    const active = data.filter(r => r.active === 'true')
    return active.map(r => ({
      id: r['.id'], user: r.user||'', ip: r['user-address']||'',
      macAddress: r['calling-station-id']||'', nasIp: r['nas-ip-address']||'',
      nasPort: r['nas-port-id']||'', download: r['download']||'0',
      upload: r['upload']||'0', uptime: r['uptime']||'', started: r['started']||'',
    }))
  }
}

module.exports = { MikroTikManager }
