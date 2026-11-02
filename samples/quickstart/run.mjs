#!/usr/bin/env node
/**
 * dsh-attendance-check quickstart — validates the bundled synthetic punch ledger,
 * audits 6 employees over 5 workdays with the default rules, rolls the month up
 * and exports the reconciliation CSV.
 *
 *   node samples/quickstart/run.mjs            # human-readable summary
 *   node samples/quickstart/run.mjs --json     # the golden result on stdout
 *   node samples/quickstart/run.mjs --check    # recompute and diff against the golden file
 *
 * The golden file `expected/result.json` is the stdout of `--json`; it is a real
 * run over the committed CSV, not hand-written output.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatHours } from '../../lib/core/time.js'
import { createTools } from '../../lib/plugin/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const samplePath = path.join(here, 'input', 'attendance-2026-06.csv')
const expectedPath = path.join(here, 'expected', 'result.json')
const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--json') ? 'json' : 'summary'

async function run() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-attendance-check-quickstart-'))
  const realTemp = await realpath(tempDir)
  try {
    const tools = Object.fromEntries(createTools({ baseDir: tempDir }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'quickstart' }
    const check = await tools['attendance.check'].execute({ path: samplePath }, exec)
    const summary = await tools['attendance.summary'].execute({ path: samplePath }, exec)
    const exported = await tools['attendance.export'].execute({ path: samplePath }, exec)
    const exportText = await readFile(exported.path, 'utf8')
    return {
      sample: 'samples/quickstart/input/attendance-2026-06.csv',
      check,
      summary,
      exports: {
        reconciliation: {
          ...exported,
          path: path.relative(realTemp, exported.path).split(path.sep).join('/'),
          text: exportText,
        },
      },
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function anomalyCount(result, employee) {
  return result.check.violations.filter((violation) => violation.employee === employee).length
}

function printSummary(result) {
  const { check, summary, exports } = result
  console.log('dsh-attendance-check quickstart - synthetic punch records (not employee data)')
  console.log(
    `period ${check.period.from}..${check.period.to} (${check.period.workdays} workdays); ${check.totals.employees} employee(s), ${check.totals.days} audited day(s); ${formatHours(
      check.totals.worked_minutes,
    )}h worked, ${formatHours(check.totals.overtime_minutes)}h overtime`,
  )
  console.log('employees:')
  for (const employee of check.employees) {
    console.log(
      `  ${employee.employee}: ${employee.days.length} day(s), ${formatHours(employee.worked_minutes)}h worked, ${formatHours(
        employee.overtime_minutes,
      )}h overtime, ${anomalyCount(result, employee.employee)} anomaly(ies)`,
    )
  }
  console.log(`violations (${check.violations.length}):`)
  for (const violation of check.violations) {
    console.log(`  [${violation.severity}] ${violation.message}`)
  }
  for (const row of summary.rows) {
    console.log(
      `monthly ${row.month} ${row.employee}: ${row.expected_days} expected / ${row.attended_days} attended, ${formatHours(
        row.overtime_minutes,
      )}h overtime, ${row.anomaly_count} anomaly(ies), over_limit=${row.over_limit}`,
    )
  }
  console.log(
    `reconciliation CSV ${exports.reconciliation.path}: ${exports.reconciliation.rows} rows, ${exports.reconciliation.bytes} bytes, sha256 ${exports.reconciliation.sha256.slice(0, 12)}...`,
  )
}

const result = await run()

if (mode === 'json') {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} else if (mode === 'check') {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.deepEqual(result, expected)
  printSummary(result)
  console.log('golden samples/quickstart/expected/result.json matches')
  console.log('quickstart ok')
} else {
  printSummary(result)
  console.log('run with --check to compare against expected/result.json')
}
