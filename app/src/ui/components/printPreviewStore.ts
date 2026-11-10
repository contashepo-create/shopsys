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
  scale: number
  rebuildError: boolean
  setScale: (scale: number) => void
  openPreview: (handle: PrintPreviewHandle) => void
  closePreview: () => void
  setMini: (mini: boolean) => void
  /** إعادة البناء مع تعطيل الطباعة إذا لم تعد بيانات المستند قابلة للبناء. */
  refresh: () => void
}

export const usePrintPreview = create<PrintPreviewState>((set, get) => ({
  open: false,
  handle: null,
  mini: false,
  scale: 100,
  rebuildError: false,
  setScale: (scale) => set({ scale: Math.min(120, Math.max(40, Number.isFinite(scale) ? Math.round(scale) : 100)) }),
  openPreview: (handle) => set({ open: true, handle, mini: false, scale: 100, rebuildError: false }),
  closePreview: () => set({ open: false, handle: null, mini: false, rebuildError: false }),
  setMini: (mini) => set({ mini }),
  refresh: () => {
    const { handle } = get()
    if (!handle?.rebuild) return
    try {
      set({ handle: { ...handle, html: handle.rebuild() }, rebuildError: false })
    } catch {
      // آخر صورة قديمة للعرض فقط؛ لا يجوز طباعتها بعد فشل تحديث المستند.
      set({ rebuildError: true })
    }
  },
}))

/** الاختصار الذي تستدعيه الصفحات لفتح المعاينة */
export const openPrintPreview = (handle: PrintPreviewHandle) => usePrintPreview.getState().openPreview(handle)
