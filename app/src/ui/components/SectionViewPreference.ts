import { useState } from 'react'

/**
 * تفضيل عرض مستقل لكل شاشة/قسم.
 *
 * العرض الافتراضي قائمة، والتفضيل واجهي فقط: لا يدخل في snapshot المحاسبي
 * ولا يغيّر ترتيب البيانات أو مصدر الحقيقة في Repository.
 */
export function readSectionView<T extends string>(section: string, defaultView: T, allowedViews: readonly T[]): T {
  if (typeof window === 'undefined') return defaultView
  try {
    const stored = window.localStorage.getItem(`shopsys:section-view:${section}`)
    return stored && allowedViews.includes(stored as T) ? stored as T : defaultView
  } catch {
    return defaultView
  }
}

export function writeSectionView(section: string, view: string): void {
  try { window.localStorage.setItem(`shopsys:section-view:${section}`, view) } catch { /* التخزين الواجهـي اختياري */ }
}

export function usePersistedSectionView<T extends string>(section: string, defaultView: T, allowedViews: readonly T[]): [T, (view: T) => void] {
  const [view, setViewState] = useState<T>(() => readSectionView(section, defaultView, allowedViews))
  const setView = (next: T) => {
    setViewState(next)
    writeSectionView(section, next)
  }
  return [view, setView]
}
