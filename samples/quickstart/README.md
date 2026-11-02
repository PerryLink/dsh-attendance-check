# dsh-attendance-check quickstart

- `input/attendance-2026-06.csv` — synthetic 30-row punch ledger: 6 employees × 5 workdays (2026-06-22 to 2026-06-26), no real employee data.
- `expected/result.json` — the real stdout of `node samples/quickstart/run.mjs --json`; it is regenerated, never hand-written.
- `run.mjs` — audits the ledger with the default rules (8h / 3h / 36h / 60min), writes the monthly rollup and exports the reconciliation CSV into a temporary directory.

```sh
node samples/quickstart/run.mjs            # human-readable summary
node samples/quickstart/run.mjs --json     # golden output
node samples/quickstart/run.mjs --check    # recompute and diff against expected/result.json
```

The sample deliberately contains:

- 2 overtime days: 张伟 works 14:00–次日 00:30 (1.5h overtime, cross-midnight) and 李娜 works 09:00–21:30 (3.5h overtime, 0.5h over the 3h daily cap).
- 1 missing punch: 王强 has no clock-out on 2026-06-25; it is an `E_ATT_MISSING_PUNCH` issue, not an error.
- 1 short break: 刘洋 takes 30 minutes on 2026-06-26 against the 60-minute minimum; no overtime is created.
