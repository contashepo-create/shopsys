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
import { resolveBranchActivityId, resolveBranchModules, type Branch } from '../../core/branches.ts'
import type { BusinessModule } from '../../core/activities.ts'

export interface EffectiveBranchScope {
  branches: Branch[]
  effectiveBranch: Branch | null
  effectiveBranchId: number | null
  isLockedToUserBranch: boolean
  effectiveModules: BusinessModule[]
  effectiveActivityId: string | null
  setActiveBranchId: (id: number | null) => void
}

/**
 * نطاق الفرع الفعال للتنقل والواجهة:
 * - الموظف المربوط بفرع (`activeUser.branchId`) يُقفل تلقائياً على فرعه وأقسامه المخصصة.
 * - المالك/المدير العام يتنقل بحرية بين «كل الفروع (شامل)» أو أي فرع لاختبار/تشغيل أقسامه المخصصة.
 */
export function useEffectiveBranchScope(): EffectiveBranchScope {
  const setup = useAppStore((s) => s.setup)
  const appUsers = useDataStore((s) => s.appUsers)
  const currentUserId = useDataStore((s) => s.currentUserId)
  const branches = useDataStore((s) => s.branches)
  const activeBranchId = useDataStore((s) => s.activeBranchId)
  const setActiveBranchId = useDataStore((s) => s.setActiveBranchId)

  return useMemo(() => {
    const activeBranches = branches.filter((b) => b.active)
    const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
    const userBranchId = activeUser?.branchId ?? null
    const isLockedToUserBranch = userBranchId != null && activeBranches.some((b) => b.id === userBranchId)
    const effectiveBranchId = isLockedToUserBranch ? userBranchId : activeBranchId
    const effectiveBranch = effectiveBranchId != null
      ? (activeBranches.find((b) => b.id === effectiveBranchId) ?? null)
      : null
    const effectiveModules = resolveBranchModules(effectiveBranch, setup.modules)
    const effectiveActivityId = resolveBranchActivityId(effectiveBranch, setup.activityId)
    return {
      branches: activeBranches,
      effectiveBranch,
      effectiveBranchId: effectiveBranch?.id ?? null,
      isLockedToUserBranch,
      effectiveModules,
      effectiveActivityId,
      setActiveBranchId,
    }
  }, [activeBranchId, appUsers, branches, currentUserId, setActiveBranchId, setup.activityId, setup.modules])
}

export function useNavSections(): NavSection[] {
  const setup = useAppStore((s) => s.setup)
  const appUsers = useDataStore((s) => s.appUsers)
  const currentUserId = useDataStore((s) => s.currentUserId)
  const roleOverrides = useDataStore((s) => s.roleOverrides)
  const customRoles = useDataStore((s) => s.customRoles)
  const { effectiveModules, effectiveActivityId } = useEffectiveBranchScope()

  return useMemo(() => {
    const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
    const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, effectiveActivityId))
    return NAV_SECTIONS
      .filter((sec) => (!sec.module || effectiveModules.includes(sec.module)) && (!sec.accountingOnly || setup.accountingMode === 'full'))
      .map((sec) => ({
        ...sec,
        nameAr: labelFor(effectiveActivityId, sec.id, sec.nameAr),
        children: sec.children
          .filter((c) => !c.module || effectiveModules.includes(c.module))
          .filter((c) => !c.feature || setup.features.includes(c.feature))
          .filter((c) => !c.activities || c.activities.includes(effectiveActivityId ?? ''))
          .filter((c) => !c.hideForActivities || !c.hideForActivities.includes(effectiveActivityId ?? ''))
          .filter((c) => canAccessPath(c.path, perms))
          .map((c) => ({ ...c, nameAr: labelFor(effectiveActivityId, `${sec.id}.${c.id}`, c.nameAr) })),
      }))
      .filter((sec) => sec.children.length > 0)
  }, [appUsers, currentUserId, customRoles, effectiveActivityId, effectiveModules, roleOverrides, setup])
}
