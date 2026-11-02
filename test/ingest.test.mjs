import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { CHINESE_HEADER, HEADER, punchCsv } from './helpers/fixtures.mjs'
import { ingestAttendanceCsv, PUNCH_HEADER } from '../lib/core/ingest.js'

const csvError = (error) => error?.code === 'E_ATT_CSV_ROW'

test('exposes the five canonical columns in documented order', () => {
  assert.deepEqual([...PUNCH_HEADER], ['employee', 'date', 'clock_in', 'clock_out', 'break_minutes'])
})

test('parses the canonical header and keeps line numbers', () => {
  const ledger = ingestAttendanceCsv(punchCsv([
    '张伟,2026-06-22,09:00,18:00,60',
    '李娜,2026-06-23,09:00,18:00,0',
  ]))
  assert.equal(ledger.records.length, 2)
  assert.deepEqual(ledger.records[0], {
    employee: '张伟',
    date: '2026-06-22',
    clock_in: '09:00',
    clock_out: '18:00',
    break_minutes: 60,
    line: 2,
  })
  assert.equal(ledger.records[1].line, 3)
})

test('accepts Chinese aliases for every column', () => {
  const ledger = ingestAttendanceCsv(punchCsv(['张伟,2026-06-22,09:00,18:00,60'], CHINESE_HEADER))
  assert.equal(ledger.records[0].employee, '张伟')
  assert.equal(ledger.records[0].break_minutes, 60)
})

test('matches headers case-insensitively and ignores an extra column', () => {
  const ledger = ingestAttendanceCsv(
    punchCsv(
      ['张伟,2026-06-22,09:00,18:00,60,note'],
      'Employee,Date,Clock_In,Clock_Out,Break_Minutes,Note',
    ),
  )
  assert.equal(ledger.records[0].employee, '张伟')
})

test('trims whitespace around every field', () => {
  const ledger = ingestAttendanceCsv(
    punchCsv(['  张伟  , 2026-06-22 , 09:00 , 18:00 , 60 ']),
  )
  assert.deepEqual(
    [ledger.records[0].employee, ledger.records[0].date, ledger.records[0].clock_in, ledger.records[0].clock_out],
    ['张伟', '2026-06-22', '09:00', '18:00'],
  )
  assert.equal(ledger.records[0].break_minutes, 60)
})

test('parses a quoted employee name containing a comma', () => {
  const ledger = ingestAttendanceCsv(punchCsv(['"张, 三",2026-06-22,09:00,18:00,60']))
  assert.equal(ledger.records[0].employee, '张, 三')
})

test('keeps an empty clock value for the audit to flag as a missing punch', () => {
  const ledger = ingestAttendanceCsv(punchCsv(['王强,2026-06-25,09:00,,60']))
  assert.equal(ledger.records[0].clock_out, '')
})

test('treats an empty break cell as zero', () => {
  const ledger = ingestAttendanceCsv(punchCsv(['王强,2026-06-25,09:00,18:00,']))
  assert.equal(ledger.records[0].break_minutes, 0)
})

test('rejects a missing required header', () => {
  assert.throws(
    () => ingestAttendanceCsv(punchCsv(['张伟,2026-06-22,09:00,18:00'], 'employee,date,clock_in,clock_out')),
    (error) => {
      assert.equal(error.code, 'E_ATT_CSV_ROW')
      assert.match(error.message, /表头缺少：休息分钟/)
      return true
    },
  )
})

test('rejects a duplicate header column', () => {
  assert.throws(
    () => ingestAttendanceCsv(punchCsv(['a,2026-06-22,09:00,18:00,60'], 'employee,date,clock_in,clock_out,break_minutes,员工')),
    csvError,
  )
})

test('rejects a row whose column count differs from the header', () => {
  assert.throws(
    () => ingestAttendanceCsv(punchCsv(['张伟,2026-06-22,09:00,18:00'])),
    (error) => {
      assert.equal(error.code, 'E_ATT_CSV_ROW')
      assert.match(error.message, /第 2 行有 4 列，表头有 5 列/)
      return true
    },
  )
})

test('rejects an empty employee name', () => {
  assert.throws(() => ingestAttendanceCsv(punchCsv([',2026-06-22,09:00,18:00,60'])), csvError)
})

test('rejects a bad date and a bad time', () => {
  assert.throws(
    () => ingestAttendanceCsv(punchCsv(['张伟,2026-02-30,09:00,18:00,60'])),
    (error) => error.code === 'E_ATT_DATE_INVALID',
  )
  assert.throws(
    () => ingestAttendanceCsv(punchCsv(['张伟,2026-06-22,9:00,18:00,60'])),
    (error) => {
      assert.equal(error.code, 'E_ATT_TIME_INVALID')
      assert.match(error.message, /第 2 行上班时间/)
      return true
    },
  )
})

test('rejects a non-integer, negative or oversized break', () => {
  for (const value of ['1.5', '-5', 'abc', '1441']) {
    assert.throws(
      () => ingestAttendanceCsv(punchCsv([`张伟,2026-06-22,09:00,18:00,${value}`])),
      (error) => error.code === 'E_ATT_BREAK_INVALID',
      value,
    )
  }
})

test('rejects duplicate employee-date combinations', () => {
  assert.throws(
    () => ingestAttendanceCsv(punchCsv([
      '张伟,2026-06-22,09:00,18:00,60',
      '张伟,2026-06-22,10:00,19:00,60',
    ])),
    (error) => {
      assert.equal(error.code, 'E_ATT_CSV_ROW')
      assert.match(error.message, /第 3 行与第 2 行重复/)
      return true
    },
  )
})

test('allows the same employee on different dates and different employees on one date', () => {
  const ledger = ingestAttendanceCsv(punchCsv([
    '张伟,2026-06-22,09:00,18:00,60',
    '张伟,2026-06-23,09:00,18:00,60',
    '李娜,2026-06-22,09:00,18:00,60',
  ]))
  assert.equal(ledger.records.length, 3)
})

test('rejects empty content and a header-only file', () => {
  assert.throws(() => ingestAttendanceCsv(''), (error) => error.code === 'E_ATT_EMPTY')
  assert.throws(() => ingestAttendanceCsv(`${HEADER}\n`), (error) => error.code === 'E_ATT_EMPTY')
})

test('hashes the raw file text with SHA-256', () => {
  const text = punchCsv(['张伟,2026-06-22,09:00,18:00,60'])
  const ledger = ingestAttendanceCsv(text)
  assert.equal(ledger.source_sha256, createHash('sha256').update(text).digest('hex'))
  assert.match(ledger.source_sha256, /^[0-9a-f]{64}$/)
})

test('strips a UTF-8 BOM from the header', () => {
  const ledger = ingestAttendanceCsv(`\uFEFF${punchCsv(['张伟,2026-06-22,09:00,18:00,60'])}`)
  assert.equal(ledger.records[0].employee, '张伟')
})
