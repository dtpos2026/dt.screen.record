export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`
}

/** 75_000 → "01:15", 3_725_000 → "1:02:05" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatResolution(w: number | null | undefined, h: number | null | undefined): string {
  if (!w || !h) return '—'
  return `${w} × ${h}`
}

export function resolutionLabel(w: number, h: number): string {
  const p = Math.min(w, h)
  if (p >= 2160) return '4K'
  if (p >= 1440) return 'QHD'
  if (p >= 1080) return 'Full HD'
  if (p >= 720) return 'HD'
  return 'SD'
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function splitHms(totalSeconds: number): { h: number; m: number; s: number } {
  const t = Math.max(0, Math.floor(totalSeconds))
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 }
}
