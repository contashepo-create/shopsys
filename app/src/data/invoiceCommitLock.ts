import { desktopBridge } from './desktopBridge.ts'
import { flushPendingDesktopSnapshots, refreshDesktopSnapshot } from './persistentStorage.ts'
import { flushSecureStorageWrites } from './secureStorage.ts'

/**
 * تصريف الكتابات المؤجلة بعد ترحيل ناجح، مع إعادة محاولة قصيرة.
 *
 * بلاغ المالك: «الفاتورة تُكتب ثم لا تُغلق النافذة». السبب الشائع فشل مؤقت
 * في تصريف اللقطة بعد نجاح `commit` (IPC مشغول/SQLite يعيد محاولة/quota يفرغ)
 * فيُرفض الوعد ويظن النموذج أن الترحيل فشل رغم أن المستند قائم — فتبقى
 * النافذة مفتوحة وتهبط بوابة «تعذّر تأكيد الحفظ». المستند المُرحَّل لا يُلغى
 * بفشل تصريف لحظي؛ نعيد المحاولة ثم نرفض فقط إن استعصى التصريف فعلاً
 * (عندها تبقى النافذة مفتوحة للحفاظ على البيانات وإعادة المحاولة الآمنة).
 */
async function flushAfterCommit(flush: () => Promise<void>): Promise<void> {
  const attempts = 3
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    try {
      await flush()
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/**
 * Serialize invoice posting across independent renderer processes/tabs. The lock
 * is held while the latest snapshot is reloaded, domain guards run, and storage
 * confirms completion. Independent drafts remain editable in their own windows.
 */
export async function withInvoiceCommitLock<T>(
  refreshLiveData: () => Promise<unknown>,
  commit: () => T | Promise<T>,
): Promise<T> {
  const desktop = desktopBridge()
  if (desktop) {
    const lock = desktop.invoiceCommit
    if (!lock) throw new Error('نسخة سطح المكتب لا توفر قفل الترحيل الآمن — حدّث التطبيق قبل ترحيل الفاتورة.')
    const token = await lock.acquire()
    if (!token) throw new Error('تعذّر حجز دور آمن لترحيل الفاتورة. أعد المحاولة بعد لحظات.')
    try {
      await refreshDesktopSnapshot('shopsys-data')
      await refreshLiveData()
      const result = await commit()
      // لا تجعل خطأ لقطة الإعدادات shopsys-app يترك فاتورة مُرحّلة مفتوحة
      // فيدفع المستخدم إلى إعادة الترحيل. نؤكد هنا لقطة دفتر المبيعات فقط.
      await flushAfterCommit(() => flushPendingDesktopSnapshots('shopsys-data'))
      return result
    } finally {
      /* تحرير القفل لا يُبطل مستنداً اكتمل — أخطأ التحرير يُسجَّل ويُهمَل */
      try { lock.release(token) } catch { /* لا شيء */ }
    }
  }

  // تطبيق الويب قد يعمل في عدة تبويبات مستقلة؛ localStorage وحده لا يوفّر
  // قفلاً ذرياً. Web Locks API هو الحارس العابر للتبويبات، ونفشل مغلقاً بدونه.
  const lockManager = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!lockManager) {
    throw new Error('هذا المتصفح لا يدعم قفل الترحيل الآمن بين التبويبات. حدّث المتصفح ثم أعد المحاولة.')
  }
  return lockManager.request('shopsys:invoice-commit', { mode: 'exclusive' }, async () => {
    await flushSecureStorageWrites('shopsys-data')
    await refreshLiveData()
    const result = await commit()
    await flushAfterCommit(() => flushSecureStorageWrites('shopsys-data'))
    return result
  })
}
