import { appError } from '@shared/errors'
import type { EngineCommand } from '@shared/ipc'
import { RecordingSession, toErrorInfo } from './session'
import { encodeImage, grabFramePng } from './video'

/**
 * Hidden capture engine. Receives commands from the main process, owns the
 * media streams and the MediaRecorder, and streams encoded chunks back to the
 * main process, which writes them to disk.
 */
const dt = window.dt
let session: RecordingSession | null = null
let sessionId: string | null = null

function reply(reqId: number, ok: boolean, value?: unknown, error?: ReturnType<typeof toErrorInfo>) {
  void dt.invoke('engine:reply', { reqId, ok, value, error })
}

async function handle(cmd: EngineCommand): Promise<void> {
  try {
    switch (cmd.cmd) {
      case 'start': {
        if (session) {
          session.abort()
          session = null
        }
        const id = cmd.plan.sessionId
        const s = new RecordingSession(cmd.plan, {
          chunk: async (data) => {
            const accepted = await dt.invoke('engine:chunk', { sessionId: id, data })
            if (!accepted) throw new Error('Chunk rejected')
          },
          levels: (l) => dt.send('engine:levels', l),
          warning: (message) => dt.send('engine:warning', { sessionId: id, message }),
          fatal: (error) => dt.send('engine:fatal', { sessionId: id, error })
        })
        const result = await s.start()
        session = s
        sessionId = id
        reply(cmd.reqId, true, result)
        return
      }
      case 'pause':
        session?.pause()
        reply(cmd.reqId, true)
        return
      case 'resume':
        session?.resume()
        reply(cmd.reqId, true)
        return
      case 'stop': {
        const s = session
        session = null
        sessionId = null
        if (s) await s.stop()
        reply(cmd.reqId, true)
        return
      }
      case 'abort':
        session?.abort()
        session = null
        sessionId = null
        reply(cmd.reqId, true)
        return
      case 'grabFrame':
        reply(cmd.reqId, true, await grabFramePng(cmd.sourceId))
        return
      case 'encodeImage':
        reply(cmd.reqId, true, await encodeImage(cmd.png, cmd.format, cmd.quality))
        return
      default:
        reply((cmd as EngineCommand).reqId, false, undefined, appError('UNKNOWN', 'Unknown engine command'))
    }
  } catch (err) {
    reply(cmd.reqId, false, undefined, toErrorInfo(err))
  }
}

dt.on('engine:command', (cmd) => void handle(cmd))
void dt.invoke('engine:ready')
void sessionId
