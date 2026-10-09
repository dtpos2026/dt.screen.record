# Testing Digital Target Screen Studio

## Automated

| Suite | Command | What it proves |
|---|---|---|
| Unit (40 tests) | `npm test` | Settings validation/repair, resolution & bitrate math (no upscaling, encoder limits, DPI, multi-monitor layout), filenames, shortcut parsing, FFmpeg argument building and output parsing, image header parsing |
| End-to-end (22 tests) | `npm run build && npm run test:e2e` | Drives the real app and inspects real output files with ffprobe (see README → Testing) |
| CI | `.github/workflows/screen-studio.yml` | Windows: unit + E2E on the Windows desktop, NSIS/portable packaging, silent install → launch → uninstall. Linux: E2E on a virtual two-monitor desktop with virtual audio |

On Windows the E2E suite uses Chromium's fake camera/microphone (`DT_E2E=1`), so it runs on machines without audio hardware. Tests that rely on Linux helpers are skipped on Windows (window capture via `xclock`, global shortcut via `xdotool`, system-audio loopback via PulseAudio); the matching Windows behaviour is covered by the manual checklist below.

## Manual checklist for real Windows hardware

Run on at least one Windows 10 (22H2) and one Windows 11 PC, ideally with: a 4K or high-DPI laptop display (150–200 % scaling), a second monitor with a different resolution/scaling, a USB or built-in microphone, speakers/headphones, and a webcam.

### Install
- [ ] Installer shows Digital Target branding (icon, sidebar), licence page, folder choice; app starts after install.
- [ ] Start menu + desktop shortcuts have the Digital Target icon; Settings → Apps lists "Digital Target Screen Studio" with publisher Digital Target.
- [ ] Portable exe starts without installation.
- [ ] Uninstall keeps recordings and screenshots.

### Recording
- [ ] Full screen on each monitor at Native, 1080p and 4K presets: output resolution matches the Output card (no upscaling on 1080p screens).
- [ ] 60 fps recording plays smoothly; CPU/GPU usage is reasonable (Task Manager).
- [ ] Window recording of a browser/Office window; resize the window during recording (output keeps its size, content letterboxed).
- [ ] Region recording on the high-DPI display: region frame visible on screen but **not** in the video.
- [ ] All displays combined with mixed scaling: monitors appear in the right arrangement.
- [ ] Floating toolbar is **not visible** in recordings or screenshots (Windows 10 2004+/11); it remembers its position after restart.
- [ ] Pause/resume, countdown, duration limit auto-save, discard confirmation, quit-while-recording dialog.
- [ ] Minimise to tray while recording; tray menu pause/resume/stop; tray tooltip shows elapsed time.
- [ ] Global shortcuts work while other apps are focused.

### Audio
- [ ] System audio only (play a YouTube video): clear audio, in sync with video.
- [ ] Microphone only: test with "Test microphone (5 s)"; noise suppression on/off; voice enhancement on/off; clipping warning when shouting close to the mic.
- [ ] System audio + microphone together, 10-minute recording: no drift (lip-sync at the end).
- [ ] Unplug a USB microphone during recording: warning shown, video continues and saves.
- [ ] Microphone blocked in Windows privacy settings: clear message and working "Privacy settings" button.

### Screenshots
- [ ] Region, full screen, monitor, window, all monitors — sizes match the native resolution (e.g. 3840×2160 on a 4K screen at 150 %).
- [ ] PNG/JPEG/WebP saved and open in Photos; clipboard paste into Paint/Word/Teams.
- [ ] Delay 3/5/10 s with countdown; capture a menu that only opens on hover.
- [ ] Editor: all tools, undo/redo, crop, resize, Save copy, Save As, Overwrite (asks first).

### Library & export
- [ ] Thumbnails, durations, resolutions; play/seek/volume in the built-in player.
- [ ] Rename, delete (goes to Recycle Bin), Show in folder.
- [ ] Export 4K → 1080p with the hardware encoder (NVIDIA/Intel/AMD) and with the software fallback; cancel an export.

### Reliability
- [ ] End the app with Task Manager during a recording → restart → Recover produces a playable MP4.
- [ ] Fill a nearly-full USB drive as the save folder → recording stops safely with a message.
- [ ] Sleep/hibernate during recording → recording is saved or recoverable.
