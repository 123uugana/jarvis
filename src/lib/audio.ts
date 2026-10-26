/**
 * A single shared microphone stream plus an analyser, so the reactor can pulse
 * with the user's voice. Opening the mic more than once causes Chrome to drop
 * the earlier stream, so everything that needs audio goes through here.
 */

import { useSettings, type VoiceSettings } from './settings'

let stream: MediaStream | null = null
let opening: Promise<MediaStream> | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buf: Uint8Array | null = null
let wave: Float32Array<ArrayBuffer> | null = null

function capture(settings: VoiceSettings) {
  return navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: settings.deviceId === 'default' ? undefined : { exact: settings.deviceId },
    echoCancellation: true,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
  } })
}

export async function configureMicrophone(settings: VoiceSettings): Promise<void> {
  if (opening) await opening
  const next = await capture(settings)
  const previous = stream
  stream = next
  previous?.getTracks().forEach((track) => track.stop())
  if (ctx) await ctx.close()
  ctx = null
  analyser = null
  buf = null
  wave = null
}

export async function getMic(): Promise<MediaStream> {
  if (stream?.getAudioTracks().some((track) => track.readyState === 'live')) return stream
  if (opening) return opening
  opening = capture(useSettings.getState().settings).then((value) => (stream = value)).finally(() => { opening = null })
  return opening
}

export async function startAnalyser(): Promise<void> {
  if (analyser) return
  const s = await getMic()
  ctx = new AudioContext()
  await ctx.resume()
  const src = ctx.createMediaStreamSource(s)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  src.connect(analyser)
  buf = new Uint8Array(analyser.frequencyBinCount)
  wave = new Float32Array(analyser.fftSize)
}

/** Unscaled microphone energy for the input check (0..1 RMS). */
export function micRms(): number {
  if (!analyser || !wave) return 0
  analyser.getFloatTimeDomainData(wave)
  return Math.sqrt(wave.reduce((sum, sample) => sum + sample * sample, 0) / wave.length)
}

/** 0..1 loudness. Returns 0 before the analyser is up. */
export function micLevel(): number {
  if (!analyser || !buf) return 0
  analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)
  let sum = 0
  // Skip the lowest bins — they're mostly rumble and mains hum.
  for (let i = 4; i < buf.length; i++) sum += buf[i]
  const avg = sum / (buf.length - 4) / 255
  // Voice sits low in this range; stretch it so the visuals actually move.
  return Math.min(1, avg * 3.2)
}

/** Analyser fed from an <audio> element, so the orb reacts while JARVIS talks. */
export function attachOutputAnalyser(el: HTMLAudioElement): () => number {
  const c = new AudioContext()
  const src = c.createMediaElementSource(el)
  const a = c.createAnalyser()
  a.fftSize = 512
  a.smoothingTimeConstant = 0.7
  src.connect(a)
  a.connect(c.destination)
  const b = new Uint8Array(a.frequencyBinCount)
  return () => {
    a.getByteFrequencyData(b as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 2; i < b.length; i++) sum += b[i]
    return Math.min(1, sum / (b.length - 2) / 255 * 3)
  }
}
