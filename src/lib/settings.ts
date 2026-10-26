import { create } from 'zustand'
import { z } from 'zod'
import { SPEECH_LANGUAGE, SPEECH_PAUSE_MS } from '../config'

export const settingsSchema = z.object({
  reviewVoice: z.boolean().default(false),
  deviceId: z.string().max(500).default('default'),
  language: z.enum(['en-US', 'en-GB', 'mn-MN']).default(SPEECH_LANGUAGE === 'en-GB' ? 'en-GB' : SPEECH_LANGUAGE === 'mn-MN' ? 'mn-MN' : 'en-US'),
  pauseMs: z.number().int().min(600).max(3000).default(SPEECH_PAUSE_MS),
  noiseSuppression: z.boolean().default(true),
  autoGainControl: z.boolean().default(true),
})
export type VoiceSettings = z.infer<typeof settingsSchema>
const KEY = 'jarvis.settings'
function read(): VoiceSettings {
  try { return settingsSchema.parse(JSON.parse(localStorage.getItem(KEY) || '{}')) }
  catch { return settingsSchema.parse({}) }
}
export const useSettings = create<{ settings: VoiceSettings; save: (value: VoiceSettings) => void }>((set) => ({
  settings: read(),
  save: (value) => {
    const settings = settingsSchema.parse(value)
    localStorage.setItem(KEY, JSON.stringify(settings))
    set({ settings })
  },
}))
