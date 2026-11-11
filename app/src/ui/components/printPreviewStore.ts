/**
 * متجر معاينة الطباعة العام (طلب المالك: «شغّل المعاينة الحية») —
 * نافذة حرة واحدة فوق كل المسارات: أي صفحة تفتح معاينة من هنا، وتبقى المعاينة
 * حية أثناء فتح قسم إعدادات الطباعة (مصغّرة أسفل الشاشة) فتتحدث فوراً مع كل
 * تغيير في الإعدادات — لأن `rebuild` يقرأ receipt لحظة استدعائه لا لحظة الفتح.
 */
import { create } from 'zustand'
import { getEffectiveActiveBranch, useRawDataStore } from '../../data/repo.ts'

/** لا تبقى بيانات معاينة مستخدم أو فرع أمام سياق عمل آخر. */
function previewScope(state: ReturnType<typeof useRawDataStore.getState>): string {
  return JSON.stringify([state.currentUserId, state.activeBranchId, getEffectiveActiveBranch(state)?.id ?? null])
}
export function currentPreviewScope(): string { return previewScope(useRawDataStore.getState()) }

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
  scope: string | null
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
  scope: null,
  setScale: (scale) => set({ scale: Math.min(120, Math.max(40, Number.isFinite(scale) ? Math.round(scale) : 100)) }),
  openPreview: (handle) => set({ open: true, handle, mini: false, scale: 100, rebuildError: false, scope: previewScope(useRawDataStore.getState()) }),
  closePreview: () => set({ open: false, handle: null, mini: false, rebuildError: false, scope: null }),
  setMini: (mini) => set({ mini }),
  refresh: () => {
    const { handle, scope } = get()
    if (scope !== previewScope(useRawDataStore.getState())) { get().closePreview(); return }
    if (!handle?.rebuild) return
    try {
      set({ handle: { ...handle, html: handle.rebuild() }, rebuildError: false })
    } catch {
      // آخر صورة قديمة للعرض فقط؛ لا يجوز طباعتها بعد فشل تحديث المستند.
      set({ rebuildError: true })
    }
  },
}))

// يشمل المستندات الثابتة أيضاً: لا ننتظر محاولة الطباعة لكشف تغيير الهوية أو الفرع.
useRawDataStore.subscribe((state) => {
  const preview = usePrintPreview.getState()
  if (preview.open && preview.scope !== previewScope(state)) preview.closePreview()
})

/** الاختصار الذي تستدعيه الصفحات لفتح المعاينة */
export const openPrintPreview = (handle: PrintPreviewHandle) => usePrintPreview.getState().openPreview(handle)
