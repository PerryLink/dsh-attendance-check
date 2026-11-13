import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseCsv } from '../lib/core/csv.js'
import { attendanceReconciliationCsv, defaultExportFilename } from '../lib/core/export.js'
import { buildAttendanceCheck } from '../lib/core/check.js'
import { ingestAttendanceCsv } from '../lib/core/ingest.js'
import { exec, exportFor, makeTemp, samplePath, toolMap, writePunches } from './helpers/fixtures.mjs'

test('the sample export writes the documented nine-column header', async (t) => {
  const dir = await makeTemp(t)
  const tools = toolMap(dir)
  const exported = await exportFor(tools)
  const text = await readFile(exported.path, 'utf8')
  assert.equal(text.split('\n')[0], '员工,日期,上班,下班,休息分钟,日工时,加班小时,状态,问题')
  assert.equal(exported.rows, 30)
  assert.equal(exported.employee_count, 6)
  assert.equal(exported.over_limit_days, 1)
  assert.equal(exported.missing_punches, 1)
  assert.equal(exported.violation_count, 3)
  assert.equal(exported.filename, 'attendance-2026-06-22-2026-06-26.csv')
  assert.ok(exported.path.startsWith(`${path.join(dir, 'exports')}${path.sep}`))
})

test('the export hash, bytes and row count match the written file', async (t) => {
  const dir = await makeTemp(t)
  const exported = await exportFor(toolMap(dir))
  const text = await readFile(exported.path, 'utf8')
  assert.equal(exported.sha256, createHash('sha256').update(text).digest('hex'))
  assert.equal(exported.bytes, Buffer.byteLength(text, 'utf8'))
  assert.equal(exported.rows, text.trimEnd().split('\n').length - 1)
  assert.ok(text.endsWith('\n'))
})

test('day rows carry hours, status and issue codes', async (t) => {
  const dir = await makeTemp(t)
  const exported = await exportFor(toolMap(dir))
  const text = await readFile(exported.path, 'utf8')
  assert.ok(text.includes('张伟,2026-06-22,09:00,18:00,60,8.00,0.00,正常,'))
  assert.ok(text.includes('张伟,2026-06-23,14:00,次日 00:30,60,9.50,1.50,加班,'))
  assert.ok(text.includes('李娜,2026-06-24,09:00,21:30,60,11.50,3.50,超限,E_ATT_OVER_LIMIT'))
  assert.ok(text.includes('王强,2026-06-25,09:00,,60,0.00,0.00,缺卡,E_ATT_MISSING_PUNCH'))
  assert.ok(text.includes('刘洋,2026-06-26,09:00,17:30,30,8.00,0.00,休息不足,E_ATT_REST_SHORT'))
})

test('rows keep employee first-appearance order and date order', async (t) => {
  const dir = await makeTemp(t)
  const exported = await exportFor(toolMap(dir))
  const parsed = parseCsv(await readFile(exported.path, 'utf8'))
  const body = parsed.rows.slice(1)
  assert.equal(body.length, 30)
  assert.deepEqual(
    body.slice(0, 5).map((row) => row[1]),
    ['2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26'],
  )
  assert.equal(body[0][0], '张伟')
  assert.equal(body[29][0], '赵磊')
})

test('a custom filename is honoured', async (t) => {
  const dir = await makeTemp(t)
  const exported = await exportFor(toolMap(dir), { filename: 'june-check.csv' })
  assert.equal(exported.filename, 'june-check.csv')
  assert.equal(path.basename(exported.path), 'june-check.csv')
})

test('unsafe export filenames are rejected with E_ATT_PATH_INVALID', async (t) => {
  const dir = await makeTemp(t)
  const tools = toolMap(dir)
  for (const filename of ['../evil.csv', 'a/b.csv', '/etc/passwd', 'with space.csv', '核对表.csv', '']) {
    await assert.rejects(
      () => tools['attendance_export'].execute({ path: samplePath, filename }, exec),
      (error) => {
        assert.equal(error.code, 'E_ATT_PATH_INVALID')
        return true
      },
      filename,
    )
  }
})

test('defaultExportFilename uses the audited period', () => {
  assert.equal(
    defaultExportFilename({ from: '2026-06-22', to: '2026-06-26', workdays: 5, months: ['2026-06'] }),
    'attendance-2026-06-22-2026-06-26.csv',
  )
})

test('an employee name with a comma stays one quoted CSV cell', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'comma.csv', ['"张, 三",2026-06-22,09:00,18:00,60'])
  const tools = toolMap(dir)
  const exported = await tools['attendance_export'].execute({ path: file }, exec)
  const text = await readFile(exported.path, 'utf8')
  assert.ok(text.includes('"张, 三",2026-06-22'))
  const parsed = parseCsv(text)
  assert.equal(parsed.rows[1][0], '张, 三')
})

test('attendanceReconciliationCsv is deterministic for the sample', async () => {
  const text = await readFile(samplePath, 'utf8')
  const ledger = ingestAttendanceCsv(text)
  const report = buildAttendanceCheck(ledger)
  const csv = attendanceReconciliationCsv(report)
  assert.equal(attendanceReconciliationCsv(report), csv)
  assert.equal(csv.split('\n').filter((line) => line !== '').length, 31)
})
