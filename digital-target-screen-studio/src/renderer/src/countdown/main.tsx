import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/base.css'
import './countdown.css'

const params = new URLSearchParams(location.search)
const total = Math.max(1, Number(params.get('seconds') ?? 3))
const purpose = params.get('purpose') === 'record' ? 'record' : 'screenshot'

function Countdown() {
  const [left, setLeft] = useState(total)
  useEffect(() => {
    const t0 = performance.now()
    const id = setInterval(() => {
      const remaining = Math.max(0, total - Math.floor((performance.now() - t0) / 1000))
      setLeft(remaining)
    }, 100)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.dt.invoke('recording:cancelCountdown')
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const progress = (total - left) / total
  return (
    <div className="cd" role="timer" aria-live="assertive">
      <svg className="cd-ring" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="45" className="cd-track" />
        <circle cx="50" cy="50" r="45" className="cd-progress" style={{ strokeDashoffset: 283 * (1 - progress) }} />
      </svg>
      <div className="cd-content">
        <div className="cd-label">{purpose === 'record' ? 'Recording in' : 'Screenshot in'}</div>
        <div key={left} className="cd-num tabular">{Math.max(1, left)}</div>
        <button className="cd-cancel" onClick={() => void window.dt.invoke('recording:cancelCountdown')}>
          Cancel <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Countdown />)
