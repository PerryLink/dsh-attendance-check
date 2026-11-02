import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as plugin from '../lib/plugin/index.js'
import { createTools } from '../lib/plugin/tools.js'
import { checkFor, exec, samplePath, summaryFor, toolMap } from './helpers/fixtures.mjs'

const baseDir = path.join(os.tmpdir(), 'dsh-attendance-check-smoke')

test('createTools exposes the three attendance.* tools with unique names', () => {
  const tools = createTools({ baseDir })
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['attendance.check', 'attendance.summary', 'attendance.export'],
  )
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 3)
  for (const tool of tools) {
    assert.ok(tool.name.startsWith('attendance.'))
    assert.ok(tool.description.length > 0)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
  }
})

test('resolveBaseDir defaults to $DSH_HOME/dsh-attendance-check and honours the override', () => {
  assert.equal(
    plugin.resolveBaseDir({ DSH_HOME: '/tmp/dsh-home' }),
    path.join('/tmp/dsh-home', 'dsh-attendance-check'),
  )
  assert.equal(
    plugin.resolveBaseDir({ DSH_HOME: '/tmp/dsh-home', DSH_ATTENDANCE_CHECK_HOME: '/tmp/attendance-home' }),
    '/tmp/attendance-home',
  )
  assert.equal(plugin.name, 'dsh-attendance-check')
  assert.deepEqual(plugin.inject, ['tools'])
})

test('apply() registers all three tools and writes the export under the override', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-attendance-check-apply-'))
  const previous = process.env.DSH_ATTENDANCE_CHECK_HOME
  process.env.DSH_ATTENDANCE_CHECK_HOME = dir
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_ATTENDANCE_CHECK_HOME
    else process.env.DSH_ATTENDANCE_CHECK_HOME = previous
    await rm(dir, { recursive: true, force: true })
  })

  const registered = []
  await plugin.apply({ tools: { register(tool) { registered.push(tool) } } })
  assert.equal(registered.length, 3)

  const exporter = registered.find((tool) => tool.name === 'attendance.export')
  const result = await exporter.execute({ path: samplePath }, exec)
  assert.equal(result.rows, 30)
  assert.ok(result.path.startsWith(`${dir}${path.sep}exports${path.sep}`))
})

test('every tool render returns exactly one text block', async () => {
  const tools = toolMap(baseDir)
  const check = await checkFor(tools)
  const renderedCheck = tools['attendance.check'].output.render({ path: samplePath }, check)
  assert.equal(renderedCheck.length, 1)
  assert.equal(renderedCheck[0].type, 'text')
  assert.match(renderedCheck[0].text, /attendance check 2026-06-22\.\.2026-06-26: 6 employee\(s\) \/ 30 day\(s\)/)
  assert.match(renderedCheck[0].text, /5\.00h overtime; 3 violation\(s\)/)

  const summary = await summaryFor(tools)
  const renderedSummary = tools['attendance.summary'].output.render({ path: samplePath }, summary)
  assert.equal(renderedSummary.length, 1)
  assert.match(renderedSummary[0].text, /attendance summary 2026-06: 6 employee-month row\(s\)/)
  assert.match(renderedSummary[0].text, /30 expected \/ 29 attended day\(s\)/)

  const exported = await tools['attendance.export'].execute({ path: samplePath }, exec)
  const renderedExport = tools['attendance.export'].output.render({ path: samplePath }, exported)
  assert.equal(renderedExport.length, 1)
  assert.match(renderedExport[0].text, /attendance CSV 30 row\(s\) -> /)
  assert.match(renderedExport[0].text, /sha256 [0-9a-f]{12}\.\.\./)
})

test('tool descriptions state the risk and the local-only boundary', () => {
  const tools = createTools({ baseDir })
  const check = tools.find((tool) => tool.name === 'attendance.check')
  const exporter = tools.find((tool) => tool.name === 'attendance.export')
  assert.match(check.description, /Read-only/)
  assert.match(exporter.description, /Local write only/)
})
