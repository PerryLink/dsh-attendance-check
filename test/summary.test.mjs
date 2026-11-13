import test from 'node:test'
import assert from 'node:assert/strict'
import { exec, makeTemp, samplePath, summaryFor, toolMap, writePunches } from './helpers/fixtures.mjs'

test('the sample rolls up to six employee-month rows', async () => {
  const summary = await summaryFor(toolMap('/tmp/dsh-attendance-check-summary'))
  assert.equal(summary.rows.length, 6)
  assert.equal(summary.totals.employees, 6)
  assert.equal(summary.totals.months, 1)
  assert.equal(summary.totals.expected_days, 30)
  assert.equal(summary.totals.attended_days, 29)
  assert.equal(summary.totals.overtime_minutes, 300)
  assert.equal(summary.totals.anomaly_count, 3)
  assert.equal(summary.totals.over_limit_employees, 0)
  assert.deepEqual(summary.period, {
    from: '2026-06-22',
    to: '2026-06-26',
    workdays: 5,
    months: ['2026-06'],
  })
})

test('each employee-month row carries expected, attended, overtime and anomalies', async () => {
  const summary = await summaryFor(toolMap('/tmp/dsh-attendance-check-summary-rows'))
  const byEmployee = Object.fromEntries(summary.rows.map((row) => [row.employee, row]))
  assert.deepEqual(byEmployee['张伟'], {
    employee: '张伟',
    month: '2026-06',
    expected_days: 5,
    attended_days: 5,
    overtime_minutes: 90,
    overtime_hours: 1.5,
    anomaly_count: 0,
    missing_punches: 0,
    rest_short_days: 0,
    over_limit_days: 0,
    over_limit: false,
  })
  assert.equal(byEmployee['王强'].attended_days, 4)
  assert.equal(byEmployee['王强'].missing_punches, 1)
  assert.equal(byEmployee['王强'].anomaly_count, 1)
  assert.equal(byEmployee['刘洋'].rest_short_days, 1)
  assert.equal(byEmployee['刘洋'].anomaly_count, 1)
  assert.equal(byEmployee['李娜'].over_limit_days, 1)
  assert.equal(byEmployee['李娜'].overtime_hours, 3.5)
})

test('rows keep employee first-appearance order', async () => {
  const summary = await summaryFor(toolMap('/tmp/dsh-attendance-check-summary-order'))
  assert.deepEqual(
    summary.rows.map((row) => row.employee),
    ['张伟', '李娜', '王强', '刘洋', '陈静', '赵磊'],
  )
})

test('month=YYYY-MM filters the report to that month', async () => {
  const summary = await summaryFor(toolMap('/tmp/dsh-attendance-check-summary-filter'), { month: '2026-06' })
  assert.equal(summary.rows.length, 6)
  assert.deepEqual(summary.period.months, ['2026-06'])
  await assert.rejects(
    () => summaryFor(toolMap('/tmp/dsh-attendance-check-summary-empty'), { month: '2026-05' }),
    (error) => {
      assert.equal(error.code, 'E_ATT_EMPTY')
      assert.match(error.message, /2026-05/)
      return true
    },
  )
  await assert.rejects(
    () => summaryFor(toolMap('/tmp/dsh-attendance-check-summary-bad'), { month: '2026-13' }),
    (error) => error.code === 'E_ATT_DATE_INVALID',
  )
})

test('a file spanning two months produces one row per employee-month', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'two-months.csv', [
    '张伟,2026-06-29,09:00,18:00,60',
    '张伟,2026-06-30,09:00,18:00,60',
    '张伟,2026-07-01,09:00,18:00,60',
    '张伟,2026-07-02,09:00,18:00,60',
    '张伟,2026-07-03,09:00,18:00,60',
  ])
  const tools = toolMap(dir)
  const summary = await tools['attendance_summary'].execute({ path: file }, exec)
  assert.deepEqual(summary.rows.map((row) => [row.month, row.expected_days, row.attended_days]), [
    ['2026-06', 2, 2],
    ['2026-07', 3, 3],
  ])
  assert.deepEqual(summary.period, {
    from: '2026-06-29',
    to: '2026-07-03',
    workdays: 5,
    months: ['2026-06', '2026-07'],
  })
  assert.equal(summary.totals.expected_days, 5)
})

test('a month filter clips the period to that month', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'two-months-filter.csv', [
    '张伟,2026-06-29,09:00,18:00,60',
    '张伟,2026-06-30,09:00,18:00,60',
    '张伟,2026-07-01,09:00,18:00,60',
    '张伟,2026-07-02,09:00,18:00,60',
    '张伟,2026-07-03,09:00,18:00,60',
  ])
  const tools = toolMap(dir)
  const july = await tools['attendance_summary'].execute({ path: file, month: '2026-07' }, exec)
  assert.deepEqual(july.period, {
    from: '2026-07-01',
    to: '2026-07-03',
    workdays: 3,
    months: ['2026-07'],
  })
  assert.equal(july.rows.length, 1)
  assert.equal(july.rows[0].expected_days, 3)
})

test('the summary keeps the audited policy and source hash', async () => {
  const summary = await summaryFor(toolMap('/tmp/dsh-attendance-check-summary-meta'))
  assert.equal(summary.policy.standard_hours, 8)
  assert.equal(summary.policy.include_holidays, false)
  assert.match(summary.source_sha256, /^[0-9a-f]{64}$/)
})

test('the summary rejects an empty month filter value', async () => {
  await assert.rejects(
    () => summaryFor(toolMap('/tmp/dsh-attendance-check-summary-blank'), { month: '' }),
    (error) => error.code === 'E_ATT_DATE_INVALID',
  )
})

test('the sample path is the documented quickstart input', () => {
  assert.match(samplePath, /samples[\\/]quickstart[\\/]input[\\/]attendance-2026-06\.csv$/)
})
