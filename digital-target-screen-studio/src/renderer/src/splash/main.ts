import '../styles/base.css'
import './splash.css'
import lockup from '../assets/brand/logo-lockup-white.svg'

const root = document.getElementById('root')!
root.innerHTML = `
  <div class="splash" role="status" aria-live="polite">
    <img class="splash-logo" src="${lockup}" alt="Digital Target" />
    <div class="splash-product">Screen Studio</div>
    <div class="splash-bar"><span></span></div>
    <div class="splash-meta" id="meta">Starting…</div>
  </div>`

void window.dt.invoke('app:info').then((info) => {
  const meta = document.getElementById('meta')
  if (meta) meta.textContent = `Version ${info.version} · Loading capture engine…`
})
