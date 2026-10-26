import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile(file)
}
if (process.argv.includes('--writes')) process.env.JARVIS_ALLOW_WRITES = '1'
if (process.argv.includes('--computer')) process.env.JARVIS_ALLOW_COMPUTER = '1'

await import('../bridge/server.mjs')
