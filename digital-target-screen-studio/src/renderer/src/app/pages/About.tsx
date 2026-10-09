import { ShieldCheck, Scale, Cpu } from 'lucide-react'
import { PRIVACY_STATEMENT } from '@shared/constants'
import { Badge, Card } from '../../components/ui'
import { useApp } from '../context'
import lockup from '../../assets/brand/logo-lockup-white.svg'

export function About() {
  const { info } = useApp()
  const year = new Date().getFullYear()
  return (
    <div className="stack">
      <section className="about-hero">
        <img src={lockup} alt="Digital Target" />
        <div>
          <h2>Digital Target Screen Studio</h2>
          <p className="muted" style={{ margin: '4px 0 10px', color: '#e6dcf5' }}>Professional screen recording and screenshots for Windows.</p>
          <div className="row">
            <Badge tone="accent">Version {info?.version ?? '…'}</Badge>
            <Badge>{info ? `${info.platform === 'win32' ? 'Windows' : info.platform} · ${info.arch}` : '…'}</Badge>
            <Badge tone="success">Works offline</Badge>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <Card title={<span className="row"><ShieldCheck size={16} /> Privacy</span>}>
          <p className="muted" style={{ margin: 0, userSelect: 'text' }}>{PRIVACY_STATEMENT}</p>
        </Card>
        <Card title={<span className="row"><Cpu size={16} /> Technical details</span>}>
          <dl className="spec-list">
            <dt>Application</dt><dd>{info?.version}</dd>
            <dt>Electron</dt><dd>{info?.electron}</dd>
            <dt>Chromium</dt><dd>{info?.chrome}</dd>
            <dt>Node.js</dt><dd>{info?.node}</dd>
            <dt>OS release</dt><dd>{info?.osRelease}{info?.windowsBuild ? ` (build ${info.windowsBuild})` : ''}</dd>
          </dl>
        </Card>
      </div>

      <Card title={<span className="row"><Scale size={16} /> Open-source acknowledgements</span>} subtitle="Digital Target Screen Studio is built with the following open-source software. Thank you to their authors.">
        <div className="stack">
          <p className="small muted" style={{ margin: 0, userSelect: 'text' }}>
            <strong>FFmpeg</strong> is used under the GNU Lesser General Public License v3 or later (LGPL build with no GPL or non-free components), run as a separate program.
            Its source code is available from ffmpeg.org and the build recipe from github.com/BtbN/FFmpeg-Builds. You may replace the bundled FFmpeg files in the
            installation&apos;s resources\ffmpeg folder with your own compatible build. <strong>Electron</strong> and <strong>Chromium</strong> are distributed under the
            MIT and BSD licenses; Chromium&apos;s full notices are in LICENSES.chromium.html in the installation folder. H.264 encoding uses the codecs provided by
            Windows, your graphics driver or Cisco OpenH264.
          </p>
          <div className="license-list">
            <table>
              <thead>
                <tr><th>Component</th><th>Version</th><th>License</th></tr>
              </thead>
              <tbody>
                {(info?.licenses ?? []).map((l) => (
                  <tr key={`${l.name}@${l.version}`}>
                    <td>{l.name}</td>
                    <td className="tabular muted">{l.version || (l.name === 'Chromium' ? info?.chrome : l.name === 'Node.js' ? info?.node : '')}</td>
                    <td>{l.license}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <p className="small muted" style={{ textAlign: 'center' }}>
        © {year} Digital Target. All rights reserved. Digital Target and the Digital Target logo are trademarks of Digital Target.
      </p>
    </div>
  )
}
