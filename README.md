<div align="center">

# dsh-attendance-check

> **Official repository.** The only official repository of this package, maintained by PerryLink. Same-name repositories under other accounts are not affiliated. Apache-2.0.

[![npm](https://img.shields.io/npm/v/dsh-attendance-check)](https://www.npmjs.com/package/dsh-attendance-check)
[![CI](https://github.com/PerryLink/dsh-attendance-check/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-attendance-check/actions)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Turn a punch-clock CSV into per-employee daily hours, overtime, over-limit days, missing punches and short breaks, then roll the month up and export a reconciliation CSV.**

> **Status: alpha / public-synthetic / partial / not counted / not GA.** No employee data, customer evidence, payroll-settlement, legal or audit claim.

[English](README.md) · [简体中文](README-zh.md)

```sh
dsh plugin --profile <profile> add dsh-attendance-check
```

</div>

## One-liner

Import a local punch ledger (employee, date, clock-in, clock-out, break minutes), audit it against an 8-hour standard workday, a 3-hour daily overtime cap and a 36-hour monthly overtime cap, and get each employee's daily hours, overtime, over-limit days, missing punches and short breaks, a severity-sorted violation list, a monthly rollup and a reconciliation CSV.

## Fit / not a fit

- **Fits:** tens to tens of thousands of punch rows; checking daily hours and overtime before payroll; finding employees above the 3-hour daily cap or the 36-hour monthly cap; turning missing punches, short breaks and over-limit days into a follow-up list; handing HR or finance a reviewable reconciliation CSV; cross-midnight shifts written as `次日 HH:MM` or `24:00+`.
- **Does not fit:** shift scheduling, overtime approval or replacing a time-and-attendance system; a statutory holiday calendar (only Saturday/Sunday is recognised); multiple punch pairs per day; leave, comp time, business-trip or field-work conversion; wage, overtime-pay, tax or social-insurance calculation; PDF, scans or Excel as direct input (export CSV first); syncing a punch device or uploading employee data.

## Input

- UTF-8 CSV with a header row and comma separators. RFC 4180 quotes, embedded newlines, CRLF and a UTF-8 BOM are supported.
- Header: `employee,date,clock_in,clock_out,break_minutes`. Chinese aliases (`员工 / 姓名 / 日期 / 上班时间 / 下班时间 / 休息分钟`) work too; matching is case-insensitive and extra columns are ignored.
- Dates: `date` must be a real `YYYY-MM-DD`. One row per employee per day; duplicates are `E_ATT_CSV_ROW`.
- Times: `HH:MM` (00:00–23:59). Cross midnight with `次日 01:30`, `次日01:30`, or extended hours `24:00`–`29:59` (the `24:00+` form); clock-out must be later than clock-in and a single shift cannot exceed 24 hours. Bad formats are `E_ATT_TIME_INVALID`.
- Missing punches: `clock_in` or `clock_out` may be empty. An empty value becomes an `E_ATT_MISSING_PUNCH` **issue**, not an abort.
- Break minutes: integer 0–1440; empty means 0; it must be smaller than the shift span. Bad values are `E_ATT_BREAK_INVALID`.
- Size: up to 20 MB per file; split by employee or month beyond that.
- Source: the local CSV the user names; it is read-only and never modified.

## Output

- **`attendance.check`**: `{ period, source_sha256, policy, employees, violations, totals }`.
  - `period`: covered dates, Monday–Friday workdays in that span, months touched.
  - `policy`: the rules used (standard hours, daily cap, monthly cap, minimum break, holidays included).
  - `employees[]`: per employee, `days[]` (date, weekday, clocks, break, worked minutes, overtime, holiday flag, cross-midnight flag, missing side, status, issue codes), `worked_minutes`, `overtime_minutes`, `over_limit_days`, `over_limit_months`, `missing_punches`, `rest_short_days`, `skipped_holiday_days` and `monthly_overtime[]`.
  - `violations[]`: severity-sorted violations with `severity`, `rank`, `kind`, `scope`, `code`, `employee`, `date`/`month`, `minutes` and a Chinese `message`.
  - `totals`: employees, audited days, skipped weekend rows, worked and overtime minutes, over-limit days/months, missing punches, short-break days and total violations.
- **`attendance.summary`**: `{ period, source_sha256, policy, rows, totals }`. One row per employee-month: `expected_days`, `attended_days`, `overtime_minutes` / `overtime_hours`, `anomaly_count`, `missing_punches`, `rest_short_days`, `over_limit_days`, and `over_limit` (monthly overtime above 36h). Optional `month=YYYY-MM` filter.
- **`attendance.export`**: writes the day-level reconciliation CSV under `$DSH_HOME/dsh-attendance-check/exports/` with columns `员工,日期,上班,下班,休息分钟,日工时,加班小时,状态,问题`; returns path, `sha256`, bytes and row count. The filename must be `[A-Za-z0-9._-]` only.

## Rules

1. Daily hours = clock-out − clock-in − break; cross-midnight times are computed on the next day.
2. Weekday overtime = max(0, daily minutes − standard minutes); the default standard is 8 hours.
3. Daily overtime above the 3-hour cap marks the day `over_limit` with severity `medium`.
4. Monthly overtime above the 36-hour cap marks that employee-month `over_limit` with severity `high`; both `monthly_overtime[]` and the summary `over_limit` flag are set.
5. Missing clock-in or clock-out marks the day `missing_punch`, counts 0 worked minutes, and emits `E_ATT_MISSING_PUNCH` as an **issue**, never as a thrown error.
6. A break below the minimum (default 60 minutes) marks the day `rest_short` and emits `E_ATT_REST_SHORT`.
7. Saturday/Sunday rows are skipped by default (counted in `skipped_holiday_rows`). With `include_holidays=true`, weekend rows are audited as holiday work: standard time is 0, all worked minutes count as overtime, and the daily cap still applies.
8. Severity order: missing punch (30) > monthly over-limit (25) > daily over-limit (20) > short break (10); ties break by date, employee order and kind.
9. Expected days = Monday–Friday days in the covered span of that month; attended days = days with both clocks present. No statutory holiday calendar is built in.
10. The monthly cap applies to the data present in the file; it does not fill in the rest of the month.

## Example

Paste this one line into the agent:

> 我有这份 6 名员工 5 个工作日的打卡明细，用 8 小时标准工时、单日加班上限 3 小时、月加班上限 36 小时核对，输出异常清单并导出核对表 CSV。

Reproduce the bundled sample and compare with the golden file:

```sh
node samples/quickstart/run.mjs --check
```

![dsh-attendance-check quickstart terminal output](docs/assets/quickstart.png)

The sample is 6 employees × 5 workdays (2026-06-22 to 2026-06-26), 30 synthetic punch rows: 2 overtime days (Zhang Wei works 1.5h across midnight; Li Na works 3.5h and exceeds the daily cap by 0.5h), 1 missing punch (Wang Qiang has no clock-out) and 1 short break (Liu Yang takes only 30 minutes). `samples/quickstart/expected/result.json` is the real stdout of `node samples/quickstart/run.mjs --json`, not hand-written; the screenshot is the real `--check` terminal output.

## Permissions

- Read: the punch CSV the user names (sample: `samples/quickstart/input/attendance-2026-06.csv`); nothing else.
- Write: only `$DSH_HOME/dsh-attendance-check/exports/` (the reconciliation CSV); the source file is not modified.
- Network: no.
- External systems: none.

`attendance.check` and `attendance.summary` are **R0** (read-only). `attendance.export` is **R1** (local write under the exports folder only). `DSH_ATTENDANCE_CHECK_HOME` overrides the local write root for tests; the default is exactly `$DSH_HOME/dsh-attendance-check`.

## FAQ

### 1. How do I write a cross-midnight shift?

Write `次日 01:30` (with or without a space) or the extended form `25:30`; they are equivalent. A bare `01:30` is treated as the same-day early morning, which is earlier than clock-in and raises `E_ATT_TIME_INVALID`. A shift longer than 24 hours raises the same code.

### 2. Why is a missing punch not an error?

Missing punches are routine in real attendance data and one missing punch should not fail the whole reconciliation. It is recorded as a `missing_punch` day plus an `E_ATT_MISSING_PUNCH` issue, with 0 worked minutes and 0 overtime; `attendance.check` still returns everyone else's results so HR can fix the punch and rerun. Only malformed CSV, dates, times, breaks or rules abort the call.

### 3. How is the 36-hour monthly cap decided?

Overtime minutes are summed per employee per calendar month over the audited days; above 2160 minutes `over_limit=true`, and a `scope=month`, `severity=high` violation is emitted with `minutes` equal to the excess. If the file covers only half a month, only the audited data is counted; the tool does not extrapolate.

### 4. How are weekends and holidays handled?

There is no statutory holiday calendar: only Saturday and Sunday are recognised as rest days. Weekend rows are skipped by default; pass `include_holidays=true` to audit weekend work, where all worked minutes count as overtime and the daily cap still applies. Mark or remove statutory weekday holidays in the source data first.

### 5. What are expected and attended days?

Expected days are the Monday–Friday days inside the file's covered span for that month (the span runs from the earliest to the latest audited date across all employees). Attended days are the days with both clocks present for that employee. A missing-punch day is not attended, but it appears in `missing_punches` and the violation list.

### 6. Does it modify or upload my file?

No. It reads the named CSV, writes only under `$DSH_HOME/dsh-attendance-check/exports/`, and never uses the network, a model call or an upload. The source CSV is not modified.

## Errors

The message format is `<one sentence>（E_ATT_XXX）｜下一步：<one action>｜细节：<optional>`. The first seven codes are thrown; the last three are issue codes that only appear in `violations`.

| Code | When | Next action |
|---|---|---|
| `E_ATT_CSV_ROW` | Wrong column count, missing/duplicate header, empty employee, duplicate employee-day, file > 20 MB | Fix the named row; keep one row per employee per day |
| `E_ATT_DATE_INVALID` | `date` or `month` is not a real date/month | Use `2026-06-22` / `2026-06` |
| `E_ATT_TIME_INVALID` | Not `HH:MM`, bad cross-midnight form, clock-out not later than clock-in, shift > 24h | Use `09:00`; cross midnight with `次日 01:30` or `25:30` |
| `E_ATT_BREAK_INVALID` | Break is not an integer 0–1440, or consumes the whole shift | Integer minutes smaller than the shift span |
| `E_ATT_POLICY_INVALID` | Standard hours, caps or minimum break out of range | Standard 1–24h, daily 0–24h, monthly 0–744h, break 0–720 integer minutes |
| `E_ATT_PATH_INVALID` | Missing/directory/unreadable input or an unsafe export filename | Pass an existing CSV; export with `[A-Za-z0-9._-]` only |
| `E_ATT_EMPTY` | Empty file, header only, all weekends without `include_holidays`, or a month filter with no data | Check the dates and `include_holidays`; pick a month with data |
| `E_ATT_MISSING_PUNCH` (issue) | Clock-in or clock-out is empty | Fix the punch and rerun; the day counts 0 hours for now |
| `E_ATT_OVER_LIMIT` (issue) | Daily cap exceeded (`scope=day`) or monthly cap exceeded (`scope=month`) | Review overtime approval and comp-time planning |
| `E_ATT_REST_SHORT` (issue) | Break below the policy minimum | Check the break record or adjust `min_break_minutes` |

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Acceptance evidence

Public/synthetic fixtures live in `samples/quickstart/`; `ACCEPTANCE.csv` records 17 tool checks plus one quickstart golden row (18 rows). Every row is `counted=false` except the quickstart row.

| req_id | metric | threshold | actual | pass | source | counted |
|---|---|---|---|---|---|---|
| AC-A01 | daily audit totals | employees=6 days=30 overtime=300 | employees=6 days=30 overtime=300 | true | public/synthetic | false |
| AC-A04 | daily overtime cap | overtime=210 status=over_limit | overtime=210 status=over_limit | true | public/synthetic | false |
| AC-A07 | monthly summary | rows=6 expected=30 attended=29 | rows=6 expected=30 attended=29 | true | public/synthetic | false |
| AC-A09 | monthly cap over_limit | monthly=2340 over=180 | monthly=2340 over=180 | true | public/synthetic | false |
| AC-A10 | reconciliation CSV | rows=30 lines=31 hash=ok | rows=30 lines=31 hash=ok | true | public/synthetic | false |
| PS1-QS01 | quickstart golden | 1/1 | 1 | true | synthetic/quickstart | true |

*Fixture-backed rows, not employee or customer data; no output is invented.*

## Version

`0.1.0-alpha.1` · 134 tests pass (`node --test test/*.test.mjs`).

> ⭐ If this helps, a star makes it easier for the next person to find it. Nothing is gated behind it.

## Install

```sh
dsh plugin --profile <profile> add dsh-attendance-check
dsh --profile <profile> --dump-config | grep dsh-attendance-check
```

Uninstall:

```sh
dsh plugin --profile <profile> remove dsh-attendance-check
```

### Install channels

- **npm (recommended):** `dsh plugin --profile <profile> add dsh-attendance-check`
- **git channel:** `dsh plugin --profile <profile> add github:PerryLink/dsh-attendance-check`
- **tarball:** `pnpm pack`, then `dsh plugin --profile <profile> add ./dsh-attendance-check-<version>.tgz`

## Tools

Tool names are stable API; descriptions stay in English to match runtime output.

| Tool | Purpose | Risk |
|---|---|---|
| `attendance.check` | Read the punch CSV and audit every day: daily hours, overtime, over-limit days, missing punches, short breaks and a severity-sorted violation list | R0 |
| `attendance.summary` | Roll up expected/attended days, overtime, anomaly count and the monthly over-limit flag per employee-month | R0 |
| `attendance.export` | Write the day-level reconciliation CSV (employee/date/clocks/break/hours/overtime/status/issue), returning path and sha256 | R1 local write |

## Limits and known limitations

- **No holiday calendar:** only Saturday/Sunday is recognised; statutory holidays and make-up workdays must be prepared in the source data.
- **One clock pair per day:** no multi-segment punches or separate overtime start/end records; merge them in the source system first.
- **No leave types:** leave, comp time, business trips, field work and absence are not converted; a missing punch is only an issue.
- **No payroll:** no overtime pay, multipliers, tax or social insurance; the package reports hours and reconciliation results only.
- **Monthly cap is data-scoped:** if the file covers part of a month, the 36-hour cap is applied only to the audited data.
- CSV only: no PDF, scans or Excel, and no OCR.
- Exported CSV uses RFC 4180 quoting only; Excel formula prefixes are not sanitised.
- Local only: no network, no model call, no upload.
- Public/synthetic samples only; alpha/partial, not counted, no production-readiness or compliance claim.

## Development

```sh
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck
node --test test/*.test.mjs
node scripts/gate.mjs
```

## Compatibility

| Surface | Status |
|---|---|
| Harness | `dsh >=0.2.1-rc.3 <0.4.0` |
| Node | `>=24.9.0 <25` |
| Platforms | All; local files only |
| Data | No network, no model call, no upload |

## Related work

- [dsh-ar-aging](https://github.com/PerryLink/dsh-ar-aging) (AR aging)
- [dsh-policy-ledger](https://github.com/PerryLink/dsh-policy-ledger) (policy ledger)
- [Domain index](https://perrylink.github.io/dsh-plugins/)

## License

Apache-2.0. See `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES`.
