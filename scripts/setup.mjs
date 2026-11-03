#!/usr/bin/env node
// Advisory preflight for the machine and local profile; never prints secrets.

import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { spawnSync } from 'node:child_process'
import { openCodeCommand, openCodeEnvironment } from '../bridge/opencode-process.mjs'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile(file)
}

const line = (tag, message) => console.log(`[${tag}] ${message}`)
const tick = ' ok '
const warn = 'note'

console.log('\nJARVIS preflight — checking your machine and local OpenCode profile')
console.log('------------------------------------------------------------')

const [major, minor] = process.versions.node.split('.').map(Number)
if (major > 20 || (major === 20 && minor >= 12)) {
  line(tick, `Node.js ${process.versions.node} (20.12+ required).`)
} else {
  line(warn, `Node.js ${process.versions.node} is below 20.12. Please upgrade.`)
}

try {
  const result = spawnSync(openCodeCommand(), ['--version'], { env: openCodeEnvironment(), windowsHide: true, encoding: 'utf8', timeout: 10_000 })
  if (result.error || result.status !== 0) throw new Error('OpenCode could not start.')
  line(tick, `OpenCode ${result.stdout.trim()}; model ${process.env.OPENCODE_MODEL || 'opencode/big-pickle'}.`)
  line(tick, 'Existing OpenCode logins are reused. Sign in: npm run opencode -- auth login')
} catch (err) {
  line(warn, err.message)
}

line(
  process.env.ELEVENLABS_API_KEY?.trim() ? tick : ' ·  ',
  process.env.ELEVENLABS_API_KEY?.trim()
    ? 'ElevenLabs voice and transcription are enabled.'
    : 'No ElevenLabs key; browser speech remains available.',
)

console.log('\nRun:')
console.log('  npm start')
console.log('Then open http://localhost:5173 in Chrome or Edge and click INITIALISE.\n')
process.exit(0)
