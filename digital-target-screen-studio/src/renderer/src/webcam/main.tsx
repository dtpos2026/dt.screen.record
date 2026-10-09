import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Circle, Minus, Plus, Square, X } from 'lucide-react'
import { useSettings } from '../lib/hooks'
import '../styles/base.css'
import './webcam.css'

/** Floating webcam bubble. It is captured as part of the screen recording. */
function Webcam() {
  const [settings, update] = useSettings()
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const deviceId = settings?.webcam.deviceId

  useEffect(() => {
    if (deviceId === undefined) return
    let stream: MediaStream | null = null
    let cancelled = false
    const open = async () => {
      const video0: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId && deviceId !== 'default' ? { ...video0, deviceId: { exact: deviceId } } : video0 })
      } catch (err) {
        const name = (err as DOMException).name
        if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video0 })
          } catch {
            stream = null
          }
        }
        if (!stream) {
          setError(name === 'NotAllowedError' ? 'Camera access is blocked in Windows privacy settings.' : 'No camera is available.')
          return
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      setError(null)
      if (video.current) video.current.srcObject = stream
    }
    void open()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [deviceId])

  if (!settings) return null
  const w = settings.webcam
  const resize = (delta: number) => void update({ webcam: { size: Math.max(120, Math.min(600, w.size + delta)) } })
  return (
    <div className={`cam cam-${w.shape}`}>
      {error ? <div className="cam-error">{error}</div> : <video ref={video} autoPlay muted playsInline className={w.mirror ? 'mirror' : ''} />}
      <div className="cam-tools">
        <button onClick={() => resize(-40)} title="Smaller" aria-label="Smaller"><Minus size={14} /></button>
        <button onClick={() => resize(40)} title="Larger" aria-label="Larger"><Plus size={14} /></button>
        <button onClick={() => void update({ webcam: { shape: w.shape === 'circle' ? 'rounded' : 'circle' } })} title="Change shape" aria-label="Change shape">
          {w.shape === 'circle' ? <Square size={14} /> : <Circle size={14} />}
        </button>
        <button onClick={() => void window.dt.invoke('webcam:close')} title="Hide webcam" aria-label="Hide webcam"><X size={14} /></button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Webcam />)
