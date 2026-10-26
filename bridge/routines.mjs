import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { localCommand, normaliseCommand } from './desktop.mjs'

const file = resolve('jarvis-routines.local.json')
const defaults = [{ name: 'work mode', steps: ['open https://www.google.com/', 'open notepad'] }]
export const routinesSchema = z.array(z.object({
  name: z.string().trim().min(2).max(60),
  steps: z.array(z.string().trim().min(2).max(500)).min(1).max(8),
}).strict()).max(20).superRefine((routines, context) => {
  const names = new Set()
  routines.forEach((routine, i) => {
    const name = normaliseCommand(routine.name).toLowerCase()
    if (!name || names.has(name)) context.addIssue({ code: 'custom', path: [i, 'name'], message: 'Routine names must be unique.' })
    names.add(name)
    try { if (localCommand(name)) throw new Error() }
    catch { context.addIssue({ code: 'custom', path: [i, 'name'], message: 'Choose a name that is not a built-in command.' }) }
    routine.steps.forEach((step, j) => {
      try { if (!localCommand(step)) throw new Error() }
      catch { context.addIssue({ code: 'custom', path: [i, 'steps', j], message: 'Use an exact supported local command, such as open notepad or open https://example.com/.' }) }
    })
  })
})

export async function readRoutines(path = file) {
  try { return routinesSchema.parse(JSON.parse(await readFile(path, 'utf8'))) }
  catch (err) { if (err.code === 'ENOENT') return defaults; throw new Error('Saved routines could not be read. Fix jarvis-routines.local.json before saving or running them.') }
}

export async function saveRoutines(value, path = file) {
  const routines = routinesSchema.parse(value)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(routines, null, 2) + '\n', { flag: 'wx' })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) }
  return routines
}

export function findRoutine(text, routines) {
  const name = normaliseCommand(text).toLowerCase()
  return routines.find((routine) => {
    const key = normaliseCommand(routine.name).toLowerCase()
    return name === key || name === `run ${key}` || name === `start ${key}`
  })
}

export async function runRoutine(routine, { tools, allowTool, signal, onTool }) {
  routinesSchema.parse([routine])
  // Validate every step and permission before doing anything; never hand recipe text to a shell or model.
  const steps = routine.steps.map((step) => {
    const call = localCommand(step)
    const tool = tools.find((entry) => entry.name === call.name)
    if (!tool || !allowTool(call.name)) throw new Error(`Routine cannot run: ${step}. Enable the required Windows/browser controls first.`)
    return { step, call, tool }
  })
  let completed = 0
  for (const { step, call, tool } of steps) {
    signal.throwIfAborted()
    onTool(call.name)
    try {
      const result = await tool.execute(call.args)
      if (result.isError) throw new Error(result.content.filter((item) => item.type === 'text').map((item) => item.text).join(' '))
      completed++
    } catch (err) {
      throw new Error(`${routine.name} stopped after ${completed}/${steps.length} steps at "${step}": ${err.message}`)
    }
  }
  return `${routine.name}: ${completed} steps completed.`
}
