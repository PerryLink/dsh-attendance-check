import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { checkFor, exec, makeTemp, samplePath, toolMap, writePunches } from './helpers/fixtures.mjs'

test('the sample audits 6 employees over 30 day rows', async () => {
  const tools = toolMap('/tmp/dsh-attendance-check-check')
  const report = await checkFor(tools)
  assert.equal(report.totals.employees, 6)
  assert.equal(report.totals.days, 30)
  assert.equal(report.totals.worked_minutes, 14_220)
  assert.equal(report.totals.overtime_minutes, 300)
  assert.equal(report.totals.over_limit_days, 1)
  assert.equal(report.totals.over_limit_months, 0)
  assert.equal(report.totals.missing_punches, 1)
  assert.equal(report.totals.rest_short_days, 1)
  assert.equal(report.totals.violations, 3)
  assert.equal(report.totals.skipped_holiday_rows, 0)
})

test('the period covers the five audited workdays', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-period'))
  assert.deepEqual(report.period, {
    from: '2026-06-22',
    to: '2026-06-26',
    workdays: 5,
    months: ['2026-06'],
  })
  assert.deepEqual(report.policy, {
    standard_hours: 8,
    daily_overtime_cap_hours: 3,
    monthly_overtime_cap_hours: 36,
    min_break_minutes: 60,
    include_holidays: false,
  })
})

test('employees keep first-appearance order and days are date-sorted', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-order'))
  assert.deepEqual(
    report.employees.map((employee) => employee.employee),
    ['张伟', '李娜', '王强', '刘洋', '陈静', '赵磊'],
  )
  assert.deepEqual(
    report.employees[0].days.map((day) => day.date),
    ['2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26'],
  )
})

test('a normal 09:00–18:00 day with a 60-minute break is exactly 8h', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-normal'))
  const day = report.employees[0].days[0]
  assert.deepEqual(day, {
    date: '2026-06-22',
    weekday: '周一',
    clock_in: '09:00',
    clock_out: '18:00',
    break_minutes: 60,
    worked_minutes: 480,
    overtime_minutes: 0,
    holiday: false,
    cross_midnight: false,
    missing_in: false,
    missing_out: false,
    status: 'normal',
    issue_codes: [],
  })
})

test('a 次日 clock is canonicalised and counts as cross-midnight overtime', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-next-day'))
  const day = report.employees[0].days[1]
  assert.equal(day.clock_out, '次日 00:30')
  assert.equal(day.cross_midnight, true)
  assert.equal(day.worked_minutes, 570)
  assert.equal(day.overtime_minutes, 90)
  assert.equal(day.status, 'overtime')
  assert.equal(report.employees[0].overtime_minutes, 90)
})

test('a day above the 3h daily cap is marked over_limit', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-cap'))
  const lina = report.employees.find((employee) => employee.employee === '李娜')
  const day = lina.days.find((entry) => entry.date === '2026-06-24')
  assert.equal(day.worked_minutes, 690)
  assert.equal(day.overtime_minutes, 210)
  assert.equal(day.status, 'over_limit')
  assert.deepEqual(day.issue_codes, ['E_ATT_OVER_LIMIT'])
  assert.equal(lina.over_limit_days, 1)
})

test('a missing clock becomes an issue, not a thrown error', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-missing'))
  const wang = report.employees.find((employee) => employee.employee === '王强')
  const day = wang.days.find((entry) => entry.date === '2026-06-25')
  assert.equal(day.status, 'missing_punch')
  assert.equal(day.missing_out, true)
  assert.equal(day.missing_in, false)
  assert.equal(day.clock_out, '')
  assert.equal(day.worked_minutes, 0)
  assert.equal(day.overtime_minutes, 0)
  assert.deepEqual(day.issue_codes, ['E_ATT_MISSING_PUNCH'])
  assert.equal(wang.missing_punches, 1)
  assert.equal(report.violations[0].code, 'E_ATT_MISSING_PUNCH')
  assert.match(report.violations[0].message, /缺少下班卡/)
})

test('a 30-minute break is a short-break issue and does not create overtime', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-break'))
  const liu = report.employees.find((employee) => employee.employee === '刘洋')
  const day = liu.days.find((entry) => entry.date === '2026-06-26')
  assert.equal(day.break_minutes, 30)
  assert.equal(day.worked_minutes, 480)
  assert.equal(day.overtime_minutes, 0)
  assert.equal(day.status, 'rest_short')
  assert.deepEqual(day.issue_codes, ['E_ATT_REST_SHORT'])
  assert.equal(liu.rest_short_days, 1)
})

test('violations come out sorted by severity, then date', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-violations'))
  assert.equal(report.violations.length, 3)
  assert.deepEqual(
    report.violations.map((violation) => [violation.severity, violation.rank, violation.kind, violation.employee]),
    [
      ['high', 30, 'missing_punch', '王强'],
      ['medium', 20, 'over_limit', '李娜'],
      ['low', 10, 'rest_short', '刘洋'],
    ],
  )
  const daily = report.violations[1]
  assert.equal(daily.scope, 'day')
  assert.equal(daily.date, '2026-06-24')
  assert.equal(daily.month, '2026-06')
  assert.equal(daily.minutes, 30)
  assert.match(daily.message, /超出单日上限 3\.00 小时共 0\.50 小时/)
  const rest = report.violations[2]
  assert.equal(rest.minutes, 30)
  assert.match(rest.message, /休息 30 分钟/)
})

test('monthly overtime is reported even when it does not exceed the cap', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-monthly'))
  const zhang = report.employees[0]
  assert.deepEqual(zhang.monthly_overtime, [
    {
      month: '2026-06',
      overtime_minutes: 90,
      cap_minutes: 2160,
      over_minutes: 0,
      over_limit: false,
    },
  ])
  assert.equal(report.employees[1].monthly_overtime[0].overtime_minutes, 210)
})

test('the source hash matches the sample file bytes', async () => {
  const report = await checkFor(toolMap('/tmp/dsh-attendance-check-hash'))
  const text = await readFile(samplePath, 'utf8')
  assert.equal(report.source_sha256, createHash('sha256').update(text).digest('hex'))
})

test('an inverted shift is rejected with E_ATT_TIME_INVALID', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'inverted.csv', ['张伟,2026-06-22,09:00,08:00,60'])
  const tools = toolMap(dir)
  await assert.rejects(
    () => tools['attendance.check'].execute({ path: file }, exec),
    (error) => {
      assert.equal(error.code, 'E_ATT_TIME_INVALID')
      assert.match(error.message, /下班时间必须晚于上班时间/)
      return true
    },
  )
})

test('a break that consumes the whole shift is rejected with E_ATT_BREAK_INVALID', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'break.csv', ['张伟,2026-06-22,09:00,10:00,60'])
  const tools = toolMap(dir)
  await assert.rejects(
    () => tools['attendance.check'].execute({ path: file }, exec),
    (error) => error.code === 'E_ATT_BREAK_INVALID',
  )
})

test('custom rules flow through the report and change overtime', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'standard.csv', ['张伟,2026-06-22,09:00,18:00,60'])
  const tools = toolMap(dir)
  const report = await tools['attendance.check'].execute({ path: file, standard_hours: 7.5 }, exec)
  assert.equal(report.policy.standard_hours, 7.5)
  assert.equal(report.employees[0].days[0].overtime_minutes, 30)
  assert.equal(report.employees[0].days[0].status, 'overtime')
})
