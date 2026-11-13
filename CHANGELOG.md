# Changelog

## [0.2.0] — 2026-11-13

### Breaking

- The provider validates every `tools[].name` against `^[a-zA-Z0-9_-]+$`; a dot
  makes the whole `tools` array invalid, so the plugin registered but every
  request that carried the tools failed. The three tool names are now
  `attendance_check`, `attendance_summary` and `attendance_export` — a 1:1
  rename from the previous dotted spelling, with no dotted alias registered
  (an alias would keep the entire tools array rejected).
- Migration: update prompts, configs and scripts to the underscore names. The
  parameters, outputs, permission levels (R0/R1) and CSV format are unchanged;
  only the wire names differ. Historical entries below are normalized to the
  current spelling.

### Added

- Regression test `test/tool-name-wire.test.mjs`: every registered tool name
  matches `^[a-zA-Z0-9_-]+$`, contains no dot, keeps the `attendance_`
  namespace, and is unique.

### Changed

- Version bumped to 0.2.0 (minor) under the repository compatibility promise
  (breaking changes require a minor bump).

## [0.1.0] — 2026-11-03

### Stable

- First non-alpha release: tool names and the CLI surface are covered by a
  compatibility promise (breaking changes require a minor bump).
- Ships a quickstart sample, a one-line prompt, a permission block and real captures.

## 0.1.0-alpha.1 — 2026-11-03

- First public alpha of `dsh-attendance-check`.
- `attendance_check`: punch CSV ingest, 8h standard workday, 3h daily overtime cap, 36h monthly overtime cap, minimum break minutes, optional weekend/holiday work; per-employee daily hours, overtime, over-limit days, missing punches, short breaks and a severity-sorted violation list.
- `attendance_summary`: employee-month rollup of expected/attended days, overtime total, anomaly count and the monthly `over_limit` flag; optional `month=YYYY-MM` filter.
- `attendance_export`: day-level Chinese reconciliation CSV under `$DSH_HOME/dsh-attendance-check/exports/` with safe-path and sha256 metadata.
- Cross-midnight clocks (`次日 HH:MM`, `24:00+`) and missing punches as issues rather than errors.
- Synthetic 6-employee × 5-workday quickstart ledger, real-output golden file, real terminal screenshot and acceptance evidence.
- Local only: no network, no model call, no upload.
