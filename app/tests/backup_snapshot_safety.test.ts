import { describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { readBackupSnapshot } from '../src/data/backupSnapshot.ts'

function fixture() {
  let listener: ((next: unknown, previous: unknown) => void) | null = null
  let generation = 1, sealed = false
  const unsubscribe = vi.fn(() => { listener = null })
  const settings: StateStorage = { getItem: vi.fn(async () => '{"state":{"fiscalYears":[]}}'), setItem: vi.fn(), removeItem: vi.fn() }
  const data: StateStorage = { getItem: vi.fn(async () => '{"state":{"journal":[]}}'), setItem: vi.fn(), removeItem: vi.fn() }
  const options = { settings, data, flush: vi.fn<() => Promise<void>>(async () => {}), generation: () => generation, sealed: () => sealed, subscribe: (fn: (next: unknown, previous: unknown) => void) => { listener = fn; return unsubscribe } }
  return { options, settings, data, unsubscribe, notify: (next: unknown, prev: unknown) => listener?.(next, prev), setGeneration: (value: number) => { generation = value }, setSealed: (value: boolean) => { sealed = value } }
}

describe('قراءة متحفظة لمخزني نسخة JSON', () => {
  it('تصرّف أولاً وتقرأ المخزنين مرتين وتزيل المراقبة', async () => {
    const f = fixture(), result = await readBackupSnapshot(f.options)
    expect(result).toEqual({ appRaw: '{"state":{"fiscalYears":[]}}', storeRaw: '{"state":{"journal":[]}}' })
    expect(f.options.flush).toHaveBeenCalledOnce(); expect(f.settings.getItem).toHaveBeenCalledTimes(2); expect(f.data.getItem).toHaveBeenCalledTimes(2); expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it('ترفض فشل تصريف الحفظ السابق قبل القراءة وتزيل المراقبة', async () => {
    const f = fixture(); f.options.flush.mockRejectedValueOnce(new Error('save failed'))
    await expect(readBackupSnapshot(f.options)).rejects.toThrow('save failed')
    expect(f.settings.getItem).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it('ترفض تغير الحالة أثناء الانتظار حتى إذا رجعت', async () => {
    const f = fixture(); let release!: () => void
    f.options.flush.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const promise = readBackupSnapshot(f.options)
    f.notify({ v: 2 }, { v: 1 }); f.notify({ v: 1 }, { v: 2 }); release()
    await expect(promise).rejects.toThrow('تغيرت البيانات أو الإعدادات'); expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it('ترفض تغير السر أثناء قراءة البيانات حتى إن لم يعد التخزين مختوماً', async () => {
    const f = fixture(); let release!: (value: string) => void
    vi.mocked(f.data.getItem).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const promise = readBackupSnapshot(f.options)
    await vi.waitFor(() => expect(f.data.getItem).toHaveBeenCalledOnce())
    f.setGeneration(2); release('{}')
    await expect(promise).rejects.toThrow('تغير مفتاح التخزين'); expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it('ترفض الختم قبل القراءة', async () => {
    const f = fixture(); f.setSealed(true)
    await expect(readBackupSnapshot(f.options)).rejects.toThrow('خُتم'); expect(f.options.flush).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it.each(['settings', 'data'] as const)('ترفض اختلاف قراءة %s الثانية دون إشعار محلي', async name => {
    const f = fixture(); vi.mocked(f[name].getItem).mockResolvedValueOnce('{"state":{}}').mockResolvedValueOnce('{"state":{"x":1}}')
    await expect(readBackupSnapshot(f.options)).rejects.toThrow('تغير التخزين أثناء أخذ النسخة'); expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it('ترفض بيانات غير قابلة للقراءة وتسمح بالإعدادات الغائبة لنسخة إنقاذ غير مكتملة', async () => {
    const f = fixture(); vi.mocked(f.data.getItem).mockResolvedValue(null)
    await expect(readBackupSnapshot(f.options)).rejects.toThrow('لا بيانات محلية قابلة للقراءة')
    const rescue = fixture(); vi.mocked(rescue.settings.getItem).mockResolvedValue(null)
    expect((await readBackupSnapshot(rescue.options)).appRaw).toBeNull()
  })
  it('ترفض عدم قابلية تسلسل تغيير الحالة بدلاً من تجاهله', async () => {
    const f = fixture(); let release!: () => void
    f.options.flush.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const promise = readBackupSnapshot(f.options)
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic
    f.notify(cyclic, {}); release()
    await expect(promise).rejects.toThrow('تغيرت البيانات أو الإعدادات')
  })
})
