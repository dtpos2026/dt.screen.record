import { constants } from 'node:fs'
import { access, mkdir, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DiskInfo } from '../../shared/types'

export async function diskInfo(path: string): Promise<DiskInfo> {
  let probe = path
  // statfs needs an existing path; walk up until one exists.
  for (let i = 0; i < 20; i++) {
    try {
      const s = await statfs(probe)
      return { path, freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }
    } catch {
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  return { path, freeBytes: null, totalBytes: null }
}

/** Creates the folder if needed and checks that it is writable. */
export async function ensureWritableDir(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true })
    await access(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}
