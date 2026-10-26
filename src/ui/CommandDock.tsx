import { useRef } from 'react'
import { useStore } from '../store'
import { useSettings } from '../lib/settings'

export function CommandDock({ onSend, onTalk, onStop, onSettings }: { onSend: (text: string) => void; onTalk: () => void; onStop: () => void; onSettings: () => void }) {
  const phase = useStore((s) => s.phase)
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const setEditing = useStore((s) => s.setEditing)
  const settings = useSettings((s) => s.settings)
  const save = useSettings((s) => s.save)
  const input = useRef<HTMLInputElement>(null)
  if (phase === 'offline' || phase === 'boot') return null
  return (
    <section className="command-dock" aria-label="Command controls">
      <form onSubmit={(event) => {
        event.preventDefault()
        if (!draft.trim()) return
        input.current?.blur()
        setEditing(false)
        onSend(draft.trim())
      }}>
        <button type="button" onClick={onTalk} aria-label="Start listening">Talk</button>
        <button type="button" onClick={onStop} aria-label="Stop the current task">Stop</button>
        <input ref={input} aria-label="Command" value={draft} maxLength={2000}
          placeholder="Type a command, or review what Jarvis heard…"
          onChange={(event) => setDraft(event.target.value)} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} />
        <button type="submit" disabled={!draft.trim()}>Send</button>
        <button type="button" onClick={() => { setDraft(''); setEditing(false) }} disabled={!draft}>Clear</button>
        <button type="button" onClick={onSettings}>Controls</button>
      </form>
      <label className="review-toggle"><input type="checkbox" checked={settings.reviewVoice}
        onChange={(event) => { try { save({ ...settings, reviewVoice: event.target.checked }) } catch { useStore.getState().setError('Settings could not be saved.') } }} />
        Review voice commands before sending
      </label>
      {settings.reviewVoice && draft && <span role="status">Ready to review · Enter or Ctrl+Alt+J to send</span>}
    </section>
  )
}
