import { AttendanceError } from './errors.js'

/** Caller-supplied reconciliation rules; every field is optional. */
export interface AttendancePolicyInput {
  standardHours?: number
  dailyOvertimeCapHours?: number
  monthlyOvertimeCapHours?: number
  minBreakMinutes?: number
  includeHolidays?: boolean
}

/** Normalized, reported rules. Times are in hours; minutes are derived. */
export interface AttendancePolicy {
  standard_hours: number
  daily_overtime_cap_hours: number
  monthly_overtime_cap_hours: number
  min_break_minutes: number
  include_holidays: boolean
}

/** Internal minute form used by the audit. */
export interface PolicyMinutes {
  standard_minutes: number
  daily_overtime_cap_minutes: number
  monthly_overtime_cap_minutes: number
  min_break_minutes: number
  include_holidays: boolean
}

export const DEFAULT_POLICY: AttendancePolicy = {
  standard_hours: 8,
  daily_overtime_cap_hours: 3,
  monthly_overtime_cap_hours: 36,
  min_break_minutes: 60,
  include_holidays: false,
}

function invalid(field: string, detail: string): never {
  throw new AttendanceError('E_ATT_POLICY_INVALID', `${field} ${detail}`)
}

function numberField(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(field, `必须是数字，收到 ${JSON.stringify(value)}`)
  }
  if (value < min || value > max) invalid(field, `必须在 ${min}–${max} 之间，收到 ${value}`)
  return value
}

/**
 * Normalize and validate rules. Defaults: 8h standard, 3h daily cap, 36h
 * monthly cap, 60-minute minimum break, weekend punches excluded.
 */
export function resolvePolicy(input: AttendancePolicyInput = {}): AttendancePolicy {
  const standardHours =
    input.standardHours === undefined ? DEFAULT_POLICY.standard_hours : numberField(input.standardHours, 'standard_hours', 1, 24)
  const dailyCap =
    input.dailyOvertimeCapHours === undefined
      ? DEFAULT_POLICY.daily_overtime_cap_hours
      : numberField(input.dailyOvertimeCapHours, 'daily_overtime_cap_hours', 0, 24)
  const monthlyCap =
    input.monthlyOvertimeCapHours === undefined
      ? DEFAULT_POLICY.monthly_overtime_cap_hours
      : numberField(input.monthlyOvertimeCapHours, 'monthly_overtime_cap_hours', 0, 744)
  let minBreak = DEFAULT_POLICY.min_break_minutes
  if (input.minBreakMinutes !== undefined) {
    if (typeof input.minBreakMinutes !== 'number' || !Number.isInteger(input.minBreakMinutes)) {
      invalid('min_break_minutes', `必须是整数分钟，收到 ${JSON.stringify(input.minBreakMinutes)}`)
    }
    if (input.minBreakMinutes < 0 || input.minBreakMinutes > 720) {
      invalid('min_break_minutes', `必须在 0–720 之间，收到 ${input.minBreakMinutes}`)
    }
    minBreak = input.minBreakMinutes
  }
  let includeHolidays = DEFAULT_POLICY.include_holidays
  if (input.includeHolidays !== undefined) {
    if (typeof input.includeHolidays !== 'boolean') {
      invalid('include_holidays', `必须是 true/false，收到 ${JSON.stringify(input.includeHolidays)}`)
    }
    includeHolidays = input.includeHolidays
  }
  if (Math.round(standardHours * 60) < 60) {
    invalid('standard_hours', '标准工时至少 1 小时')
  }
  return {
    standard_hours: standardHours,
    daily_overtime_cap_hours: dailyCap,
    monthly_overtime_cap_hours: monthlyCap,
    min_break_minutes: minBreak,
    include_holidays: includeHolidays,
  }
}

/** Minute form of a normalized policy; hours are rounded to whole minutes. */
export function policyMinutes(policy: AttendancePolicy): PolicyMinutes {
  return {
    standard_minutes: Math.round(policy.standard_hours * 60),
    daily_overtime_cap_minutes: Math.round(policy.daily_overtime_cap_hours * 60),
    monthly_overtime_cap_minutes: Math.round(policy.monthly_overtime_cap_hours * 60),
    min_break_minutes: policy.min_break_minutes,
    include_holidays: policy.include_holidays,
  }
}

/** Copy the reported policy (keeps tool output free of internal fields). */
export function policyReport(policy: AttendancePolicy): AttendancePolicy {
  return { ...policy }
}
