import { AttendanceError } from './errors.js'

/** Minutes in one civil day. */
export const MINUTES_PER_DAY = 1440
/** Latest extended clock accepted after midnight: 29:59 (next day 05:59). */
export const MAX_EXTENDED_MINUTES = 29 * 60 + 59
/** A single shift longer than this is treated as a data-entry mistake. */
export const MAX_SHIFT_MINUTES = MINUTES_PER_DAY

const CLOCK = /^(\d{2}):(\d{2})$/
const NEXT_DAY = /^次日\s*(\d{2}):(\d{2})$/

export interface ParsedClock {
  /** Minutes from midnight of the punch date; next-day times are 1440+. */
  minutes: number
  /** True when written with an explicit `次日` prefix. */
  next_day: boolean
}

function invalid(value: string, label: string, detail: string): never {
  throw new AttendanceError('E_ATT_TIME_INVALID', `${label}：${JSON.stringify(value)} ${detail}`)
}

/**
 * Parse one clock value. Accepted:
 * - `HH:MM` for 00:00–23:59;
 * - extended `24:00`–`29:59` (hours past midnight, the `24:00+` form);
 * - `次日 HH:MM` / `次日HH:MM` for 00:00–23:59 of the next day.
 *
 * Empty strings are rejected here; missing punches are handled by the audit.
 */
export function parseClockTime(value: string, label = '时间'): ParsedClock {
  if (typeof value !== 'string') invalid(String(value), label, '不是字符串')
  const text = value.trim()
  if (text === '') invalid(value, label, '为空')
  const nextDayMatch = NEXT_DAY.exec(text)
  const plainMatch = nextDayMatch ? null : CLOCK.exec(text)
  const match = nextDayMatch ?? plainMatch
  if (!match) invalid(value, label, '不是 HH:MM、次日 HH:MM 或 24:00+')
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (minute > 59) invalid(value, label, '分钟必须在 00–59')
  if (nextDayMatch) {
    if (hour > 23) invalid(value, label, '「次日」后面只能跟 00:00–23:59')
  } else if (hour > 23) {
    if (hour < 24 || hour > 29) invalid(value, label, '跨零点的小时只能是 24–29')
  }
  const base = hour * 60 + minute
  const minutes = nextDayMatch ? base + MINUTES_PER_DAY : base
  if (minutes > MAX_EXTENDED_MINUTES) invalid(value, label, '跨零点最晚只能到次日 05:59')
  return { minutes, next_day: Boolean(nextDayMatch) }
}

/** Render canonical clock text: `HH:MM`, or `次日 HH:MM` for 1440+ minutes. */
export function formatClockMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_EXTENDED_MINUTES) return ''
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY)
  const rest = minutes % MINUTES_PER_DAY
  const text = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`
  return dayOffset === 0 ? text : `次日 ${text}`
}

/**
 * Validate that `clockOut` is later than `clockIn` on the same punch date and
 * that the shift is at most 24 hours. Returns the raw span in minutes.
 */
export function shiftSpanMinutes(clockInMinutes: number, clockOutMinutes: number, detail = ''): number {
  if (!Number.isInteger(clockInMinutes) || !Number.isInteger(clockOutMinutes)) {
    throw new AttendanceError('E_ATT_TIME_INVALID', `${detail}时间不是整数分钟`)
  }
  const span = clockOutMinutes - clockInMinutes
  if (span <= 0) {
    throw new AttendanceError(
      'E_ATT_TIME_INVALID',
      `${detail}下班时间必须晚于上班时间；跨零点请写成「次日 HH:MM」或 25:30`,
    )
  }
  if (span > MAX_SHIFT_MINUTES) {
    throw new AttendanceError('E_ATT_TIME_INVALID', `${detail}单次当班 ${span} 分钟超过 24 小时`)
  }
  return span
}

/** Round minutes to a two-decimal hour number without negative zero. */
export function minutesToHours(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0
  return Math.round((minutes / 60) * 100) / 100
}

/** Render whole minutes as a two-decimal hour string, e.g. 570 -> "9.50". */
export function formatHours(minutes: number): string {
  if (!Number.isFinite(minutes)) return '0.00'
  return (minutes / 60).toFixed(2)
}
