import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { browserTarget, localCommand, localAcknowledgement, desktopServer, desktopAction, openApp } from '../bridge/desktop.mjs'
import { chromeServer } from '../bridge/chrome.mjs'

test('standalone thanks cannot retry a browser action; thanks with a new request still routes normally', () => {
  for (const text of ['okay thank you', 'Okay, thank you, Jarvis.', 'thanks', 'Thank you!', 'Hey Jarvis, thanks again', 'баярлалаа']) {
    assert.equal(localAcknowledgement(text), "You're welcome, sir.", text)
    assert.equal(localCommand(text), null, text)
  }
  for (const text of ['thanks, open YouTube', 'thank you but Instagram did not open', 'okay can you open Instagram', 'why does it say reconnect account', 'thanks for nothing', 'no thanks']) {
    assert.equal(localAcknowledgement(text), null, text)
  }
})

test('the bridge answers thanks without an API key or any tool execution', { timeout: 12000 }, async (t) => {
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const child = spawn(process.execPath, ['bridge/server.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, ASHNA_API_KEY: '', ELEVENLABS_API_KEY: '', JARVIS_BRIDGE_PORT: String(port), JARVIS_GLOBAL_HOTKEY: '0', JARVIS_ALLOW_WRITES: '0' },
  })
  t.after(async () => { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped } })
  // Wait for the actual listener, not the startup banner printed before listen completes.
  let ready = false
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok } catch { /* still starting */ }
    if (ready || child.exitCode !== null) break
    await delay(50)
  }
  assert.ok(ready, 'Test bridge must start')
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: 'http://localhost:5173' } })
  t.after(() => ws.terminate())
  const frames = []
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local reply timed out')), 5000)
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw); frames.push(frame)
      if (frame.type === 'ready') ws.send(JSON.stringify({ type: 'ask', id: 'thanks', text: 'okay thank you' }))
      if (frame.type === 'error') { clearTimeout(timer); reject(new Error(frame.message)) }
      if (frame.type === 'done') { clearTimeout(timer); resolve() }
    })
  })
  assert.equal(frames.at(-1).text, "You're welcome, sir.")
  assert.equal(frames.some((frame) => frame.type === 'tool'), false)
})

test('everyday commands use registered tools; negation, questions and compound instructions go to the model', () => {
  for (const [text, name, args] of [
    ['Hey Jarvis, please open YouTube!', 'chrome_new_tab', { url: 'https://www.youtube.com/' }],
    ['Could you open Instagram in a new tab please?', 'chrome_new_tab', { url: 'https://www.instagram.com/' }],
    ['new tab', 'chrome_new_tab', {}],
    ['open a new tab in chrome', 'chrome_new_tab', {}],
    ['Open file explorer', 'desktop_open_app', { app: 'explorer' }],
    ['open calculator', 'desktop_open_app', { app: 'calculator' }],
    ['volume up', 'desktop_control', { action: 'volume_up' }],
    ['show desktop', 'desktop_control', { action: 'show_desktop' }],
    ['search YouTube for Daft Punk', 'chrome_search_youtube', { query: 'Daft Punk' }],
    ['search for C++ tutorial on YouTube', 'chrome_search_youtube', { query: 'C++ tutorial' }],
    ['open https://example.com/CaseSensitive?x=A', 'chrome_new_tab', { url: 'https://example.com/CaseSensitive?x=A' }],
    ['next tab', 'chrome_tab_control', { action: 'next' }],
    ['close this tab', 'chrome_tab_control', { action: 'close' }],
    ['pause the youtube video', 'chrome_youtube', { action: 'pause' }],
    ['switch to Notepad', 'desktop_window', { action: 'focus', query: 'Notepad' }],
    ['snap left window', 'desktop_window', { action: 'snap_left' }],
    ['list windows', 'desktop_windows', {}],
  ]) {
    const command = localCommand(text)
    assert.ok(command.name.endsWith(`__${name}`), text)
    assert.deepEqual(command.args, args)
    const registry = [...chromeServer({ allowWrites: true }).tools, ...desktopServer({ allowWrites: true }).tools]
    if (process.platform === 'win32' || ['chrome_new_tab', 'chrome_search_youtube'].includes(name)) assert.ok(registry.some((tool) => tool.name === name))
  }
  for (const text of ["don't open YouTube", 'how do I open calculator', 'open YouTube and delete my files', 'open notepad.exe & calc', 'new tab then shut down', 'unmute']) {
    assert.equal(localCommand(text), null, text)
  }
})

test('URLs and Windows actions reject executable input; writes stay gated', async () => {
  assert.equal(browserTarget(), 'about:blank')
  assert.equal(browserTarget('https://youtube.com'), 'https://youtube.com/')
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows', '--load-extension=evil', 'data:text/html,test', 'https://user:pass@example.com']) {
    assert.throws(() => browserTarget(url))
  }
  await assert.rejects(openApp('powershell; calc'), /Unsupported|Windows/)
  await assert.rejects(desktopAction('shutdown'), /Unsupported|Windows/)
  assert.deepEqual(desktopServer({ allowWrites: false }).tools.map((tool) => tool.name), process.platform === 'win32' ? ['desktop_windows'] : [])
  const tools = chromeServer({ allowWrites: false }).tools
  assert.ok(tools.some((tool) => tool.name === 'chrome_new_tab'))
  assert.ok(!tools.some((tool) => tool.name === 'chrome_click'))
  assert.ok(!tools.some((tool) => tool.name === 'chrome_tab_control' || tool.name === 'chrome_youtube'))
  await assert.rejects(tools.find((tool) => tool.name === 'chrome_new_tab').execute({ url: 'file:///C:/secret' }))
})
