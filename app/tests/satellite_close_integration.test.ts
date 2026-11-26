import { describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ handles: new Map<string, (...args: any[]) => any>(), listeners: new Map<string, (...args: any[]) => any>(), windows: [] as any[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Contents extends EventEmitter {
    id: number
    sent: { channel: string; data: any }[] = []
    constructor(id: number) { super(); this.id = id }
    isDestroyed() { return false }
    setWindowOpenHandler() {}
    send(channel: string, data: any) { this.sent.push({ channel, data }) }
  }
  class Window extends EventEmitter {
    webContents = new Contents(fake.windows.length + 2)
    destroyed = false
    url = ''
    constructor() { super(); fake.windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    show() {}
    focus() {}
    loadURL(url: string) { this.url = url; return Promise.resolve() }
    close() { const event = { prevented: false, preventDefault() { this.prevented = true } }; this.emit('close', event); if (!event.prevented) { this.destroyed = true; this.emit('closed') } }
  }
  return { BrowserWindow: Window, ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => fake.handles.set(name, fn), on: (name: string, fn: (...args: any[]) => any) => fake.listeners.set(name, fn) }, dialog: {}, shell: {} }
})

describe('سلسلة إغلاق الأقمار بمحاكاة عملية Electron الرئيسية', () => {
  it('يحافظ على الابن المعترض وينبّه الأب، ثم يغلقهما عند الموافقة', async () => {
    const { initSatelliteWindows } = await import('../desktop/satelliteWindows.ts')
    const main = { isDestroyed: () => false, webContents: { id: 1, isDestroyed: () => false, send: () => {} } }
    initSatelliteWindows({ getMainWindow: () => main as never, isDev: true, devStartUrl: 'http://example.test', indexFilePath: '', appIndexFileUrl: '', devOrigin: null, preloadPath: '', iconPath: '', log: () => {} })
    const open = fake.handles.get('windows:open')!, call = (name: string, sender: any, arg?: any) => fake.listeners.get(name)!({ sender }, arg)
    open({ sender: main.webContents }, { windowId: 'parent', kind: 'purchase-invoice', title: 'فاتورة' })
    const parent = fake.windows[0]
    open({ sender: parent.webContents }, { windowId: 'child', title: 'محرر صنف' })
    const child = fake.windows[1]
    const token = new URL(child.url).searchParams.get('sat')
    expect(fake.handles.get('windows:claim')!({ sender: child.webContents }, token)).toBeTruthy()
    call('windows:renderer-ready', child.webContents, true)
    call('windows:set-dirty', child.webContents, true)
    call('windows:close-self', parent.webContents)
    const first = child.webContents.sent.find((x: any) => x.channel === 'windows:request-close')
    expect(first).toBeTruthy()
    call('windows:close-response', child.webContents, { token: first.data.token, allow: false })
    await vi.waitFor(() => expect(parent.webContents.sent).toContainEqual({ channel: 'windows:close-blocked', data: { childTitle: 'محرر صنف' } }))
    expect(parent.destroyed).toBe(false)
    expect(child.destroyed).toBe(false)
    call('windows:close-self', parent.webContents)
    const requests = child.webContents.sent.filter((x: any) => x.channel === 'windows:request-close')
    call('windows:close-response', child.webContents, { token: requests[1].data.token, allow: true })
    await vi.waitFor(() => expect(parent.destroyed).toBe(true))
    expect(child.destroyed).toBe(true)
  })
})
