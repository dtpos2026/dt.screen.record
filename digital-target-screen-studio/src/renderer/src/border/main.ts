import '../styles/base.css'

// Purely visual frame drawn just outside the recorded region. The window is
// click-through and excluded from capture where Windows supports it.
document.body.style.background = 'transparent'
const root = document.getElementById('root')!
root.innerHTML = `<div style="position:absolute;inset:0;border:2px solid #ff3b5c;border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,.35), inset 0 0 0 1px rgba(0,0,0,.35);"></div>
<div style="position:absolute;top:-1px;left:-1px;width:14px;height:14px;border-top:4px solid #e0aaff;border-left:4px solid #e0aaff;border-radius:4px 0 0 0"></div>
<div style="position:absolute;top:-1px;right:-1px;width:14px;height:14px;border-top:4px solid #e0aaff;border-right:4px solid #e0aaff;border-radius:0 4px 0 0"></div>
<div style="position:absolute;bottom:-1px;left:-1px;width:14px;height:14px;border-bottom:4px solid #e0aaff;border-left:4px solid #e0aaff;border-radius:0 0 0 4px"></div>
<div style="position:absolute;bottom:-1px;right:-1px;width:14px;height:14px;border-bottom:4px solid #e0aaff;border-right:4px solid #e0aaff;border-radius:0 0 4px 0"></div>`
