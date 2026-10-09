import { dialog, type MessageBoxOptions, type SaveDialogOptions, type OpenDialogOptions } from 'electron'
import { getMainWindow } from './windows'

/** Native dialogs parented to the main window when it is visible. */
function parent() {
  const w = getMainWindow()
  return w && w.isVisible() ? w : null
}

/**
 * Automated end-to-end tests cannot click native dialogs, so when DT_E2E=1
 * they answer with the first button (the confirming action) and file dialogs
 * use paths from the environment. Never active in normal use.
 */
const E2E = process.env.DT_E2E === '1'

export async function messageBox(options: MessageBoxOptions): Promise<number> {
  if (E2E) return Number(process.env.DT_E2E_DIALOG_RESPONSE ?? 0)
  const p = parent()
  const r = p ? await dialog.showMessageBox(p, options) : await dialog.showMessageBox(options)
  return r.response
}

export async function confirm(opts: { title: string; message: string; detail?: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  const response = await messageBox({
    type: opts.danger ? 'warning' : 'question',
    buttons: [opts.confirmLabel, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: opts.title,
    message: opts.message,
    detail: opts.detail
  })
  return response === 0
}

export async function saveDialog(options: SaveDialogOptions): Promise<string | null> {
  if (E2E) return process.env.DT_E2E_SAVE_PATH ?? null
  const p = parent()
  const r = p ? await dialog.showSaveDialog(p, options) : await dialog.showSaveDialog(options)
  return r.canceled || !r.filePath ? null : r.filePath
}

export async function openDialog(options: OpenDialogOptions): Promise<string[] | null> {
  if (E2E) return process.env.DT_E2E_OPEN_PATH ? [process.env.DT_E2E_OPEN_PATH] : null
  const p = parent()
  const r = p ? await dialog.showOpenDialog(p, options) : await dialog.showOpenDialog(options)
  return r.canceled ? null : r.filePaths
}
