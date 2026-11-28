/* Windows CI: real Electron + actual React invoice/satellite; IPC snapshots are an isolated in-memory test double, not SQLite. */
import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { initSatelliteWindows } from '../../desktop/satelliteWindows.ts'

const [port, preload, icon, evidence] = process.argv.slice(2)
const url = `http://127.0.0.1:${port}/tests/windows/purchase_close_fixture.html`
if (process.env.RUNNER_TEMP) writeFileSync(join(process.env.RUNNER_TEMP, 'purchase-smoke-startup.json'), JSON.stringify({ argv: process.argv, pid: process.pid }))
console.log('Purchase smoke main started:', JSON.stringify(process.argv))
let stage = 'startup'
const logs: string[] = []
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(100) }
  throw new Error(`Timed out: ${label}`)
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const execute = <T>(win: BrowserWindow, script: string): Promise<T> => win.webContents.executeJavaScript(script) as Promise<T>

type Snapshot = { storeName: string; revision: number; payloadJson: string | null; updatedAt: string | null }
type Save = { storeName: string; expectedRevision: number; payloadJson: string }
const snapshots = new Map<string, Snapshot>()
let holdInvoiceWrite = false, writingInvoice = false, releaseWrite: (() => void) | undefined
let lockOwner: number | null = null

async function run(): Promise<void> {
  check(port && preload && icon && evidence, 'Missing test arguments')
  app.setPath('userData', join(dirname(evidence), 'purchase-close-smoke-profile'))
  console.log('Purchase smoke waiting for Electron readiness')
  await app.whenReady()
  console.log('Purchase smoke Electron ready')
  ipcMain.handle('database:getSnapshot', (_event, name: string) => snapshots.get(name) ?? { storeName: name, revision: 0, payloadJson: null, updatedAt: null })
  ipcMain.handle('database:saveSnapshot', async (_event, input: Save) => {
    const current = snapshots.get(input.storeName) ?? { storeName: input.storeName, revision: 0, payloadJson: null, updatedAt: null }
    if (input.expectedRevision !== current.revision) throw new Error('revision conflict')
    if (holdInvoiceWrite && input.storeName === 'shopsys-data' && (JSON.parse(input.payloadJson).state?.purchases?.length ?? 0) > 0) {
      writingInvoice = true
      await new Promise<void>(resolve => { releaseWrite = resolve })
      holdInvoiceWrite = false
    }
    const next = { storeName: input.storeName, revision: current.revision + 1, payloadJson: input.payloadJson, updatedAt: new Date().toISOString() }
    snapshots.set(input.storeName, next)
    return { revision: next.revision, updatedAt: next.updatedAt }
  })
  ipcMain.handle('invoice-commit:acquire', event => { if (lockOwner !== null) return null; lockOwner = event.sender.id; return 'smoke-lock' })
  ipcMain.on('invoice-commit:release', (event, token) => { if (token === 'smoke-lock' && event.sender.id === lockOwner) lockOwner = null })

  const main = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } })
  const origin = new URL(url).origin
  initSatelliteWindows({ getMainWindow: () => main, isDev: true, devStartUrl: url, indexFilePath: '', appIndexFileUrl: '', devOrigin: origin, preloadPath: preload, iconPath: icon, log: (tag, message) => logs.push(`${tag}: ${message}`) })
  stage = 'seed real application stores'
  await main.loadURL(url)
  await until(async () => {
    const status = await execute<{ ready: boolean; error?: string }>(main, '({ready: !!window.__smokeReady, error: window.__smokeError})')
    if (status.error) throw new Error(status.error)
    return status.ready
  }, 'fixture setup', 90_000)
  const orderId = await execute<number>(main, 'window.__orderId')
  check(orderId, 'Missing purchase order')
  const initialIds = new Set(BrowserWindow.getAllWindows().map(win => win.id))
  const open = await execute<{ ok: boolean }>(main, `window.shopsysDesktop.windows.open(${JSON.stringify({ windowId: 'purchase-close-smoke', kind: 'purchase-invoice', title: 'Purchase smoke', props: { prefill: { purchaseOrderId: orderId } } })})`)
  check(open.ok, 'Cannot open real purchase satellite')
  let invoice: BrowserWindow | undefined
  await until(() => { invoice = BrowserWindow.getAllWindows().find(win => !initialIds.has(win.id)); return !!invoice }, 'invoice BrowserWindow')
  check(invoice, 'Missing invoice window')
  invoice.webContents.on('console-message', (_event, _level, message) => logs.push(`renderer: ${message}`))
  stage = 'load invoice renderer'
  await until(async () => {
    if (invoice!.isDestroyed()) throw new Error('Invoice unexpectedly closed during load')
    const result = await execute<{ ready: boolean; error?: string; hasInvoice: boolean; hasLine: boolean }>(invoice!, `({ready: !!window.__smokeReady, error: window.__smokeError, hasInvoice: !!document.querySelector('[data-satellite-view="purchase-invoice"] .invoice-pos-root'), hasLine: document.body.innerText.includes('صنف اختبار ويندوز')})`)
    if (result.error) throw new Error(result.error)
    return result.ready && result.hasInvoice && result.hasLine
  }, 'actual purchase editor with prefilled order', 90_000)
  stage = 'post and defer persistence acknowledgement'
  holdInvoiceWrite = true
  await execute(invoice, `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('حفظ وترحيل')); if (!button || button.disabled) throw new Error('Save button missing or disabled'); button.click() })()`)
  await until(() => writingInvoice, 'posted invoice snapshot write', 45_000)
  check(!invoice.isDestroyed(), 'Invoice closed before persistence was confirmed')
  check(lockOwner === invoice.webContents.id, 'Invoice commit lock not held during write')
  check(releaseWrite, 'Deferred write missing')
  stage = 'acknowledge and verify close'
  releaseWrite()
  await until(() => invoice!.isDestroyed(), 'purchase invoice window closed after save', 30_000)
  await until(() => lockOwner === null, 'commit lock released')
  const snapshot = snapshots.get('shopsys-data')
  check(snapshot?.payloadJson, 'No saved data snapshot')
  const state = JSON.parse(snapshot.payloadJson).state
  check(state.purchases?.length === 1 && state.purchases[0].sourcePurchaseOrderId === orderId, 'Expected exactly one persisted purchase linked to order')
  check(state.journal?.filter((entry: { sourceType: string; sourceId: number }) => entry.sourceType === 'purchase' && entry.sourceId === state.purchases[0].id).length === 1, 'Missing or duplicate purchase journal')
  writeFileSync(evidence, JSON.stringify({ ok: true, platform: process.platform, electron: process.versions.electron, actualPurchaseUI: true, actualBrowserWindow: true, snapshotBackend: 'in-memory test double', heldOpenUntilWriteAcknowledged: true, closedAfterPost: true, purchases: 1 }, null, 2))
}
void run().then(() => app.exit(0)).catch(error => {
  if (evidence) writeFileSync(evidence, JSON.stringify({ ok: false, stage, error: error instanceof Error ? error.stack : String(error), logs: logs.slice(-30) }, null, 2))
  app.exit(1)
})
