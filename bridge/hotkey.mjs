import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { powershellPath, windowsScript } from './desktop.mjs'

export const hotkeyStatus = { ready: false, message: 'Ctrl+Alt+J requires Windows.' }
export function startHotkey(onPress) {
  if (process.platform !== 'win32') return () => {}
  if (process.env.JARVIS_GLOBAL_HOTKEY === '0') { hotkeyStatus.message = 'Global shortcut disabled by JARVIS_GLOBAL_HOTKEY=0.'; return () => {} }
  hotkeyStatus.message = 'Starting Ctrl+Alt+J…'
  const child = spawn(powershellPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsScript, '-Action', 'hotkey', '-ParentId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let error = ''
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let event
    try { event = JSON.parse(line) } catch { return }
    if (event.type === 'status') {
      hotkeyStatus.ready = event.ready === true
      hotkeyStatus.message = hotkeyStatus.ready ? 'Ctrl+Alt+J ready' : 'Shortcut unavailable'
    }
    if (event.type === 'hotkey' && hotkeyStatus.ready) onPress()
  })
  child.stderr.on('data', (chunk) => { error = (error + chunk.toString()).slice(-1000) })
  child.on('error', (err) => { hotkeyStatus.ready = false; hotkeyStatus.message = err.message })
  child.on('exit', () => { hotkeyStatus.ready = false; hotkeyStatus.message = error.trim() || 'Global shortcut stopped.'; lines.close() })
  const stop = () => { child.kill(); lines.close() }
  process.once('exit', stop)
  return () => { process.off('exit', stop); stop() }
}
