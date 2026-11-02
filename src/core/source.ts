import { readFile, stat } from 'node:fs/promises'
import { AttendanceError } from './errors.js'

/** Local CSV limit: a punch ledger should be far below this. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024

/**
 * Read the user-named CSV. A missing path, a directory, or an unreadable file is
 * `E_ATT_PATH_INVALID`; an empty file is `E_ATT_EMPTY`; an
 * oversized file is `E_ATT_CSV_ROW`.
 */
export async function readAttendanceSource(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new AttendanceError('E_ATT_PATH_INVALID', 'path 为空')
  }
  const target = filePath.trim()
  let info
  try {
    info = await stat(target)
  } catch {
    throw new AttendanceError('E_ATT_PATH_INVALID', `找不到 ${JSON.stringify(target)}，或当前用户读不到`)
  }
  if (!info.isFile()) throw new AttendanceError('E_ATT_PATH_INVALID', `${JSON.stringify(target)} 不是文件`)
  if (info.size === 0) throw new AttendanceError('E_ATT_EMPTY', 'CSV 是空文件')
  if (info.size > MAX_SOURCE_BYTES) {
    throw new AttendanceError(
      'E_ATT_CSV_ROW',
      `CSV 有 ${info.size} 字节，超过 20 MB 上限；请按员工或月份拆文件`,
    )
  }
  try {
    return await readFile(target, 'utf8')
  } catch {
    throw new AttendanceError('E_ATT_PATH_INVALID', `读不了 ${JSON.stringify(target)}；确认权限后重试`)
  }
}
