import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [fixture, preload, evidence] = process.argv.slice(2)
const events: string[] = []
let finished = false
function finish(ok: boolean, error?: string) {
  if (finished) return
  finished = true
  writeFileSync(evidence, JSON.stringify({ ok, error, events }, null, 2))
  app.exit(ok ? 0 : 1)
}
void app.whenReady().then(() => {
  app.setPath('userData', join(dirname(evidence), 'purchase-diagnostic-profile'))
  // The actual preload exposes a synchronous identity request. An unhandled
  // sendSync blocks the renderer forever, before any snapshot request occurs.
  ipcMain.on('device:identity', event => {
    events.push('device identity request')
    event.returnValue = { deviceId: 'WIN-DIAGNOSTIC', firstTrialAt: '2026-01-01T00:00:00.000Z' }
  })
  ipcMain.handle('database:getSnapshot', (_event, storeName: string) => {
    events.push(`snapshot request: ${storeName}`)
    return { storeName, revision: 0, payloadJson: null, updatedAt: null }
  })
  const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } })
  window.webContents.on('console-message', (_event, _level, message) => {
    events.push(message)
    if (message.includes('DIAGNOSTIC: completed')) finish(true)
    else if (message.includes('DIAGNOSTIC: error')) finish(false, message)
  })
  window.webContents.on('render-process-gone', (_event, details) => finish(false, `renderer gone: ${JSON.stringify(details)}`))
  setTimeout(() => finish(false, 'Timed out waiting for module initialization'), 60000)
  void window.loadFile(fixture).catch(error => finish(false, String(error)))
}).catch(error => finish(false, String(error)))
