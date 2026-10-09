import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  type DtBridge,
  type EventChannel,
  type InvokeChannel,
  type SendChannel
} from '../shared/ipc'

/**
 * Restricted bridge: renderers can only use the whitelisted channels below.
 * The raw ipcRenderer object is never exposed, and the main process
 * validates every payload and the sender's window role again.
 */
// Theme for the first paint, passed by the main process; the page's own settings take over once loaded.
const firstTheme = process.argv.find((a) => a.startsWith('--dt-theme='))?.slice('--dt-theme='.length)
if (firstTheme === 'light' || firstTheme === 'dark' || firstTheme === 'midnight') {
  // The preload is type-checked without the DOM library; this is the only DOM it touches.
  const doc = (globalThis as unknown as { document: PreloadDocument }).document
  const apply = () => {
    if (doc.documentElement && !doc.documentElement.dataset.theme) doc.documentElement.dataset.theme = firstTheme
  }
  if (doc.documentElement) apply()
  else doc.addEventListener('readystatechange', apply, { once: true })
}

interface PreloadDocument {
  documentElement: { dataset: Record<string, string | undefined> } | null
  addEventListener(type: 'readystatechange', listener: () => void, options: { once: boolean }): void
}

const invokeAllowed = new Set<string>(INVOKE_CHANNELS)
const sendAllowed = new Set<string>(SEND_CHANNELS)
const eventAllowed = new Set<string>(EVENT_CHANNELS)

const bridge: DtBridge = {
  invoke(channel: InvokeChannel, ...args: unknown[]) {
    if (!invokeAllowed.has(channel)) return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, args[0])
  },
  send(channel: SendChannel, payload: unknown) {
    if (!sendAllowed.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`)
    ipcRenderer.send(channel, payload)
  },
  on(channel: EventChannel, listener: (payload: unknown) => void) {
    if (!eventAllowed.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  platform: process.platform
} as DtBridge

contextBridge.exposeInMainWorld('dt', bridge)
