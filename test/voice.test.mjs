import assert from 'node:assert/strict'
import test from 'node:test'
import { tsImport } from 'tsx/esm/api'

const { startVoice } = await tsImport('../src/lib/voice.ts', import.meta.url)

test('voice waits for final words, keeps wake commands whole, and never repeats them after restart/stop', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 })
  const instances = []
  class Recogniser {
    constructor() { instances.push(this) }
    start(track) { this.track = track; this.onstart() }
    abort() { this.onend() }
    result(...parts) {
      this.onresult({ resultIndex: 0, results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) })
    }
  }
  globalThis.window = { SpeechRecognition: Recogniser }
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Chrome/145.0.0.0' })
  const track = { readyState: 'live', kind: 'audio' }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async () => ({ getAudioTracks: () => [track] }),
  } })
  t.after(() => { delete globalThis.window; delete navigator.mediaDevices; delete navigator.userAgent })
  let mode = 'wake'
  const wakes = []
  const turns = []
  const errors = []
  const voice = await startVoice({
    mode: () => mode,
    onWake: (text) => { wakes.push(text); mode = 'command' },
    onSpeechStart: () => { mode = 'command' },
    onPartial: () => {},
    onUtterance: (text) => turns.push(text),
    onError: (text) => errors.push(text),
  })
  t.after(() => voice.stop())
  const rec = instances[0]
  assert.equal(rec.lang, 'en-US')
  assert.equal(rec.track, track)
  rec.result(['Hey Jarvis, open instant', false])
  t.mock.timers.tick(4000)
  assert.deepEqual(wakes, [])
  rec.result(['Hey Jarvis, open Instagram.', true])
  t.mock.timers.tick(1100)
  assert.deepEqual(wakes, ['open Instagram.'])
  rec.result(['Hey Jarvis, open Instagram.', true])
  t.mock.timers.tick(4000)
  assert.deepEqual(turns, [])

  rec.result(['Hey Jarvis, open Instagram.', true], ['Open', false])
  t.mock.timers.tick(2000)
  assert.deepEqual(turns, [])
  rec.result(['Hey Jarvis, open Instagram.', true], ['Open YouTube.', true])
  rec.onend()
  t.mock.timers.tick(1100)
  assert.deepEqual(turns, ['Open YouTube.'])
  assert.equal(instances.length, 2)
  // A late event from the previous recogniser must not affect the new one.
  rec.result(['Open calculator.', true])
  t.mock.timers.tick(2000)
  assert.equal(turns.length, 1)
  instances[1].result(['Open YouTube', true])
  t.mock.timers.tick(1100)
  t.mock.timers.tick(250)
  assert.deepEqual(turns, ['Open YouTube.', 'Open YouTube'])
  instances[1].result(['Open YouTube', true], ['Open notepad.', true])
  voice.stop()
  t.mock.timers.tick(10000)
  assert.deepEqual(turns, ['Open YouTube.', 'Open YouTube'])
  assert.equal(voice.live(), false)
  assert.deepEqual(errors, [])
})
