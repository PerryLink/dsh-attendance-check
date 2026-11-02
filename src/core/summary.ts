import { formatIsoDate, parseIsoMonth, workdaysBetween, workdaysInMonth } from './date.js'
import { AttendanceError } from './errors.js'
import { policyMinutes, type AttendancePolicy } from './rules.js'
import { minutesToHours } from './time.js'
import type { AttendancePeriod, AttendanceReport } from './check.js'

/** One employee-month rollup. */
export interface AttendanceSummaryRow {
  employee: string
  month: string
  expected_days: number
  attended_days: number
  overtime_minutes: number
  overtime_hours: number
  anomaly_count: number
  missing_punches: number
  rest_short_days: number
  over_limit_days: number
  over_limit: boolean
}

export interface AttendanceSummaryTotals {
  employees: number
  months: number
  expected_days: number
  attended_days: number
  overtime_minutes: number
  over_limit_employees: number
  anomaly_count: number
}

export interface AttendanceSummary {
  period: AttendancePeriod
  source_sha256: string
  policy: AttendancePolicy
  rows: AttendanceSummaryRow[]
  totals: AttendanceSummaryTotals
}

export interface AttendanceSummaryOptions {
  /** Optional `YYYY-MM` filter; defaults to every month in the report. */
  month?: string
}

/**
 * Roll the audit up per employee per month: expected weekdays vs attended days,
 * overtime total, monthly-cap flag and anomaly count. Only (employee, month)
 * combinations present in the file produce a row.
 */
export function buildAttendanceSummary(
  report: AttendanceReport,
  options: AttendanceSummaryOptions = {},
): AttendanceSummary {
  const wanted = options.month === undefined ? null : parseIsoMonth(options.month).month
  const months = wanted === null ? [...report.period.months] : [wanted]
  const available = new Set(report.period.months)
  if (wanted !== null && !available.has(wanted)) {
    throw new AttendanceError('E_ATT_EMPTY', `${wanted} 没有可核对的打卡记录；文件覆盖 ${report.period.months.join('、')}`)
  }

  const periodFromMs = Date.parse(`${report.period.from}T00:00:00Z`)
  const periodToMs = Date.parse(`${report.period.to}T00:00:00Z`)
  const monthlyCapMinutes = policyMinutes(report.policy).monthly_overtime_cap_minutes
  const rows: AttendanceSummaryRow[] = []
  let totalViolations = 0
  let totalOvertime = 0
  let totalExpected = 0
  let totalAttended = 0

  for (const employee of report.employees) {
    for (const month of months) {
      const days = employee.days.filter((day) => day.date.slice(0, 7) === month)
      if (days.length === 0) continue
      const overtimeMinutes = days.reduce((sum, day) => sum + day.overtime_minutes, 0)
      const missingPunches = days.filter((day) => day.missing_in || day.missing_out).length
      const restShortDays = days.filter((day) => day.issue_codes.includes('E_ATT_REST_SHORT')).length
      const overLimitDays = days.filter((day) => day.issue_codes.includes('E_ATT_OVER_LIMIT')).length
      const anomalyCount = report.violations.filter(
        (violation) =>
          violation.employee === employee.employee &&
          (violation.month === month || (violation.date !== null && violation.date.slice(0, 7) === month)),
      ).length
      const expectedDays = workdaysInMonth(month, periodFromMs, periodToMs)
      const attendedDays = days.filter((day) => !day.missing_in && !day.missing_out).length
      rows.push({
        employee: employee.employee,
        month,
        expected_days: expectedDays,
        attended_days: attendedDays,
        overtime_minutes: overtimeMinutes,
        overtime_hours: minutesToHours(overtimeMinutes),
        anomaly_count: anomalyCount,
        missing_punches: missingPunches,
        rest_short_days: restShortDays,
        over_limit_days: overLimitDays,
        over_limit: overtimeMinutes > monthlyCapMinutes,
      })
      totalViolations += anomalyCount
      totalOvertime += overtimeMinutes
      totalExpected += expectedDays
      totalAttended += attendedDays
    }
  }

  if (rows.length === 0) {
    throw new AttendanceError('E_ATT_EMPTY', `${months.join('、')} 没有可汇总的打卡记录`)
  }

  const firstMonth = months[0]!
  const lastMonth = months[months.length - 1]!
  const fromMs = Math.max(periodFromMs, parseIsoMonth(firstMonth).startMs)
  const toMs = Math.min(periodToMs, parseIsoMonth(lastMonth).endMs)
  const overLimitEmployees = new Set(rows.filter((row) => row.over_limit).map((row) => row.employee)).size

  return {
    period: {
      from: formatIsoDate(fromMs),
      to: formatIsoDate(toMs),
      workdays: workdaysBetween(fromMs, toMs),
      months,
    },
    source_sha256: report.source_sha256,
    policy: { ...report.policy },
    rows,
    totals: {
      employees: new Set(rows.map((row) => row.employee)).size,
      months: new Set(rows.map((row) => row.month)).size,
      expected_days: totalExpected,
      attended_days: totalAttended,
      overtime_minutes: totalOvertime,
      over_limit_employees: overLimitEmployees,
      anomaly_count: totalViolations,
    },
  }
}
