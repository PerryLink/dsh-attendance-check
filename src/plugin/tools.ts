import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  buildAttendanceCheck,
  type AttendanceReport,
  type ViolationKind,
  type ViolationScope,
  type ViolationSeverity,
} from '../core/check.js'
import { defaultExportFilename, writeAttendanceExport, type AttendanceExportResult } from '../core/export.js'
import { ingestAttendanceCsv } from '../core/ingest.js'
import type { AttendancePolicyInput } from '../core/rules.js'
import { readAttendanceSource } from '../core/source.js'
import { buildAttendanceSummary, type AttendanceSummary, type AttendanceSummaryRow } from '../core/summary.js'
import { formatHours } from '../core/time.js'

export interface ToolDeps {
  /** Local write root; the plugin uses `$DSH_HOME/dsh-attendance-check`. */
  baseDir: string
}

const text = (value: string) => [{ type: 'text' as const, text: value }]

const policyParameters = {
  path: { type: 'string' as const, required: true as const },
  standard_hours: { type: 'number' as const },
  daily_overtime_cap_hours: { type: 'number' as const },
  monthly_overtime_cap_hours: { type: 'number' as const },
  min_break_minutes: { type: 'number' as const },
  include_holidays: { type: 'boolean' as const },
}

interface PolicyArgs {
  path: string
  standard_hours?: number
  daily_overtime_cap_hours?: number
  monthly_overtime_cap_hours?: number
  min_break_minutes?: number
  include_holidays?: boolean
}

function policyInput(args: PolicyArgs): AttendancePolicyInput {
  return {
    standardHours: args.standard_hours,
    dailyOvertimeCapHours: args.daily_overtime_cap_hours,
    monthlyOvertimeCapHours: args.monthly_overtime_cap_hours,
    minBreakMinutes: args.min_break_minutes,
    includeHolidays: args.include_holidays,
  }
}

async function loadReport(args: PolicyArgs): Promise<AttendanceReport> {
  const ledger = ingestAttendanceCsv(await readAttendanceSource(args.path))
  return buildAttendanceCheck(ledger, policyInput(args))
}

const periodSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    from: { type: 'string' as const, required: true },
    to: { type: 'string' as const, required: true },
    workdays: { type: 'integer' as const, required: true },
    months: { type: 'array' as const, required: true, items: { type: 'string' as const } },
  },
} as const

const policySchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    standard_hours: { type: 'number' as const, required: true },
    daily_overtime_cap_hours: { type: 'number' as const, required: true },
    monthly_overtime_cap_hours: { type: 'number' as const, required: true },
    min_break_minutes: { type: 'integer' as const, required: true },
    include_holidays: { type: 'boolean' as const, required: true },
  },
} as const

const daySchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    date: { type: 'string' as const, required: true },
    weekday: { type: 'string' as const, required: true },
    clock_in: { type: 'string' as const, required: true },
    clock_out: { type: 'string' as const, required: true },
    break_minutes: { type: 'integer' as const, required: true },
    worked_minutes: { type: 'integer' as const, required: true },
    overtime_minutes: { type: 'integer' as const, required: true },
    holiday: { type: 'boolean' as const, required: true },
    cross_midnight: { type: 'boolean' as const, required: true },
    missing_in: { type: 'boolean' as const, required: true },
    missing_out: { type: 'boolean' as const, required: true },
    status: {
      type: 'string' as const,
      required: true,
      enum: ['normal', 'overtime', 'over_limit', 'rest_short', 'missing_punch', 'holiday'],
    },
    issue_codes: {
      type: 'array' as const,
      required: true,
      items: {
        type: 'string' as const,
        enum: ['E_ATT_MISSING_PUNCH', 'E_ATT_OVER_LIMIT', 'E_ATT_REST_SHORT'],
      },
    },
  },
} as const

const monthlyOvertimeSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    month: { type: 'string' as const, required: true },
    overtime_minutes: { type: 'integer' as const, required: true },
    cap_minutes: { type: 'integer' as const, required: true },
    over_minutes: { type: 'integer' as const, required: true },
    over_limit: { type: 'boolean' as const, required: true },
  },
} as const

const employeeSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    employee: { type: 'string' as const, required: true },
    days: { type: 'array' as const, required: true, items: daySchema },
    worked_minutes: { type: 'integer' as const, required: true },
    overtime_minutes: { type: 'integer' as const, required: true },
    over_limit_days: { type: 'integer' as const, required: true },
    over_limit_months: { type: 'integer' as const, required: true },
    missing_punches: { type: 'integer' as const, required: true },
    rest_short_days: { type: 'integer' as const, required: true },
    skipped_holiday_days: { type: 'integer' as const, required: true },
    monthly_overtime: { type: 'array' as const, required: true, items: monthlyOvertimeSchema },
  },
} as const

const violationSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    severity: { type: 'string' as const, required: true, enum: ['high', 'medium', 'low'] },
    rank: { type: 'integer' as const, required: true },
    kind: { type: 'string' as const, required: true, enum: ['missing_punch', 'over_limit', 'rest_short'] },
    scope: { type: 'string' as const, required: true, enum: ['day', 'month'] },
    code: {
      type: 'string' as const,
      required: true,
      enum: ['E_ATT_MISSING_PUNCH', 'E_ATT_OVER_LIMIT', 'E_ATT_REST_SHORT'],
    },
    employee: { type: 'string' as const, required: true },
    date: { oneOf: [{ type: 'string' as const }, { type: 'null' as const }], required: true },
    month: { oneOf: [{ type: 'string' as const }, { type: 'null' as const }], required: true },
    minutes: { type: 'integer' as const, required: true },
    message: { type: 'string' as const, required: true },
  },
} as const

const checkSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    period: { ...periodSchema, required: true as const },
    source_sha256: { type: 'string' as const, required: true },
    policy: { ...policySchema, required: true as const },
    employees: { type: 'array' as const, required: true, items: employeeSchema },
    violations: { type: 'array' as const, required: true, items: violationSchema },
    totals: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        employees: { type: 'integer' as const, required: true },
        days: { type: 'integer' as const, required: true },
        skipped_holiday_rows: { type: 'integer' as const, required: true },
        worked_minutes: { type: 'integer' as const, required: true },
        overtime_minutes: { type: 'integer' as const, required: true },
        over_limit_days: { type: 'integer' as const, required: true },
        over_limit_months: { type: 'integer' as const, required: true },
        missing_punches: { type: 'integer' as const, required: true },
        rest_short_days: { type: 'integer' as const, required: true },
        violations: { type: 'integer' as const, required: true },
      },
      required: true,
    },
  },
} as const

const summaryRowSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    employee: { type: 'string' as const, required: true },
    month: { type: 'string' as const, required: true },
    expected_days: { type: 'integer' as const, required: true },
    attended_days: { type: 'integer' as const, required: true },
    overtime_minutes: { type: 'integer' as const, required: true },
    overtime_hours: { type: 'number' as const, required: true },
    anomaly_count: { type: 'integer' as const, required: true },
    missing_punches: { type: 'integer' as const, required: true },
    rest_short_days: { type: 'integer' as const, required: true },
    over_limit_days: { type: 'integer' as const, required: true },
    over_limit: { type: 'boolean' as const, required: true },
  },
} as const

const summarySchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    period: { ...periodSchema, required: true as const },
    source_sha256: { type: 'string' as const, required: true },
    policy: { ...policySchema, required: true as const },
    rows: { type: 'array' as const, required: true, items: summaryRowSchema },
    totals: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        employees: { type: 'integer' as const, required: true },
        months: { type: 'integer' as const, required: true },
        expected_days: { type: 'integer' as const, required: true },
        attended_days: { type: 'integer' as const, required: true },
        overtime_minutes: { type: 'integer' as const, required: true },
        over_limit_employees: { type: 'integer' as const, required: true },
        anomaly_count: { type: 'integer' as const, required: true },
      },
      required: true,
    },
  },
} as const

const exportSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    path: { type: 'string' as const, required: true },
    filename: { type: 'string' as const, required: true },
    sha256: { type: 'string' as const, required: true },
    bytes: { type: 'integer' as const, required: true },
    rows: { type: 'integer' as const, required: true },
    employee_count: { type: 'integer' as const, required: true },
    over_limit_days: { type: 'integer' as const, required: true },
    missing_punches: { type: 'integer' as const, required: true },
    violation_count: { type: 'integer' as const, required: true },
    period: { ...periodSchema, required: true as const },
  },
} as const

export function createTools(deps: ToolDeps) {
  const check = defineTool({
    name: 'attendance.check',
    description:
      'Audit a local punch CSV (employee, date, clock_in, clock_out, break_minutes) against rules: 8h standard workday, 3h daily overtime cap, 36h monthly overtime cap, minimum break minutes and optional weekend/holiday work. Times are HH:MM; cross-midnight uses "次日 HH:MM" or 24:00+. Returns per-employee daily hours, overtime, over-limit days, missing punches and short breaks, plus a severity-sorted violation list. Missing punches are issues, not errors. Read-only.',
    parameters: policyParameters,
    output: {
      schema: checkSchema,
      render: (_args, value: AttendanceReport) =>
        text(
          `attendance check ${value.period.from}..${value.period.to}: ${value.totals.employees} employee(s) / ${value.totals.days} day(s), ${formatHours(
            value.totals.overtime_minutes,
          )}h overtime; ${value.totals.violations} violation(s) (${value.totals.missing_punches} missing punch, ${value.totals.over_limit_days} over-limit day, ${value.totals.over_limit_months} over-limit month, ${value.totals.rest_short_days} short break)`,
        ),
    },
    async execute(args) {
      return loadReport(args)
    },
  })

  const summary = defineTool({
    name: 'attendance.summary',
    description:
      'Roll the punch audit up per employee per month: expected weekdays, attended days, overtime total, monthly over-limit flag and anomaly count. Uses the same rules as attendance.check; month=YYYY-MM filters one month. Read-only.',
    parameters: {
      ...policyParameters,
      month: { type: 'string' as const },
    },
    output: {
      schema: summarySchema,
      render: (_args, value: AttendanceSummary) =>
        text(
          `attendance summary ${value.period.months.join('/')}: ${value.rows.length} employee-month row(s), ${value.totals.expected_days} expected / ${value.totals.attended_days} attended day(s), ${formatHours(
            value.totals.overtime_minutes,
          )}h overtime, ${value.totals.anomaly_count} anomaly(ies), ${value.totals.over_limit_employees} monthly over-limit employee(s)`,
        ),
    },
    async execute(args) {
      const report = await loadReport(args)
      return buildAttendanceSummary(report, { month: args.month })
    },
  })

  const exportTool = defineTool({
    name: 'attendance.export',
    description:
      'Write the day-level reconciliation table as CSV under $DSH_HOME/dsh-attendance-check/exports with columns 员工/日期/上班/下班/休息分钟/日工时/加班小时/状态/问题, one row per audited employee-day in employee and date order. The filename must be one safe component. Returns path, sha256, bytes and counts. Local write only.',
    parameters: {
      ...policyParameters,
      filename: { type: 'string' as const },
    },
    output: {
      schema: exportSchema,
      render: (_args, value: AttendanceExportResult) =>
        text(`attendance CSV ${value.rows} row(s) -> ${value.path} (sha256 ${value.sha256.slice(0, 12)}...)`),
    },
    async execute(args) {
      const report = await loadReport(args)
      return writeAttendanceExport(
        report,
        path.join(deps.baseDir, 'exports'),
        args.filename ?? defaultExportFilename(report.period),
      )
    },
  })

  return [check, summary, exportTool]
}

/** Re-export the report shape for tests and downstream typing. */
export type { AttendanceSummaryRow, ViolationKind, ViolationScope, ViolationSeverity }
