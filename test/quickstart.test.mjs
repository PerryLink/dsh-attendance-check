import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { packageRoot, samplePath } from './helpers/fixtures.mjs'

const expectedPath = path.join(packageRoot, 'samples', 'quickstart', 'expected', 'result.json')

test('the bundled quickstart input is a real 30-row punch CSV', async () => {
  const text = await readFile(samplePath, 'utf8')
  assert.ok(text.startsWith('employee,date,clock_in,clock_out,break_minutes\n'))
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  assert.equal(lines.length, 31)
  const employees = lines.slice(1).map((line) => line.split(',')[0])
  assert.deepEqual([...new Set(employees)], ['张伟', '李娜', '王强', '刘洋', '陈静', '赵磊'])
  for (const name of new Set(employees)) {
    assert.equal(employees.filter((employee) => employee === name).length, 5, name)
  }
})

test('quickstart --check reproduces the committed golden result', () => {
  const result = spawnSync(process.execPath, ['samples/quickstart/run.mjs', '--check'], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /period 2026-06-22\.\.2026-06-26 \(5 workdays\); 6 employee\(s\), 30 audited day\(s\)/)
  assert.match(result.stdout, /violations \(3\):/)
  assert.match(result.stdout, /\[high\] 2026-06-25 王强 缺少下班卡/)
  assert.match(result.stdout, /\[medium\] 2026-06-24 李娜/)
  assert.match(result.stdout, /\[low\] 2026-06-26 刘洋/)
  assert.match(result.stdout, /golden samples\/quickstart\/expected\/result\.json matches/)
  assert.match(result.stdout, /quickstart ok/)
})

test('quickstart --json equals the committed golden file', async () => {
  const result = spawnSync(process.execPath, ['samples/quickstart/run.mjs', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.deepEqual(JSON.parse(result.stdout), expected)
  assert.equal(expected.check.totals.employees, 6)
  assert.equal(expected.check.totals.days, 30)
  assert.equal(expected.check.totals.overtime_minutes, 300)
  assert.equal(expected.summary.rows.length, 6)
  assert.equal(expected.summary.totals.attended_days, 29)
  assert.equal(expected.exports.reconciliation.rows, 30)
})

test('the golden files preserve the cross-midnight row and the CSV hash', async () => {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  const zhang = expected.check.employees.find((employee) => employee.employee === '张伟')
  const nextDay = zhang.days.find((day) => day.date === '2026-06-23')
  assert.equal(nextDay.clock_out, '次日 00:30')
  assert.equal(nextDay.cross_midnight, true)
  assert.equal(nextDay.overtime_minutes, 90)
  const csv = expected.exports.reconciliation.text
  assert.match(csv, /^员工,日期,上班,下班,休息分钟,日工时,加班小时,状态,问题\n/)
  assert.ok(csv.includes('王强,2026-06-25,09:00,,60,0.00,0.00,缺卡,E_ATT_MISSING_PUNCH'))
  assert.equal(
    expected.exports.reconciliation.sha256,
    createHash('sha256').update(csv).digest('hex'),
  )
  assert.equal(expected.exports.reconciliation.path, 'exports/attendance-2026-06-22-2026-06-26.csv')
})
