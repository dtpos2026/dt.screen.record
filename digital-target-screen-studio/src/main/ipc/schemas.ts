import { z } from 'zod'
import { SCREENSHOT_MODES, IMAGE_FORMATS } from '../../shared/settings'
import { CAPTURE_ERROR_CODES } from '../../shared/errors'
import { validateFileName } from '../../shared/filenames'

/** Payload schemas for IPC requests. Unknown keys are rejected. */

const absPath = z.string().min(1).max(4096)
const id = z.string().min(1).max(200)
const bytes = z.instanceof(Uint8Array).refine((b) => b.byteLength <= 512 * 1024 * 1024, 'Too large')
const rect = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative()
})

const appErrorSchema = z.strictObject({
  code: z.enum(CAPTURE_ERROR_CODES as [string, ...string[]]).transform((c) => c as (typeof CAPTURE_ERROR_CODES)[number]),
  message: z.string().max(2000),
  hint: z.string().max(2000).optional()
})

export const S = {
  settingsPatch: z.record(z.string(), z.record(z.string(), z.unknown())),
  chooseFolder: z.strictObject({ purpose: z.enum(['recordings', 'screenshots']) }),
  openFolder: z.strictObject({ kind: z.enum(['recordings', 'screenshots', 'logs']) }),
  systemSettings: z.strictObject({ target: z.enum(['microphone', 'camera', 'sound', 'display']) }),
  disk: z.strictObject({ kind: z.enum(['recordings', 'screenshots']) }),
  displays: z.strictObject({ thumbnails: z.boolean().optional() }).optional().transform((v) => v ?? {}),
  selectRegion: z.strictObject({ displayId: z.string().max(64).optional() }).optional().transform((v) => v ?? {}),
  selectWindow: z.strictObject({ sourceId: id, name: z.string().max(500) }),
  recoverId: z.strictObject({ id: z.string().regex(/^[\w-]{6,64}$/) }),
  screenshotCapture: z.strictObject({
    mode: z.enum(SCREENSHOT_MODES),
    displayId: z.string().max(64).optional(),
    windowId: id.optional(),
    delaySeconds: z.number().int().min(0).max(60).optional()
  }),
  readBytes: z.strictObject({ captureId: id.optional(), path: absPath.optional() }),
  save: z.strictObject({
    captureId: id.optional(),
    bytes: bytes.optional(),
    format: z.enum(IMAGE_FORMATS).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    target: z.enum(['auto', 'dialog', 'overwrite']),
    sourcePath: absPath.optional(),
    suggestedName: z.string().max(200).refine((v) => validateFileName(v).ok, 'Invalid file name').optional()
  }),
  copy: z.strictObject({ captureId: id.optional(), bytes: bytes.optional(), path: absPath.optional() }),
  captureId: z.strictObject({ captureId: id }),
  path: z.strictObject({ path: absPath }),
  rename: z.strictObject({ path: absPath, newName: z.string().min(1).max(220) }),
  paths: z.strictObject({ paths: z.array(absPath).min(1).max(500) }),
  exportInfo: z.strictObject({ refresh: z.boolean().optional() }).optional().transform((v) => v ?? {}),
  exportStart: z.strictObject({
    path: absPath,
    options: z.strictObject({
      resolution: z.enum(['original', '2160', '1440', '1080', '720', '480']),
      fps: z.union([z.literal('original'), z.literal(24), z.literal(30), z.literal(60)]),
      quality: z.enum(['high', 'balanced', 'small']),
      encoder: z.string().regex(/^(auto|[a-z0-9_]{2,40})$/),
      audioBitrateKbps: z.number().int().min(64).max(320),
      removeAudio: z.boolean()
    })
  }),
  jobId: z.strictObject({ jobId: id }),
  navigate: z.strictObject({
    page: z.enum(['dashboard', 'recorder', 'screenshot', 'library', 'editor', 'settings', 'about']),
    params: z.record(z.string().max(64), z.string().max(4096)).optional()
  }),
  toolbarToggle: z.strictObject({ visible: z.boolean().optional() }).optional().transform((v) => v ?? {}),
  toolbarResize: z.strictObject({ width: z.number().int().min(40).max(1000), height: z.number().int().min(30).max(400) }),
  overlaySubmit: z.strictObject({ rect: rect.nullable() }),
  engineReply: z.strictObject({
    reqId: z.number().int().positive(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: appErrorSchema.optional()
  }),
  engineChunk: z.strictObject({ sessionId: z.string().uuid(), data: bytes }),
  levels: z.strictObject({
    mic: z.strictObject({ rms: z.number(), peak: z.number(), clipping: z.boolean() }).nullable(),
    system: z.strictObject({ rms: z.number(), peak: z.number(), clipping: z.boolean() }).nullable()
  }),
  engineWarning: z.strictObject({ sessionId: z.string().uuid(), message: z.string().max(1000) }),
  engineFatal: z.strictObject({
    sessionId: z.string().uuid(),
    error: appErrorSchema
  })
}
