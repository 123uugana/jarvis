import assert from 'node:assert/strict'
import test from 'node:test'
import { tsImport } from 'tsx/esm/api'

const { getMic, configureMicrophone } = await tsImport('../src/lib/audio.ts', import.meta.url)
const { settingsSchema } = await tsImport('../src/lib/settings.ts', import.meta.url)

test('microphone capture is shared, selected explicitly, and preserves working input on failure', async (t) => {
  const requests = []
  const streams = []
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async (constraints) => {
      requests.push(constraints)
      if (constraints.audio.deviceId?.exact === 'missing') throw new Error('Device disconnected')
      const track = { readyState: 'live', stop() { this.readyState = 'ended' } }
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
      streams.push(stream)
      return stream
    },
  } })
  t.after(() => { delete navigator.mediaDevices })
  const [first, second] = await Promise.all([getMic(), getMic()])
  assert.equal(first, second)
  assert.equal(requests.length, 1)
  const settings = settingsSchema.parse({ deviceId: 'usb-mic', noiseSuppression: false, pauseMs: 1600 })
  await configureMicrophone(settings)
  assert.equal(first.getTracks()[0].readyState, 'ended')
  assert.equal(await getMic(), streams[1])
  assert.deepEqual(requests[1].audio, { deviceId: { exact: 'usb-mic' }, echoCancellation: true, noiseSuppression: false, autoGainControl: true })
  await assert.rejects(configureMicrophone({ ...settings, deviceId: 'missing' }), /disconnected/)
  assert.equal(await getMic(), streams[1])
  assert.equal(streams[1].getTracks()[0].readyState, 'live')
  assert.equal(settingsSchema.safeParse({ pauseMs: 20 }).success, false)
})
