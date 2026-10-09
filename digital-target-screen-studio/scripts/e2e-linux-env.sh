#!/usr/bin/env bash
# Starts a virtual desktop for the end-to-end tests on Linux:
#   - Xorg (dummy driver) with two monitors: 1920x1080 + 1280x720 (offset)
#   - openbox (so other applications' windows are capturable) and xclock
#   - PulseAudio with a null sink as default output (system-audio loopback)
# Requires: xserver-xorg-video-dummy x11-xserver-utils openbox x11-apps pulseaudio
# Usage: source scripts/e2e-linux-env.sh
set -e
DISPLAY_NUM=${DT_E2E_DISPLAY:-:62}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! DISPLAY=$DISPLAY_NUM xrandr >/dev/null 2>&1; then
  Xorg "$DISPLAY_NUM" -noreset -nolisten tcp -ac -config "$HERE/tests/e2e/xorg-dummy.conf" -logfile /tmp/dt-e2e-xorg.log >/dev/null 2>&1 &
  for _ in $(seq 1 30); do DISPLAY=$DISPLAY_NUM xrandr >/dev/null 2>&1 && break; sleep 0.2; done
fi
export DISPLAY=$DISPLAY_NUM
xrandr --output DUMMY0 --mode 1920x1080 --pos 0x0 --primary
xrandr --addmode DUMMY1 1280x720 2>/dev/null || true
xrandr --output DUMMY1 --mode 1280x720 --pos 1920x180
pgrep -x openbox >/dev/null || (openbox >/dev/null 2>&1 &)
pgrep -x xclock >/dev/null || (xclock -geometry 360x360+300+300 >/dev/null 2>&1 &)
if ! pactl info >/dev/null 2>&1; then
  pulseaudio --daemonize=yes --exit-idle-time=-1 --log-target=file:/tmp/dt-e2e-pulse.log || true
  sleep 1
fi
pactl list short sinks | grep -q dtsink || pactl load-module module-null-sink sink_name=dtsink sink_properties=device.description=DT_Speakers >/dev/null
pactl set-default-sink dtsink
pactl set-source-volume dtsink.monitor 100%
pactl set-sink-volume dtsink 100%
export DT_E2E_MULTI_MONITOR=1
echo "E2E desktop ready on $DISPLAY (2 monitors, openbox, PulseAudio null sink)"
