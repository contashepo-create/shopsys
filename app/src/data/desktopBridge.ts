/**
 * عقد IPC اختياري للنسخة المكتبية.
 * المتصفح لا يستدعي localhost ولا يعرف Node؛ preload فقط يحقن هذا الجسر
 * عند التشغيل داخل Electron مع contextIsolation مفعلاً.
 */

export interface DesktopSnapshot {
  storeName: string
  revision: number
  payloadJson: string | null
  updatedAt: string | null
}

export interface DesktopDatabaseBridge {
  getSnapshot(storeName: string): Promise<DesktopSnapshot>
  saveSnapshot(input: { storeName: string; expectedRevision: number; payloadJson: string }): Promise<{ revision: number; updatedAt: string }>
  deleteSnapshot?(input: { storeName: string; expectedRevision: number }): Promise<{ revision: number; updatedAt: string }>
  integrityCheck(): Promise<{ ok: boolean; message: string }>
  schemaVersion(): Promise<number>
}

export interface ShopsysDesktopBridge {
  runtime: 'electron'
  database: DesktopDatabaseBridge
}

declare global {
  interface Window {
    shopsysDesktop?: ShopsysDesktopBridge
  }
}

export function desktopBridge(): ShopsysDesktopBridge | null {
  return typeof window !== 'undefined' ? window.shopsysDesktop ?? null : null
}

export function isElectronRuntime(): boolean {
  return desktopBridge()?.runtime === 'electron'
}

export function requireDesktopDatabase(): DesktopDatabaseBridge {
  const bridge = desktopBridge()
  if (!bridge) throw new Error('قاعدة SQLite متاحة فقط داخل نسخة سطح المكتب')
  return bridge.database
}
