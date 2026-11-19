/**
 * حالة نافذة التأكيد — وحدة بلا مكوّنات كي يبقى Fast Refresh سليماً
 * (`ConfirmDialog.tsx` يصدر مكوّناً واحداً فقط).
 *
 * البديل المعتمد لـ `window.confirm`: التطبيق سطح مكتب (Electron)، ونافذة النظام
 * لا تتبع لغة التطبيق ولا شكله، وقد تُحجب خلف النافذة فيظن الكاشير أن الزر معطّل.
 */

export interface ConfirmOptions {
  title: string
  /** نص التأكيد — اشرح ما سيحدث وما لن يحدث (لا سؤال نعم/لا غامض) */
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** عملية حذف/استبدال لا رجعة فيها ⇒ زر أحمر */
  danger?: boolean
  /** معرّف ثابت للاختبارات */
  testId?: string
}

export interface PendingConfirm {
  key: number
  opts: ConfirmOptions
  resolve: (ok: boolean) => void
}

let pending: PendingConfirm | null = null
let sequence = 0
const listeners = new Set<(value: PendingConfirm | null) => void>()

export function getPendingConfirm(): PendingConfirm | null { return pending }

export function subscribeConfirm(listener: (value: PendingConfirm | null) => void): () => void {
  listeners.add(listener)
  listener(pending)
  return () => { listeners.delete(listener) }
}

/** يفتح التأكيد ويعيد true عند الموافقة · false عند الإلغاء/الإغلاق */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  /* طلب جديد قبل إغلاق السابق (نقرتان سريعتان): السابق يُلغى صراحةً
     بدل أن يبقى معلَّقاً للأبد فيسرّب معالجه */
  const previous = pending
  pending = null
  previous?.resolve(false)
  return new Promise<boolean>((resolve) => {
    sequence += 1
    pending = { key: sequence, opts, resolve }
    for (const listener of listeners) listener(pending)
  })
}

/** يُغلق الطلب الحالي بالنتيجة المعطاة (يُستدعى من النافذة فقط) */
export function settleConfirm(key: number, ok: boolean): void {
  if (!pending || pending.key !== key) return
  const { resolve } = pending
  pending = null
  for (const listener of listeners) listener(null)
  resolve(ok)
}

/** للاختبارات: هل هناك تأكيد معلَّق؟ */
export function pendingConfirmCount(): number {
  return pending ? 1 : 0
}
