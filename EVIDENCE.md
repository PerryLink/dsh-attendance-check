# Evidence — dsh-attendance-check 0.2.0

All runs are local, over a synthetic punch ledger. No employee data, no network call, no
model call, no upload. Local verification only; publication is performed by the tag-triggered GitHub workflow.

## Environment

- Node `v24.22.1`
- pnpm `11.28.5` (project pin)
- TypeScript `7.0.2` (NodeNext, strict)
- Date: 2026-11-13 (Asia/Shanghai)

## Commands and results

| Command | Result |
|---|---|
| `./node_modules/.bin/tsc -p tsconfig.json` | exit 0, emits `lib/` |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | exit 0 |
| `node --test test/*.test.mjs` | 135 tests, 135 pass, 0 fail |
| `node samples/quickstart/run.mjs --check` | golden `expected/result.json` matches |
| `node scripts/lint.mjs` | 13 source files, 16 test files / 135 tests, 16 published entries |
| `node scripts/gate.mjs` | lint ok, acceptance ok, 18/18 acceptance rows pass |
| `npm pack --dry-run --json` | 52 files, 703,336 bytes unpacked, no publish |

## Local Package Standard v1 score

The package is intentionally **not** added to `04-build/dsh-plugins/family.json` (not in the
family yet, so the committed roster does not count it). To verify the standard locally, the
official `04-build/dsh-plugins/scripts/score-packages.mjs` was copied to a temporary harness
(`04-build/.tmp-ps1/`), pointed at a one-item temporary family file for this package, and run
against this checkout. The temporary harness was removed afterwards.

```
PS1 scores: 1 packages | green 1 / yellow 0 / red 0
domain packages: 1, avg 10.0
10 green  dsh-attendance-check
gate 8: ok
```

Per-category score for `dsh-attendance-check`: `page=1 sample=2 prompt=1 expected=1 permissions=2 errors=1 evidence=2 total=10` (green; every category non-zero).

## Screenshot / golden hashes

| Artifact | SHA-256 |
|---|---|
| `docs/assets/quickstart.png` | `505bee2822438dc71a74340de0b2e5fc493a6bcb0701baff930e6cd9b98c0ca1` |
| `docs/assets/quickstart.log` | `73e08c05885cb7182cf9bc0df5213b3f11dd2784257e10a26d21fc85130efbe8` |
| `samples/quickstart/expected/result.json` | `2c48f215348d70b9481961d89ca2b82c78a894178c1abf375521b2b0b860e30c` |
| `ACCEPTANCE.csv` | `961a8e2a4a8246557ca973daf9670f941ce7944c27cb5d5863a3a7d1e8c43e24` |
| latest `evidence/attendance-1794569827485/result.json` | `e6a98e17b204b5667b64d0b873c4daa7e1bf6cb90102702dc297db121283ead9` |

The screenshot was rendered by `04-build/dsh-plugins/scripts/render-capture.py` from the real
captured terminal output in `docs/assets/quickstart.log` with
`RENDER_CAPTURE_FONT=/mnt/c/Windows/Fonts/msyh.ttc`; no output text was invented.

## Error-path coverage

Thrown codes:

- `E_ATT_CSV_ROW` — wrong column count, missing/duplicate header, empty employee, duplicate employee-day, oversized file.
- `E_ATT_DATE_INVALID` — impossible or malformed `date` / `month`.
- `E_ATT_TIME_INVALID` — malformed clock, bad `次日`/`24:00+` form, clock-out not later than clock-in, shift > 24h.
- `E_ATT_BREAK_INVALID` — non-integer, negative or oversized break, or a break that consumes the whole shift.
- `E_ATT_POLICY_INVALID` — standard hours, daily/monthly caps, minimum break or `include_holidays` out of range.
- `E_ATT_PATH_INVALID` — missing/directory/unreadable input, unsafe export filename, traversal, symlink re-anchor, write failure.
- `E_ATT_EMPTY` — empty/header-only file, all weekends without `include_holidays`, month filter with no data.

Issue codes (never abort; collected in `violations`):

- `E_ATT_MISSING_PUNCH` — `clock_in` or `clock_out` empty; 0 worked minutes for that day.
- `E_ATT_OVER_LIMIT` — daily overtime above the daily cap (`scope=day`) or monthly overtime above the monthly cap (`scope=month`); the monthly case sets `over_limit=true` on `monthly_overtime[]` and on the summary row.
- `E_ATT_REST_SHORT` — break below `min_break_minutes`.

All codes are exercised by `test/*.test.mjs` and by `scripts/acceptance.mjs`.

## Acceptance evidence

- `ACCEPTANCE.csv` has 18 rows: 17 fixture-backed tool checks (`counted=false`) and one
  quickstart golden row (`counted=true`).
- Evidence run: `evidence/attendance-1794569827485/result.json`; the ACCEPTANCE rows
  reference this run hash above. Earlier runs remain under `evidence/`.
- The 30-row sample is synthetic: employee names, dates and times are placeholders.

## Scope notes

- Reconciliation only: no payroll, overtime pay, tax/social-insurance or compliance conclusion.
- No statutory holiday calendar; only Saturday/Sunday is recognised, and weekend rows are
  skipped unless `include_holidays=true`.
- The monthly 36h cap is applied to the data present in the file, not to an extrapolated month.
- Tool calls are local reads and one local CSV write under
  `$DSH_HOME/dsh-attendance-check/exports/`; nothing is sent or uploaded.
