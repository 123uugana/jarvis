import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { routinesSchema, readRoutines, saveRoutines, findRoutine, runRoutine } from '../bridge/routines.mjs'
import { localCommand } from '../bridge/desktop.mjs'

test('saved routines validate before replacing a file and execute in order with permission, failure and cancellation boundaries', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'jarvis-routines-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'routines.json')
  const recipe = { name: 'Work mode', steps: ['open notepad', 'open youtube', 'volume up'] }
  assert.equal((await readRoutines(path))[0].name, 'work mode')
  await saveRoutines([recipe], path)
  assert.deepEqual(await readRoutines(path), [recipe])
  assert.deepEqual(findRoutine('Hey Jarvis, run work mode!', [recipe]), recipe)
  assert.equal(findRoutine("don't run work mode", [recipe]), undefined)
  for (const invalid of [
    [{ name: 'work', steps: ['powershell Remove-Item C:/'] }],
    [{ name: 'open youtube', steps: ['open notepad'] }],
    [recipe, { ...recipe, name: 'work mode!' }],
    [{ name: 'empty', steps: [] }],
  ]) {
    assert.equal(routinesSchema.safeParse(invalid).success, false)
    await assert.rejects(saveRoutines(invalid, path))
    assert.deepEqual(await readRoutines(path), [recipe])
  }
  const calls = []
  let fail = false
  let abortAfterFirst = false
  let controller = new AbortController()
  const tools = recipe.steps.map((step, index) => ({
    name: localCommand(step).name,
    execute: async () => {
      calls.push(index)
      if (abortAfterFirst) controller.abort()
      return { isError: fail && index === 1, content: [{ type: 'text', text: 'unavailable' }] }
    },
  }))
  const run = (allowTool = () => true) => runRoutine(recipe, { tools, allowTool, signal: controller.signal, onTool: () => {} })
  await assert.rejects(run((name) => name !== tools[2].name), /cannot run/)
  assert.deepEqual(calls, [])
  assert.match(await run(), /3 steps completed/)
  assert.deepEqual(calls, [0, 1, 2])
  calls.length = 0; fail = true
  await assert.rejects(run(), /stopped after 1\/3/)
  assert.deepEqual(calls, [0, 1])
  calls.length = 0; fail = false; abortAfterFirst = true
  controller = new AbortController()
  await assert.rejects(run(), { name: 'AbortError' })
  assert.deepEqual(calls, [0])
  await writeFile(path, '{broken')
  await assert.rejects(readRoutines(path), /could not be read/)
  assert.equal(await readFile(path, 'utf8'), '{broken')
})
