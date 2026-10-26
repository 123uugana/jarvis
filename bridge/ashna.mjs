const DEFAULT_URL = 'https://api.ashna.ai/v1/api/chat/completions'

export class AshnaError extends Error {
  constructor(message, { code = 'ashna_error', status } = {}) {
    super(message)
    this.name = 'AshnaError'
    this.code = code
    this.status = status
  }
}

/** Custom agents can run server-side tools outside decideTool; only catalog models are safe. */
export async function requireFoundationModel({
  apiKey,
  model,
  signal,
  timeoutMs = 120_000,
  url = DEFAULT_URL,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new AshnaError('ASHNA_API_KEY is not set.', { code: 'missing_key' })
  const modelsUrl = new URL(url)
  modelsUrl.pathname = modelsUrl.pathname.replace(/\/chat\/completions$/, '/models')
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  signal?.addEventListener('abort', interrupt, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response
    try {
      response = await fetchImpl(modelsUrl, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
    } catch (err) {
      if (signal?.aborted) throw abortError()
      if (controller.signal.aborted) {
        throw new AshnaError('AshnaAI model check timed out.', { code: 'timeout' })
      }
      throw new AshnaError(`Could not reach AshnaAI: ${safeMessage(err?.message, apiKey)}`, {
        code: 'network_error',
      })
    }
    if (!response.ok) throw await httpError(response, apiKey, model)
    const body = await response.json()
    const ids = new Set((body?.data ?? []).map((entry) => entry?.id).filter(Boolean))
    if (!ids.has(model)) {
      throw new AshnaError(
        `AshnaAI foundation model "${model}" is unavailable. Custom agent IDs are not supported because their tools bypass decideTool().`,
        { code: 'unsupported_model' },
      )
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', interrupt)
  }
}

const abortError = () => Object.assign(new Error('Interrupted.'), { name: 'AbortError' })

function safeMessage(value, key) {
  const text = typeof value === 'string' ? value : ''
  return key ? text.replaceAll(key, '[redacted]') : text
}

async function httpError(response, key, model) {
  let detail = ''
  try {
    const body = await response.json()
    detail = safeMessage(body?.error?.message, key)
  } catch {
    // Status-specific text below is enough when the upstream body is not JSON.
  }

  const messages = {
    400: detail || 'AshnaAI rejected the request.',
    401: 'AshnaAI rejected ASHNA_API_KEY.',
    403: `ASHNA_API_KEY is not allowed to use model "${model}".`,
    404: `AshnaAI model or agent "${model}" was not found.`,
    429: 'AshnaAI rate limit reached. Try again shortly.',
  }
  return new AshnaError(messages[response.status] || detail || `AshnaAI request failed (${response.status}).`, {
    code: `http_${response.status}`,
    status: response.status,
  })
}

function parseEvent(block, accept) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (data) accept(data)
}

/** One OpenAI-compatible SSE request. Exported so the parser can be mock-tested. */
export async function streamChatCompletion({
  apiKey,
  model,
  messages,
  tools = [],
  signal,
  timeoutMs = 120_000,
  url = DEFAULT_URL,
  fetchImpl = fetch,
  onText = () => {},
}) {
  if (!apiKey) throw new AshnaError('ASHNA_API_KEY is not set.', { code: 'missing_key' })

  const controller = new AbortController()
  let timedOut = false
  const interrupt = () => controller.abort()
  signal?.addEventListener('abort', interrupt, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    let response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          max_tokens: 1024,
          ...(tools.length
            ? {
                tools: tools.map(({ name, description, parameters }) => ({
                  type: 'function',
                  function: { name, description, parameters },
                })),
                tool_choice: 'auto',
              }
            : {}),
        }),
        signal: controller.signal,
      })
    } catch (err) {
      if (signal?.aborted) throw abortError()
      if (timedOut) throw new AshnaError('AshnaAI request timed out.', { code: 'timeout' })
      throw new AshnaError(`Could not reach AshnaAI: ${safeMessage(err?.message, apiKey)}`, {
        code: 'network_error',
      })
    }

    if (!response.ok) throw await httpError(response, apiKey, model)
    if (!response.body) throw new AshnaError('AshnaAI returned no response stream.', { code: 'empty_stream' })

    const decoder = new TextDecoder()
    const calls = new Map()
    let buffer = ''
    let text = ''
    let done = false
    let finishReason = null

    const accept = (data) => {
      if (data === '[DONE]') {
        done = true
        return
      }
      let chunk
      try {
        chunk = JSON.parse(data)
      } catch {
        throw new AshnaError('AshnaAI returned an invalid SSE chunk.', { code: 'invalid_stream' })
      }
      if (chunk?.error) {
        throw new AshnaError(safeMessage(chunk.error.message, apiKey) || 'AshnaAI stream failed.', {
          code: chunk.error.code || 'stream_error',
        })
      }
      const choice = chunk?.choices?.[0]
      if (!choice) return
      finishReason = choice.finish_reason ?? finishReason
      const delta = choice.delta ?? {}
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content
        onText(delta.content)
      }
      for (const part of delta.tool_calls ?? []) {
        const index = Number(part.index ?? 0)
        const call = calls.get(index) ?? {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        }
        if (part.id) call.id += part.id
        if (part.function?.name) call.function.name += part.function.name
        if (part.function?.arguments) call.function.arguments += part.function.arguments
        calls.set(index, call)
      }
    }

    try {
      for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ''
        for (const event of events) parseEvent(event, accept)
      }
      buffer += decoder.decode()
      if (buffer.trim()) parseEvent(buffer, accept)
    } catch (err) {
      if (signal?.aborted) throw abortError()
      if (timedOut) throw new AshnaError('AshnaAI request timed out.', { code: 'timeout' })
      if (err instanceof AshnaError) throw err
      throw new AshnaError(`AshnaAI stream was interrupted: ${safeMessage(err?.message, apiKey)}`, {
        code: 'network_error',
      })
    }

    if (!done) {
      throw new AshnaError('AshnaAI stream ended before [DONE].', { code: 'incomplete_stream' })
    }
    return { text, toolCalls: [...calls.values()], finishReason }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', interrupt)
  }
}

function toolOutput(result) {
  if (typeof result === 'string') return { text: result, images: [] }
  if (!result || typeof result !== 'object') return { text: JSON.stringify(result), images: [] }
  if (!Array.isArray(result.content)) return { text: JSON.stringify(result), images: [] }

  const text = []
  const images = []
  for (const item of result.content) {
    if (item?.type === 'text') text.push(String(item.text ?? ''))
    if (item?.type === 'image' && item.data) {
      images.push(`data:${item.mimeType ?? 'image/jpeg'};base64,${item.data}`)
    }
  }
  return {
    text: `${result.isError ? 'Tool error: ' : ''}${text.join('\n') || 'Tool completed.'}`,
    images,
  }
}

/** Runs client-side function calls until Ashna returns a final assistant answer. */
export async function runAshnaTurn({
  apiKey,
  model,
  messages,
  tools = [],
  signal,
  timeoutMs,
  url,
  fetchImpl,
  onText,
  onTool = () => {},
  allowTool = () => false,
  maxToolRounds = 8,
}) {
  const byName = new Map(tools.map((entry) => [entry.name, entry]))
  const working = [...messages]
  let answer = ''

  for (let round = 0; round <= maxToolRounds; round += 1) {
    signal?.throwIfAborted()
    const result = await streamChatCompletion({
      apiKey,
      model,
      messages: working,
      tools,
      signal,
      timeoutMs,
      url,
      fetchImpl,
      onText: (delta) => {
        answer += delta
        onText?.(delta)
      },
    })

    if (!result.toolCalls.length) return { text: answer.trim() }
    if (round === maxToolRounds) {
      throw new AshnaError('AshnaAI used too many tool rounds.', { code: 'max_tool_rounds' })
    }

    working.push({
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls,
    })

    const images = []
    for (const call of result.toolCalls) {
      signal?.throwIfAborted()
      const name = call.function.name
      const registered = byName.get(name)
      let output
      if (!registered) {
        output = { text: `Tool error: ${name} is not registered by this bridge.`, images: [] }
      } else if (!allowTool(name)) {
        output = {
          text: 'Blocked: JARVIS is in read-only mode and this action is not permitted.',
          images: [],
        }
      } else {
        onTool(name)
        try {
          signal?.throwIfAborted()
          const args = JSON.parse(call.function.arguments || '{}')
          output = toolOutput(await registered.execute(args, { signal }))
        } catch (err) {
          signal?.throwIfAborted()
          output = { text: `Tool error: ${err?.message ?? err}`, images: [] }
        }
      }
      working.push({
        role: 'tool',
        tool_call_id: call.id,
        content: output.text.slice(0, 100_000),
      })
      images.push(...output.images)
    }

    if (images.length) {
      working.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Images returned by the requested local tool:' },
          ...images.map((image) => ({ type: 'image_url', image_url: { url: image } })),
        ],
      })
    }
  }
}
