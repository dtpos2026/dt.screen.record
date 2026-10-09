import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 2 * 1024 * 1024
let logFile: string | null = null
const home = homedir()

/**
 * Privacy-aware logger. Messages are written to `<userData>/logs/app.log`
 * (rotated at 2 MB). The user's home folder is replaced with `~` so user
 * names are not written to disk, and no screen/audio content is ever logged.
 */
export function initLogger(): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'app.log')
  try {
    if (existsSync(logFile) && statSync(logFile).size > MAX_LOG_BYTES) {
      renameSync(logFile, join(dir, 'app.previous.log'))
    }
  } catch {
    // Rotation is best effort.
  }
  return dir
}

export function redact(text: string): string {
  if (!home) return text
  return text.split(home).join('~')
}

function serialize(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack.split('\n').slice(1, 6).join('\n')}` : ''}`
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function write(level: Level, scope: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${redact(args.map(serialize).join(' '))}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else if (!app.isPackaged) console.log(line)
  if (!logFile) return
  try {
    appendFileSync(logFile, line + '\n')
  } catch {
    // Never let logging break the app.
  }
}

export function createLogger(scope: string) {
  return {
    debug: (...a: unknown[]) => {
      if (!app.isPackaged) write('debug', scope, a)
    },
    info: (...a: unknown[]) => write('info', scope, a),
    warn: (...a: unknown[]) => write('warn', scope, a),
    error: (...a: unknown[]) => write('error', scope, a)
  }
}

export type Logger = ReturnType<typeof createLogger>
