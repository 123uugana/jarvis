import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { z } from 'zod'
import { tool } from '../bridge/tools.mjs'
import { runOpenCodeTurn, toolEndpoint } from '../bridge/opencode.mjs'

const messages = [{ role: 'system', content: 'Speak briefly.' }, { role: 'user', content: 'Test the connection.' }]
const rpc = async (endpoint, method, params, extraHeaders = {}) => {
  const response = await fetch(endpoint.url, { method: 'POST', headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  return { response, body: response.status === 200 ? await response.json() : null }
}

test('MCP enforces capability, origin, validation, permission and cancellation; images survive', async (t) => {
  const controller = new AbortController()
  let runs = 0
  const seen = []
  const endpoint = await toolEndpoint({ signal: controller.signal, allowTool: (name) => name === 'observe', onTool: (name) => seen.push(name), tools: [
    tool('observe', 'Observe a test image.', { label: z.string() }, async ({ label }, { signal }) => {
      assert.equal(signal, controller.signal)
      runs++
      return { content: [{ type: 'text', text: label }, { type: 'image', mimeType: 'image/png', data: 'test-image' }] }
    }),
    tool('write', 'Must remain blocked.', {}, () => { throw new Error('Must not run') }),
  ] })
  t.after(endpoint.close)
  assert.equal((await rpc(endpoint, 'tools/list', {}, { authorization: 'Bearer wrong' })).response.status, 403)
  assert.equal((await rpc(endpoint, 'tools/list', {}, { origin: 'http://localhost:5173' })).response.status, 403)
  assert.equal((await rpc(endpoint, 'initialize')).body.result.protocolVersion, '2025-03-26')
  assert.deepEqual((await rpc(endpoint, 'tools/list')).body.result.tools.map((tool) => tool.name), ['observe'])
  assert.ok((await rpc(endpoint, 'tools/call', { name: 'write' })).body.error)
  assert.ok((await rpc(endpoint, 'tools/call', { name: 'observe', arguments: { label: 42 } })).body.result.isError)
  const result = (await rpc(endpoint, 'tools/call', { name: 'observe', arguments: { label: 'Сайн байна уу' } })).body.result
  assert.equal(result.content[0].text, 'Сайн байна уу')
  assert.equal(result.content[1].data, 'test-image')
  controller.abort()
  assert.ok((await rpc(endpoint, 'tools/call', { name: 'observe', arguments: { label: 'later' } })).body.error)
  assert.equal(runs, 1)
  assert.deepEqual(seen, ['observe', 'observe'])
})

async function mockOpenCode(t, respond) {
  let events, endpoint, sessionBody
  const calls = []
  const errors = []
  const emit = (type, properties) => events.write(`data: ${JSON.stringify({ type, properties })}\r\n\r\n`)
  const server = createServer((req, res) => {
    void (async () => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = raw ? JSON.parse(raw) : null
      calls.push(`${req.method} ${req.url}`)
      const json = (value) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
      if (req.url === '/mcp') {
        endpoint = { url: body.config.url, token: body.config.headers.Authorization.slice(7) }
        const list = (await rpc(endpoint, 'tools/list')).body.result.tools
        assert.deepEqual(list.map((tool) => tool.name), ['observe'])
        return json({ [body.name]: { status: 'connected' } })
      }
      if (req.url === '/session') { sessionBody = body; return json({ id: 'ses_test' }) }
      if (req.url === '/event') {
        events = res
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        return emit('server.connected', {})
      }
      if (req.url === '/session/ses_test/message') {
        assert.equal(body.agent, 'jarvis')
        assert.deepEqual(body.model, { providerID: 'opencode', modelID: 'big-pickle' })
        assert.deepEqual(sessionBody.permission[0], { permission: '*', pattern: '*', action: 'deny' })
        assert.equal(sessionBody.permission.length, 2, 'Only permitted Jarvis tools may bypass the deny rule')
        return respond({ body, endpoint, emit, json, res, events })
      }
      return json(true)
    })().catch((err) => { errors.push(err); res.writeHead(500); res.end() })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.close(); server.closeAllConnections(); assert.deepEqual(errors, []) })
  return { url: `http://127.0.0.1:${server.address().port}`, calls }
}

const tools = [tool('observe', 'Observe.', {}, () => ({ content: [{ type: 'text', text: 'observed' }] })), tool('write', 'Blocked.', {}, () => assert.fail('Denied tool ran'))]
const options = { messages, tools, allowTool: (name) => name === 'observe' }

test('OpenCode streams assistant text once, hides user/reasoning, executes tools, and deletes the turn', async (t) => {
  const mock = await mockOpenCode(t, async ({ body, endpoint, emit, json }) => {
    assert.equal(body.system, 'Speak briefly.')
    assert.match(body.parts[0].text, /Previous conversation/)
    assert.equal(body.parts.at(-1).text, 'Test the connection.')
    emit('message.part.updated', { sessionID: 'ses_test', part: { id: 'user', messageID: body.messageID, sessionID: 'ses_test', type: 'text', text: 'Do not speak this user text' } })
    emit('message.part.updated', { sessionID: 'ses_test', part: { id: 'reasoning', type: 'reasoning', text: 'Private reasoning' } })
    emit('message.part.delta', { sessionID: 'ses_other', partID: 'answer', field: 'text', delta: 'Another tab' })
    emit('message.part.updated', { sessionID: 'ses_test', part: { id: 'answer', type: 'text', text: 'Сайн ' } })
    emit('message.part.delta', { sessionID: 'ses_test', partID: 'answer', field: 'text', delta: 'байна уу.' })
    assert.equal((await rpc(endpoint, 'tools/call', { name: 'observe' })).body.result.content[0].text, 'observed')
    assert.ok((await rpc(endpoint, 'tools/call', { name: 'write' })).body.error)
    await new Promise((resolve) => setTimeout(resolve, 20))
    json({ info: {}, parts: [{ id: 'answer', type: 'text', text: 'Сайн байна уу.' }] })
  })
  let spoken = ''
  const seen = []
  const result = await runOpenCodeTurn({ ...options, ...mock, messages: [messages[0], { role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Acknowledged.' }, messages[1]], onText: (delta) => { spoken += delta }, onTool: (name) => seen.push(name) })
  assert.equal(result.text, 'Сайн байна уу.')
  assert.equal(spoken, result.text)
  assert.deepEqual(seen, ['observe'])
  assert.ok(mock.calls.includes('DELETE /session/ses_test'))
  assert.ok(mock.calls.some((call) => /\/mcp\/.*\/disconnect$/.test(call)))
})

test('model authentication failures are actionable and never expose upstream secret text', async (t) => {
  const mock = await mockOpenCode(t, ({ json }) => json({ info: { error: { name: 'ProviderAuthError', data: { message: 'Bearer secret-api-key' } } }, parts: [] }))
  await assert.rejects(runOpenCodeTurn({ ...options, ...mock }), (err) => /auth login/.test(err.message) && !err.message.includes('secret-api-key'))
})

test('exhausted free quota stops retries promptly and exposes no upstream credential text', async (t) => {
  const mock = await mockOpenCode(t, ({ emit }) => emit('session.status', { sessionID: 'ses_test', status: { type: 'retry', message: 'Free usage limit reached. Bearer secret-api-key', attempt: 1, next: Date.now() + 10_000 } }))
  await assert.rejects(runOpenCodeTurn({ ...options, ...mock }), (err) => /free-model usage limit/.test(err.message) && !err.message.includes('secret-api-key'))
  assert.ok(mock.calls.includes('POST /session/ses_test/abort'))
  assert.ok(mock.calls.includes('DELETE /session/ses_test'))
})

test('expired keys, empty credits and retired models report the correct recovery action', async (t) => {
  for (const [statusCode, expected] of [[401, /create a new key/], [402, /credits are empty.*Billing/], [410, /model has been retired/]]) {
    const mock = await mockOpenCode(t, ({ json }) => json({ info: { error: { name: 'APIError', data: { statusCode, message: 'Upstream detail' } } }, parts: [] }))
    await assert.rejects(runOpenCodeTurn({ ...options, ...mock }), expected)
  }
})

test('interruption aborts OpenCode remotely and prevents further tool execution', async (t) => {
  const controller = new AbortController()
  let attempted
  const done = new Promise((resolve) => { attempted = resolve })
  const mock = await mockOpenCode(t, async ({ endpoint }) => {
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The endpoint is either already closed or refuses the aborted capability.
    try { assert.ok((await rpc(endpoint, 'tools/call', { name: 'observe' })).body.error) } catch (err) { assert.equal(err.cause?.code, 'ECONNREFUSED') }
    attempted()
  })
  await assert.rejects(runOpenCodeTurn({ ...options, ...mock, signal: controller.signal }), (err) => err.name === 'AbortError')
  await done
  assert.ok(mock.calls.includes('POST /session/ses_test/abort'))
})

test('timeout and truncated event streams fail and clean up their sessions', async (t) => {
  for (const truncate of [false, true]) {
    const mock = await mockOpenCode(t, ({ events }) => { if (truncate) events.end() })
    await assert.rejects(runOpenCodeTurn({ ...options, ...mock, timeoutMs: 200 }), truncate ? /disconnected/ : /timed out/)
    assert.ok(mock.calls.includes('POST /session/ses_test/abort'))
    assert.ok(mock.calls.includes('DELETE /session/ses_test'))
  }
})
