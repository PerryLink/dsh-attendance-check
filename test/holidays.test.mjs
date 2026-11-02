import test from 'node:test'
import assert from 'node:assert/strict'
import { exec, makeTemp, summaryFor, toolMap, writePunches } from './helpers/fixtures.mjs'

test('Sunday and Saturday rows are skipped by default', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'weekend.csv', [
    '张伟,2026-06-22,09:00,18:00,60',
    '张伟,2026-06-27,09:00,18:00,60',
  ])
  const tools = toolMap(dir)
  const report = await tools['attendance.check'].execute({ path: file }, exec)
  assert.equal(report.totals.days, 1)
  assert.equal(report.totals.skipped_holiday_rows, 1)
  assert.equal(report.employees[0].skipped_holiday_days, 1)
  assert.equal(report.employees[0].overtime_minutes, 0)
})

test('include_holidays=false on an all-weekend file is E_ATT_EMPTY', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'weekend-only.csv', [
    '张伟,2026-06-27,09:00,18:00,60',
    '张伟,2026-06-28,09:00,18:00,60',
  ])
  const tools = toolMap(dir)
  await assert.rejects(
    () => tools['attendance.check'].execute({ path: file }, exec),
    (error) => {
      assert.equal(error.code, 'E_ATT_EMPTY')
      assert.match(error.message, /include_holidays=true/)
      return true
    },
  )
})

test('include_holidays=true audits weekend work as full overtime', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'weekend-work.csv', ['张伟,2026-06-27,09:00,13:00,60'])
  const tools = toolMap(dir)
  const report = await tools['attendance.check'].execute({ path: file, include_holidays: true }, exec)
  const day = report.employees[0].days[0]
  assert.equal(day.holiday, true)
  assert.equal(day.worked_minutes, 180)
  assert.equal(day.overtime_minutes, 180)
  assert.equal(day.status, 'holiday')
  assert.equal(report.totals.skipped_holiday_rows, 0)
  assert.equal(report.totals.overtime_minutes, 180)
  assert.equal(report.totals.violations, 0)
})

test('holiday overtime still respects the daily cap', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'weekend-long.csv', ['张伟,2026-06-27,09:00,18:00,60'])
  const tools = toolMap(dir)
  const report = await tools['attendance.check'].execute({ path: file, include_holidays: true }, exec)
  assert.equal(report.employees[0].overtime_minutes, 480)
  assert.equal(report.totals.over_limit_days, 1)
  assert.equal(report.violations[0].scope, 'day')
  assert.equal(report.violations[0].minutes, 300)
})

test('a missing punch on a weekend is only an issue when holidays are included', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'weekend-missing.csv', ['张伟,2026-06-27,09:00,,60'])
  const tools = toolMap(dir)
  await assert.rejects(
    () => tools['attendance.check'].execute({ path: file }, exec),
    (error) => error.code === 'E_ATT_EMPTY',
  )
  const report = await tools['attendance.check'].execute({ path: file, include_holidays: true }, exec)
  assert.equal(report.totals.missing_punches, 1)
  assert.equal(report.violations[0].code, 'E_ATT_MISSING_PUNCH')
})

test('summary expected days stay Monday–Friday even with holiday work', async (t) => {
  const dir = await makeTemp(t)
  const file = await writePunches(dir, 'weekend-summary.csv', [
    '张伟,2026-06-26,09:00,18:00,60',
    '张伟,2026-06-27,09:00,13:00,60',
  ])
  const tools = toolMap(dir)
  const summary = await tools['attendance.summary'].execute(
    { path: file, include_holidays: true },
    exec,
  )
  assert.equal(summary.rows[0].expected_days, 1)
  assert.equal(summary.rows[0].attended_days, 2)
  assert.equal(summary.rows[0].overtime_minutes, 180)
})
