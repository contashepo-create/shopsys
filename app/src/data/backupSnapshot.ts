import type { StateStorage } from 'zustand/middleware'

type PairOptions = {
  settings: StateStorage
  data: StateStorage
  flush: () => Promise<void>
  generation: () => number
  sealed: () => boolean
  subscribe: (onChange: (next: unknown, previous: unknown) => void) => () => void
}

/**
 * قراءة محافظة لنسخة JSON في السياق الحالي، وليست لقطة ذرية بين المخزنين.
 * تصريف الكتابات والكشف عن التغييرات لا يقفل النوافذ أو الأجهزة الأخرى.
 */
export async function readBackupSnapshot(options: PairOptions): Promise<{ appRaw: string | null; storeRaw: string }> {
  const initialGeneration = options.generation()
  let changed = false
  const unsubscribe = options.subscribe((next, previous) => {
    try {
      if (JSON.stringify(next) !== JSON.stringify(previous)) changed = true
    } catch { changed = true }
  })
  const assertStable = () => {
    if (options.sealed() || options.generation() !== initialGeneration) throw new Error('تغير مفتاح التخزين أو خُتم أثناء أخذ النسخة — أعد تشغيل التطبيق وراجع البيانات')
    if (changed) throw new Error('تغيرت البيانات أو الإعدادات أثناء أخذ النسخة — أعد المحاولة بعد اكتمال الحفظ')
  }
  try {
    assertStable()
    await options.flush()
    assertStable()
    const appRaw = await options.settings.getItem('shopsys-app')
    assertStable()
    const storeRaw = await options.data.getItem('shopsys-data')
    assertStable()
    const appAgain = await options.settings.getItem('shopsys-app')
    assertStable()
    const storeAgain = await options.data.getItem('shopsys-data')
    assertStable()
    if (appRaw !== appAgain || storeRaw !== storeAgain) throw new Error('تغير التخزين أثناء أخذ النسخة — أعد المحاولة بعد اكتمال الحفظ')
    if (!storeRaw) throw new Error('لا بيانات محلية قابلة للقراءة للنسخ')
    return { appRaw, storeRaw }
  } finally {
    unsubscribe()
  }
}
