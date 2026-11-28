/* Windows CI fixture: real Electron UI/preload and SQLite; IPC authorization and the invoice lock are test doubles. */
import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initSatelliteWindows } from '../../desktop/satelliteWindows.ts'
import { ShopsysDatabase, type SaveSnapshotInput } from '../../desktop/sqlite/storage.ts'

const [fixture, preload, icon, evidence] = process.argv.slice(2)
if (process.env.RUNNER_TEMP) writeFileSync(join(process.env.RUNNER_TEMP, 'purchase-smoke-startup.json'), JSON.stringify({ argv: process.argv, pid: process.pid }))
console.log('Purchase smoke main started:', JSON.stringify(process.argv))
let stage = 'startup'
const logs: string[] = []
function mark(next: string): void {
  stage = next
  if (process.env.RUNNER_TEMP) writeFileSync(join(process.env.RUNNER_TEMP, 'purchase-smoke-stage.json'), JSON.stringify({ stage, logs: logs.slice(-30) }))
}
async function bounded<T>(promise: Promise<T>, label: string, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeout) })]) }
  finally { if (timer) clearTimeout(timer) }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(100) }
  throw new Error(`Timed out: ${label}`)
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const execute = <T>(win: BrowserWindow, script: string): Promise<T> => bounded(win.webContents.executeJavaScript(script) as Promise<T>, 'renderer executeJavaScript', 45_000)

let holdInvoiceWrite = false, writingInvoice = false, releaseWrite: (() => void) | undefined
let lockOwner: number | null = null

async function run(): Promise<void> {
  check(fixture && preload && icon && evidence, 'Missing test arguments')
  app.setPath('userData', join(dirname(evidence), 'purchase-close-smoke-profile'))
  console.log('Purchase smoke waiting for Electron readiness')
  await app.whenReady()
  console.log('Purchase smoke Electron ready')
  ipcMain.on('device:identity', event => { event.returnValue = { deviceId: 'WIN-SMOKE', firstTrialAt: '2026-01-01T00:00:00.000Z' } })
  const dbPath = join(dirname(evidence), 'purchase-smoke.sqlite')
  const database = await ShopsysDatabase.open(dbPath)
  ipcMain.handle('database:getSnapshot', (_event, name: string) => { logs.push(`getSnapshot ${name}`); return database.getSnapshot(name) })
  ipcMain.handle('database:saveSnapshot', async (_event, input: SaveSnapshotInput) => {
    if (holdInvoiceWrite && input.storeName === 'shopsys-data' && (JSON.parse(input.payloadJson).state?.purchases?.length ?? 0) > 0) {
      writingInvoice = true
      await new Promise<void>(resolve => { releaseWrite = resolve })
      holdInvoiceWrite = false
    }
    return database.saveSnapshot(input)
  })
  ipcMain.handle('invoice-commit:acquire', event => { if (lockOwner !== null) return null; lockOwner = event.sender.id; return 'smoke-lock' })
  ipcMain.on('invoice-commit:release', (event, token) => { if (token === 'smoke-lock' && event.sender.id === lockOwner) lockOwner = null })

  const main = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } })
  initSatelliteWindows({ getMainWindow: () => main, isDev: false, devStartUrl: null, indexFilePath: fixture, appIndexFileUrl: pathToFileURL(fixture).href, devOrigin: null, preloadPath: preload, iconPath: icon, log: (tag, message) => logs.push(`${tag}: ${message}`) })
  main.webContents.on('console-message', (_event, _level, message) => { logs.push(`main renderer: ${message}`) })
  mark('load built fixture')
  await bounded(main.loadFile(fixture), 'main fixture load', 120_000)
  mark('seed real application stores')
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
  mark('load invoice renderer')
  await until(async () => {
    if (invoice!.isDestroyed()) throw new Error('Invoice unexpectedly closed during load')
    const result = await execute<{ ready: boolean; error?: string; hasInvoice: boolean; hasLine: boolean }>(invoice!, `({ready: !!window.__smokeReady, error: window.__smokeError, hasInvoice: !!document.querySelector('[data-satellite-view="purchase-invoice"] .invoice-pos-root'), hasLine: document.body.innerText.includes('صنف اختبار ويندوز')})`)
    if (result.error) throw new Error(result.error)
    return result.ready && result.hasInvoice && result.hasLine
  }, 'actual purchase editor with prefilled order', 90_000)
  mark('post and defer persistence acknowledgement')
  holdInvoiceWrite = true
  await execute(invoice, `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('حفظ وترحيل')); if (!button || button.disabled) throw new Error('Save button missing or disabled'); button.click() })()`)
  await until(() => writingInvoice, 'posted invoice snapshot write', 45_000)
  check(!invoice.isDestroyed(), 'Invoice closed before persistence was confirmed')
  check(lockOwner === invoice.webContents.id, 'Invoice commit lock not held during write')
  check(releaseWrite, 'Deferred write missing')
  mark('acknowledge and verify close')
  releaseWrite()
  await until(() => invoice!.isDestroyed(), 'purchase invoice window closed after save', 30_000)
  await until(() => lockOwner === null, 'commit lock released')
  check(database.integrityCheck().ok, 'SQLite integrity check failed')
  database.close()
  const reopened = await ShopsysDatabase.open(dbPath)
  const snapshot = reopened.getSnapshot('shopsys-data')
  check(snapshot.payloadJson, 'No saved data snapshot after reopening SQLite')
  const state = JSON.parse(snapshot.payloadJson).state
  check(state.purchases?.length === 1 && state.purchases[0].sourcePurchaseOrderId === orderId, 'Expected exactly one persisted purchase linked to order')
  check(state.purchases[0].lines?.[0]?.qty === 2 && state.items?.find((item: { id: number }) => item.id === 1)?.stockQty === 2, 'Purchase quantity or stock was not persisted')
  check(state.journal?.filter((entry: { sourceType: string; sourceId: number }) => entry.sourceType === 'purchase' && entry.sourceId === state.purchases[0].id).length === 1, 'Missing or duplicate purchase journal')
  check(reopened.integrityCheck().ok, 'Reopened SQLite integrity check failed')
  reopened.close()
  writeFileSync(evidence, JSON.stringify({ ok: true, platform: process.platform, electron: process.versions.electron, actualPurchaseUI: true, actualBrowserWindow: true, snapshotBackend: 'SQLite ShopsysDatabase', ipcAuthorization: 'test double', invoiceLock: 'test double', heldOpenUntilWriteAcknowledged: true, closedAfterPost: true, reopenedDatabase: true, purchases: 1 }, null, 2))
}
void run().then(() => app.exit(0)).catch(error => {
  if (evidence) writeFileSync(evidence, JSON.stringify({ ok: false, stage, error: error instanceof Error ? error.stack : String(error), logs: logs.slice(-30) }, null, 2))
  app.exit(1)
})
