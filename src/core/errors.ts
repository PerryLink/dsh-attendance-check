/** Stable, user-facing failure codes for dsh-attendance-check. */
export type AttendanceErrorCode =
  | 'E_ATT_CSV_ROW'
  | 'E_ATT_DATE_INVALID'
  | 'E_ATT_TIME_INVALID'
  | 'E_ATT_BREAK_INVALID'
  | 'E_ATT_POLICY_INVALID'
  | 'E_ATT_PATH_INVALID'
  | 'E_ATT_EMPTY'

/**
 * Issue codes never thrown as errors: they are collected in `violations` so one
 * bad day does not abort the whole reconciliation.
 */
export type AttendanceIssueCode = 'E_ATT_MISSING_PUNCH' | 'E_ATT_OVER_LIMIT' | 'E_ATT_REST_SHORT'

interface HumanMessage {
  text: string
  next: string
}

const ATTENDANCE_HUMAN: Record<AttendanceErrorCode, HumanMessage> = {
  E_ATT_CSV_ROW: {
    text: '打卡 CSV 有一行读不了：列数、表头或字段不合规',
    next: '对照表头检查这一行：员工、日期、上班时间、下班时间、休息分钟',
  },
  E_ATT_DATE_INVALID: {
    text: '日期不是有效的 YYYY-MM-DD，或月份不是有效的 YYYY-MM',
    next: '统一成 2026-06-22 这种日期（月份用 2026-06），并确认真实存在',
  },
  E_ATT_TIME_INVALID: {
    text: '上下班时间不是 HH:MM，跨零点没有写成「次日 HH:MM」或「24:00+」',
    next: '把时间写成 09:00、18:00；跨零点写「次日 01:30」或 25:30，且下班必须晚于上班',
  },
  E_ATT_BREAK_INVALID: {
    text: '休息分钟不是 0 到 1440 的整数，或休息时长把当班时长扣成了 0 以下',
    next: '休息分钟填整数分钟（如 60），且必须小于上下班之间的时长',
  },
  E_ATT_POLICY_INVALID: {
    text: '核对规则不合法：标准工时、单日/月加班上限或最少休息分钟超出范围',
    next: '标准工时 1–24 小时、单日上限 0–24 小时、月上限 0–744 小时、最少休息 0–720 整数分钟',
  },
  E_ATT_PATH_INVALID: {
    text: '文件路径或导出文件名不可用',
    next: '传一个存在的 CSV 文件；导出时只传 [A-Za-z0-9._-] 组成的文件名',
  },
  E_ATT_EMPTY: {
    text: '没有可核对的打卡记录：空文件、只有表头、或全部是周末且未开启节假日核对',
    next: '确认文件里有员工与日期；需要核对周末/节假日打卡时传 include_holidays=true',
  },
}

/** `one plain sentence（E_CODE）｜下一步：one action｜细节：detail` — what the end user sees. */
export function attendanceErrorMessage(code: AttendanceErrorCode, detail?: string): string {
  const human = ATTENDANCE_HUMAN[code]
  return `${human.text}（${code}）｜下一步：${human.next}${detail ? `｜细节：${detail}` : ''}`
}

export class AttendanceError extends Error {
  readonly code: AttendanceErrorCode

  constructor(code: AttendanceErrorCode, detail?: string) {
    super(attendanceErrorMessage(code, detail))
    this.name = 'AttendanceError'
    this.code = code
  }
}
