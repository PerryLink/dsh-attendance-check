import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createTools } from './tools.js'

export const name = 'dsh-attendance-check'
export const inject = ['tools']

/** Local write root: `$DSH_ATTENDANCE_CHECK_HOME`, else `$DSH_HOME/dsh-attendance-check`. */
export function resolveBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DSH_ATTENDANCE_CHECK_HOME?.trim()
  if (override) return override
  const dshHome = env.DSH_HOME?.trim()
  return path.join(dshHome || process.cwd(), 'dsh-attendance-check')
}

export async function apply(ctx: Context): Promise<void> {
  for (const tool of createTools({ baseDir: resolveBaseDir() })) ctx.tools.register(tool)
}
