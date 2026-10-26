import * as bridge from './bridge'
export { watchShortcut, setVoiceReady } from './bridge'
import type { Blade, Panel } from '../store'

export type AskHandlers = {
  onText: (delta: string) => void
  onTool: (name: string) => void
}
export type { ConnectionState } from './bridge'

/**
 * One browser-facing brain interface. AshnaAI is always reached through the
 * local bridge so its API key never enters the browser bundle.
 */

export async function ask(
  prompt: string,
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  return bridge.ask(prompt, handlers)
}

export async function warm(): Promise<void> {
  await bridge.warmBridge()
}

/** The bridge reports its connected local tool groups for the HUD. */
export function watchServers(fn: (servers: string[]) => void): void {
  bridge.watchServers(fn)
}

/** HUD panels are pushed mid-turn by the `display` tool, not returned by ask(). */
export function watchPanels(fn: (panel: Panel) => void): void {
  bridge.watchPanels(fn)
}

/** Blades — the big surface — arrive from the bridge's `blade` tool. */
export function watchBlades(fn: (blade: Blade) => void): void {
  bridge.watchBlades(fn)
}

/**
 * Redressing the interface — theme, reactor, orbiting objects, effects — is a
 * bridge capability, like panels. The `ui_*` tools push straight down the open
 * socket while a turn is running.
 */
export function watchUi(fn: (op: string, args: any) => void): void {
  bridge.watchUi(fn)
}

/**
 * The one thing the bridge asks US for.
 *
 * A camera frame is the exception to the push channels: the hardware is in the
 * browser, so this handler answers a bridge request.
 */
export function watchCapture(
  fn: (req: bridge.CaptureRequest) => Promise<bridge.CaptureResult>,
): void {
  bridge.watchCapture(fn)
}

/**
 * Barge-in aborts the bridge's Ashna request and settles the outstanding ask.
 */
export function cancel(): void {
  bridge.cancel()
}

/** The older name for `cancel()`. */
export function interrupt(): void {
  cancel()
}

/**
 * Whether the brain is reachable right now.
 *
 * A live socket is the session and owns its bounded conversation history.
 */
export function isConnected(): boolean {
  return bridge.isConnected()
}

/**
 * Connection state, for the UI.
 *
 * Worth surfacing because in bridge mode the socket *is* the conversation: all
 * of JARVIS's memory of the exchange lives in the agent session behind it, so a
 * drop wipes the conversation while the transcript on screen still shows it.
 * Never fires on the direct path, which has no connection to lose.
 */
export function watchConnection(
  fn: (state: bridge.ConnectionState) => void,
): void {
  bridge.watchConnection(fn)
}

/** Labels for the HUD's SYSTEMS rail. */
export function connectedLabels(): string[] {
  return bridge.bridgeServers()
}
