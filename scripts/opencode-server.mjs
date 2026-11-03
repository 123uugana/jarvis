import { spawn } from 'node:child_process'

const child = spawn(process.argv[2], ['serve', '--hostname', '127.0.0.1', '--port', '0', '--pure'], {
  windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
})
process.on('disconnect', () => { child.kill(); process.exit(0) })
child.on('error', () => process.exit(1))
child.on('exit', (code) => process.exit(code ?? 1))
