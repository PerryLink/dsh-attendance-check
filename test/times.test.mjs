import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatClockMinutes,
  formatHours,
  MAX_EXTENDED_MINUTES,
  minutesToHours,
  parseClockTime,
  shiftSpanMinutes,
} from '../lib/core/time.js'

const timeError = (error) => error?.code === 'E_ATT_TIME_INVALID'

test('parses plain HH:MM into minutes from midnight', () => {
  assert.deepEqual(parseClockTime('09:00'), { minutes: 540, next_day: false })
  assert.deepEqual(parseClockTime('00:00'), { minutes: 0, next_day: false })
  assert.deepEqual(parseClockTime('18:30'), { minutes: 1110, next_day: false })
  assert.deepEqual(parseClockTime('23:59'), { minutes: 1439, next_day: false })
})

test('accepts extended 24:00+ clocks for the next day', () => {
  assert.deepEqual(parseClockTime('24:00'), { minutes: 1440, next_day: false })
  assert.deepEqual(parseClockTime('25:30'), { minutes: 1530, next_day: false })
  assert.deepEqual(parseClockTime('29:59'), { minutes: 1799, next_day: false })
  assert.equal(MAX_EXTENDED_MINUTES, 1799)
})

test('accepts 次日 HH:MM with and without a space', () => {
  assert.deepEqual(parseClockTime('次日 00:30'), { minutes: 1470, next_day: true })
  assert.deepEqual(parseClockTime('次日01:30'), { minutes: 1530, next_day: true })
  assert.deepEqual(parseClockTime('次日 05:59'), { minutes: 1799, next_day: true })
})

test('trims surrounding whitespace before parsing', () => {
  assert.deepEqual(parseClockTime('  08:05  '), { minutes: 485, next_day: false })
})

test('rejects malformed clock text with E_ATT_TIME_INVALID', () => {
  for (const value of ['9:00', '09:60', '24:60', '30:00', '次日 24:00', '次日 30:00', '次日 23:59', 'abc', '', '  ', '09：00', '-1:00', '09:0', '09:000']) {
    assert.throws(() => parseClockTime(value), timeError, value)
  }
})

test('rejects non-string clock input', () => {
  assert.throws(() => parseClockTime(900), timeError)
  assert.throws(() => parseClockTime(null), timeError)
})

test('formats clock minutes back to canonical text', () => {
  assert.equal(formatClockMinutes(540), '09:00')
  assert.equal(formatClockMinutes(0), '00:00')
  assert.equal(formatClockMinutes(1439), '23:59')
  assert.equal(formatClockMinutes(1440), '次日 00:00')
  assert.equal(formatClockMinutes(1470), '次日 00:30')
  assert.equal(formatClockMinutes(1799), '次日 05:59')
  assert.equal(formatClockMinutes(-1), '')
  assert.equal(formatClockMinutes(1800), '')
  assert.equal(formatClockMinutes(1.5), '')
})

test('validates a shift span and rejects an inverted or overlong shift', () => {
  assert.equal(shiftSpanMinutes(540, 1080), 540)
  assert.equal(shiftSpanMinutes(840, 1470), 630)
  assert.throws(() => shiftSpanMinutes(1080, 540), timeError)
  assert.throws(() => shiftSpanMinutes(540, 540), timeError)
  assert.throws(() => shiftSpanMinutes(0, 1500), timeError)
  assert.throws(() => shiftSpanMinutes(0.5, 100), timeError)
})

test('converts minutes to two-decimal hours', () => {
  assert.equal(minutesToHours(480), 8)
  assert.equal(minutesToHours(570), 9.5)
  assert.equal(minutesToHours(35), 0.58)
  assert.equal(minutesToHours(0), 0)
  assert.equal(minutesToHours(Number.NaN), 0)
})

test('formats hours with two decimals', () => {
  assert.equal(formatHours(480), '8.00')
  assert.equal(formatHours(570), '9.50')
  assert.equal(formatHours(210), '3.50')
  assert.equal(formatHours(0), '0.00')
  assert.equal(formatHours(Number.NaN), '0.00')
})

test('error text names the label and keeps the next-action wording', () => {
  assert.throws(
    () => parseClockTime('9:00', '第 3 行上班时间'),
    (error) => {
      assert.equal(error.code, 'E_ATT_TIME_INVALID')
      assert.match(error.message, /第 3 行上班时间/)
      assert.match(error.message, /下一步：/)
      return true
    },
  )
})
