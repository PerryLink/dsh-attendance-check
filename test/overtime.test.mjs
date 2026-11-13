import test from 'node:test'
import assert from 'node:assert/strict'
import { checkFor, exec, JUNE_WEEKDAYS, makeTemp, summaryFor, toolMap, writePunches } from './helpers/fixtures.mjs'

async function fixture(t, rows, name = 'overtime.csv') {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, name, rows)
  return { dir, file, tools: toolMap(dir) }
}

test('exactly 3h of overtime is allowed by the default daily cap', async (t) => {
  const { file, tools } = await fixture(t, ['张伟,2026-06-01,09:00,21:00,60'])
  const report = await tools['attendance_check'].execute({ path: file }, exec)
  assert.equal(report.employees[0].days[0].worked_minutes, 660)
  assert.equal(report.employees[0].days[0].overtime_minutes, 180)
  assert.equal(report.totals.over_limit_days, 0)
  assert.equal(report.totals.violations, 0)
})

test('one minute over the daily cap is a medium over_limit violation', async (t) => {
  const { file, tools } = await fixture(t, ['张伟,2026-06-01,09:00,21:01,60'])
  const report = await tools['attendance_check'].execute({ path: file }, exec)
  assert.equal(report.totals.over_limit_days, 1)
  assert.equal(report.totals.violations, 1)
  const violation = report.violations[0]
  assert.equal(violation.severity, 'medium')
  assert.equal(violation.kind, 'over_limit')
  assert.equal(violation.scope, 'day')
  assert.equal(violation.minutes, 1)
  assert.equal(violation.code, 'E_ATT_OVER_LIMIT')
})

test('exactly 36h in a month does not trip the monthly cap', async (t) => {
  const rows = JUNE_WEEKDAYS.slice(0, 12).map((date) => `张伟,${date},09:00,21:00,60`)
  const { file, tools } = await fixture(t, rows)
  const report = await tools['attendance_check'].execute({ path: file }, exec)
  assert.equal(report.employees[0].monthly_overtime[0].overtime_minutes, 2160)
  assert.equal(report.employees[0].monthly_overtime[0].over_limit, false)
  assert.equal(report.totals.over_limit_months, 0)
  assert.equal(report.totals.violations, 0)
})

test('more than 36h in a month is flagged over_limit on the month', async (t) => {
  const rows = JUNE_WEEKDAYS.slice(0, 13).map((date) => `张伟,${date},09:00,21:00,60`)
  const { file, tools } = await fixture(t, rows)
  const report = await tools['attendance_check'].execute({ path: file }, exec)
  const monthly = report.employees[0].monthly_overtime[0]
  assert.equal(monthly.overtime_minutes, 2340)
  assert.equal(monthly.over_minutes, 180)
  assert.equal(monthly.over_limit, true)
  assert.equal(report.totals.over_limit_months, 1)
  const violation = report.violations.find((entry) => entry.scope === 'month')
  assert.ok(violation)
  assert.equal(violation.severity, 'high')
  assert.equal(violation.rank, 25)
  assert.equal(violation.kind, 'over_limit')
  assert.equal(violation.date, null)
  assert.equal(violation.month, '2026-06')
  assert.equal(violation.minutes, 180)
  assert.match(violation.message, /月加班 39\.00 小时/)
  assert.match(violation.message, /共 3\.00 小时/)
})

test('the summary marks the over-limit employee and totals the anomaly', async (t) => {
  const rows = JUNE_WEEKDAYS.slice(0, 13).map((date) => `张伟,${date},09:00,21:00,60`)
  const { dir, file } = await fixture(t, rows)
  const tools = toolMap(dir)
  const summary = await tools['attendance_summary'].execute({ path: file }, exec)
  assert.equal(summary.rows.length, 1)
  assert.equal(summary.rows[0].over_limit, true)
  assert.equal(summary.rows[0].overtime_minutes, 2340)
  assert.equal(summary.rows[0].overtime_hours, 39)
  assert.equal(summary.rows[0].anomaly_count, 1)
  assert.equal(summary.totals.over_limit_employees, 1)
})

test('a custom daily cap moves the over-limit threshold', async (t) => {
  const { file, tools } = await fixture(t, ['张伟,2026-06-01,09:00,21:00,60'])
  const report = await tools['attendance_check'].execute(
    { path: file, daily_overtime_cap_hours: 2 },
    exec,
  )
  assert.equal(report.policy.daily_overtime_cap_hours, 2)
  assert.equal(report.totals.over_limit_days, 1)
  assert.equal(report.violations[0].minutes, 60)
})

test('a fractional daily cap is converted to whole minutes', async (t) => {
  const { file, tools } = await fixture(t, ['张伟,2026-06-01,09:00,21:00,60'])
  const report = await tools['attendance_check'].execute(
    { path: file, daily_overtime_cap_hours: 2.5 },
    exec,
  )
  assert.equal(report.totals.over_limit_days, 1)
  assert.equal(report.violations[0].minutes, 30)
})

test('a zero monthly cap flags any overtime in the month', async (t) => {
  const { file, tools } = await fixture(t, ['张伟,2026-06-01,09:00,20:00,60'])
  const report = await tools['attendance_check'].execute(
    { path: file, monthly_overtime_cap_hours: 0 },
    exec,
  )
  assert.equal(report.employees[0].overtime_minutes, 120)
  assert.equal(report.totals.over_limit_months, 1)
  assert.equal(report.violations[0].scope, 'month')
  assert.equal(report.violations[0].minutes, 120)
})

test('a longer standard workday removes overtime', async (t) => {
  const { file, tools } = await fixture(t, ['张伟,2026-06-01,09:00,18:00,60'])
  const report = await tools['attendance_check'].execute({ path: file, standard_hours: 10 }, exec)
  assert.equal(report.employees[0].days[0].overtime_minutes, 0)
  assert.equal(report.totals.violations, 0)
})

test('a monthly violation outranks a daily violation in the sorted list', async (t) => {
  const rows = JUNE_WEEKDAYS.slice(0, 13).map((date, index) =>
    index === 12 ? `张伟,${date},09:00,22:00,60` : `张伟,${date},09:00,21:00,60`,
  )
  const { dir, file } = await fixture(t, rows)
  const tools = toolMap(dir)
  const report = await tools['attendance_check'].execute({ path: file }, exec)
  assert.deepEqual(
    report.violations.map((violation) => [violation.scope, violation.severity, violation.rank]),
    [
      ['month', 'high', 25],
      ['day', 'medium', 20],
    ],
  )
})
