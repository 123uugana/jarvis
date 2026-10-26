import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { computerServer, prepareInput, runTerminal, runProcess } from '../bridge/computer.mjs'
import { powershellPath, windowsScript, windowsCommand } from '../bridge/desktop.mjs'
import { runAshnaTurn } from '../bridge/ashna.mjs'

test('computer tools require their own opt-in and screenshot input is bounded and fresh', async () => {
  assert.deepEqual(computerServer({ enabled: false, allowWrites: true }).tools, [])
  const tools = computerServer({ enabled: true }).tools
  assert.equal(tools.length, process.platform === 'win32' ? 3 : 0)
  const snapshot = { id: randomUUID(), at: Date.now(), windowId: 123, width: 800, height: 600, bounds: {} }
  const click = { screenshotId: snapshot.id, action: 'click', x: 30, y: 40 }
  assert.equal(prepareInput(click, snapshot).windowId, 123)
  for (const value of [{ ...click, x: 800 }, { ...click, y: 600 }, { ...click, x: -1 }, { ...click, x: 1.2 }, { ...click, x: undefined }, { ...click, action: 'key', key: 'ctrl+evil' }, { ...click, action: 'type', text: '' }, { ...click, action: 'scroll', delta: 0 }]) assert.throws(() => prepareInput(value, snapshot))
  assert.throws(() => prepareInput(click, { ...snapshot, at: Date.now() - 61000 }), /fresh/)
  assert.throws(() => prepareInput(click, { ...snapshot, id: randomUUID() }), /fresh/)
  assert.throws(() => prepareInput(click, null), /fresh/)
  if (tools.length) await assert.rejects(tools.find((t) => t.name === 'computer_input').execute(click), /fresh/)
})

test('PowerShell returns Unicode, native failure, errors, timeouts, aborts and bounded output', { skip: process.platform !== 'win32' }, async () => {
  const ok = await runTerminal({ command: "Write-Output 'Сайн байна уу'; (Get-Location).Path" })
  assert.equal(ok.exitCode, 0)
  assert.match(ok.stdout, /Сайн байна уу/)
  assert.ok(ok.stdout.includes(process.cwd()))
  const fail = await runTerminal({ command: 'cmd.exe /c exit 7' })
  assert.equal(fail.exitCode, 7)
  const error = await runTerminal({ command: "throw 'expected-test-error'" })
  assert.notEqual(error.exitCode, 0)
  assert.match(error.stderr, /expected-test-error/)
  await assert.rejects(runTerminal({ command: 'Get-Location', timeoutSeconds: 61 }))
  await assert.rejects(runTerminal({ command: 'Get-Location', cwd: 'Z:\\missing-jarvis-test-directory' }))
  const timeout = await runTerminal({ command: "$child = Start-Process powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 20' -WindowStyle Hidden -PassThru; Write-Output $child.Id; Start-Sleep -Seconds 20", timeoutSeconds: 2 })
  assert.equal(timeout.stopped, 'Timed out')
  const pid = Number(timeout.stdout.trim())
  assert.ok(Number.isInteger(pid) && pid > 0, 'Child PID should be captured before timeout')
  const alive = await runTerminal({ command: `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'stopped' }` })
  assert.equal(alive.stdout.trim(), 'stopped', 'Timeout must stop descendants too')
  const controller = new AbortController()
  const pending = runTerminal({ command: 'Start-Sleep -Seconds 20' }, { signal: controller.signal })
  setTimeout(() => controller.abort(), 500)
  await assert.rejects(pending, (err) => err.name === 'AbortError')
  const bounded = await runProcess(powershellPath, ['-NoProfile', '-Command', "Write-Output ('x' * 10000); Start-Sleep -Seconds 20"], { maxBytes: 100 })
  assert.equal(bounded.stopped, 'Output limit exceeded')
  assert.ok(bounded.stdout.length <= 100)
  const started = Date.now()
  const detached = await runProcess(process.execPath, ['-e', "require('node:child_process').spawn(process.execPath,['-e','setTimeout(() => {}, 2500)'],{stdio:'inherit',windowsHide:true}).unref()"], { timeoutMs: 500 })
  if (detached.stopped) {
    assert.equal(detached.stopped, 'Timed out')
    assert.match(detached.cleanupError, /detached descendants/)
  } else assert.equal(detached.exitCode, 0)
  assert.ok(Date.now() - started < 2000, 'An exited parent must not leave the request hanging on inherited pipes')
  // Compiles the shared native helper without taking a screenshot or sending input.
  const windows = await runProcess(powershellPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsScript, '-Action', 'windows'])
  assert.equal(windows.exitCode, 0, windows.stderr)
  assert.ok(Array.isArray(JSON.parse(windows.stdout)))
})

test('tool loop supplies cancellation to tools, stops sibling calls, and returns images to the model', async () => {
  const controller = new AbortController()
  let runs = 0
  const calls = ['first', 'second'].map((name, index) => ({ index, id: name, function: { name, arguments: '{}' } }))
  const fetchImpl = async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls } }] })}\n\ndata: [DONE]\n\n`)
  await assert.rejects(runAshnaTurn({ apiKey: 'test', model: 'test', messages: [], signal: controller.signal, fetchImpl, allowTool: () => true,
    tools: ['first', 'second'].map((name) => ({ name, parameters: {}, execute: async (_, { signal }) => { assert.equal(signal, controller.signal); runs++; controller.abort(); return 'stopped' } })),
  }), (err) => err.name === 'AbortError')
  assert.equal(runs, 1)
  let requests = 0
  await runAshnaTurn({ apiKey: 'test', model: 'test', messages: [], allowTool: () => true,
    tools: [{ name: 'first', parameters: {}, execute: async () => ({ content: [{ type: 'text', text: 'snapshot' }, { type: 'image', mimeType: 'image/png', data: 'test-image' }] }) }],
    fetchImpl: async (_url, init) => {
      if (requests++ === 0) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls.slice(0, 1) } }] })}\n\ndata: [DONE]\n\n`)
      assert.equal(JSON.parse(init.body).messages.at(-1).content[1].image_url.url, 'data:image/png;base64,test-image')
      return new Response('data: {"choices":[{"delta":{"content":"Observed"}}]}\n\ndata: [DONE]\n\n')
    },
  })
})

test('bridge registers computer tools only when enabled and runs exact commands without an API', { skip: process.platform !== 'win32', timeout: 20000 }, async (t) => {
  for (const enabled of [false, true]) {
    const probe = createServer()
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = probe.address().port
    await new Promise((resolve) => probe.close(resolve))
    const child = spawn(process.execPath, ['bridge/server.mjs'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, ASHNA_API_KEY: '', JARVIS_GLOBAL_HOTKEY: '0', JARVIS_BRIDGE_PORT: String(port), JARVIS_ALLOW_WRITES: '1', JARVIS_ALLOW_COMPUTER: enabled ? '1' : '0' } })
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped } })
    let ready = false
    for (let i = 0; i < 60; i++) {
      try { const h = await fetch(`http://127.0.0.1:${port}/health`); ready = h.ok; if (ready) assert.equal((await h.json()).computer, enabled) } catch { /* listener starting */ }
      if (ready || child.exitCode !== null) break
      await delay(50)
    }
    assert.ok(ready)
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: 'http://localhost:5173' } })
    t.after(() => ws.terminate())
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Bridge command timed out')), 7000)
      ws.on('error', reject)
      ws.on('message', (raw) => {
        try {
          const frame = JSON.parse(raw)
          if (frame.type === 'ready') {
            assert.equal(frame.servers.includes('jarvis_computer'), enabled)
            ws.send(JSON.stringify({ type: 'ask', id: 'test', text: "powershell: Write-Output 'bridge-terminal-ok'" }))
          }
          if (frame.type === 'done' || frame.type === 'error') {
            clearTimeout(timer)
            assert.equal(frame.type, enabled ? 'done' : 'error')
            if (enabled) assert.match(JSON.parse(frame.text).stdout, /bridge-terminal-ok/)
            else assert.match(frame.message, /disabled/)
            resolve()
          }
        } catch (err) { clearTimeout(timer); reject(err) }
      })
    })
    ws.terminate()
    const stopped = once(child, 'exit'); child.kill(); await stopped
  }
})

// Opt in because this briefly opens/focuses a disposable form. It never types in existing apps.
test('native desktop screenshot, click, Unicode typing and shortcut smoke', { skip: process.platform !== 'win32' || process.env.JARVIS_COMPUTER_SMOKE !== '1', timeout: 30000 }, async (t) => {
  const script = `
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    Add-Type -AssemblyName System.Windows.Forms,System.Drawing
    $form = [Windows.Forms.Form]::new(); $form.Text = 'Jarvis disposable input check'; $form.Size = [Drawing.Size]::new(500,220)
    $box = [Windows.Forms.TextBox]::new(); $box.Location = [Drawing.Point]::new(20,20); $box.Width = 400
    $button = [Windows.Forms.Button]::new(); $button.Text = 'Check'; $button.Location = [Drawing.Point]::new(20,90)
    $form.Controls.AddRange(@($box,$button))
    $button.Add_Click({ @{ value=$box.Text } | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) } })
    $form.Add_Shown({
      $form.Show(); $form.Activate(); $p = $box.PointToScreen([Drawing.Point]::new(15,10)); $b = $button.PointToScreen([Drawing.Point]::new(20,10))
      @{ windowId=$form.Handle.ToInt64(); textX=$p.X; textY=$p.Y; buttonX=$b.X; buttonY=$b.Y } | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
    })
    [void]$form.ShowDialog()
  `
  const child = spawn(powershellPath, ['-NoProfile', '-Sta', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (s) => { stderr += s })
  const lines = createInterface({ input: child.stdout })
  t.after(async () => { lines.close(); if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped } })
  const next = () => new Promise((resolve, reject) => {
    const onLine = (line) => { clearTimeout(timer); resolve(JSON.parse(line)) }
    const timer = setTimeout(() => { lines.off('line', onLine); reject(new Error(`Test window did not respond: ${stderr}`)) }, 8000)
    lines.once('line', onLine)
  })
  const target = await next()
  try { await windowsCommand('focus', target.windowId) }
  catch {
    t.diagnostic('Click the Jarvis disposable input check window to focus it; waiting up to 10 seconds. No input will be sent to other windows.')
    let focused = false
    for (let i = 0; i < 10; i++) {
      focused = (await windowsCommand('windows')).some((w) => w.id === target.windowId && w.active)
      if (focused) break
      await delay(500)
    }
    assert.ok(focused, 'Windows refused focus. Run this smoke test on an interactive desktop and select its test window.')
  }
  const registry = computerServer({ enabled: true }).tools
  const capture = registry.find((entry) => entry.name === 'computer_screenshot')
  const input = registry.find((entry) => entry.name === 'computer_input')
  const take = async () => {
    const output = await capture.execute({})
    const metadata = JSON.parse(output.content[0].text)
    assert.equal(metadata.windowId, target.windowId, 'Refuse to interact with anything except the disposable test form')
    assert.equal(Buffer.from(output.content[1].data, 'base64').subarray(1, 4).toString(), 'PNG')
    return metadata
  }
  const click = async (x, y) => {
    const image = await take()
    await input.execute({ screenshotId: image.id, action: 'click', x: Math.floor((x - image.bounds.left) * image.width / (image.bounds.right - image.bounds.left)), y: Math.floor((y - image.bounds.top) * image.height / (image.bounds.bottom - image.bounds.top)) })
  }
  await click(target.textX, target.textY)
  let image = await take()
  await input.execute({ screenshotId: image.id, action: 'type', text: 'Сайн байна уу' })
  await assert.rejects(input.execute({ screenshotId: image.id, action: 'type', text: 'stale' }), /fresh/)
  let value = next()
  await click(target.buttonX, target.buttonY)
  assert.equal((await value).value, 'Сайн байна уу')
  await click(target.textX, target.textY)
  image = await take()
  await input.execute({ screenshotId: image.id, action: 'key', key: 'ctrl+a' })
  image = await take()
  await input.execute({ screenshotId: image.id, action: 'type', text: 'Jarvis smoke passed' })
  value = next()
  await click(target.buttonX, target.buttonY)
  assert.equal((await value).value, 'Jarvis smoke passed')
})
