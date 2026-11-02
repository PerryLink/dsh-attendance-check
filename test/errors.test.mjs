import test from 'node:test'
import assert from 'node:assert/strict'
import { AttendanceError, attendanceErrorMessage } from '../lib/core/errors.js'

const CODES = [
  'E_ATT_CSV_ROW',
  'E_ATT_DATE_INVALID',
  'E_ATT_TIME_INVALID',
  'E_ATT_BREAK_INVALID',
  'E_ATT_POLICY_INVALID',
  'E_ATT_PATH_INVALID',
  'E_ATT_EMPTY',
]

test('every error code renders one sentence, the code and a next action', () => {
  for (const code of CODES) {
    const message = attendanceErrorMessage(code)
    assert.match(message, new RegExp(`（${code}）`))
    assert.match(message, /下一步：/)
    assert.match(message, /[。！？]$|下一步：/)
    assert.ok(message.length > 10)
  }
})

test('a detail is appended after the next action', () => {
  const message = attendanceErrorMessage('E_ATT_TIME_INVALID', '第 2 行上班时间：\"9:00\"')
  assert.match(message, /细节：第 2 行上班时间/)
})

test('AttendanceError carries the code, name and full message', () => {
  const error = new AttendanceError('E_ATT_EMPTY', '只有表头')
  assert.equal(error.name, 'AttendanceError')
  assert.equal(error.code, 'E_ATT_EMPTY')
  assert.match(error.message, /没有可核对的打卡记录/)
  assert.match(error.message, /细节：只有表头/)
  assert.ok(error instanceof Error)
})

test('distinct codes produce distinct human sentences', () => {
  const texts = CODES.map((code) => attendanceErrorMessage(code))
  assert.equal(new Set(texts).size, CODES.length)
})

test('the missing-punch code is an issue code, not a thrown error code', () => {
  const error = new AttendanceError('E_ATT_CSV_ROW')
  assert.notEqual(error.code, 'E_ATT_MISSING_PUNCH')
  assert.doesNotMatch(attendanceErrorMessage('E_ATT_CSV_ROW'), /E_ATT_MISSING_PUNCH/)
})
