import { existsSync, mkdirSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'

export const runtimeRoot = resolve('.opencode-runtime.local')

export function openCodeCommand() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidates = process.platform === 'win32'
      ? [join(dir, 'opencode.exe'), join(dir, 'node_modules/opencode-ai/bin/opencode.exe')]
      : [join(dir, 'opencode')]
    for (const path of candidates) if (existsSync(path)) return path
  }
  throw new Error('OpenCode is not installed. Install it from https://opencode.ai, or set OPENCODE_BIN to its executable.')
}

export function openCodeEnvironment() {
  mkdirSync(runtimeRoot, { recursive: true })
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(runtimeRoot, 'config'),
    // Keep OpenCode's standard credential store so existing provider logins work.
    XDG_CACHE_HOME: join(runtimeRoot, 'cache'),
    XDG_STATE_HOME: join(runtimeRoot, 'state'),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      autoupdate: false, snapshot: false, share: 'disabled', lsp: false, formatter: false,
      permission: { '*': 'deny' },
      agent: { jarvis: {
        mode: 'primary', steps: 24,
        prompt: 'You are JARVIS, a voice assistant. Use only the supplied Jarvis tools. Follow the system instructions for this conversation.',
        permission: { '*': 'deny' },
      } },
    }),
  }
}

let running
let supervisor
export function stopOpenCode() { if (supervisor?.connected) supervisor.disconnect() }

export function startOpenCode() {
  if (running) return running
  const command = openCodeCommand()
  const password = randomBytes(32).toString('hex')
  // The IPC supervisor also stops OpenCode if Windows terminates the bridge abruptly.
  const child = fork(new URL('../scripts/opencode-server.mjs', import.meta.url), [command], {
    cwd: runtimeRoot,
    env: { ...openCodeEnvironment(), OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: password },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  supervisor = child
  running = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('OpenCode did not start within 30 seconds. Run npm run setup.')) }, 30_000)
    let output = ''
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-4000)
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
      if (match) { clearTimeout(timer); resolveReady({ url: match[1], password }) }
    })
    // Provider errors can include credentials; expose only the exit code.
    child.stderr.resume()
    child.on('error', () => { clearTimeout(timer); running = null; reject(new Error('Could not launch OpenCode. Run npm run setup.')) })
    child.on('exit', (code) => { clearTimeout(timer); running = null; reject(new Error(`OpenCode exited (${code}). Run npm run setup.`)) })
  })
  function stop() { if (child.connected) child.disconnect() }
  process.once('exit', stop)
  child.once('exit', () => process.removeListener('exit', stop))
  return running
}
