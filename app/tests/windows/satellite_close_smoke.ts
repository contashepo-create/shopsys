/* Windows CI smoke: real Electron BrowserWindow, real preload and IPC, no store/installer publication. */
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initSatelliteWindows } from '../../desktop/satelliteWindows.ts'

const [fixture, preload, icon, evidence] = process.argv.slice(2)
let stage = 'startup'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const execute = <T>(window: BrowserWindow, script: string): Promise<T> => window.webContents.executeJavaScript(script) as Promise<T>
async function loaded(window: BrowserWindow): Promise<void> {
  await until(() => !window.isDestroyed() && !window.webContents.isLoading() && window.webContents.getURL().startsWith('file:'), 'renderer load')
}
async function openChild(owner: BrowserWindow, id: string, title: string): Promise<BrowserWindow> {
  const oldIds = new Set(BrowserWindow.getAllWindows().map(window => window.id))
  const result = await execute<{ ok: boolean }>(owner, `window.shopsysDesktop.windows.open(${JSON.stringify({ windowId: id, kind: 'purchase-invoice', title })})`)
  check(result.ok, `IPC open failed for ${id}`)
  let child: BrowserWindow | undefined
  await until(() => { child = BrowserWindow.getAllWindows().find(window => !oldIds.has(window.id)); return !!child }, `BrowserWindow ${id}`)
  check(child, `Missing window ${id}`)
  await loaded(child)
  const descriptor = await execute<{ windowId: string } | null>(child, "window.shopsysDesktop.windows.claim(new URL(location.href).searchParams.get('sat'))")
  check(descriptor?.windowId === id, `Claim failed for ${id}`)
  await execute(child, `(() => {
    window.__requests = []; window.__blocked = [];
    window.shopsysDesktop.windows.onRequestClose(e => window.__requests.push(e.token));
    window.shopsysDesktop.windows.onCloseBlocked(e => window.__blocked.push(e.childTitle));
    window.shopsysDesktop.windows.setRendererReady(true);
    window.shopsysDesktop.windows.setDirty(true);
  })()`)
  return child
}
async function pair(main: BrowserWindow, name: string): Promise<{ parent: BrowserWindow; child: BrowserWindow }> {
  const parent = await openChild(main, `parent-${name}`, `Invoice ${name}`)
  const child = await openChild(parent, `child-${name}`, `Editor ${name}`)
  return { parent, child }
}
async function requestCount(window: BrowserWindow): Promise<number> { return execute<number>(window, 'window.__requests.length') }
async function reply(window: BrowserWindow, index: number, allow: boolean): Promise<void> {
  await execute(window, `window.shopsysDesktop.windows.respondClose(window.__requests[${index}], ${allow})`)
}
async function run(): Promise<void> {
  check(fixture && preload && icon && evidence, 'Missing smoke paths')
  app.setPath('userData', join(dirname(evidence), 'satellite-smoke-profile'))
  await app.whenReady()
  const main = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await main.loadFile(fixture)
  initSatelliteWindows({ getMainWindow: () => main, isDev: false, devStartUrl: null, indexFilePath: fixture, appIndexFileUrl: pathToFileURL(fixture).href, devOrigin: null, preloadPath: preload, iconPath: icon, log: () => {} })

  stage = 'concurrent accept'
  const accepted = await pair(main, 'allow')
  await execute(accepted.parent, "window.shopsysDesktop.windows.requestClose('child-allow')")
  await until(async () => (await requestCount(accepted.child)) === 1, 'first child close request')
  await execute(accepted.parent, 'window.shopsysDesktop.windows.closeSelf()')
  await execute(accepted.parent, 'window.shopsysDesktop.windows.list()') // IPC ordering barrier from parent
  await sleep(200)
  check(!accepted.parent.isDestroyed() && !accepted.child.isDestroyed(), 'Windows closed before child decision')
  check(await execute<number>(accepted.parent, 'window.__blocked.length') === 0, 'Concurrent close was incorrectly treated as a refusal')
  await reply(accepted.child, 0, true)
  await until(() => accepted.parent.isDestroyed() && accepted.child.isDestroyed(), 'actual accepted window destruction')

  stage = 'concurrent refusal'
  const refused = await pair(main, 'refuse')
  await execute(refused.parent, "window.shopsysDesktop.windows.requestClose('child-refuse')")
  await until(async () => (await requestCount(refused.child)) === 1, 'refusal child close request')
  await execute(refused.parent, 'window.shopsysDesktop.windows.closeSelf()')
  await execute(refused.parent, 'window.shopsysDesktop.windows.list()')
  await reply(refused.child, 0, false)
  await until(async () => !refused.parent.isDestroyed() && (await execute<number>(refused.parent, 'window.__blocked.length')) === 1, 'blocked notification')
  check(!refused.child.isDestroyed(), 'Refused dirty child was closed')
  await execute(refused.parent, 'window.shopsysDesktop.windows.closeSelf()')
  await until(async () => (await requestCount(refused.child)) === 2, 'second child close request')
  await reply(refused.child, 1, true)
  await until(() => refused.parent.isDestroyed() && refused.child.isDestroyed(), 'cleanup window destruction')
  writeFileSync(evidence, JSON.stringify({ ok: true, electron: process.versions.electron, platform: process.platform, actualBrowserWindows: true, concurrentAccepted: true, concurrentRefusalPreserved: true }, null, 2))
}

void run().then(() => app.exit(0)).catch(error => {
  if (evidence) writeFileSync(evidence, JSON.stringify({ ok: false, stage, error: error instanceof Error ? error.stack : String(error) }, null, 2))
  app.exit(1)
})
