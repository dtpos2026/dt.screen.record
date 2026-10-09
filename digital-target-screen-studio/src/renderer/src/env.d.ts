/// <reference types="vite/client" />
import type {} from '../../preload/index.d.ts'

declare global {
  // Chromium insertable streams (available in Electron, not yet in lib.dom).
  class MediaStreamTrackProcessor<T = VideoFrame> {
    constructor(init: { track: MediaStreamTrack; maxBufferSize?: number })
    readonly readable: ReadableStream<T>
  }

  class MediaStreamTrackGenerator<T = VideoFrame> extends MediaStreamTrack {
    constructor(init: { kind: 'video' | 'audio' })
    readonly writable: WritableStream<T>
  }

  interface MediaRecorderOptions {
    videoKeyFrameIntervalDuration?: number
  }
}
