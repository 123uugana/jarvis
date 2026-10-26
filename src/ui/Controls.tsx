import { useEffect, useRef, useState } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import { micRms } from '../lib/audio'
import { useSettings, type VoiceSettings } from '../lib/settings'
import { useStore } from '../store'

type WindowInfo = { id: number; title: string; app: string; active: boolean }
type Routine = { name: string; steps: string[] }
type ControlState = { windows: WindowInfo[]; routines: Routine[]; allowWrites: boolean; allowComputer: boolean; platform: string; hotkey: { ready: boolean; message: string } }
async function request(path: string, value?: unknown) {
  const response = await fetch(`${BRIDGE_HTTP_URL}${path}`, {
    ...(value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

export function Controls({ onApplyMicrophone, onRun }: { onApplyMicrophone: (settings: VoiceSettings) => Promise<void>; onRun: (text: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(useSettings.getState().settings)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [state, setState] = useState<ControlState | null>(null)
  const [routines, setRoutines] = useState<Routine[]>([])
  const [windowId, setWindowId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [energy, setEnergy] = useState(0)
  const noise = useRef<{ until: number; samples: number[] } | null>(null)
  const active = useRef(false)
  const generation = useRef(0)

  const refresh = async (initial = false) => {
    const mine = generation.current
    const data: ControlState = await request('/controls')
    if (!active.current || mine !== generation.current) return
    setState(data)
    if (initial) setRoutines(data.routines)
    setWindowId((id) => data.windows.some((window) => window.id === id) ? id : (data.windows.find((window) => window.active)?.id ?? data.windows[0]?.id ?? 0))
  }
  const attempt = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setNotice('')
    try { await work() } catch (err) { setNotice(err instanceof Error ? err.message : 'The action failed.') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    const show = () => { setSettings(useSettings.getState().settings); setNotice(''); setOpen(true) }
    window.addEventListener('jarvis:controls', show)
    return () => window.removeEventListener('jarvis:controls', show)
  }, [])
  useEffect(() => {
    if (!open) return
    active.current = true
    generation.current++
    dialog.current?.showModal()
    useStore.getState().setEditing(true)
    const enumerate = () => { void navigator.mediaDevices?.enumerateDevices().then((list) => { if (active.current) setDevices(list.filter((device) => device.kind === 'audioinput')) }).catch(() => setNotice('Microphone devices could not be listed.')) }
    enumerate()
    navigator.mediaDevices?.addEventListener('devicechange', enumerate)
    void refresh(true).catch((err: Error) => { if (active.current) setNotice(err.message) })
    const timer = setInterval(() => {
      const rms = micRms()
      setEnergy(rms)
      if (!noise.current) return
      noise.current.samples.push(rms)
      if (Date.now() >= noise.current.until) {
        const samples = noise.current.samples
        setNotice(`Room level: ${(samples.reduce((sum, sample) => sum + sample, 0) / samples.length * 100).toFixed(2)}% RMS. Speak now and compare with the input meter.`)
        noise.current = null
      }
    }, 100)
    return () => {
      active.current = false; noise.current = null
      clearInterval(timer)
      navigator.mediaDevices?.removeEventListener('devicechange', enumerate)
      useStore.getState().setEditing(false)
    }
    // Each opening loads a fresh snapshot. Refreshing windows preserves unsaved routines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = () => { if (!busy) { dialog.current?.close(); setOpen(false) } }
  const editRoutine = (index: number, patch: Partial<Routine>) => setRoutines((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item))

  return (
    <dialog ref={dialog} className="control-dialog" aria-labelledby="controls-title" onCancel={(event) => { event.preventDefault(); close() }} onClose={() => setOpen(false)}>
      <header><h2 id="controls-title">Jarvis controls</h2><button onClick={close} disabled={busy} aria-label="Close controls">Close</button></header>
      <p className="control-notice" role="status">{notice || 'Choose a microphone, manage windows, or create your own command.'}</p>
      <section>
        <h3>Microphone</h3>
        <div className="control-grid">
          <label>Input device<select value={settings.deviceId} onChange={(event) => setSettings({ ...settings, deviceId: event.target.value })}>
            <option value="default">System default</option>
            {devices.filter((device) => device.deviceId !== 'default').map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}
            {settings.deviceId !== 'default' && !devices.some((device) => device.deviceId === settings.deviceId) && <option value={settings.deviceId}>Selected microphone unavailable</option>}
          </select></label>
          <label>Speech language<select value={settings.language} onChange={(event) => setSettings({ ...settings, language: event.target.value as VoiceSettings['language'] })}>
            <option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="mn-MN">Mongolian</option>
          </select></label>
        </div>
        <label className="pause-slider">Wait after speaking: {settings.pauseMs} ms<input type="range" min="600" max="3000" step="100" value={settings.pauseMs} onChange={(event) => setSettings({ ...settings, pauseMs: Number(event.target.value) })} /></label>
        <label><input type="checkbox" checked={settings.noiseSuppression} onChange={(event) => setSettings({ ...settings, noiseSuppression: event.target.checked })} /> Noise suppression</label>{' '}
        <label><input type="checkbox" checked={settings.autoGainControl} onChange={(event) => setSettings({ ...settings, autoGainControl: event.target.checked })} /> Automatic input gain</label>
        <div className="control-actions">
          <button disabled={busy} onClick={() => void attempt(async () => { await onApplyMicrophone(settings); setNotice('Microphone settings saved. Voice input restarted.') })}>Save microphone</button>
          <button disabled={busy} onClick={() => { noise.current = { until: Date.now() + 3000, samples: [] }; setNotice('Stay quiet for 3 seconds…') }}>Check room noise</button>
        </div>
        <label className="input-meter">Input level <meter min="0" max="0.3" value={energy} /> {(energy * 100).toFixed(1)}% RMS</label>
        <small>The meter uses the saved microphone. Save changes before checking. Browser microphone selection requires current desktop Chrome or Edge.</small>
      </section>
      <section>
        <h3>Windows</h3>
        <p>{state?.allowComputer ? 'Computer control is on: PowerShell, screenshots, mouse and keyboard. Use Stop to end a task.' : 'For terminal and desktop tasks, restart with npm start -- --computer.'}</p>
        <div className="control-actions">
          <select aria-label="Window to control" value={windowId} onChange={(event) => setWindowId(Number(event.target.value))}>
            {!state?.windows.length && <option value="0">No visible windows available</option>}
            {state?.windows.map((window) => <option key={window.id} value={window.id}>{window.app} — {window.title}</option>)}
          </select>
          <button disabled={busy} onClick={() => void attempt(() => refresh())}>Refresh</button>
        </div>
        <div className="control-actions">{[['focus', 'Switch to'], ['minimize', 'Minimize'], ['maximize', 'Maximize'], ['restore', 'Restore'], ['snap_left', 'Left half'], ['snap_right', 'Right half']].map(([action, label]) =>
          <button key={action} disabled={busy || !windowId || !state?.allowWrites} onClick={() => void attempt(async () => { await request('/window', { action, windowId }); setNotice(`${label} applied.`); await refresh() })}>{label}</button>,
        )}</div>
        {state && !state.allowWrites && <small>Windows controls are disabled. Restart Jarvis with --writes to enable them.</small>}
      </section>
      <section>
        <h3>Your commands</h3>
        <p>Say the command name to run its steps in order. Use one command per line, up to 8 steps.</p>
        {routines.map((routine, index) => <fieldset key={index} className="routine-editor">
          <legend>Command {index + 1}</legend>
          <label>Name<input value={routine.name} maxLength={60} onChange={(event) => editRoutine(index, { name: event.target.value })} /></label>
          <label>Steps<textarea rows={3} value={routine.steps.join('\n')} onChange={(event) => editRoutine(index, { steps: event.target.value.split('\n') })} placeholder={'open notepad\nopen https://www.youtube.com/'} /></label>
          <button disabled={busy} onClick={() => setRoutines((items) => items.filter((_, i) => i !== index))}>Remove command</button>
        </fieldset>)}
        <div className="control-actions">
          <button disabled={busy || !state || routines.length >= 20} onClick={() => setRoutines((items) => [...items, { name: '', steps: [''] }])}>Add command</button>
          <button disabled={busy || !state} onClick={() => void attempt(async () => { const saved = await request('/routines', routines.map((routine) => ({ ...routine, steps: routine.steps.map((step) => step.trim()).filter(Boolean) }))); setRoutines(saved); setState((previous) => previous ? { ...previous, routines: saved } : previous); setNotice('Commands saved.') })}>Save commands</button>
        </div>
        {!!state?.routines.length && <div className="control-actions"><span>Run saved:</span>{state.routines.map((routine) => <button key={routine.name} disabled={busy} onClick={() => { close(); onRun(routine.name) }}>{routine.name}</button>)}</div>}
      </section>
      <section>
        <h3>Talk from any app</h3>
        <p><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>J</kbd> starts listening after Jarvis is initialised. When voice review is on, press it again to send the pending command.</p>
        <p role="status">{state?.hotkey.message || 'Checking shortcut…'}</p>
      </section>
    </dialog>
  )
}
