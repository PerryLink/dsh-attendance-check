import { createHash } from 'node:crypto'
import { parseCsv } from './csv.js'
import { parseClockTime } from './time.js'
import { parseIsoDate } from './date.js'
import { AttendanceError } from './errors.js'

/** Canonical columns, in the order documented to users. */
export const PUNCH_HEADER = ['employee', 'date', 'clock_in', 'clock_out', 'break_minutes'] as const
export type PunchField = (typeof PUNCH_HEADER)[number]

const HEADER_LABELS: Record<PunchField, string> = {
  employee: '员工',
  date: '日期',
  clock_in: '上班时间',
  clock_out: '下班时间',
  break_minutes: '休息分钟',
}

/** Header aliases; matching is case-insensitive after trimming. */
const HEADER_ALIASES: Record<PunchField, string[]> = {
  employee: ['employee', 'name', '员工', '姓名', '员工姓名'],
  date: ['date', 'work_date', 'workdate', '日期', '考勤日期'],
  clock_in: ['clock_in', 'clockin', 'in', '上班', '上班时间', '签到'],
  clock_out: ['clock_out', 'clockout', 'out', '下班', '下班时间', '签退'],
  break_minutes: ['break_minutes', 'break', '休息分钟', '休息', '午休分钟', '休息时间'],
}

/** One punch row. Missing clock values stay as empty strings on purpose. */
export interface PunchRecord {
  employee: string
  date: string
  clock_in: string
  clock_out: string
  break_minutes: number
  /** 1-based physical CSV line, useful in error details. */
  line: number
}

export interface AttendanceLedger {
  records: PunchRecord[]
  source_sha256: string
}

function headerKey(value: string): string {
  return value.trim().replace(/^\uFEFF/, '').toLowerCase()
}

function mapHeader(header: string[]): Map<PunchField, number> {
  const mapped = new Map<PunchField, number>()
  for (let index = 0; index < header.length; index += 1) {
    const name = headerKey(header[index] ?? '')
    for (const field of PUNCH_HEADER) {
      if (!HEADER_ALIASES[field].includes(name)) continue
      const previous = mapped.get(field)
      if (previous !== undefined) {
        throw new AttendanceError(
          'E_ATT_CSV_ROW',
          `表头里 ${HEADER_LABELS[field]} 出现了两次（第 ${previous + 1} 列与第 ${index + 1} 列）`,
        )
      }
      mapped.set(field, index)
      break
    }
  }
  const missing = PUNCH_HEADER.filter((field) => !mapped.has(field)).map((field) => HEADER_LABELS[field])
  if (missing.length > 0) {
    throw new AttendanceError('E_ATT_CSV_ROW', `表头缺少：${missing.join('、')}`)
  }
  return mapped
}

function parseBreakMinutes(value: string, line: number): number {
  const text = value.trim()
  if (text === '') return 0
  if (!/^\d{1,4}$/.test(text)) {
    throw new AttendanceError(
      'E_ATT_BREAK_INVALID',
      `第 ${line} 行休息分钟：${JSON.stringify(value)} 不是非负整数分钟`,
    )
  }
  const minutes = Number(text)
  if (minutes > 24 * 60) {
    throw new AttendanceError('E_ATT_BREAK_INVALID', `第 ${line} 行休息分钟 ${minutes} 超过 1440`)
  }
  return minutes
}

/**
 * Parse a punch CSV with a header row. Missing clock values are allowed — they
 * become `E_ATT_MISSING_PUNCH` issues during the audit, never a thrown error.
 * Duplicate (employee, date), a bad date, a bad time or a bad break aborts.
 */
export function ingestAttendanceCsv(text: string): AttendanceLedger {
  if (typeof text !== 'string') {
    throw new AttendanceError('E_ATT_CSV_ROW', 'CSV 内容不是文本')
  }
  const parsed = parseCsv(text)
  if (parsed.rows.length === 0) {
    throw new AttendanceError('E_ATT_EMPTY', 'CSV 没有表头行')
  }
  const header = parsed.rows[0]!
  const columns = mapHeader(header)
  const records: PunchRecord[] = []
  const seen = new Map<string, number>()

  for (let index = 1; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index]!
    const line = parsed.lines[index] ?? index + 1
    if (row.length !== header.length) {
      throw new AttendanceError(
        'E_ATT_CSV_ROW',
        `第 ${line} 行有 ${row.length} 列，表头有 ${header.length} 列`,
      )
    }
    const pick = (field: PunchField): string => (row[columns.get(field)!] ?? '').trim()
    const employee = pick('employee')
    if (employee === '') {
      throw new AttendanceError('E_ATT_CSV_ROW', `第 ${line} 行员工为空`)
    }
    const date = pick('date')
    const dateMs = parseIsoDate(date, `第 ${line} 行日期`)
    const clockIn = pick('clock_in')
    const clockOut = pick('clock_out')
    if (clockIn !== '') parseClockTime(clockIn, `第 ${line} 行上班时间`)
    if (clockOut !== '') parseClockTime(clockOut, `第 ${line} 行下班时间`)
    const breakMinutes = parseBreakMinutes(row[columns.get('break_minutes')!] ?? '', line)

    const key = `${employee}\u0000${dateMs}`
    const previousLine = seen.get(key)
    if (previousLine !== undefined) {
      throw new AttendanceError(
        'E_ATT_CSV_ROW',
        `第 ${line} 行与第 ${previousLine} 行重复：${employee} 在 ${date} 有两条打卡记录`,
      )
    }
    seen.set(key, line)
    records.push({
      employee,
      date: new Date(dateMs).toISOString().slice(0, 10),
      clock_in: clockIn,
      clock_out: clockOut,
      break_minutes: breakMinutes,
      line,
    })
  }

  if (records.length === 0) {
    throw new AttendanceError('E_ATT_EMPTY', 'CSV 只有表头，没有打卡记录')
  }
  return { records, source_sha256: createHash('sha256').update(text).digest('hex') }
}
