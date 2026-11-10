import { getEffectiveActiveBranch, useDataStore, useRawDataStore } from '../../data/repo.ts'
import { userPrefsKey } from '../../core/userPreferences.ts'
import type { NavSection } from '../navCatalog.tsx'
import { useEffectiveBranchScope } from './useNavSections.ts'

/** لا تكشف المفضلة شاشة محجوبة: تُحل فقط من الأقسام المرئية حالياً. */
export function useNavigationFavorites(sections: NavSection[]) {
  const currentUserId = useDataStore(s => s.currentUserId)
  const loggedOut = useDataStore(s => s.loggedOut)
  const appUsers = useDataStore(s => s.appUsers)
  const preferences = useDataStore(s => s.userPrefs)
  const update = useDataStore(s => s.updateMyPreferences)
  const { effectiveBranchId } = useEffectiveBranchScope()
  const key = effectiveBranchId == null ? 'all' : `branch-${effectiveBranchId}`
  const userKey = userPrefsKey(currentUserId)
  const validUser = !loggedOut && (currentUserId == null || appUsers.some(u => u.id === currentUserId && u.active))
  const prefs = preferences[userKey]?.favoritePathsByBranch ?? {}
  const paths = validUser && Array.isArray(prefs[key]) ? prefs[key].filter((p): p is string => typeof p === 'string') : []
  const available = sections.flatMap(section => section.children).filter(child => child.path !== '/')
  const favorites = paths.flatMap(path => {
    const child = available.find(item => item.path === path)
    return child ? [{ ...child, id: `favorite:${path}` }] : []
  }).filter((child, index, all) => all.findIndex(item => item.path === child.path) === index)
  const withFavorites = sections.map(section => section.id === 'dashboard' ? { ...section, children: [...section.children, ...favorites] } : section)
  const toggle = (path: string) => {
    if (!validUser || !available.some(item => item.path === path)) return
    const fresh = useDataStore.getState()
    if (fresh.currentUserId !== currentUserId || fresh.loggedOut || (getEffectiveActiveBranch(useRawDataStore.getState())?.id ?? null) !== effectiveBranchId) return
    const map = fresh.userPrefs[userKey]?.favoritePathsByBranch ?? {}
    const current = Array.isArray(map[key]) ? map[key].filter((p): p is string => typeof p === 'string') : []
    update({ favoritePathsByBranch: { ...map, [key]: current.includes(path) ? current.filter(p => p !== path) : [...current, path] } })
  }
  return { sections: withFavorites, paths, toggle }
}
