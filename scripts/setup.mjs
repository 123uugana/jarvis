#!/usr/bin/env node
// Advisory preflight. It changes nothing and never prints secret values.

import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile(file)
}

const line = (tag, message) => console.log(`[${tag}] ${message}`)
const tick = ' ok '
const warn = 'note'

console.log('\nJARVIS preflight — checking your machine (nothing is changed)')
console.log('------------------------------------------------------------')

const [major, minor] = process.versions.node.split('.').map(Number)
if (major > 20 || (major === 20 && minor >= 12)) {
  line(tick, `Node.js ${process.versions.node} (20.12+ required).`)
} else {
  line(warn, `Node.js ${process.versions.node} is below 20.12. Please upgrade.`)
}

if (process.env.ASHNA_API_KEY?.trim()) {
  line(tick, 'ASHNA_API_KEY is set for the server.')
} else {
  line(warn, 'ASHNA_API_KEY is missing.')
  console.log('      Create one at https://app.ashna.ai (Account → API).')
  console.log('      Put ASHNA_API_KEY=your_key in .env.local, or set it in PowerShell:')
  console.log("      $env:ASHNA_API_KEY='your_key'")
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
