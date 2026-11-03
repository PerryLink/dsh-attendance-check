# Changelog

## [0.1.0] — 2026-11-03

### Stable

- First non-alpha release: tool names and the CLI surface are covered by a
  compatibility promise (breaking changes require a minor bump).
- Ships a quickstart sample, a one-line prompt, a permission block and real captures.

## 0.1.0-alpha.1 — 2026-11-03

- First public alpha of `dsh-attendance-check`.
- `attendance.check`: punch CSV ingest, 8h standard workday, 3h daily overtime cap, 36h monthly overtime cap, minimum break minutes, optional weekend/holiday work; per-employee daily hours, overtime, over-limit days, missing punches, short breaks and a severity-sorted violation list.
- `attendance.summary`: employee-month rollup of expected/attended days, overtime total, anomaly count and the monthly `over_limit` flag; optional `month=YYYY-MM` filter.
- `attendance.export`: day-level Chinese reconciliation CSV under `$DSH_HOME/dsh-attendance-check/exports/` with safe-path and sha256 metadata.
- Cross-midnight clocks (`次日 HH:MM`, `24:00+`) and missing punches as issues rather than errors.
- Synthetic 6-employee × 5-workday quickstart ledger, real-output golden file, real terminal screenshot and acceptance evidence.
- Local only: no network, no model call, no upload.
