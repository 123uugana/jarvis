import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { openCodeCommand, openCodeEnvironment, runtimeRoot } from '../bridge/opencode-process.mjs'

for (const file of ['.env.local', '.env']) if (existsSync(file)) loadEnvFile(file)
const env = openCodeEnvironment()
const child = spawn(openCodeCommand(), [...process.argv.slice(2), '--pure'], { cwd: runtimeRoot, env, stdio: 'inherit' })
child.on('error', (err) => { console.error(err.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
