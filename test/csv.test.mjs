import test from 'node:test'
import assert from 'node:assert/strict'
import { csvField, parseCsv, toCsv } from '../lib/core/csv.js'

const csvError = (error) => error?.code === 'E_ATT_CSV_ROW'

test('escapes only fields that need RFC 4180 quoting', () => {
  assert.equal(csvField('plain'), 'plain')
  assert.equal(csvField('a,b'), '"a,b"')
  assert.equal(csvField('say "hi"'), '"say ""hi"""')
  assert.equal(csvField('line\nbreak'), '"line\nbreak"')
  assert.equal(csvField('cr\rhere'), '"cr\rhere"')
  assert.equal(csvField(''), '')
})

test('builds CSV with a trailing newline and an empty string for no rows', () => {
  assert.equal(toCsv([['a', 'b'], ['1', '2']]), 'a,b\n1,2\n')
  assert.equal(toCsv([]), '')
})

test('parses quoted commas, doubled quotes and CRLF records', () => {
  const parsed = parseCsv('employee,note\r\n"张, 三","said ""hi"""\r\n')
  assert.deepEqual(parsed.rows, [
    ['employee', 'note'],
    ['张, 三', 'said "hi"'],
  ])
  assert.deepEqual(parsed.lines, [1, 2])
})

test('tracks physical line numbers across embedded newlines', () => {
  const parsed = parseCsv('a,b\n"x\ny",2\nz,3\n')
  assert.deepEqual(parsed.rows, [
    ['a', 'b'],
    ['x\ny', '2'],
    ['z', '3'],
  ])
  assert.deepEqual(parsed.lines, [1, 2, 4])
})

test('ignores blank lines and a UTF-8 BOM', () => {
  const parsed = parseCsv('\uFEFFemployee,date\n\n张伟,2026-06-22\n\n')
  assert.deepEqual(parsed.rows, [
    ['employee', 'date'],
    ['张伟', '2026-06-22'],
  ])
})

test('keeps a trailing empty field on the last record', () => {
  const parsed = parseCsv('a,b\n1,\n')
  assert.deepEqual(parsed.rows[1], ['1', ''])
})

test('rejects NUL bytes and non-string input', () => {
  assert.throws(() => parseCsv('a,b\n1,\0\n'), csvError)
  assert.throws(() => parseCsv(Buffer.from('a,b\n')), csvError)
})

test('rejects an unclosed quote and names the record line', () => {
  assert.throws(
    () => parseCsv('a,b\n"open,2\n'),
    (error) => {
      assert.equal(error.code, 'E_ATT_CSV_ROW')
      assert.match(error.message, /第 2 行/)
      return true
    },
  )
})

test('rejects stray characters after a closing quote', () => {
  assert.throws(() => parseCsv('a,b\n"x"y,2\n'), csvError)
  assert.throws(() => parseCsv('a,b\nx"y,2\n'), csvError)
})

test('round-trips a field with comma, quote and newline', () => {
  const value = '张, "三"\nline two'
  const parsed = parseCsv(toCsv([['employee'], [value]]))
  assert.equal(parsed.rows[1][0], value)
})
