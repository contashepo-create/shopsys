// فحص قناة التحديث المنشورة بHTTP/ملفات حقيقية؛ AppAdapter يحدد نسخة العميل عبر PUBLIC_UPDATE_FROM_VERSION (افتراض 1.0.23).
// لا يحاكي الشبكة أو الحفظ، ولا يشغّل مثبتاً أو يقرأ بيانات المالك.
const { app } = require('electron')
const { mkdirSync, readFileSync, writeFileSync, statSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { join, resolve } = require('node:path')
const { NsisUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows' || !process.env.RUNNER_TEMP) {
  throw new Error('Only an isolated GitHub Windows runner may run the public updater probe')
}
const [expectedVersion, output] = process.argv.slice(2)
const fromVersion = process.env.PUBLIC_UPDATE_FROM_VERSION || '1.0.23'
const semver = require('semver')
if (!semver.valid(expectedVersion) || !semver.valid(fromVersion) || !semver.gt(expectedVersion, fromVersion)) {
  throw new Error(`Expected a published version newer than probe baseline ${fromVersion}`)
}
const profile = join(process.env.RUNNER_TEMP, 'public-update-readback-profile')
mkdirSync(profile, { recursive: true })
app.setName('Tahakom-CI-Public-Readback')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
// أثبت مسار العميل العام دون الاعتماد على أي توكن نشر/CI.
delete process.env.GH_TOKEN
delete process.env.GITHUB_TOKEN

const finish = (result, code) => {
  writeFileSync(output, JSON.stringify(result, null, 2))
  app.exit(code)
}
const timer = setTimeout(() => finish({ ok: false, error: 'Public updater check/download timed out', installAttempted: false }, 1), 300000)
app.whenReady().then(async () => {
  try {
    const updater = new NsisUpdater(null, {
      version: fromVersion, name: 'Tahakom', isPackaged: true,
      userDataPath: profile, baseCachePath: join(profile, 'cache'),
      appUpdateConfigPath: resolve('release/win-unpacked/resources/app-update.yml'),
      whenReady: () => app.whenReady(),
      onQuit: () => {},
      quit: () => { throw new Error('Probe must not quit for installation') },
      relaunch: () => { throw new Error('Probe must not relaunch') },
    })
    // AppAdapter metadata injection disables the executor in the library constructor;
    // restore the actual Electron native HTTP executor, not a mock or custom downloader.
    updater.httpExecutor = new ElectronHttpExecutor((_authInfo, callback) => callback())
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.disableDifferentialDownload = true
    updater.setFeedURL({ provider: 'github', owner: 'contashepo-create', repo: 'tahakam-releases', private: false })
    let downloaded = false
    updater.on('update-downloaded', () => { downloaded = true })
    const found = await updater.checkForUpdates()
    if (!found || found.updateInfo.version !== expectedVersion) throw new Error('Public provider did not detect the expected published update')
    const paths = await updater.downloadUpdate()
    if (!downloaded || paths.length !== 1) throw new Error('Updater did not complete the installer download')
    const file = paths[0], expected = found.updateInfo.files?.[0]
    const digest = createHash('sha512').update(readFileSync(file)).digest('base64')
    const size = statSync(file).size
    if (!size || size !== expected?.size || digest !== expected?.sha512) throw new Error('Downloaded installer does not match the public manifest size/SHA512')
    clearTimeout(timer)
    finish({ ok: true, fromVersion, detectedVersion: expectedVersion, executor: 'ElectronHttpExecutor', authenticated: false, downloadedInstaller: file, size, sha512: digest, installAttempted: false, oldBinaryExecuted: false }, 0)
  } catch (error) {
    clearTimeout(timer)
    finish({ ok: false, error: error.stack || error.message, installAttempted: false }, 1)
  }
})
