export const BRAND = {
  company: 'Digital Target',
  product: 'Digital Target Screen Studio',
  shortName: 'Screen Studio',
  appId: 'com.digitaltarget.screenstudio',
  colors: {
    primary: '#3C096C',
    secondary: '#5A189A',
    accent: '#E0AAFF'
  }
} as const

/** Folder name created inside the user's Videos / Pictures folders. */
export const OUTPUT_FOLDER_NAME = 'Digital Target Screen Studio'

/** Hidden folder (inside the recordings folder) that holds in-progress recordings. */
export const IN_PROGRESS_FOLDER = '.dt-in-progress'

export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov'] as const
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const

/** Below this much free space a recording will not start. */
export const MIN_FREE_BYTES_TO_START = 300 * 1024 * 1024
/** Below this much free space a running recording is stopped and saved. */
export const MIN_FREE_BYTES_WHILE_RECORDING = 200 * 1024 * 1024
/** Show a warning before starting when free space is below this value. */
export const LOW_DISK_WARNING_BYTES = 2 * 1024 * 1024 * 1024

/**
 * H.264 encoders (hardware and software) reliably support frames up to
 * 4096 px wide and ~8.9 MP. Larger outputs are scaled down to fit and the UI
 * explains why.
 */
export const MAX_ENCODE_WIDTH = 4096
export const MAX_ENCODE_HEIGHT = 4096
export const MAX_ENCODE_PIXELS = 4096 * 2304

export const RECORDING_TIMESLICE_MS = 1000

/** Intermediate (lossless-in-practice) Opus bitrate used before the final AAC encode. */
export const INTERMEDIATE_AUDIO_BITRATE = 320_000

export const PRIVACY_STATEMENT =
  'Digital Target Screen Studio works entirely on your computer. Recordings, screenshots, ' +
  'microphone audio and camera video are processed and stored locally in the folders you choose. ' +
  'Nothing is uploaded, no account is required, and the app collects no telemetry or personal data. ' +
  'Diagnostic logs stay on this PC, never include screen or audio content, and are only shared if you send them yourself.'
