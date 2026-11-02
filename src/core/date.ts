import { AttendanceError } from './errors.js'

export const MS_PER_DAY = 86_400_000

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/**
 * Parse a strict `YYYY-MM-DD` calendar date into UTC midnight milliseconds.
 * Rejects impossible dates such as 2026-02-30 and years outside 1900–2999.
 */
export function parseIsoDate(value: string, label = '日期'): number {
  if (typeof value !== 'string') {
    throw new AttendanceError('E_ATT_DATE_INVALID', `${label}：${JSON.stringify(value)} 不是字符串`)
  }
  const text = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) {
    throw new AttendanceError('E_ATT_DATE_INVALID', `${label}：${JSON.stringify(value)} 不是 YYYY-MM-DD`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || year > 2999) {
    throw new AttendanceError('E_ATT_DATE_INVALID', `${label}：年份 ${year} 超出 1900–2999`)
  }
  const ms = Date.UTC(year, month - 1, day)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new AttendanceError('E_ATT_DATE_INVALID', `${label}：${JSON.stringify(value)} 不是真实存在的日期`)
  }
  return ms
}

/** Parse a strict `YYYY-MM` month and return its inclusive UTC day bounds. */
export function parseIsoMonth(value: string, label = '月份'): { month: string; startMs: number; endMs: number } {
  if (typeof value !== 'string') {
    throw new AttendanceError('E_ATT_DATE_INVALID', `${label}：${JSON.stringify(value)} 不是字符串`)
  }
  const text = value.trim()
  const match = /^(\d{4})-(\d{2})$/.exec(text)
  if (!match) {
    throw new AttendanceError('E_ATT_DATE_INVALID', `${label}：${JSON.stringify(value)} 不是 YYYY-MM`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 1900 || year > 2999 || month < 1 || month > 12) {
    throw new AttendanceError('E_ATT_DATE_INVALID', `${label}：${JSON.stringify(value)} 不是有效月份`)
  }
  const startMs = Date.UTC(year, month - 1, 1)
  const endMs = Date.UTC(year, month, 0)
  return { month: `${match[1]}-${match[2]}`, startMs, endMs }
}

/** Format UTC midnight milliseconds as `YYYY-MM-DD`. */
export function formatIsoDate(ms: number): string {
  const date = new Date(ms)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Format UTC midnight milliseconds as `YYYY-MM`. */
export function formatIsoMonth(ms: number): string {
  return formatIsoDate(ms).slice(0, 7)
}

/** Whole days from `fromMs` to `toMs`; positive when `toMs` is later. */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / MS_PER_DAY)
}

/** Add whole UTC days to a midnight timestamp. */
export function addDays(ms: number, days: number): number {
  return ms + days * MS_PER_DAY
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(ms: number): number {
  const day = new Date(ms).getUTCDay()
  return day === 0 ? 7 : day
}

/** Chinese weekday label, e.g. `周一`. */
export function weekdayLabel(ms: number): string {
  return WEEKDAY_LABELS[new Date(ms).getUTCDay()]!
}

/** Saturday or Sunday under this package's built-in holiday rule. */
export function isWeekend(ms: number): boolean {
  const day = new Date(ms).getUTCDay()
  return day === 0 || day === 6
}

/** Count Monday–Friday dates in the inclusive range. */
export function workdaysBetween(fromMs: number, toMs: number): number {
  if (toMs < fromMs) return 0
  let count = 0
  for (let cursor = fromMs; cursor <= toMs; cursor += MS_PER_DAY) {
    if (!isWeekend(cursor)) count += 1
  }
  return count
}

/** Workdays of `month` clipped to the inclusive `fromMs`–`toMs` range. */
export function workdaysInMonth(month: string, fromMs: number, toMs: number): number {
  const bounds = parseIsoMonth(month)
  const start = Math.max(bounds.startMs, fromMs)
  const end = Math.min(bounds.endMs, toMs)
  return workdaysBetween(start, end)
}

/** First and last calendar day of a `YYYY-MM` month. */
export function monthRange(month: string): { startMs: number; endMs: number } {
  const bounds = parseIsoMonth(month)
  return { startMs: bounds.startMs, endMs: bounds.endMs }
}
