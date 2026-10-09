import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { z } from 'zod'
import type { InvokeChannel, InvokeReq, InvokeRes, SendChannel, SendContract } from '../../shared/ipc'
import { createLogger } from '../logger'
import { isTrustedUrl } from '../paths'
import { roleOf, type WindowRole } from '../windows'

const log = createLogger('ipc')

function senderAllowed(sender: WebContents, frameUrl: string | undefined, roles: readonly WindowRole[]): boolean {
  if (!isTrustedUrl(frameUrl)) return false
  const role = roleOf(sender)
  return role !== undefined && roles.includes(role)
}

/**
 * Registers a validated `ipcMain.handle` for a contract channel. Requests are
 * rejected unless they come from one of our own pages, from a window with an
 * allowed role, and with a payload that matches the zod schema.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  roles: readonly WindowRole[],
  schema: z.ZodType<InvokeReq<C>> | null,
  fn: (payload: InvokeReq<C>, event: IpcMainInvokeEvent) => Promise<InvokeRes<C>> | InvokeRes<C>
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    if (!senderAllowed(event.sender, event.senderFrame?.url, roles)) {
      log.warn(`Rejected ${channel} from unexpected sender`)
      throw new Error('Request not allowed')
    }
    let payload = undefined as InvokeReq<C>
    if (schema) {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        log.warn(`Invalid payload for ${channel}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
        throw new Error('Invalid request')
      }
      payload = parsed.data
    }
    try {
      return await fn(payload, event)
    } catch (err) {
      log.error(`Handler ${channel} failed`, err)
      throw err instanceof Error ? new Error(err.message) : new Error('Request failed')
    }
  })
}

export function on<C extends SendChannel>(
  channel: C,
  roles: readonly WindowRole[],
  schema: z.ZodType<SendContract[C]>,
  fn: (payload: SendContract[C], event: IpcMainEvent) => void
): void {
  ipcMain.on(channel, (event, raw: unknown) => {
    if (!senderAllowed(event.sender, event.senderFrame?.url, roles)) return
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return
    try {
      fn(parsed.data, event)
    } catch (err) {
      log.error(`Listener ${channel} failed`, err)
    }
  })
}
