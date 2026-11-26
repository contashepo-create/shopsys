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
    // أُطلقت مصافحة إغلاق الابن من المنتقي قبل أن يطلب المحرر إغلاق نفسه.
    // يجب انتظار المصافحة الجارية لا اعتبارها رفضاً فورياً.
    call('windows:request-close', parent.webContents, 'child')
    const requests = child.webContents.sent.filter((x: any) => x.channel === 'windows:request-close')
    expect(requests).toHaveLength(2)
    call('windows:close-self', parent.webContents)
    call('windows:close-response', child.webContents, { token: requests[1].data.token, allow: true })
    await vi.waitFor(() => expect(parent.destroyed).toBe(true), { timeout: 1000 })
    expect(child.destroyed).toBe(true)
    expect(parent.webContents.sent.filter((x: any) => x.channel === 'windows:close-blocked')).toHaveLength(1)
  })
})

it.each(['refuse', 'timeout'] as const)('لا يغلق الأم قسراً إذا انتهت مصافحة الابن الجارية بـ %s', async mode => {
  vi.useFakeTimers()
  try {
    const { initSatelliteWindows } = await import('../desktop/satelliteWindows.ts')
    const main = { isDestroyed: () => false, webContents: { id: 1, isDestroyed: () => false, send: () => {} } }
    initSatelliteWindows({ getMainWindow: () => main as never, isDev: true, devStartUrl: 'http://example.test', indexFilePath: '', appIndexFileUrl: '', devOrigin: null, preloadPath: '', iconPath: '', log: () => {} })
    const open = fake.handles.get('windows:open')!, call = (name: string, sender: any, arg?: any) => fake.listeners.get(name)!({ sender }, arg)
    open({ sender: main.webContents }, { windowId: `parent-${mode}`, title: 'فاتورة' })
    const parent = fake.windows.at(-1)
    open({ sender: parent.webContents }, { windowId: `child-${mode}`, title: 'تحرير' })
    const child = fake.windows.at(-1)
    fake.handles.get('windows:claim')!({ sender: child.webContents }, new URL(child.url).searchParams.get('sat'))
    call('windows:renderer-ready', child.webContents, true)
    call('windows:set-dirty', child.webContents, true)
    call('windows:request-close', parent.webContents, `child-${mode}`)
    call('windows:close-self', parent.webContents)
    const first = child.webContents.sent.find((x: any) => x.channel === 'windows:request-close')
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(10_000)
    else { call('windows:close-response', child.webContents, { token: first.data.token, allow: false }); await vi.advanceTimersByTimeAsync(0) }
    expect(parent.destroyed).toBe(false)
    expect(child.destroyed).toBe(false)
    expect(parent.webContents.sent).toContainEqual({ channel: 'windows:close-blocked', data: { childTitle: 'تحرير' } })
    // تنظف النوافذ للاختبار التالي مع موافقة صحيحة من الابن نفسه.
    call('windows:close-self', parent.webContents)
    const last = child.webContents.sent.filter((x: any) => x.channel === 'windows:request-close').at(-1)
    call('windows:close-response', child.webContents, { token: last.data.token, allow: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(parent.destroyed).toBe(true)
    expect(child.destroyed).toBe(true)
  } finally { vi.useRealTimers() }
})
