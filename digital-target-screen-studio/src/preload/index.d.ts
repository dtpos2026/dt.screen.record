import type { DtBridge } from '../shared/ipc'

declare global {
  interface Window {
    dt: DtBridge
  }
}

export {}
