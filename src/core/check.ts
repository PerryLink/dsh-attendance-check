import { formatIsoDate, formatIsoMonth, isWeekend, parseIsoDate, weekdayLabel, workdaysBetween } from './date.js'
import { AttendanceError } from './errors.js'
import type { PunchRecord, AttendanceLedger } from './ingest.js'
import {
  policyMinutes,
  resolvePolicy,
  type AttendancePolicy,
  type AttendancePolicyInput,
  type PolicyMinutes,
} from './rules.js'
import { formatClockMinutes, formatHours, minutesToHours, parseClockTime, shiftSpanMinutes } from './time.js'

export type AttendanceDayStatus = 'normal' | 'overtime' | 'over_limit' | 'rest_short' | 'missing_punch' | 'holiday'
export type ViolationSeverity = 'high' | 'medium' | 'low'
export type ViolationKind = 'missing_punch' | 'over_limit' | 'rest_short'
export type ViolationScope = 'day' | 'month'
export type AttendanceIssueCode = 'E_ATT_MISSING_PUNCH' | 'E_ATT_OVER_LIMIT' | 'E_ATT_REST_SHORT'

export interface AttendanceDay {
  date: string
  weekday: string
  clock_in: string
  clock_out: string
  break_minutes: number
  worked_minutes: number
  overtime_minutes: number
  holiday: boolean
  cross_midnight: boolean
  missing_in: boolean
  missing_out: boolean
  status: AttendanceDayStatus
  issue_codes: AttendanceIssueCode[]
}

export interface MonthlyOvertime {
  month: string
  overtime_minutes: number
  cap_minutes: number
  over_minutes: number
  over_limit: boolean
}

export interface EmployeeAttendance {
  employee: string
  days: AttendanceDay[]
  worked_minutes: number
  overtime_minutes: number
  over_limit_days: number
  over_limit_months: number
  missing_punches: number
  rest_short_days: number
  skipped_holiday_days: number
  monthly_overtime: MonthlyOvertime[]
}

export interface AttendanceViolation {
  severity: ViolationSeverity
  rank: number
  kind: ViolationKind
  scope: ViolationScope
  code: AttendanceIssueCode
  employee: string
  date: string | null
  month: string | null
  minutes: number
  message: string
}

export interface AttendancePeriod {
  from: string
  to: string
  workdays: number
  months: string[]
}

export interface AttendanceTotals {
  employees: number
  days: number
  skipped_holiday_rows: number
  worked_minutes: number
  overtime_minutes: number
  over_limit_days: number
  over_limit_months: number
  missing_punches: number
  rest_short_days: number
  violations: number
}

export interface AttendanceReport {
  period: AttendancePeriod
  source_sha256: string
  policy: AttendancePolicy
  employees: EmployeeAttendance[]
  violations: AttendanceViolation[]
  totals: AttendanceTotals
}

interface PendingViolation {
  violation: AttendanceViolation
  sort_date: string
  employee_index: number
}

const SEVERITY_RANK = {
  missing_punch: 30,
  monthly_over_limit: 25,
  daily_over_limit: 20,
  rest_short: 10,
} as const

function emptyDay(record: PunchRecord, dateMs: number, missingIn: boolean, missingOut: boolean): AttendanceDay {
  return {
    date: record.date,
    weekday: weekdayLabel(dateMs),
    clock_in: record.clock_in === '' ? '' : formatClockMinutes(parseClockTime(record.clock_in).minutes),
    clock_out: record.clock_out === '' ? '' : formatClockMinutes(parseClockTime(record.clock_out).minutes),
    break_minutes: record.break_minutes,
    worked_minutes: 0,
    overtime_minutes: 0,
    holiday: isWeekend(dateMs),
    cross_midnight: false,
    missing_in: missingIn,
    missing_out: missingOut,
    status: 'missing_punch',
    issue_codes: ['E_ATT_MISSING_PUNCH'],
  }
}

function evaluateRecord(
  record: PunchRecord,
  rules: PolicyMinutes,
): { day: AttendanceDay; dailyOver: number; restShort: number } {
  const dateMs = parseIsoDate(record.date)
  const holiday = isWeekend(dateMs)
  const missingIn = record.clock_in === ''
  const missingOut = record.clock_out === ''
  if (missingIn || missingOut) {
    return { day: emptyDay(record, dateMs, missingIn, missingOut), dailyOver: 0, restShort: 0 }
  }

  const clockIn = parseClockTime(record.clock_in, `${record.employee} ${record.date} 上班时间`)
  const clockOut = parseClockTime(record.clock_out, `${record.employee} ${record.date} 下班时间`)
  const span = shiftSpanMinutes(clockIn.minutes, clockOut.minutes, `${record.employee} ${record.date}：`)
  const worked = span - record.break_minutes
  if (worked <= 0) {
    throw new AttendanceError(
      'E_ATT_BREAK_INVALID',
      `${record.employee} ${record.date}：休息 ${record.break_minutes} 分钟不少于当班 ${span} 分钟`,
    )
  }

  const standard = holiday ? 0 : rules.standard_minutes
  const overtime = Math.max(0, worked - standard)
  const dailyOver = overtime > rules.daily_overtime_cap_minutes ? overtime - rules.daily_overtime_cap_minutes : 0
  const restShort = record.break_minutes < rules.min_break_minutes ? rules.min_break_minutes - record.break_minutes : 0

  const issueCodes: AttendanceIssueCode[] = []
  if (dailyOver > 0) issueCodes.push('E_ATT_OVER_LIMIT')
  if (restShort > 0) issueCodes.push('E_ATT_REST_SHORT')

  let status: AttendanceDayStatus = 'normal'
  if (dailyOver > 0) status = 'over_limit'
  else if (restShort > 0) status = 'rest_short'
  else if (holiday) status = 'holiday'
  else if (overtime > 0) status = 'overtime'

  return {
    day: {
      date: record.date,
      weekday: weekdayLabel(dateMs),
      clock_in: formatClockMinutes(clockIn.minutes),
      clock_out: formatClockMinutes(clockOut.minutes),
      break_minutes: record.break_minutes,
      worked_minutes: worked,
      overtime_minutes: overtime,
      holiday,
      cross_midnight: clockOut.minutes >= 24 * 60,
      missing_in: false,
      missing_out: false,
      status,
      issue_codes: issueCodes,
    },
    dailyOver,
    restShort,
  }
}

function missingSide(missingIn: boolean, missingOut: boolean): string {
  if (missingIn && missingOut) return '上班与下班卡'
  return missingIn ? '上班卡' : '下班卡'
}

/**
 * Audit every punch row and return per-employee daily hours, overtime, cap
 * violations and issues. Issues never abort: only malformed CSV, dates, times,
 * breaks or rules do.
 */
export function buildAttendanceCheck(
  ledger: AttendanceLedger,
  input: AttendancePolicyInput = {},
): AttendanceReport {
  const policy = resolvePolicy(input)
  const rules = policyMinutes(policy)
  const groups = new Map<string, PunchRecord[]>()
  for (const record of ledger.records) {
    const bucket = groups.get(record.employee)
    if (bucket) bucket.push(record)
    else groups.set(record.employee, [record])
  }

  const pending: PendingViolation[] = []
  const employees: EmployeeAttendance[] = []
  const auditedDates: number[] = []
  let skippedHolidayRows = 0
  let totalViolations = 0

  let employeeOrder = 0
  for (const [employee, records] of groups) {
    const employeeIndex = employeeOrder
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))
    const days: AttendanceDay[] = []
    let skippedHolidayDays = 0
    let workedMinutes = 0
    let overtimeMinutes = 0
    let missingPunches = 0
    let restShortDays = 0
    let overLimitDays = 0

    for (const record of sorted) {
      const dateMs = parseIsoDate(record.date)
      const holiday = isWeekend(dateMs)
      if (holiday && !rules.include_holidays) {
        skippedHolidayDays += 1
        skippedHolidayRows += 1
        continue
      }
      auditedDates.push(dateMs)
      const evaluated = evaluateRecord(record, rules)
      const day = evaluated.day
      days.push(day)
      workedMinutes += day.worked_minutes
      overtimeMinutes += day.overtime_minutes

      if (day.missing_in || day.missing_out) {
        missingPunches += 1
        pending.push({
          violation: {
            severity: 'high',
            rank: SEVERITY_RANK.missing_punch,
            kind: 'missing_punch',
            scope: 'day',
            code: 'E_ATT_MISSING_PUNCH',
            employee,
            date: day.date,
            month: formatIsoMonth(dateMs),
            minutes: 0,
            message: `${day.date} ${employee} 缺少${missingSide(day.missing_in, day.missing_out)}，无法核算当日工时`,
          },
          sort_date: day.date,
          employee_index: employeeIndex,
        })
      }
      if (evaluated.dailyOver > 0) {
        overLimitDays += 1
        pending.push({
          violation: {
            severity: 'medium',
            rank: SEVERITY_RANK.daily_over_limit,
            kind: 'over_limit',
            scope: 'day',
            code: 'E_ATT_OVER_LIMIT',
            employee,
            date: day.date,
            month: formatIsoMonth(dateMs),
            minutes: evaluated.dailyOver,
            message: `${day.date} ${employee} 当日加班 ${formatHours(day.overtime_minutes)} 小时，超出单日上限 ${formatHours(
              rules.daily_overtime_cap_minutes,
            )} 小时共 ${formatHours(evaluated.dailyOver)} 小时`,
          },
          sort_date: day.date,
          employee_index: employeeIndex,
        })
      }
      if (evaluated.restShort > 0) {
        restShortDays += 1
        pending.push({
          violation: {
            severity: 'low',
            rank: SEVERITY_RANK.rest_short,
            kind: 'rest_short',
            scope: 'day',
            code: 'E_ATT_REST_SHORT',
            employee,
            date: day.date,
            month: formatIsoMonth(dateMs),
            minutes: evaluated.restShort,
            message: `${day.date} ${employee} 休息 ${day.break_minutes} 分钟，低于规则要求的 ${rules.min_break_minutes} 分钟`,
          },
          sort_date: day.date,
          employee_index: employeeIndex,
        })
      }
    }

    const byMonth = new Map<string, number>()
    for (const day of days) {
      const month = day.date.slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + day.overtime_minutes)
    }
    const monthly: MonthlyOvertime[] = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, minutes]) => {
        const overMinutes =
          minutes > rules.monthly_overtime_cap_minutes ? minutes - rules.monthly_overtime_cap_minutes : 0
        if (overMinutes > 0) {
          pending.push({
            violation: {
              severity: 'high',
              rank: SEVERITY_RANK.monthly_over_limit,
              kind: 'over_limit',
              scope: 'month',
              code: 'E_ATT_OVER_LIMIT',
              employee,
              date: null,
              month,
              minutes: overMinutes,
              message: `${month} ${employee} 月加班 ${formatHours(minutes)} 小时，超出月上限 ${formatHours(
                rules.monthly_overtime_cap_minutes,
              )} 小时共 ${formatHours(overMinutes)} 小时`,
            },
            sort_date: `${month}-01`,
            employee_index: employeeIndex,
          })
        }
        return {
          month,
          overtime_minutes: minutes,
          cap_minutes: rules.monthly_overtime_cap_minutes,
          over_minutes: overMinutes,
          over_limit: overMinutes > 0,
        }
      })

    const overLimitMonths = monthly.filter((entry) => entry.over_limit).length
    totalViolations +=
      missingPunches + overLimitDays + restShortDays + overLimitMonths
    employees.push({
      employee,
      days,
      worked_minutes: workedMinutes,
      overtime_minutes: overtimeMinutes,
      over_limit_days: overLimitDays,
      over_limit_months: overLimitMonths,
      missing_punches: missingPunches,
      rest_short_days: restShortDays,
      skipped_holiday_days: skippedHolidayDays,
      monthly_overtime: monthly,
    })
    employeeOrder += 1
  }

  if (auditedDates.length === 0) {
    throw new AttendanceError(
      'E_ATT_EMPTY',
      rules.include_holidays ? '文件里没有可核对的打卡记录' : '全部打卡都落在周六/周日，且 include_holidays=false',
    )
  }

  pending.sort(
    (a, b) =>
      b.violation.rank - a.violation.rank ||
      a.sort_date.localeCompare(b.sort_date) ||
      a.employee_index - b.employee_index ||
      a.violation.kind.localeCompare(b.violation.kind),
  )
  const violations = pending.map((entry) => entry.violation)

  const fromMs = Math.min(...auditedDates)
  const toMs = Math.max(...auditedDates)
  const months = [...new Set(employees.flatMap((employee) => employee.days.map((day) => day.date.slice(0, 7))))].sort()

  const totals: AttendanceTotals = {
    employees: employees.length,
    days: employees.reduce((sum, employee) => sum + employee.days.length, 0),
    skipped_holiday_rows: skippedHolidayRows,
    worked_minutes: employees.reduce((sum, employee) => sum + employee.worked_minutes, 0),
    overtime_minutes: employees.reduce((sum, employee) => sum + employee.overtime_minutes, 0),
    over_limit_days: employees.reduce((sum, employee) => sum + employee.over_limit_days, 0),
    over_limit_months: employees.reduce((sum, employee) => sum + employee.over_limit_months, 0),
    missing_punches: employees.reduce((sum, employee) => sum + employee.missing_punches, 0),
    rest_short_days: employees.reduce((sum, employee) => sum + employee.rest_short_days, 0),
    violations: totalViolations,
  }

  return {
    period: {
      from: formatIsoDate(fromMs),
      to: formatIsoDate(toMs),
      workdays: workdaysBetween(fromMs, toMs),
      months,
    },
    source_sha256: ledger.source_sha256,
    policy,
    employees,
    violations,
    totals,
  }
}

/** Convenience: overtime in hours for renders and summaries. */
export function overtimeHours(minutes: number): number {
  return minutesToHours(minutes)
}
