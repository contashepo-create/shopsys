/**
 * بوابة التنقل مع التغييرات غير المحفوظة (منقولة من ui.tsx بلا تغيير سلوك):
 * مجموعة حرّاس نشطة تسجّلها الصفحات عبر useUnsavedChangesGuard أو مضيف
 * التبويبات، وتمرّ عليها كل محاولات التنقل/تبديل التبويب/إغلاق التبويب.
 * الوحدة مستقلة بلا أي استيراد — تُستدعى من متجر النوافذ دون دورة.
 */
const activeNavigationGuards = new Set<(continueNavigation: () => void) => void>()

/** تستخدمها روابط التخطيط لمنع الانتقال الداخلي عندما توجد مسودات غير محفوظة. */
export function guardNavigation(continueNavigation: () => void): boolean {
  const guards = [...activeNavigationGuards]
  if (!guards.length) return false
  const confirmNext = (index: number): void => {
    if (index >= guards.length) { continueNavigation(); return }
    const guard = guards[index]
    if (!activeNavigationGuards.has(guard)) { confirmNext(index + 1); return }
    guard(() => confirmNext(index + 1))
  }
  confirmNext(0)
  return true
}

/** تسجيل حارس مخصص وإرجاع دالة إلغاء تسجيله. */
export function registerNavigationGuard(guard: (continueNavigation: () => void) => void): () => void {
  activeNavigationGuards.add(guard)
  return () => { activeNavigationGuards.delete(guard) }
}
