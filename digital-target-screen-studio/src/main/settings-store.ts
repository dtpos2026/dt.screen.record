import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applySettingsPatch, normalizeSettings, defaultSettings, type Settings } from '../shared/settings'
import { OUTPUT_FOLDER_NAME } from '../shared/constants'
import { createLogger } from './logger'

const log = createLogger('settings')

/**
 * JSON settings persisted in `<userData>/settings.json`. Writes are atomic
 * (temp file + rename) so a crash can never leave a half-written file.
 */
class SettingsStore extends EventEmitter {
  private file = ''
  private data: Settings = defaultSettings()
  private saveTimer: NodeJS.Timeout | null = null

  load(): Settings {
    this.file = join(app.getPath('userData'), 'settings.json')
    try {
      if (existsSync(this.file)) {
        this.data = normalizeSettings(JSON.parse(readFileSync(this.file, 'utf8')))
      }
    } catch (err) {
      log.warn('Settings file unreadable, using defaults', err)
      try {
        renameSync(this.file, `${this.file}.corrupt`)
      } catch {
        // ignore
      }
      this.data = defaultSettings()
    }
    this.ensureDefaultsForPaths()
    this.flush()
    return this.data
  }

  get(): Settings {
    return this.data
  }

  update(patch: unknown): Settings {
    const next = applySettingsPatch(this.data, patch)
    this.data = next
    this.ensureDefaultsForPaths()
    this.scheduleSave()
    this.emit('changed', this.data)
    return this.data
  }

  reset(): Settings {
    const keep = { toolbar: this.data.toolbar }
    this.data = { ...defaultSettings(), toolbar: { ...defaultSettings().toolbar, x: keep.toolbar.x, y: keep.toolbar.y } }
    this.ensureDefaultsForPaths()
    this.flush()
    this.emit('changed', this.data)
    return this.data
  }

  /** Silent update that does not notify listeners (e.g. toolbar position). */
  updateQuiet(patch: unknown): void {
    this.data = applySettingsPatch(this.data, patch)
    this.scheduleSave()
  }

  private ensureDefaultsForPaths(): void {
    if (!this.data.general.recordingsDir) {
      this.data.general.recordingsDir = join(app.getPath('videos'), OUTPUT_FOLDER_NAME)
    }
    if (!this.data.general.screenshotsDir) {
      this.data.general.screenshotsDir = join(app.getPath('pictures'), OUTPUT_FOLDER_NAME)
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.file) return
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      log.error('Could not save settings', err)
    }
  }
}

export const settingsStore = new SettingsStore()
