#!/usr/bin/env node
/**
 * Acceptance checks over the public synthetic punch ledger. Writes
 * ACCEPTANCE.csv and evidence/<run_id>/result.json. No network, no employee data.
 *
 *   node scripts/acceptance.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/core/csv.js'
import { createTools } from '../lib/plugin/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const sample = path.join(root, 'samples', 'quickstart', 'input', 'attendance-2026-06.csv')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const errors = []
const HEADER = 'employee,date,clock_in,clock_out,break_minutes'
const MONTH_DATES = [
  '2026-06-01',
  '2026-06-02',
  '2026-06-03',
  '2026-06-04',
  '2026-06-05',
  '2026-06-08',
  '2026-06-09',
  '2026-06-10',
  '2026-06-11',
  '2026-06-12',
  '2026-06-15',
  '2026-06-16',
  '2026-06-17',
]

async function errorCode(promise) {
  try {
    await promise
    return 'NO_ERROR'
  } catch (error) {
    return error?.code ?? error?.name ?? 'UNKNOWN'
  }
}

function metric(reqId, name, threshold, actual, pass) {
  return { req_id: reqId, metric: name, threshold, actual: String(actual), pass }
}

async function main() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-attendance-check-acceptance-'))
  const baseDir = path.join(tempDir, 'store')
  try {
    const tools = Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'acceptance' }
    const check = await tools['attendance_check'].execute({ path: sample }, exec)
    const summary = await tools['attendance_summary'].execute({ path: sample }, exec)
    const exported = await tools['attendance_export'].execute({ path: sample }, exec)

    const exportText = readFileSync(exported.path, 'utf8')
    const exportParsed = parseCsv(exportText)
    const exportHeaderOk = exportParsed.rows[0]?.join(',') === '员工,日期,上班,下班,休息分钟,日工时,加班小时,状态,问题'
    const exportHashOk = exported.sha256 === sha256(exportText)

    const zhang = check.employees.find((employee) => employee.employee === '张伟')
    const crossMidnight = zhang?.days.find((day) => day.date === '2026-06-23')
    const lina = check.employees.find((employee) => employee.employee === '李娜')
    const overtimeDay = lina?.days.find((day) => day.date === '2026-06-24')
    const wang = check.employees.find((employee) => employee.employee === '王强')
    const missingDay = wang?.days.find((day) => day.date === '2026-06-25')
    const liu = check.employees.find((employee) => employee.employee === '刘洋')
    const shortBreakDay = liu?.days.find((day) => day.date === '2026-06-26')
    const violationOrder = check.violations.map((violation) => violation.employee).join('/')
    const severityOrder = check.violations.map((violation) => violation.severity).join('/')

    const monthlyFile = path.join(tempDir, 'monthly-over.csv')
    writeFileSync(
      monthlyFile,
      `${HEADER}\n${MONTH_DATES.map((date) => `张伟,${date},09:00,21:00,60`).join('\n')}\n`,
    )
    const monthly = await tools['attendance_check'].execute({ path: monthlyFile }, exec)
    const monthlySummary = await tools['attendance_summary'].execute({ path: monthlyFile }, exec)
    const monthlyViolation = monthly.violations.find((violation) => violation.scope === 'month')

    const weekendFile = path.join(tempDir, 'weekend.csv')
    writeFileSync(weekendFile, `${HEADER}\n张伟,2026-06-27,09:00,13:00,60\n`)
    const weekendDefaultCode = await errorCode(tools['attendance_check'].execute({ path: weekendFile }, exec))
    const weekendIncluded = await tools['attendance_check'].execute(
      { path: weekendFile, include_holidays: true },
      exec,
    )

    const badTimeFile = path.join(tempDir, 'bad-time.csv')
    writeFileSync(badTimeFile, `${HEADER}\n张伟,2026-06-22,9:00,18:00,60\n`)
    const badDateFile = path.join(tempDir, 'bad-date.csv')
    writeFileSync(badDateFile, `${HEADER}\n张伟,2026-02-30,09:00,18:00,60\n`)
    const badHeaderFile = path.join(tempDir, 'bad-header.csv')
    writeFileSync(badHeaderFile, 'employee,date,clock_in,clock_out\n张伟,2026-06-22,09:00,18:00\n')
    const emptyFile = path.join(tempDir, 'empty.csv')
    writeFileSync(emptyFile, `${HEADER}\n`)

    const badPathCode = await errorCode(
      tools['attendance_export'].execute({ path: sample, filename: '../evil.csv' }, exec),
    )
    const badTimeCode = await errorCode(tools['attendance_check'].execute({ path: badTimeFile }, exec))
    const badDateCode = await errorCode(tools['attendance_check'].execute({ path: badDateFile }, exec))
    const badHeaderCode = await errorCode(tools['attendance_check'].execute({ path: badHeaderFile }, exec))
    const emptyCode = await errorCode(tools['attendance_check'].execute({ path: emptyFile }, exec))
    const missingMonthCode = await errorCode(
      tools['attendance_summary'].execute({ path: sample, month: '2026-07' }, exec),
    )

    const metrics = [
      metric(
        'AC-A01',
        'daily audit totals',
        'employees=6 days=30 worked=14220 overtime=300 over_days=1 missing=1 rest_short=1 violations=3',
        `employees=${check.totals.employees} days=${check.totals.days} worked=${check.totals.worked_minutes} overtime=${check.totals.overtime_minutes} over_days=${check.totals.over_limit_days} missing=${check.totals.missing_punches} rest_short=${check.totals.rest_short_days} violations=${check.totals.violations}`,
        check.totals.employees === 6 &&
          check.totals.days === 30 &&
          check.totals.worked_minutes === 14_220 &&
          check.totals.overtime_minutes === 300 &&
          check.totals.over_limit_days === 1 &&
          check.totals.missing_punches === 1 &&
          check.totals.rest_short_days === 1 &&
          check.totals.violations === 3,
      ),
      metric(
        'AC-A02',
        'audited period',
        'from=2026-06-22 to=2026-06-26 workdays=5 months=2026-06',
        `from=${check.period.from} to=${check.period.to} workdays=${check.period.workdays} months=${check.period.months.join('/')}`,
        check.period.from === '2026-06-22' &&
          check.period.to === '2026-06-26' &&
          check.period.workdays === 5 &&
          check.period.months.join('/') === '2026-06',
      ),
      metric(
        'AC-A03',
        'cross-midnight punch',
        'date=2026-06-23 out=次日 00:30 worked=570 overtime=90 cross_midnight=true',
        `date=${crossMidnight?.date} out=${crossMidnight?.clock_out} worked=${crossMidnight?.worked_minutes} overtime=${crossMidnight?.overtime_minutes} cross_midnight=${crossMidnight?.cross_midnight}`,
        crossMidnight?.clock_out === '次日 00:30' &&
          crossMidnight?.worked_minutes === 570 &&
          crossMidnight?.overtime_minutes === 90 &&
          crossMidnight?.cross_midnight === true,
      ),
      metric(
        'AC-A04',
        'daily overtime cap',
        'overtime=210 status=over_limit violation_minutes=30',
        `overtime=${overtimeDay?.overtime_minutes} status=${overtimeDay?.status} violation_minutes=${check.violations.find((violation) => violation.employee === '李娜')?.minutes}`,
        overtimeDay?.overtime_minutes === 210 &&
          overtimeDay?.status === 'over_limit' &&
          check.violations.some(
            (violation) => violation.employee === '李娜' && violation.kind === 'over_limit' && violation.minutes === 30,
          ),
      ),
      metric(
        'AC-A05',
        'missing punch is an issue',
        'missing_out=true out_empty=true code=E_ATT_MISSING_PUNCH',
        `missing_out=${missingDay?.missing_out} out_empty=${missingDay?.clock_out === ''} code=${check.violations.find((violation) => violation.employee === '王强')?.code}`,
        missingDay?.missing_out === true &&
          missingDay?.clock_out === '' &&
          missingDay?.worked_minutes === 0 &&
          check.violations.some(
            (violation) => violation.employee === '王强' && violation.code === 'E_ATT_MISSING_PUNCH',
          ),
      ),
      metric(
        'AC-A06',
        'short break',
        'worked=480 overtime=0 status=rest_short',
        `worked=${shortBreakDay?.worked_minutes} overtime=${shortBreakDay?.overtime_minutes} status=${shortBreakDay?.status}`,
        shortBreakDay?.worked_minutes === 480 &&
          shortBreakDay?.overtime_minutes === 0 &&
          shortBreakDay?.status === 'rest_short' &&
          shortBreakDay?.issue_codes.includes('E_ATT_REST_SHORT') === true,
      ),
      metric(
        'AC-A07',
        'monthly summary',
        'rows=6 expected=30 attended=29 overtime=300 anomalies=3 over_limit_employees=0',
        `rows=${summary.rows.length} expected=${summary.totals.expected_days} attended=${summary.totals.attended_days} overtime=${summary.totals.overtime_minutes} anomalies=${summary.totals.anomaly_count} over_limit_employees=${summary.totals.over_limit_employees}`,
        summary.rows.length === 6 &&
          summary.totals.expected_days === 30 &&
          summary.totals.attended_days === 29 &&
          summary.totals.overtime_minutes === 300 &&
          summary.totals.anomaly_count === 3 &&
          summary.totals.over_limit_employees === 0,
      ),
      metric(
        'AC-A08',
        'severity-sorted violations',
        'order=王强/李娜/刘洋 severity=high/medium/low',
        `order=${violationOrder} severity=${severityOrder}`,
        violationOrder === '王强/李娜/刘洋' && severityOrder === 'high/medium/low',
      ),
      metric(
        'AC-A09',
        'monthly cap over_limit',
        'monthly=2340 over=180 over_limit=true summary_over_limit=true',
        `monthly=${monthly.totals.overtime_minutes} over=${monthlyViolation?.minutes} over_limit=${monthly.employees[0]?.monthly_overtime[0]?.over_limit} summary_over_limit=${monthlySummary.rows[0]?.over_limit}`,
        monthly.totals.overtime_minutes === 2340 &&
          monthly.totals.over_limit_months === 1 &&
          monthlyViolation?.severity === 'high' &&
          monthlyViolation?.minutes === 180 &&
          monthlySummary.rows[0]?.over_limit === true &&
          monthlySummary.totals.over_limit_employees === 1,
      ),
      metric(
        'AC-A10',
        'reconciliation CSV',
        'header=ok rows=30 lines=31 hash=ok',
        `header=${exportHeaderOk ? 'ok' : 'bad'} rows=${exported.rows} lines=${exportParsed.rows.length} hash=${exportHashOk ? 'ok' : 'bad'}`,
        exportHeaderOk && exported.rows === 30 && exportParsed.rows.length === 31 && exportHashOk,
      ),
      metric('AC-A11', 'export path safety', 'E_ATT_PATH_INVALID', badPathCode, badPathCode === 'E_ATT_PATH_INVALID'),
      metric('AC-A12', 'invalid time', 'E_ATT_TIME_INVALID', badTimeCode, badTimeCode === 'E_ATT_TIME_INVALID'),
      metric('AC-A13', 'invalid date', 'E_ATT_DATE_INVALID', badDateCode, badDateCode === 'E_ATT_DATE_INVALID'),
      metric('AC-A14', 'bad CSV header', 'E_ATT_CSV_ROW', badHeaderCode, badHeaderCode === 'E_ATT_CSV_ROW'),
      metric('AC-A15', 'empty punch file', 'E_ATT_EMPTY', emptyCode, emptyCode === 'E_ATT_EMPTY'),
      metric(
        'AC-A16',
        'holiday switch',
        'default=E_ATT_EMPTY holiday_days=1 holiday_overtime=180',
        `default=${weekendDefaultCode} holiday_days=${weekendIncluded.totals.days} holiday_overtime=${weekendIncluded.totals.overtime_minutes}`,
        weekendDefaultCode === 'E_ATT_EMPTY' &&
          weekendIncluded.totals.days === 1 &&
          weekendIncluded.totals.overtime_minutes === 180 &&
          weekendIncluded.employees[0]?.days[0]?.status === 'holiday',
      ),
      metric(
        'AC-A17',
        'month filter with no data',
        'E_ATT_EMPTY',
        missingMonthCode,
        missingMonthCode === 'E_ATT_EMPTY',
      ),
    ]

    let quickstartPass = true
    try {
      execFileSync(process.execPath, ['samples/quickstart/run.mjs', '--check'], { cwd: root, stdio: 'ignore' })
    } catch {
      quickstartPass = false
    }
    const quickstartHash = sha256(readFileSync(path.join(root, 'samples', 'quickstart', 'expected', 'result.json')))
    const quickstart = {
      req_id: 'PS1-QS01',
      metric: 'quickstart golden',
      threshold: '1/1',
      actual: quickstartPass ? '1' : '0',
      pass: quickstartPass,
      evidence_sha256: quickstartHash,
    }

    const failures = metrics.filter((item) => !item.pass)
    for (const failure of failures) errors.push(`${failure.req_id} ${failure.metric}: ${failure.actual}`)
    if (!quickstartPass) errors.push('PS1-QS01 quickstart golden failed')

    const runId = `attendance-${Date.now()}`
    const evidence = {
      run_id: runId,
      scope: 'ATTENDANCE-CHECK-S1',
      status: failures.length === 0 && quickstartPass ? 'pass' : 'fail',
      counted: false,
      note: 'synthetic punch records only; no employee data; local files only',
      metrics,
      pass: failures.length === 0 && quickstartPass,
    }
    const evidenceDir = path.join(root, 'evidence', runId)
    mkdirSync(evidenceDir, { recursive: true })
    const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`
    writeFileSync(path.join(evidenceDir, 'result.json'), evidenceJson)
    const evidenceHash = sha256(evidenceJson)

    const rows = [
      ...metrics.map(
        (item) =>
          `${item.req_id},${item.metric},${item.threshold},${item.actual},scripts/acceptance.mjs,${evidenceHash},${item.pass},public/synthetic,false`,
      ),
      `${quickstart.req_id},${quickstart.metric},${quickstart.threshold},${quickstart.actual},samples/quickstart/run.mjs,${quickstart.evidence_sha256},${quickstart.pass},synthetic/quickstart,true`,
    ]
    writeFileSync(
      path.join(root, 'ACCEPTANCE.csv'),
      `req_id,metric,threshold,actual,script,evidence_sha256,pass,source,counted\n${rows.join('\n')}\n`,
    )

    if (errors.length > 0) {
      for (const error of errors) console.error(`acceptance: ${error}`)
      process.exit(1)
    }
    console.log(`acceptance ok: ${metrics.length + 1} checks`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

await main()
