/** نافذة القسم الحرة تسأل هذا السجل قبل إغلاق نافذة النظام. */
const dirtyChangeGuards = new Set<object>()

export function setUnsavedChangeGuard(token: object, dirty: boolean): void {
  if (dirty) dirtyChangeGuards.add(token)
  else dirtyChangeGuards.delete(token)
}

export function hasUnsavedChangesInCurrentWindow(): boolean {
  return dirtyChangeGuards.size > 0
}
