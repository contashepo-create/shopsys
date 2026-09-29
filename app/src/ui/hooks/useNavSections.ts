/**
 * أقسام التنقل المتاحة فعلاً للمستخدم الحالي — مصدر واحد يستعمله شريط القوائم
 * والشريط الجانبي و«لوحة الأوامر» (Ctrl+K) فلا تختلف القوائم بينها.
 */
import { useMemo } from 'react'
import { useAppStore } from '../../stores/app.store.ts'
import { useDataStore } from '../../data/repo.ts'
import { NAV_SECTIONS, type NavSection } from '../navCatalog.tsx'
import { labelFor } from '../../core/activityLabels.ts'
import { canAccessPath, effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'

export function useNavSections(): NavSection[] {
  const setup = useAppStore((s) => s.setup)
  const appUsers = useDataStore((s) => s.appUsers)
  const currentUserId = useDataStore((s) => s.currentUserId)
  const roleOverrides = useDataStore((s) => s.roleOverrides)
  const customRoles = useDataStore((s) => s.customRoles)

  return useMemo(() => {
    const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
    const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, setup.activityId))
    return NAV_SECTIONS
      .filter((sec) => (!sec.module || setup.modules.includes(sec.module)) && (!sec.accountingOnly || setup.accountingMode === 'full'))
      .map((sec) => ({
        ...sec,
        nameAr: labelFor(setup.activityId, sec.id, sec.nameAr),
        children: sec.children
          .filter((c) => !c.module || setup.modules.includes(c.module))
          .filter((c) => !c.feature || setup.features.includes(c.feature))
          .filter((c) => !c.activities || c.activities.includes(setup.activityId ?? ''))
          .filter((c) => !c.hideForActivities || !c.hideForActivities.includes(setup.activityId ?? ''))
          .filter((c) => canAccessPath(c.path, perms))
          .map((c) => ({ ...c, nameAr: labelFor(setup.activityId, `${sec.id}.${c.id}`, c.nameAr) })),
      }))
      .filter((sec) => sec.children.length > 0)
  }, [appUsers, currentUserId, customRoles, roleOverrides, setup])
}
