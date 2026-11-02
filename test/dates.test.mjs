import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  daysBetween,
  formatIsoDate,
  formatIsoMonth,
  isWeekend,
  isoWeekday,
  monthRange,
  parseIsoDate,
  parseIsoMonth,
  weekdayLabel,
  workdaysBetween,
  workdaysInMonth,
} from '../lib/core/date.js'

const dateError = (error) => error?.code === 'E_ATT_DATE_INVALID'

test('parses a valid YYYY-MM-DD into UTC midnight', () => {
  const ms = parseIsoDate('2026-06-22')
  assert.equal(formatIsoDate(ms), '2026-06-22')
  assert.equal(new Date(ms).toISOString(), '2026-06-22T00:00:00.000Z')
})

test('rejects impossible and malformed dates', () => {
  for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-6-2', '2026/06/22', 'not-a-date', '', '  ', '1899-12-31', '3000-01-01']) {
    assert.throws(() => parseIsoDate(value), dateError, value)
  }
  assert.throws(() => parseIsoDate(20260622), dateError)
})

test('reports ISO weekdays and Chinese labels', () => {
  assert.equal(isoWeekday(parseIsoDate('2026-06-22')), 1)
  assert.equal(isoWeekday(parseIsoDate('2026-06-26')), 5)
  assert.equal(isoWeekday(parseIsoDate('2026-06-27')), 6)
  assert.equal(isoWeekday(parseIsoDate('2026-06-28')), 7)
  assert.equal(weekdayLabel(parseIsoDate('2026-06-22')), '周一')
  assert.equal(weekdayLabel(parseIsoDate('2026-06-26')), '周五')
  assert.equal(weekdayLabel(parseIsoDate('2026-06-28')), '周日')
})

test('detects weekend dates', () => {
  assert.equal(isWeekend(parseIsoDate('2026-06-26')), false)
  assert.equal(isWeekend(parseIsoDate('2026-06-27')), true)
  assert.equal(isWeekend(parseIsoDate('2026-06-28')), true)
})

test('counts workdays between inclusive dates', () => {
  assert.equal(workdaysBetween(parseIsoDate('2026-06-22'), parseIsoDate('2026-06-26')), 5)
  assert.equal(workdaysBetween(parseIsoDate('2026-06-22'), parseIsoDate('2026-06-28')), 5)
  assert.equal(workdaysBetween(parseIsoDate('2026-06-27'), parseIsoDate('2026-06-28')), 0)
  assert.equal(workdaysBetween(parseIsoDate('2026-06-26'), parseIsoDate('2026-06-22')), 0)
})

test('adds and subtracts whole days', () => {
  const start = parseIsoDate('2026-06-30')
  assert.equal(formatIsoDate(addDays(start, 1)), '2026-07-01')
  assert.equal(formatIsoDate(addDays(start, -1)), '2026-06-29')
  assert.equal(daysBetween(parseIsoDate('2026-06-01'), parseIsoDate('2026-07-01')), 30)
})

test('formats a YYYY-MM month', () => {
  assert.equal(formatIsoMonth(parseIsoDate('2026-06-30')), '2026-06')
})

test('parses a month and returns inclusive day bounds', () => {
  const bounds = parseIsoMonth('2026-06')
  assert.equal(formatIsoDate(bounds.startMs), '2026-06-01')
  assert.equal(formatIsoDate(bounds.endMs), '2026-06-30')
  const leap = parseIsoMonth('2024-02')
  assert.equal(formatIsoDate(leap.endMs), '2024-02-29')
})

test('rejects malformed or out-of-range months', () => {
  for (const value of ['2026-6', '2026-13', '2026-00', '2026', '2026-06-22', '', 'x']) {
    assert.throws(() => parseIsoMonth(value), dateError, value)
  }
})

test('clips month workdays to the audited period', () => {
  const from = parseIsoDate('2026-06-29')
  const to = parseIsoDate('2026-07-03')
  assert.equal(workdaysInMonth('2026-06', from, to), 2)
  assert.equal(workdaysInMonth('2026-07', from, to), 3)
})

test('returns month ranges consistently', () => {
  const range = monthRange('2026-06')
  const parsed = parseIsoMonth('2026-06')
  assert.deepEqual(range, { startMs: parsed.startMs, endMs: parsed.endMs })
})
