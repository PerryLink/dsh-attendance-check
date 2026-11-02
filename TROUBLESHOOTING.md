# 故障排查 — dsh-attendance-check

每条按「症状 / 原因 / 动作」写。报错原文都是 `<一句人话>（E_ATT_XXX）｜下一步：<动作>`，
把 `E_ATT_XXX` 和这句话一起发到 issue 即可定位。不要把真实员工姓名、工号或打卡明细贴进 issue。

## 1. 列数对不上（E_ATT_CSV_ROW）

- **症状**：`打卡 CSV 有一行读不了：列数、表头或字段不合规（E_ATT_CSV_ROW）｜下一步：对照表头检查这一行：员工、日期、上班时间、下班时间、休息分钟｜细节：第 7 行有 4 列，表头有 5 列`
- **原因**：某一行少填或多填了一个字段，通常发生在休息分钟被省略、或员工姓名里有未加引号的逗号。
- **动作**：按报错行号补成 5 列；姓名里本身有逗号时用双引号包住，例如 `"张, 三"`。改完重跑 `attendance.check`。

## 2. 表头缺列、重复或同一人同一天重复（E_ATT_CSV_ROW）

- **症状**：`...E_ATT_CSV_ROW...｜细节：表头缺少：休息分钟`，或 `表头里 员工 出现了两次`，或 `第 8 行与第 4 行重复：张伟 在 2026-06-22 有两条打卡记录`
- **原因**：表头用了不认识的列名、同一字段的中英文列同时存在，或同一员工同一天被导出了两次。
- **动作**：表头统一成 `employee,date,clock_in,clock_out,break_minutes`（或对应中文别名），每列只留一次；同一员工同一天只保留一条完整记录。不要靠删员工来“修复”数据。

## 3. 日期不对（E_ATT_DATE_INVALID）

- **症状**：`日期不是有效的 YYYY-MM-DD，或月份不是有效的 YYYY-MM（E_ATT_DATE_INVALID）｜下一步：统一成 2026-06-22 这种日期（月份用 2026-06），并确认真实存在｜细节：第 12 行日期："2026/06/22" 不是 YYYY-MM-DD`
- **原因**：日期用了斜杠、两位年份或 Excel 序列号，或填了不存在的日期（例如 2026-02-30）；`month` 参数也可能是 `2026-6` 这种格式。
- **动作**：统一改成 `YYYY-MM-DD`；月份筛选参数用 `YYYY-MM`。确认日期真实存在后重跑。

## 4. 上下班时间不对（E_ATT_TIME_INVALID）

- **症状**：`上下班时间不是 HH:MM，跨零点没有写成「次日 HH:MM」或「24:00+」（E_ATT_TIME_INVALID）｜下一步：把时间写成 09:00、18:00；跨零点写「次日 01:30」或 25:30，且下班必须晚于上班｜细节：第 3 行上班时间："9:00" 不是 HH:MM...`
- **原因**：小时没补零（`9:00`）、用了全角冒号、分钟超过 59、把跨零点的 `01:30` 直接写成了同一天，或单次当班超过 24 小时。
- **动作**：写成两位小时加冒号，例如 `09:00`；跨零点写 `次日 01:30`、`次日01:30` 或 `25:30`（24:00–29:59）；确认下班严格晚于上班。改完重跑。

## 5. 休息分钟不对（E_ATT_BREAK_INVALID）

- **症状**：`休息分钟不是 0 到 1440 的整数，或休息时长把当班时长扣成了 0 以下（E_ATT_BREAK_INVALID）｜下一步：休息分钟填整数分钟（如 60），且必须小于上下班之间的时长｜细节：第 5 行休息分钟："1.5" 不是非负整数分钟`
- **原因**：把小时填成了分钟、填了小数或负数，或休息时长大于等于上下班之间的时长（例如 09:00–10:00 却休息 60 分钟）。
- **动作**：休息分钟填 0–1440 的整数；确认它小于当班时长。留空会按 0 处理，但 0 分钟通常会被判为休息不足。

## 6. 核对规则不合法（E_ATT_POLICY_INVALID）

- **症状**：`核对规则不合法：标准工时、单日/月加班上限或最少休息分钟超出范围（E_ATT_POLICY_INVALID）｜下一步：标准工时 1–24 小时、单日上限 0–24 小时、月上限 0–744 小时、最少休息 0–720 整数分钟`
- **原因**：`standard_hours` 传了 0、负数或超过 24；`daily_overtime_cap_hours` 超过 24；`monthly_overtime_cap_hours` 超过 744；`min_break_minutes` 传了小数或超过 720；`include_holidays` 传了字符串。
- **动作**：按提示的范围传数字；`min_break_minutes` 必须是整数分钟；`include_holidays` 只传 `true` / `false`。不传则使用默认 8h / 3h / 36h / 60min。

## 7. 路径或导出名不可用（E_ATT_PATH_INVALID）

- **症状**：`文件路径或导出文件名不可用（E_ATT_PATH_INVALID）｜下一步：传一个存在的 CSV 文件；导出时只传 [A-Za-z0-9._-] 组成的文件名｜细节：导出文件名不安全："../考勤表.csv"`
- **原因**：输入路径拼错、文件被移动、传了目录；导出文件名里带了 `../`、`/`、反斜杠、空格或中文，或超过 120 字符。
- **动作**：用绝对路径确认输入文件存在且可读；`filename` 只传一个 `[A-Za-z0-9._-]` 组成的文件名，例如 `attendance-2026-06.csv`。导出目录固定为 `$DSH_HOME/dsh-attendance-check/exports/`，不要传目录。

## 8. 没有可核对的打卡记录（E_ATT_EMPTY）

- **症状**：`没有可核对的打卡记录：空文件、只有表头、或全部是周末且未开启节假日核对（E_ATT_EMPTY）｜下一步：确认文件里有员工与日期；需要核对周末/节假日打卡时传 include_holidays=true`
- **原因**：CSV 为空、只有表头；所有记录都落在周六/周日且 `include_holidays=false`；`attendance.summary` 的 `month` 筛选在该文件里没有数据。
- **动作**：先确认文件里有员工与日期；要核对周末加班就传 `include_holidays=true`；月份筛选改成文件实际覆盖的月份（可用 `attendance.check` 的 `period.months` 查看）。

## 9. 缺卡提示（E_ATT_MISSING_PUNCH）

- **症状**：`attendance.check` 正常返回，但 `violations` 里出现 `E_ATT_MISSING_PUNCH`，例如 `2026-06-25 王强 缺少下班卡，无法核算当日工时`；该日 `worked_minutes` 与 `overtime_minutes` 都是 0。
- **原因**：`clock_in` 或 `clock_out` 为空。这是**问题（issue）**而不是异常，故意不抛错，避免一条缺卡让整份核对失败。
- **动作**：补卡后重跑；在补齐之前，缺卡日不计入实出勤，也不会产生加班。`missing_out=true` 表示缺下班卡，`missing_in=true` 表示缺上班卡。

## 10. 加班超限提示（E_ATT_OVER_LIMIT）

- **症状**：`violations` 里出现 `E_ATT_OVER_LIMIT`，例如 `2026-06-24 李娜 当日加班 3.50 小时，超出单日上限 3.00 小时共 0.50 小时`（`scope=day`），或 `2026-06 李娜 月加班 39.00 小时，超出月上限 36.00 小时共 3.00 小时`（`scope=month`）。
- **原因**：单日加班超过 `daily_overtime_cap_hours`（默认 3h），或该员工该自然月累计加班超过 `monthly_overtime_cap_hours`（默认 36h）。
- **动作**：先核对加班审批和调休记录，再决定是否补审批或调整排班。规则阈值可以用参数覆盖；不要把超限记录直接删掉来“消除”问题。

## 11. 休息不足提示（E_ATT_REST_SHORT）

- **症状**：`violations` 里出现 `E_ATT_REST_SHORT`，例如 `2026-06-26 刘洋 休息 30 分钟，低于规则要求的 60 分钟`，该日 `status=rest_short`。
- **原因**：休息分钟小于 `min_break_minutes`（默认 60 分钟）。
- **动作**：核对午休/晚休记录；如果公司规则本来就是 30 分钟，用 `min_break_minutes=30` 重跑。注意：休息不足本身不会产生加班，加班仍按实际工时减标准工时计算。

## 12. 结果和手工表不一致

- **症状**：没有报错，但某人日工时、加班或应出勤和手工表不同。
- **原因**：常见四类——① 跨零点没写 `次日`/`24:00+`；② 休息分钟填成了小时；③ 周末记录默认被跳过；④ 月上限只对文件覆盖到的数据累计。另外，应出勤按「文件覆盖区间内的周一至周五」计算，不是整月日历天数。
- **动作**：用 `attendance.check` 的 `employees[].days[]` 逐日核对 `worked_minutes`、`overtime_minutes` 与 `status`，再用 `attendance.export` 导出核对表对照；确认 `policy`、`period` 和 `totals.skipped_holiday_rows` 是否符合预期。

## 13. 还不行

```sh
node samples/quickstart/run.mjs --check   # 自带样例必须通过
node --test test/*.test.mjs               # 134 项测试
node scripts/gate.mjs                     # 元数据 + 验收门
```

仍失败时请在 <https://github.com/PerryLink/dsh-attendance-check/issues> 附上：包版本、最小合成 CSV（或生成脚本）、
`attendance.check` / `attendance.summary` / `attendance.export` 的完整报错行、Node 与 DSH 版本。**不要附真实员工考勤明细。**
