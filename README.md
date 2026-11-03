# J.A.R.V.I.S.

A browser voice assistant with an Iron Man-style interface. The browser owns the
wake word, microphone, speech-to-text, streaming speech, and visuals. A local
Node bridge runs a local OpenCode agent and exposes only permitted Jarvis tools
over authenticated loopback MCP. Provider credentials stay outside the browser.

## Requirements

- Node.js 20.12 or newer
- [OpenCode](https://opencode.ai) installed and available on PATH
- Chrome or Edge in a real browser window (embedded previews may block the mic)
- Optional: an ElevenLabs API key for higher-quality speech and transcription
- Optional: the Claude for Chrome extension for existing signed-in browser
  page-reading/clicking tools (the current socket adapter targets macOS/Linux).
  Opening Chrome tabs and websites on Windows does not need this extension.

## Windows PowerShell quick start

```powershell
npm install
Copy-Item .env.example .env.local
npm run setup
npm start
```

The default model is `opencode/big-pickle`, a free text/tool model requiring no
API key. OpenCode starts automatically on the first AI request. Open
<http://localhost:5173> in Chrome or Edge, click **INITIALISE**, allow the
microphone, and say **"Hey Jarvis"**. Ctrl-C stops the bridge, face and managed
OpenCode process. To run the bridge and face separately:

```powershell
npm run bridge
# In another terminal:
npm run dev
```

## OpenCode configuration

Jarvis keeps runtime configuration/cache in `.opencode-runtime.local/`, excluded
from Git, and reuses OpenCode's standard provider credential store. Existing
OpenCode logins work. Its managed server disables external plugins and project
configuration; it does not modify your other OpenCode settings.
Choose a provider/model in `.env.local` and restart the bridge:

```dotenv
OPENCODE_MODEL=opencode/big-pickle
```

For paid OpenCode Zen usage and image support, use
`OPENCODE_MODEL=opencode/claude-haiku-5-5`. Add credits under
[Console](https://opencode.ai/console) → Settings → Billing. A free-model
usage limit and the paid credit balance are separate; adding credits does not
change the model selected in `.env.local`.

List models or sign in to another provider using the same credential store as Jarvis:

```powershell
npm run opencode -- models
npm run opencode -- auth login
```

Use a vision-capable model for camera/desktop images. The default Big Pickle
model accepts text only. Free model availability, limits and data policies are
controlled by the provider; paid providers may require credentials and incur
charges. See [OpenCode models](https://opencode.ai/docs/models/) and
[providers](https://opencode.ai/docs/providers/).

| Variable | Default | Purpose |
|---|---:|---|
| `OPENCODE_MODEL` | `opencode/big-pickle` | Provider/model ID |
| `OPENCODE_BIN` | detected on PATH | Path to the native OpenCode executable |
| `OPENCODE_TIMEOUT_MS` | `120000` | Maximum time for one agent turn |
| `OPENCODE_MAX_CONTEXT_MESSAGES` | `20` | Per-WebSocket retained conversation messages |
| `JARVIS_BRIDGE_PORT` | `8787` | WebSocket and HTTP bridge port |
| `JARVIS_ALLOW_WRITES` | off | Enables Windows app/media controls and effectful browser tools |
| `JARVIS_ALLOW_COMPUTER` | off | Enables Windows PowerShell, screenshots, mouse/keyboard and existing write tools |
| `JARVIS_CHROME_PATH` | auto-detected | Chrome executable when installed outside the usual location |
| `JARVIS_GLOBAL_HOTKEY` | enabled on Windows | Set to `0` to disable Ctrl+Alt+J |
| `JARVIS_STT_LANGUAGE` | `en` | Scribe fallback language |
| `VITE_SPEECH_LANGUAGE` | `en-US` | Browser speech recognition language |
| `VITE_SPEECH_PAUSE_MS` | `1100` | End-of-speech silence, 600?3000 ms |
| `JARVIS_ALLOWED_ORIGINS` | local Vite ports | Extra accepted origins |
| `JARVIS_ALLOW_NO_ORIGIN` | off | Allows clients without an Origin header |
| `JARVIS_FILE_ROOTS` | ? | Extra roots exposed by `/file` |
| `ELEVENLABS_API_KEY` | ? | Optional TTS and STT |
| `JARVIS_VOICE_ID` | George | ElevenLabs voice |
| `VITE_BRIDGE_URL` | `ws://localhost:8787` | Browser-to-bridge URL |
| `VITE_TTS_ENGINE` | `system` | `system` or `kokoro` |
| `VITE_PICOVOICE_ACCESS_KEY` | ? | Optional offline wake word |

Settings are read from the process environment, `.env.local`, or `.env`.
Keep provider credentials server-side; never prefix them with `VITE_`.
Old `ASHNA_*` settings are no longer used.

## How it works

```text
browser                                      local bridge + OpenCode
wake word ? mic ? STT ? ask ?? WebSocket ??? bounded conversation context
streaming TTS/UI ??? text/tool/done/error ??? OpenCode agent + selected model
                                             authenticated loopback MCP
                                             decideTool permission gate
```

Each WebSocket owns a bounded conversation. Each AI turn gets a temporary
OpenCode session seeded with that context and an authenticated MCP endpoint.
Only that turn's permitted Jarvis tools are allowed; OpenCode's native shell,
file, task and other tools are denied. Model tool arguments still pass through
the existing Zod schemas and `decideTool()`. Images remain MCP image content.
Assistant text events stream into the existing speech/UI path; user text and
reasoning are not spoken. Sessions and MCP connections are cleaned up after
completion, error, timeout or interruption.

Stop, barge-in, a newer ask, and disconnect abort the remote agent and running
signal-aware tools. A cancelled turn cannot start another tool. Closing the
browser clears its retained history. Provider/network errors become the existing
frontend error frame without exposing upstream credential-bearing error text.

The voice pipeline:

- Local VAD provides barge-in.
- ElevenLabs Scribe v2 is used through `/stt` when `ELEVENLABS_API_KEY` exists;
  otherwise Chrome/Edge speech recognition is used.
- ElevenLabs TTS is used through `/tts` when configured; otherwise browser
  `speechSynthesis` or optional Kokoro is used.
- Text is spoken sentence-by-sentence as OpenCode text deltas arrive.
- Browser interim transcripts are captions only. Commands wait for final words
  and a quiet gap, including commands spoken in the same breath as "Hey Jarvis".
- Microphone level updates render only the small signal meter; the 3D scene
  caps pixel density, lowers it on slow hardware, and pauses drawing when hidden.

## Tools and permissions

OpenCode receives only tools explicitly registered by this bridge:

- `jarvis`: heads-up panels, blades, and URL probing
- `jarvis_ui`: theme, reactor, orbit, chrome, effects, reset
- `jarvis_eyes`: user-requested camera capture
- `jarvis_chrome`: existing Chrome-extension reading tools; click/type/form
  actions are registered only when writes are enabled. New tabs and HTTP(S)
  sites also work through native Chrome launch without the extension.
- `jarvis_desktop`: Windows app launch, volume/media keys, show/restore desktop;
  registered only on Windows with writes enabled
- `jarvis_computer`: PowerShell execution, foreground-window screenshots and
  mouse/keyboard input; registered only on Windows with computer control enabled

Every Jarvis tool call passes through `decideTool()`. The default permits
reading and opening browser tabs. `JARVIS_ALLOW_WRITES=1` alone does not register
the general shell or mouse/keyboard tools. Computer control is a separate opt-in.

To enable the registered browser action tools:

```powershell
npm run bridge:writes
# or both processes:
npm start -- --writes
```

### Windows voice commands

Say "Hey Jarvis" followed by one of these. During a follow-up, the name is optional.

| Command | Action |
|---|---|
| `open YouTube` / `open Instagram` / `open Google` | New tab in installed Chrome |
| `open a new tab` / `new tab` | Blank Chrome tab |
| `open calculator` / `open notepad` / `open file explorer` | Windows app |
| `open settings` / `open paint` / `open task manager` | Windows app |
| `volume up` / `volume down` | One volume step |
| `toggle mute` / `toggle playback` | Toggle mute or media playback |
| `next track` / `previous track` | Media key |
| `show desktop` / `restore windows` | Minimize / restore windows |
| `search youtube for Daft Punk` | Open YouTube search results |
| `next tab` / `previous tab` / `close this tab` | Control the most recently active Chrome window |
| `play video` / `pause video` | Play/pause the selected YouTube video |
| `list windows` / `switch to Notepad` | List windows / focus one unambiguous app or title |
| `minimize window` / `maximize window` / `restore window` | Change the foreground window |
| `snap left window` / `snap right window` | Arrange the foreground window on its monitor |
| `work mode` | Run the saved example: Google, then Notepad |

These exact commands run locally without an AI request; other phrasing goes
through the model. Windows app and media commands require `--writes` or
`JARVIS_ALLOW_WRITES=1` in `.env.local`. Restart the bridge after changing it.
Native Chrome launch reports that opening was requested. Windows tab and
YouTube controls use the included PowerShell helper, without an extension.
Playback requires a selected video tab with English Chrome/YouTube accessibility
labels; it checks the address and player state before invoking Play/Pause.
Tab closing refuses to close the Jarvis tab. If Windows refuses focus, select
the intended window yourself and retry. General page reading/clicking still
requires the existing extension adapter. Desktop actions are limited to the
listed apps and controls unless computer control is explicitly enabled below.

### Terminal and desktop work (Windows)

```powershell
npm start -- --computer
# Or just the bridge:
npm run bridge -- --computer
```

Alternatively set `JARVIS_ALLOW_COMPUTER=1` in `.env.local` and restart. This also
enables existing app/window/browser actions. Controls reports whether it is on.
No extra dependency is needed. Use a vision-capable OpenCode model for
desktop screenshots; actual image support depends on the configured provider/model.

Examples to type or say:

- "Use PowerShell to show the Node version and list this project's files."
- "Open Notepad and type Hello from Jarvis, then check the result."
- "Look at the active window and tell me what is on screen."

For an exact command without an AI request, type `powershell: Get-Location` in
the command field. The response contains stdout, stderr, exitCode and whether
execution stopped early. Natural-language commands use the existing AI tool loop.

PowerShell runs in a fresh hidden, noninteractive process for each call. The
default working directory is the Jarvis launch folder; the model can set `cwd`.
The timeout defaults to 30 seconds, with a 60-second maximum. Output is bounded;
interactive programs and persistent/background servers are not supported.

Desktop control captures the foreground window, scales the image to at most
1600 pixels on its longest side and uses coordinates relative to that image.
Each screenshot is valid for one input action for up to 60 seconds. Input refuses
changed focus or window geometry; clicks also refuse points covered by another
window. Supported input: left/right/double click, scroll, Unicode text and common
keys/shortcuts. Capture again after each action to check the result. This is not
a guarantee against an app changing its contents between capture and input.
Windows can block input into elevated apps; secure/UAC screens are unsupported.

**Stop** ends the current task; Escape in the Jarvis page, Ctrl+Alt+J from another
app (when the global shortcut is available), and barge-in also
interrupt it. A running command is stopped with its process tree, and no further
model tools are started. Completed changes cannot be undone by Stop. Processes
that have already detached from an exited parent cannot reliably be stopped.

Computer control runs with your Windows account permissions. `cwd` is not a
sandbox: commands can read/write files outside that folder. Screen images and
natural-language tool results are sent to the selected model provider. The bridge removes common
secret environment variables from child processes, but this does not prevent
commands from reading local credential files. Enable this mode for trusted tasks.

Implementation references: [Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
and [Node child processes](https://nodejs.org/api/child_process.html).

If PowerShell blocks `npm.ps1`, use `npm.cmd start` (and `npm.cmd test`, etc.).

### External MCP servers

Only the Jarvis tools listed above are connected. Servers in `~/.claude.json`
or your normal OpenCode configuration are not imported. Additional integrations need an
explicit bridge adapter so they retain the same permission boundary.

## Controls

| Key or phrase | Action |
|---|---|
| **Hey Jarvis** | Wake |
| **Space** | Talk without the wake word |
| **Ctrl+Alt+J** | Talk from another Windows app (Jarvis must be initialised and open) |
| Speak while answering | Interrupt |
| **V** | Cycle browser voice |
| **Escape** | Stand down |
| **D** | Diagnostics |
| **T** | Audio self-test |

After initialising, use the command field to type and press **Send**. Turn on
**Review voice commands before sending** to edit recognised words before any
command runs. **Send** submits the draft; **Clear** discards it. Ctrl+Alt+J
also submits a pending voice draft when you are not editing it.

Open **Controls** for:

- A microphone selector, English US/UK or Mongolian recognition, pause duration,
  noise suppression and automatic gain. Save restarts voice input. Settings are
  stored in this browser. Selecting a specific input for browser speech requires
  desktop Chrome/Edge 135+; older browsers can use the system default.
- An input meter and a three-second room-noise check. Save the chosen microphone
  first, stay quiet for the check, then compare the meter while speaking. These
  are relative levels after audio processing, not calibrated decibels.
- An explicit window list with switch, minimize, maximize, restore and left/right
  half buttons. Refresh if an app was opened or closed.
- Custom command names with one supported local command per line (up to 8).
  Save, then say the name or click its saved button. Commands live in
  `jarvis-routines.local.json`, excluded from Git. All steps are validated before
  execution; a failure or interruption stops subsequent steps. Completed steps
  are not undone. Scripts, arbitrary shell commands and nested routines are not
  accepted.

Ctrl+Alt+J is registered only while the bridge is running and targets the most
recently focused, initialised Jarvis tab. The Controls panel reports if another
app owns the shortcut. Set `JARVIS_GLOBAL_HOTKEY=0` and restart to disable it.

## Validation

```powershell
npm test
npm run lint
npm run build
```

OpenCode tests use a local mock HTTP/MCP server; no real API key is required.
The computer tests also execute harmless local PowerShell commands. To check
real screenshot/click/type behavior with a disposable Windows form, run this
from an interactive desktop session and focus the test window if prompted:

```powershell
$env:JARVIS_COMPUTER_SMOKE = '1'
node --test --test-name-pattern='native desktop' test/computer.test.mjs
Remove-Item Env:JARVIS_COMPUTER_SMOKE
```

## Troubleshooting

**OpenCode missing or fails to start:** run `npm run setup`. Install OpenCode
or set `OPENCODE_BIN` to the native executable (not the PowerShell/npm shim).

**Model missing or retired:** check `npm run opencode -- models` and restart
after changing `OPENCODE_MODEL`. The default free model requires no key.

**Zen authentication failed (HTTP 401):** create a new API key in the
[Console](https://opencode.ai/console), then run
`npm run opencode -- auth login` and replace the OpenCode Zen key. Signing in
to the website alone does not renew an expired API key.

**Zen balance empty (HTTP 402):** add credits in Console → Settings → Billing.

**Timeout or no model response:** check internet access to the selected provider;
OpenCode runs locally but cloud models still need a working network and quota.

**Bridge unreachable:** confirm `npm run bridge` is running and port `8787`
is free. Custom frontend origins must be added to
`JARVIS_ALLOWED_ORIGINS`.

**No microphone:** use a real Chrome/Edge window and grant microphone access.

**Wrong or cut-off words:** the default recognizer uses `en-US`. Open **Controls**
to select English (UK) or increase the pause to 1600 ms, then save. The
`VITE_SPEECH_LANGUAGE` / `VITE_SPEECH_PAUSE_MS` variables set initial defaults;
saved browser settings take precedence. Press **D** to see the language and
last transcript. Browser recognition needs an internet connection; optional
ElevenLabs transcription needs `ELEVENLABS_API_KEY`. Real microphone accuracy
still depends on the recognizer, room noise and microphone position.

Implementation references: [final speech results](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionResult/isFinal),
[Scribe transcription options](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
and [adaptive rendering](https://r3f.docs.pmnd.rs/advanced/scaling-performance).
Selected audio tracks: [SpeechRecognition.start](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start).
Global shortcut: [Windows RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey).

## Security

- The bridge binds to loopback; the WebSocket accepts local development origins by default.
- `/file`, `/img`, and `/media` enforce roots and SSRF checks.
- Model-authored panel HTML is sanitized under a strict CSP.
- OpenCode and MCP bind to authenticated loopback endpoints; provider credentials remain server-side.
- Effectful tools are absent or denied unless explicitly enabled.

MIT.
