/**
 * hostServerMain.ts — خادم شبكة المحل في العملية الرئيسية (§102).
 *
 * العملية الرئيسية وحدها تفتح منفذ استماع دائماً؛ منطق المضيف (LanHostCore)
 * يعيش في renderer المضيف فوق متجره — وهذه الوحدة جسر رسائل صرف:
 *
 *   ws connection  ──▶ ipc «lan-host:ws-open»    ──▶ renderer: hostCore.attach()
 *   ws message     ──▶ ipc «lan-host:ws-message» ──▶ renderer: hostCore.handle()
 *   ipc «lan-host:send» (من renderer)            ──▶ ws.send()
 *   ws close       ──▶ ipc «lan-host:ws-close»   ──▶ renderer: hostCore.detach()
 *
 * الشبكة محلية فقط: الإرسال يُحصر بعناوين الواجهات الداخلية، ولا يخرج أي
 * بيانات إلى الإنترنت (وثيقة §6).
 */
import { ipcMain, type BrowserWindow } from 'electron'
import os from 'node:os'
import { WebSocketServer, type WebSocket } from 'ws'

interface WsOpenEvent { connectionId: number }
interface WsMessageEvent { connectionId: number; msg: unknown }
interface WsCloseEvent { connectionId: number }

export interface LanHostServerStatus {
  running: boolean
  port: number | null
  /** عناوين الوصول من أجهزة المحل: ws://192.168.x.x:port */
  addresses: string[]
}

let server: WebSocketServer | null = null
const connections = new Map<number, WebSocket>()
let nextConnectionId = 1

/** عناوين IPv4 الداخلية للجهاز (شبكة المحل) — بلا loopback ولا عامّة. */
export function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue
      out.push(net.address)
    }
  }
  return out
}

function currentStatus(): LanHostServerStatus {
  const port = server ? (server.address() as { port: number }).port : null
  return {
    running: !!server,
    port,
    addresses: port == null ? [] : lanAddresses().map((ip) => `ws://${ip}:${port}`),
  }
}

function stopServer(): void {
  if (!server) return
  for (const ws of connections.values()) {
    try { ws.close() } catch { /* قناة مقفلة سلفاً */ }
  }
  connections.clear()
  try { server.close() } catch { /* لا شيء */ }
  server = null
}

/** تفعيل جسور ipc — يستدعى مرة عند إنشاء النافذة الرئيسية. */
export function initLanHostIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('lan-host:start', (_e, opts: { port: number }) => {
    stopServer()
    const win = getWindow()
    if (!win) return { running: false, port: null, addresses: [] } satisfies LanHostServerStatus
    server = new WebSocketServer({ host: '0.0.0.0', port: opts.port })
    server.on('connection', (ws: WebSocket) => {
      const id = nextConnectionId++
      connections.set(id, ws)
      win.webContents.send('lan-host:ws-open', { connectionId: id } satisfies WsOpenEvent)
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(String(data)) as unknown
          win.webContents.send('lan-host:ws-message', { connectionId: id, msg } satisfies WsMessageEvent)
        } catch {
          /* رسالة غير JSON — تُهمل (بروتوكول JSON فقط) */
        }
      })
      ws.on('close', () => {
        connections.delete(id)
        win.webContents.send('lan-host:ws-close', { connectionId: id } satisfies WsCloseEvent)
      })
      ws.on('error', () => {
        /* أخطاء المقبس تُعالج بclose إن لزم */
      })
    })
    return currentStatus()
  })

  ipcMain.handle('lan-host:stop', () => {
    stopServer()
    return currentStatus()
  })

  ipcMain.handle('lan-host:status', () => currentStatus())

  ipcMain.handle('lan-host:send', (_e, payload: { connectionId: number; msg: unknown }) => {
    const ws = connections.get(payload.connectionId)
    if (!ws) return false
    try {
      ws.send(JSON.stringify(payload.msg))
      return true
    } catch {
      return false
    }
  })
}
