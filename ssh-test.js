/**
 * SSH test runner for core router 172.19.250.251
 * Connects via SSH, runs MikroTik ping + traceroute commands,
 * streams results back line by line.
 */
const { Client } = require('ssh2')

const CORE_ROUTER = {
  host: '172.19.250.251',
  port: 22,
  username: 'admin',
  password: 'AnySmart@007',
}

function runSSHCommand(command, onData, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let output = ''
    let timer

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); reject(err); return }

        timer = setTimeout(() => {
          conn.end()
          resolve(output) // return whatever we got
        }, timeoutMs)

        stream.on('data', (data) => {
          const chunk = data.toString()
          output += chunk
          // Fire callback for each line
          chunk.split('\n').forEach(line => {
            const trimmed = line.trim()
            if (trimmed) onData(trimmed)
          })
        })

        stream.stderr.on('data', (data) => {
          const chunk = data.toString()
          output += chunk
          chunk.split('\n').forEach(line => {
            const trimmed = line.trim()
            if (trimmed) onData('ERR: ' + trimmed)
          })
        })

        stream.on('close', () => {
          clearTimeout(timer)
          conn.end()
          resolve(output)
        })
      })
    })

    conn.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`SSH error: ${err.message}`))
    })

    conn.connect({
      ...CORE_ROUTER,
      readyTimeout: 8000,
      algorithms: {
        kex: ['diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1',
              'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521'],
        cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                 'aes128-cbc', '3des-cbc', 'aes256-cbc'],
        serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256'],
        hmac: ['hmac-sha1', 'hmac-sha2-256', 'hmac-md5'],
      },
    })
  })
}

async function pingTest(targetIp, onLine) {
  // MikroTik RouterOS ping command
  const cmd = `/ping ${targetIp} count=10`
  onLine(`▶ Running: ${cmd}`)
  onLine(`▶ Target: ${targetIp}`)
  onLine('─'.repeat(44))
  return runSSHCommand(cmd, onLine, 25000)
}

async function tracerouteTest(targetIp, onLine) {
  // MikroTik RouterOS traceroute command
  const cmd = `/tool traceroute ${targetIp} count=3`
  onLine(`▶ Running: ${cmd}`)
  onLine(`▶ Target: ${targetIp}`)
  onLine('─'.repeat(44))
  return runSSHCommand(cmd, onLine, 30000)
}

module.exports = { pingTest, tracerouteTest, CORE_ROUTER }
