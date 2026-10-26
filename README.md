# J.A.R.V.I.S.

A browser voice assistant with an Iron Man-style interface. The browser owns the
wake word, microphone, speech-to-text, streaming speech, and visuals. A local
Node bridge keeps the AshnaAI key off the browser and calls AshnaAI's
OpenAI-compatible Chat Completions API.

## Requirements

- Node.js 20.12 or newer
- Chrome or Edge in a real browser window (embedded previews may block the mic)
- An AshnaAI API key from [Account → API](https://app.ashna.ai)
- Optional: an ElevenLabs API key for higher-quality speech and transcription
- Optional: the Claude for Chrome extension for the existing signed-in browser
  page-reading/clicking tools (the current socket adapter targets macOS/Linux).
  Opening Chrome tabs and websites on Windows does not need this extension.

## Windows PowerShell quick start

```powershell
npm install
Copy-Item .env.example .env.local
notepad .env.local
```

Set `ASHNA_API_KEY` in `.env.local`, then run:

```powershell
npm run setup
npm start
```

Open <http://localhost:5173> in Chrome or Edge, click **INITIALISE**, allow the
microphone, and say **"Hey Jarvis"**. `npm start` launches both the bridge and
Vite. To run them separately:

```powershell
npm run bridge
# In another terminal:
npm run dev
```

You can also keep the key out of files for the current PowerShell session:

```powershell
$env:ASHNA_API_KEY = 'your_key'
npm start
```

Do not prefix the key with `VITE_`; only the Node bridge may read it.

## AshnaAI configuration

The bridge posts streaming requests to
`https://api.ashna.ai/v1/api/chat/completions`. The default model is the
documented foundation model `gpt-4o-mini`. Change it in `.env.local`:

```dotenv
ASHNA_MODEL=glm-5.3-flash
```

Use a current foundation model ID from the
[AshnaAI API documentation](https://www.ashna.ai/api-docs). Ashna custom-agent
IDs are not a substitute for bridge tools: their server-side tools do not pass
through `decideTool()` and are therefore unsupported by this security model.

| Variable | Default | Purpose |
|---|---:|---|
| `ASHNA_API_KEY` | required | Server-only bearer token |
| `ASHNA_MODEL` | `gpt-4o-mini` | Ashna foundation model ID |
| `ASHNA_TIMEOUT_MS` | `120000` | Maximum time for one API stream |
| `ASHNA_MAX_CONTEXT_MESSAGES` | `20` | Per-WebSocket history limit |
| `JARVIS_BRIDGE_PORT` | `8787` | WebSocket and HTTP bridge port |
| `JARVIS_ALLOW_WRITES` | off | Enables Windows app/media controls and effectful browser tools |
| `JARVIS_ALLOW_COMPUTER` | off | Enables Windows PowerShell, screenshots, mouse/keyboard and existing write tools |
| `JARVIS_CHROME_PATH` | auto-detected | Chrome executable when installed outside the usual location |
| `JARVIS_GLOBAL_HOTKEY` | enabled on Windows | Set to `0` to disable Ctrl+Alt+J |
| `JARVIS_STT_LANGUAGE` | `en` | Scribe fallback language when a client does not send its selected language |
| `VITE_SPEECH_LANGUAGE` | `en-US` | Browser speech recognition language; e.g. `en-GB` |
| `VITE_SPEECH_PAUSE_MS` | `1100` | End-of-speech silence, 600–3000 ms |
| `JARVIS_ALLOWED_ORIGINS` | local Vite ports | Extra accepted origins |
| `JARVIS_ALLOW_NO_ORIGIN` | off | Allows clients without an Origin header |
| `JARVIS_FILE_ROOTS` | — | Extra roots exposed by `/file` |
| `ELEVENLABS_API_KEY` | — | Optional TTS and STT |
| `JARVIS_VOICE_ID` | George | ElevenLabs voice |
| `VITE_BRIDGE_URL` | `ws://localhost:8787` | Browser-to-bridge URL |
| `VITE_TTS_ENGINE` | `system` | `system` or `kokoro` |
| `VITE_PICOVOICE_ACCESS_KEY` | — | Optional offline wake word |

The key is read from the process environment, `.env`, or `.env.local`. It is
never included in a browser bundle, WebSocket frame, or normal bridge log.

## How it works

```text
browser                                              local bridge
wake word → mic → STT → {type:"ask"}  ── WebSocket ─► session history
streaming TTS/UI  ◄── text/tool/done/error frames ── Ashna SSE + tool loop
                                                     decideTool permission gate
```

Each WebSocket connection owns one bounded conversation. The bridge sends
`system + retained history + user` to AshnaAI, parses partial SSE chunks, emits
text deltas immediately, executes approved function calls, and sends tool
results back for the next model step. `data: [DONE]` completes a request.
Disconnecting clears that connection's history.

An `interrupt` frame aborts the active HTTP request. A newer question also
aborts a still-running older one. Network truncation, timeout, invalid key,
unavailable model, and rate-limit responses become the existing frontend
`error` frame; the bearer token is redacted and never logged.

The voice pipeline:

- Local VAD provides barge-in.
- ElevenLabs Scribe v2 is used through `/stt` when `ELEVENLABS_API_KEY` exists;
  otherwise Chrome/Edge speech recognition is used.
- ElevenLabs TTS is used through `/tts` when configured; otherwise browser
  `speechSynthesis` or optional Kokoro is used.
- Text is spoken sentence-by-sentence as Ashna SSE deltas arrive.
- Browser interim transcripts are captions only. Commands wait for final words
  and a quiet gap, including commands spoken in the same breath as "Hey Jarvis".
- Microphone level updates render only the small signal meter; the 3D scene
  caps pixel density, lowers it on slow hardware, and pauses drawing when hidden.

## Tools and permissions

Ashna receives only tools explicitly registered by this bridge:

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

Every returned tool call passes through `decideTool()`. The default permits
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

These exact commands run locally without an Ashna request; other phrasing goes
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
No extra dependency is needed. Use a vision-capable Ashna foundation model for
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
natural-language tool results are sent to AshnaAI. The bridge removes common
secret environment variables from child processes, but this does not prevent
commands from reading local credential files. Enable this mode for trusted tasks.

Implementation references: [Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
and [Node child processes](https://nodejs.org/api/child_process.html).

If PowerShell blocks `npm.ps1`, use `npm.cmd start` (and `npm.cmd test`, etc.).

### MCP migration limitation

The previous Claude Agent SDK automatically launched servers from
`~/.claude.json`. Ashna Chat Completions does not connect to those local stdio
MCP servers, and this bridge deliberately does not claim they are available.
Existing `exa`, `higgsfield`, `android`, `playwright`, and similar MCP
integrations therefore no longer work unless they are explicitly adapted and
registered in the bridge. The built-in UI, camera, media proxy, voice endpoints,
and optional Chrome-extension tools remain available.

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

Tests use a local mock HTTP server; no real API key is required.
The computer tests also execute harmless local PowerShell commands. To check
real screenshot/click/type behavior with a disposable Windows form, run this
from an interactive desktop session and focus the test window if prompted:

```powershell
$env:JARVIS_COMPUTER_SMOKE = '1'
node --test --test-name-pattern='native desktop' test/computer.test.mjs
Remove-Item Env:JARVIS_COMPUTER_SMOKE
```

## Troubleshooting

**Missing or invalid key:** run `npm run setup`, then check that
`ASHNA_API_KEY` is in the same PowerShell environment, `.env`, or
`.env.local` used to start the bridge.

**Model denied or missing:** choose an ID currently listed in the Ashna docs and
available to the key, then restart the bridge after changing `ASHNA_MODEL`.

**Rate limited:** wait and retry, or use a model/quota available to the account.

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
- Ashna credentials remain server-side.
- Effectful tools are absent or denied unless explicitly enabled.

MIT.
