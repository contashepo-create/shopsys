/**
 * حراسة التفاعل: التطبيق يُعامَل كبرنامج سطح مكتب لا كصفحة نصية (قرار المالك).
 *
 * قاعدة CSS وحدها لا تكفي: سحب الفأرة من منطقة غير قابلة للتحديد فوق حقل إدخال
 * يلتقط نص الحقل ويظلّله. لذلك نمنع **بدء** التحديد ما لم يبدأ داخل حقل فعلاً،
 * وننظّف أي تحديد عابر عند رفع الزر — مع إبقاء التحديد داخل الحقل نفسه كاملاً
 * (نقر + سحب داخل الحقل · نقرة مزدوجة · Ctrl+A داخله · لصق ونسخ).
 */
const FIELD_SELECTOR = 'input, textarea, [contenteditable="true"], [contenteditable=""], [data-selectable]'

function insideField(node: EventTarget | null): boolean {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null
  return !!element?.closest(FIELD_SELECTOR)
}

export function installNoTextSelection(target: Document = document): () => void {
  let startedInField = false

  const onPointerDown = (event: PointerEvent) => { startedInField = insideField(event.target) }
  const onSelectStart = (event: Event) => {
    if (startedInField) return
    /* تحديد بلوحة المفاتيح داخل حقل يعمل فيه المستخدم فعلاً (Shift+الأسهم) */
    const active = target.activeElement
    const inFocusedField = insideField(event.target) && !!active && insideField(active)
      && (active === event.target || active.contains(event.target as Node))
    if (inFocusedField) return
    event.preventDefault()
  }
  const onPointerUp = () => {
    if (startedInField) return
    const selection = target.defaultView?.getSelection?.()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()
    /* سحب مرّ فوق حقل: نُلغي تظليل نصه أيضاً */
    const active = target.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    if (active && 'setSelectionRange' in active && typeof active.selectionStart === 'number'
      && (active.selectionEnd ?? 0) > (active.selectionStart ?? 0)) {
      try { active.setSelectionRange(active.selectionEnd ?? 0, active.selectionEnd ?? 0) } catch { /* حقول لا تدعم التحديد */ }
    }
  }
  /* Ctrl+A خارج الحقول لا يظلّل الشاشة */
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    if (event.key.toLowerCase() !== 'a') return
    if (insideField(event.target)) return
    event.preventDefault()
  }

  target.addEventListener('pointerdown', onPointerDown, true)
  target.addEventListener('selectstart', onSelectStart, true)
  target.addEventListener('pointerup', onPointerUp, true)
  target.addEventListener('keydown', onKeyDown, true)
  return () => {
    target.removeEventListener('pointerdown', onPointerDown, true)
    target.removeEventListener('selectstart', onSelectStart, true)
    target.removeEventListener('pointerup', onPointerUp, true)
    target.removeEventListener('keydown', onKeyDown, true)
  }
}
