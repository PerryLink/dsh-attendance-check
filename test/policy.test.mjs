import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_POLICY, policyMinutes, policyReport, resolvePolicy } from '../lib/core/rules.js'

const policyError = (error) => error?.code === 'E_ATT_POLICY_INVALID'

test('default rules are 8h / 3h / 36h / 60min with weekends excluded', () => {
  assert.deepEqual(resolvePolicy(), {
    standard_hours: 8,
    daily_overtime_cap_hours: 3,
    monthly_overtime_cap_hours: 36,
    min_break_minutes: 60,
    include_holidays: false,
  })
  assert.deepEqual(DEFAULT_POLICY, resolvePolicy())
})

test('accepts explicit overrides and keeps them in the report', () => {
  assert.deepEqual(resolvePolicy({
    standardHours: 7.5,
    dailyOvertimeCapHours: 2,
    monthlyOvertimeCapHours: 30,
    minBreakMinutes: 45,
    includeHolidays: true,
  }), {
    standard_hours: 7.5,
    daily_overtime_cap_hours: 2,
    monthly_overtime_cap_hours: 30,
    min_break_minutes: 45,
    include_holidays: true,
  })
})

test('converts hours to whole minutes for the audit', () => {
  assert.deepEqual(policyMinutes(resolvePolicy()), {
    standard_minutes: 480,
    daily_overtime_cap_minutes: 180,
    monthly_overtime_cap_minutes: 2160,
    min_break_minutes: 60,
    include_holidays: false,
  })
  assert.equal(policyMinutes(resolvePolicy({ standardHours: 7.5 })).standard_minutes, 450)
})

test('rejects a standard workday outside 1–24 hours', () => {
  for (const value of [0, 0.5, 24.5, -1, Number.NaN, Number.POSITIVE_INFINITY, '8']) {
    assert.throws(() => resolvePolicy({ standardHours: value }), policyError, String(value))
  }
  assert.equal(resolvePolicy({ standardHours: 1 }).standard_hours, 1)
  assert.equal(resolvePolicy({ standardHours: 24 }).standard_hours, 24)
})

test('rejects a daily cap outside 0–24 hours', () => {
  for (const value of [-0.1, 25, Number.NaN, '3']) {
    assert.throws(() => resolvePolicy({ dailyOvertimeCapHours: value }), policyError, String(value))
  }
  assert.equal(resolvePolicy({ dailyOvertimeCapHours: 0 }).daily_overtime_cap_hours, 0)
})

test('rejects a monthly cap outside 0–744 hours', () => {
  for (const value of [-1, 745, Number.NaN, null]) {
    assert.throws(() => resolvePolicy({ monthlyOvertimeCapHours: value }), policyError, String(value))
  }
  assert.equal(resolvePolicy({ monthlyOvertimeCapHours: 744 }).monthly_overtime_cap_hours, 744)
})

test('requires a whole-number minimum break between 0 and 720 minutes', () => {
  for (const value of [-1, 1.5, 721, Number.NaN, '60']) {
    assert.throws(() => resolvePolicy({ minBreakMinutes: value }), policyError, String(value))
  }
  assert.equal(resolvePolicy({ minBreakMinutes: 0 }).min_break_minutes, 0)
  assert.equal(resolvePolicy({ minBreakMinutes: 720 }).min_break_minutes, 720)
})

test('requires include_holidays to be a real boolean', () => {
  for (const value of ['true', 1, null]) {
    assert.throws(() => resolvePolicy({ includeHolidays: value }), policyError, String(value))
  }
  assert.equal(resolvePolicy({ includeHolidays: true }).include_holidays, true)
})

test('policyReport returns a copy rather than the source object', () => {
  const policy = resolvePolicy()
  const copy = policyReport(policy)
  assert.deepEqual(copy, policy)
  assert.notEqual(copy, policy)
})
