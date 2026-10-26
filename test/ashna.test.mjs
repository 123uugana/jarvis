import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import {
  requireFoundationModel,
  runAshnaTurn,
  streamChatCompletion,
} from '../bridge/ashna.mjs'

let server
let baseUrl

before(async () => {
  let calls = 0
  server = createServer((req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }))
    }
    if (req.url.startsWith('/status/')) {
      const status = Number(req.url.split('/').pop())
      res.writeHead(status, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: 'upstream detail' } }))
    }
    if (req.url === '/cut') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
      return setImmediate(() => res.destroy())
    }
    if (req.url === '/hang') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': connected\n\n')
      return
    }

    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      assert.equal(req.headers.authorization, 'Bearer test-key')
      const input = JSON.parse(body)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      calls += 1
      if (calls === 1) {
        const chunks = [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"mcp__test__read","arguments":"{\\"value\\":"}}]},"finish_reason":null}]}\n',
          '\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ok\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          'data: [DONE]\n\n',
        ]
        for (const chunk of chunks) res.write(chunk)
        return res.end()
      }
      assert.equal(input.messages.at(-1).role, 'tool')
      res.end(
        'data: {"choices":[{"delta":{"content":"All "},"finish_reason":null}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

test('parses fragmented SSE and completes an approved tool round trip', async () => {
  const deltas = []
  const used = []
  let args
  const result = await runAshnaTurn({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    url: `${baseUrl}/chat`,
    messages: [{ role: 'user', content: 'test' }],
    tools: [{
      name: 'mcp__test__read',
      description: 'test',
      parameters: { type: 'object' },
      execute: async (value) => {
        args = value
        return { content: [{ type: 'text', text: 'worked' }] }
      },
    }],
    allowTool: () => true,
    onTool: (name) => used.push(name),
    onText: (delta) => deltas.push(delta),
  })
  assert.deepEqual(args, { value: 'ok' })
  assert.deepEqual(used, ['mcp__test__read'])
  assert.equal(deltas.join(''), 'All done')
  assert.equal(result.text, 'All done')
})

test('accepts catalog models and rejects custom-agent ids that bypass the gate', async () => {
  await requireFoundationModel({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    url: `${baseUrl}/chat/completions`,
  })
  await assert.rejects(
    requireFoundationModel({
      apiKey: 'test-key',
      model: 'my-custom-agent',
      url: `${baseUrl}/chat/completions`,
    }),
    /Custom agent IDs are not supported/,
  )
})

test('returns denied tool calls to the model without executing them', async () => {
  let requests = 0
  let executed = false
  const fetchImpl = async (_url, init) => {
    requests += 1
    if (requests === 1) {
      return new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"blocked","function":{"name":"danger","arguments":"{}"}}]}}]}\n\n' +
        'data: [DONE]\n\n',
      )
    }
    const body = JSON.parse(init.body)
    assert.match(body.messages.at(-1).content, /^Blocked:/)
    return new Response(
      'data: {"choices":[{"delta":{"content":"Denied safely."}}]}\n\n' +
      'data: [DONE]\n\n',
    )
  }
  const result = await runAshnaTurn({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'act' }],
    tools: [{
      name: 'danger',
      description: 'danger',
      parameters: { type: 'object' },
      execute: async () => { executed = true },
    }],
    allowTool: () => false,
    fetchImpl,
  })
  assert.equal(executed, false)
  assert.equal(result.text, 'Denied safely.')
})

for (const [status, expected] of [
  [401, /ASHNA_API_KEY/],
  [403, /not allowed.*gpt-4o-mini/],
  [404, /not found/],
  [429, /rate limit/],
]) {
  test(`maps HTTP ${status} to a useful error`, async () => {
    await assert.rejects(
      streamChatCompletion({
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        messages: [],
        url: `${baseUrl}/status/${status}`,
      }),
      expected,
    )
  })
}

test('reports a truncated network stream', async () => {
  await assert.rejects(
    streamChatCompletion({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      messages: [],
      url: `${baseUrl}/cut`,
    }),
    /interrupted|before \[DONE\]/,
  )
})

test('times out a stalled stream', async () => {
  await assert.rejects(
    streamChatCompletion({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      messages: [],
      timeoutMs: 30,
      url: `${baseUrl}/hang`,
    }),
    /timed out/,
  )
})

test('interrupt aborts the active request without exposing the key', async () => {
  const controller = new AbortController()
  const pending = streamChatCompletion({
    apiKey: 'secret-never-print',
    model: 'gpt-4o-mini',
    messages: [],
    signal: controller.signal,
    url: `${baseUrl}/hang`,
  })
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(pending, (err) => {
    assert.equal(err.name, 'AbortError')
    assert.doesNotMatch(err.message, /secret-never-print/)
    return true
  })
})
