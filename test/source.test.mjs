import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MAX_SOURCE_BYTES, readAttendanceSource } from '../lib/core/source.js'
import { makeTemp, samplePath } from './helpers/fixtures.mjs'

test('reads the user-named punch CSV unchanged', async () => {
  const text = await readAttendanceSource(samplePath)
  assert.equal(text, await readFile(samplePath, 'utf8'))
})

test('rejects an empty or non-string path', async () => {
  for (const value of ['', '   ', null, undefined, 42]) {
    await assert.rejects(
      () => readAttendanceSource(value),
      (error) => error.code === 'E_ATT_PATH_INVALID',
      String(value),
    )
  }
})

test('rejects a path that does not exist', async () => {
  await assert.rejects(
    () => readAttendanceSource('/definitely/not/here/attendance.csv'),
    (error) => {
      assert.equal(error.code, 'E_ATT_PATH_INVALID')
      assert.match(error.message, /找不到/)
      return true
    },
  )
})

test('rejects a directory', async (t) => {
  const dir = await makeTemp(t)
  await mkdir(path.join(dir, 'folder'))
  await assert.rejects(
    () => readAttendanceSource(path.join(dir, 'folder')),
    (error) => {
      assert.equal(error.code, 'E_ATT_PATH_INVALID')
      assert.match(error.message, /不是文件/)
      return true
    },
  )
})

test('rejects an empty file with E_ATT_EMPTY', async (t) => {
  const dir = await makeTemp(t)
  const file = path.join(dir, 'empty.csv')
  await writeFile(file, '')
  await assert.rejects(
    () => readAttendanceSource(file),
    (error) => error.code === 'E_ATT_EMPTY',
  )
})

test('rejects a file above the 20 MB limit', async (t) => {
  const dir = await makeTemp(t)
  const file = path.join(dir, 'huge.csv')
  await writeFile(file, Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x61))
  await assert.rejects(
    () => readAttendanceSource(file),
    (error) => {
      assert.equal(error.code, 'E_ATT_CSV_ROW')
      assert.match(error.message, /超过 20 MB/)
      return true
    },
  )
})

test('trims the path before reading', async () => {
  const text = await readAttendanceSource(`  ${samplePath}  `)
  assert.match(text, /^employee,date,clock_in,clock_out,break_minutes\n/)
})
