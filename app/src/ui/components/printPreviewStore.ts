/**
 * متجر معاينة الطباعة العام (طلب المالك: «شغّل المعاينة الحية») —
 * نافذة حرة واحدة فوق كل المسارات: أي صفحة تفتح معاينة من هنا، وتبقى المعاينة
 * حية أثناء فتح قسم إعدادات الطباعة (مصغّرة أسفل الشاشة) فتتحدث فوراً مع كل
 * تغيير في الإعدادات — لأن `rebuild` يقرأ receipt لحظة استدعائه لا لحظة الفتح.
 */
import { create } from 'zustand'

export interface PrintPreviewHandle {
  /** نسخة HTML الأولى (مبنية بإعدادات اللحظة) */
  html: string
  /** فاتورة كبيرة (A4) بدل رول الكاشير */
  wide: boolean
  title?: string
  /**
   * إعادة بناء المعاينة بالإعدادات الحالية — closure يلتقط نموذج المستند
   * وقالبه ويقرأ إعدادات الطباعة من appStore وقت الاستدعاء ⇒ معاينة حية.
   */
  rebuild?: () => string
}

interface PrintPreviewState {
  open: boolean
  handle: PrintPreviewHandle | null
  /** وضع مصغّر أسفل الشاشة — أثناء فتح قسم إعدادات الطباعة الكامل */
  mini: boolean
  openPreview: (handle: PrintPreviewHandle) => void
  closePreview: () => void
  setMini: (mini: boolean) => void
  /** إعادة بناء HTML بالإعدادات الجديدة — تفشل بصمت فتبقى آخر نسخة صالحة */
  refresh: () => void
}

export const usePrintPreview = create<PrintPreviewState>((set, get) => ({
  open: false,
  handle: null,
  mini: false,
  openPreview: (handle) => set({ open: true, handle, mini: false }),
  closePreview: () => set({ open: false, handle: null, mini: false }),
  setMini: (mini) => set({ mini }),
  refresh: () => {
    const { handle } = get()
    if (!handle?.rebuild) return
    try {
      set({ handle: { ...handle, html: handle.rebuild() } })
    } catch {
      /* نموذج المستند لم يعد قابلاً للبناء (صفحة أُغلقت مثلاً) — تبقى آخر نسخة */
    }
  },
}))

/** الاختصار الذي تستدعيه الصفحات لفتح المعاينة */
export const openPrintPreview = (handle: PrintPreviewHandle) => usePrintPreview.getState().openPreview(handle)
