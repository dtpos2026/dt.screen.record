/**
 * electron-builder afterPack hook: brands the Windows executable (icon,
 * version info, company name) using `resedit`, a pure-JavaScript PE editor,
 * so Windows builds can be produced on Linux/macOS without Wine.
 */
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const ResEdit = await import('resedit')
  const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit.default ?? ResEdit
  const appInfo = context.packager.appInfo
  const exePath = join(context.appOutDir, `${appInfo.productFilename}.exe`)
  const exe = NtExecutable.from(readFileSync(exePath), { ignoreCert: true })
  const res = NtExecutableResource.from(exe)

  const iconFile = Data.IconFile.from(readFileSync(join(context.packager.info.projectDir, 'build', 'icon.ico')))
  const groups = Resource.IconGroupEntry.fromEntries(res.entries)
  const groupId = groups.length ? groups[0].id : 1
  const lang = groups.length ? groups[0].lang : 1033
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data))

  const versions = Resource.VersionInfo.fromEntries(res.entries)
  const vi = versions[0] ?? Resource.VersionInfo.createEmpty()
  const [major, minor, patch] = appInfo.version.split('.').map((n) => parseInt(n, 10) || 0)
  vi.setFileVersion(major, minor, patch, 0, 1033)
  vi.setProductVersion(major, minor, patch, 0, 1033)
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      CompanyName: 'Digital Target',
      FileDescription: 'Digital Target Screen Studio',
      ProductName: 'Digital Target Screen Studio',
      InternalName: 'DigitalTargetScreenStudio',
      OriginalFilename: `${appInfo.productFilename}.exe`,
      LegalCopyright: 'Copyright © 2026 Digital Target',
      LegalTrademarks: 'Digital Target',
      FileVersion: appInfo.version,
      ProductVersion: appInfo.version
    }
  )
  vi.outputToResourceEntries(res.entries)
  res.outputResource(exe)
  writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`  • branded ${appInfo.productFilename}.exe (icon + version info)`)
}
