import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from '../../lib/plugin/tools.js'

export const HEADER = 'employee,date,clock_in,clock_out,break_minutes'
export const CHINESE_HEADER = '员工,日期,上班时间,下班时间,休息分钟'
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const samplePath = path.join(packageRoot, 'samples', 'quickstart', 'input', 'attendance-2026-06.csv')

export function punchCsv(rows, header = HEADER) {
  return `${header}\n${rows.join('\n')}\n`
}

export async function makeTemp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-attendance-check-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

export async function writeTextFile(dir, name, content) {
  const file = path.join(dir, name)
  await writeFile(file, content)
  return file
}

export async function writePunches(dir, name, rows, header = HEADER) {
  return writeTextFile(dir, name, punchCsv(rows, header))
}

export function toolMap(baseDir) {
  return Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
}

export const exec = { callId: 'test' }

export function assertErrorCode(error, code) {
  assert.equal(error?.code, code, `expected ${code}, got ${error?.code}: ${error?.message}`)
  assert.match(error.message, new RegExp(`${code}`))
  assert.match(error.message, /下一步：/)
  return true
}

export async function checkFor(tools, overrides = {}) {
  return tools['attendance.check'].execute({ path: samplePath, ...overrides }, exec)
}

export async function summaryFor(tools, overrides = {}) {
  return tools['attendance.summary'].execute({ path: samplePath, ...overrides }, exec)
}

export async function exportFor(tools, overrides = {}) {
  return tools['attendance.export'].execute({ path: samplePath, ...overrides }, exec)
}

/** Weekdays of June 2026 from 06-01, used by overtime fixtures. */
export const JUNE_WEEKDAYS = [
  '2026-06-01',
  '2026-06-02',
  '2026-06-03',
  '2026-06-04',
  '2026-06-05',
  '2026-06-08',
  '2026-06-09',
  '2026-06-10',
  '2026-06-11',
  '2026-06-12',
  '2026-06-15',
  '2026-06-16',
  '2026-06-17',
  '2026-06-18',
  '2026-06-19',
]
