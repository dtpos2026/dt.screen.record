import type { EngineCommand } from '../../shared/ipc'
import { AppError } from '../../shared/errors'
import type { AppErrorInfo } from '../../shared/types'
import { createLogger } from '../logger'
import { createEngineWindow, getEngineWindow } from '../windows'

const log = createLogger('engine-client')

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
type EngineRequest = DistributiveOmit<EngineCommand, 'reqId'>

/**
 * Talks to the hidden capture-engine window. The engine owns all media
 * streams (screen, microphone, system audio) and the MediaRecorder, so it
 * keeps recording when the main window is hidden, minimised or closed.
 */
class EngineClient {
  private seq = 1
  private pending = new Map<number, Pending>()
  private readyWaiters: Array<() => void> = []
  private ready = false

  ensure(): void {
    if (!getEngineWindow()) {
      this.ready = false
      const win = createEngineWindow()
      win.webContents.on('render-process-gone', (_e, details) => {
        log.error(`Engine renderer exited: ${details.reason}`)
        this.ready = false
        for (const [, p] of this.pending) {
          clearTimeout(p.timer)
          p.reject(new AppError('INIT_FAILED', 'The capture engine stopped unexpectedly.'))
        }
        this.pending.clear()
        this.crashListener?.()
        if (!win.isDestroyed()) win.destroy()
      })
    }
  }

  private crashListener: (() => void) | null = null
  onCrash(fn: () => void): void {
    this.crashListener = fn
  }

  markReady(): void {
    this.ready = true
    const waiters = this.readyWaiters
    this.readyWaiters = []
    waiters.forEach((w) => w())
  }

  private waitReady(timeoutMs = 15_000): Promise<void> {
    this.ensure()
    if (this.ready) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new AppError('INIT_FAILED', 'The capture engine did not start.')), timeoutMs)
      this.readyWaiters.push(() => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  async request<T>(command: EngineRequest, timeoutMs = 30_000): Promise<T> {
    await this.waitReady()
    const win = getEngineWindow()
    if (!win) throw new AppError('INIT_FAILED', 'The capture engine is not running.')
    const reqId = this.seq++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new AppError('INIT_FAILED', `The capture engine did not respond (${command.cmd}).`))
      }, timeoutMs)
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer })
      win.webContents.send('engine:command', { ...command, reqId } as EngineCommand)
    })
  }

  reply(reqId: number, ok: boolean, value: unknown, error?: AppErrorInfo): void {
    const p = this.pending.get(reqId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(reqId)
    if (ok) p.resolve(value)
    else p.reject(new AppError(error?.code ?? 'UNKNOWN', error?.message, error?.hint))
  }
}

export const engine = new EngineClient()
