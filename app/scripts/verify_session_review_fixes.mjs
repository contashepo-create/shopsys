/** Regression checks for issues found in the 2026-10 session audit. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const trips = read('../src/ui/pages/TripsPage.tsx')
const tripPrint = trips.slice(trips.indexOf('const buildNow ='), trips.indexOf('const [tab, setTab]'))
assert.equal((tripPrint.match(/printModelWithTemplate\(/g) ?? []).length, 1, 'trip printing has one unified preview/print entry point')
assert.equal((tripPrint.match(/openPrintPreview\(/g) ?? []).length, 0, 'trip printing does not open a duplicate preview')
const pos = read('../src/ui/pages/PosPage.tsx')
assert.match(pos, /printModelWithTemplate\(model, cur, documentSettings\.receipt, posTemplate/)
assert.doesNotMatch(pos, /printHtml\(/, 'POS must not bypass preview / silent-print policy')
const close = read('../desktop/satelliteWindows.ts')
assert.match(close, /resolve\(false\)/, 'close handshake timeout must cancel')
assert.doesNotMatch(close, /انتهت مهلة مصافحة إغلاق[^\n]*إغلاق قسري/)
const satellite = read('../src/ui/windows/satellite.tsx')
assert.match(satellite, /hasUnsavedChangesInCurrentWindow/)
assert.match(satellite, /catch \(error\)/, 'failed save cannot approve close')
const ui = read('../src/ui/components/unsavedChangeRegistry.ts')
assert.match(ui, /export function hasUnsavedChangesInCurrentWindow/)
assert.match(ui, /dirtyChangeGuards\.add/)

const main = read('../desktop/main.ts')
const installHandler = main.slice(main.indexOf("ipcMain.handle('updater:install'"), main.indexOf("ipcMain.handle('app:info'"))
assert.match(installHandler, /requireAuthorizedWebContents\(event\.sender\.id\)/, 'update IPC requires an authenticated renderer')
assert.ok(installHandler.indexOf('confirmAndCloseAllSatellites') < installHandler.indexOf('shutdownApplication(true)'), 'manual update closes/prompts every satellite before shutdown')
for (const channel of ['database:saveSnapshot', 'database:deleteSnapshot', 'database:enqueueOutbox', 'database:claimOutbox', 'database:completeOutbox', 'database:integrityCheck', 'database:schemaVersion', 'database:exportCopy', 'database:getStorageInfo', 'database:listFileBackups', 'database:restoreFileBackup', 'database:chooseDbLocation', 'database:chooseSecondaryBackupDir', 'app:backupNow', 'support:tokenGet', 'support:tokenSet']) {
  const start = main.indexOf(`ipcMain.handle('${channel}'`)
  assert.ok(start >= 0, `missing ${channel}`)
  assert.match(main.slice(start, start + 300), /requireAuthorizedWebContents\(event\.sender\.id\)/, `${channel} requires an authenticated renderer`)
}
for (const page of ['SaleReturnsPage.tsx', 'PurchaseReturnsPage.tsx']) {
  const source = read(`../src/ui/pages/${page}`)
  assert.match(source, /withInvoiceCommitLock\(async \(\) => \{ await useRawDataStore\.persist\.rehydrate\(\) \}/, `${page} serializes and refreshes before posting`)
  assert.match(source, /\.then\(\(ret\) => \{\s*toast\.show/, `${page} reports success only after durable commit`)
}
console.log('verify_session_review_fixes PASS=32')
