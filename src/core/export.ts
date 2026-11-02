import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AttendanceDayStatus, AttendancePeriod, AttendanceReport } from './check.js'
import { toCsv } from './csv.js'
import { AttendanceError } from './errors.js'
import { safeExportPath } from './safe-path.js'
import { formatHours } from './time.js'

/** The nine columns of the reconciliation CSV. */
export const ATTENDANCE_EXPORT_HEADER = [
  '员工',
  '日期',
  '上班',
  '下班',
  '休息分钟',
  '日工时',
  '加班小时',
  '状态',
  '问题',
] as const

export const STATUS_LABELS: Record<AttendanceDayStatus, string> = {
  normal: '正常',
  overtime: '加班',
  over_limit: '超限',
  rest_short: '休息不足',
  missing_punch: '缺卡',
  holiday: '节假日',
}

export interface AttendanceExportResult {
  path: string
  filename: string
  sha256: string
  bytes: number
  rows: number
  employee_count: number
  over_limit_days: number
  missing_punches: number
  violation_count: number
  period: AttendancePeriod
}

/** Build the day-level reconciliation CSV in employee order and date order. */
export function attendanceReconciliationCsv(report: AttendanceReport): string {
  const rows: string[][] = [[...ATTENDANCE_EXPORT_HEADER]]
  for (const employee of report.employees) {
    for (const day of employee.days) {
      rows.push([
        employee.employee,
        day.date,
        day.clock_in,
        day.clock_out,
        String(day.break_minutes),
        formatHours(day.worked_minutes),
        formatHours(day.overtime_minutes),
        STATUS_LABELS[day.status],
        day.issue_codes.join(';'),
      ])
    }
  }
  return toCsv(rows)
}

/** Default safe filename for a reconciliation export. */
export function defaultExportFilename(period: AttendancePeriod): string {
  return `attendance-${period.from}-${period.to}.csv`
}

/** Write the reconciliation CSV under `exportsDir` and return its metadata. */
export async function writeAttendanceExport(
  report: AttendanceReport,
  exportsDir: string,
  filename: string,
): Promise<AttendanceExportResult> {
  const csv = attendanceReconciliationCsv(report)
  let filePath: string
  try {
    filePath = await safeExportPath(exportsDir, filename)
  } catch (error) {
    if (error instanceof AttendanceError) throw error
    throw new AttendanceError('E_ATT_PATH_INVALID', String(error))
  }
  try {
    await writeFile(filePath, csv, 'utf8')
  } catch (error) {
    throw new AttendanceError('E_ATT_PATH_INVALID', `写核对表失败：${String(error)}`)
  }
  return {
    path: filePath,
    filename,
    sha256: createHash('sha256').update(csv).digest('hex'),
    bytes: Buffer.byteLength(csv, 'utf8'),
    rows: report.totals.days,
    employee_count: report.totals.employees,
    over_limit_days: report.totals.over_limit_days,
    missing_punches: report.totals.missing_punches,
    violation_count: report.totals.violations,
    period: report.period,
  }
}

/** Expose the resolved path helper to tests without duplicating rules. */
export function exportPathFor(exportsDir: string, filename: string): string {
  return path.join(exportsDir, filename)
}
