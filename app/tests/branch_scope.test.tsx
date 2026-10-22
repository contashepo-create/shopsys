/**
 * نطاق الفرع الفعّال — حالات الهوية الثلاث التي يبني عليها شارة الفرع:
 *  - `currentUserId = null` = المالك الافتراضي (كل الشيفرة تعامله كذلك:
 *    BranchesPage/Header) ⇒ لا قفل و«كل الفروع» متاحة.
 *  - مالك مسجَّل بدور owner ⇒ لا قفل ويحكم اختياره.
 *  - موظف له فرع ⇒ مقيَّد بفرعه مهما اختار.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEffectiveBranchScope } from '../src/ui/hooks/useNavSections.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'

const branch = (over: Record<string, unknown> = {}) => ({
  id: 1, nameAr: 'الفرع الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101',
  active: true, customModulesMode: 'all', enabledModules: [], ...over,
})

/* إعادة الضبط عبر المتجر الخام: المتجر المقيَّد يرفض setState أثناء نطاق فرع
   (حارس مقصود في الإنتاج) — الاختبار يجهّز الحالة ثم يقرأ عبر الخطاف فقط. */
const resetScope = () => {
  const app = useAppStore.getState()
  useAppStore.setState({ setup: { ...app.setup, modules: [], activityId: 'general' }, companySetup: null })
  useRawDataStore.setState({
    branches: [branch(), branch({ id: 2, nameAr: 'فرع المنصورة', isMain: false, warehouseId: 2 })],
    appUsers: [],
    currentUserId: null,
    activeBranchId: null,
  })
}
beforeEach(resetScope)

describe('useEffectiveBranchScope — من هو المالك ومن هو المقيَّد', () => {
  it('بلا تسجيل دخول (المالك الافتراضي): ليس مقيَّداً ويبدأ بـ«كل الفروع»', () => {
    const { result } = renderHook(() => useEffectiveBranchScope())
    expect(result.current.isLockedToUserBranch).toBe(false)
    expect(result.current.effectiveBranchId).toBeNull()
    expect(result.current.branches.length).toBe(2)
  })

  it('المالك المسجَّل: يختار الفرع بحرية', () => {
    useRawDataStore.setState({
      appUsers: [{ id: 1, nameAr: 'المالك', roleId: 'owner', pinHash: '0'.repeat(64), active: true }],
      currentUserId: 1,
      activeBranchId: 2,
    })
    const { result } = renderHook(() => useEffectiveBranchScope())
    expect(result.current.isLockedToUserBranch).toBe(false)
    expect(result.current.effectiveBranchId).toBe(2)
  })

  it('موظف مرتبط بفرع: مقيَّد بفرعه ولا يغيّره اختياره', () => {
    useRawDataStore.setState({
      appUsers: [{ id: 3, nameAr: 'محمود', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: 2 }],
      currentUserId: 3,
      activeBranchId: 1,
    })
    const { result } = renderHook(() => useEffectiveBranchScope())
    expect(result.current.isLockedToUserBranch).toBe(true)
    expect(result.current.effectiveBranchId).toBe(2)
    expect(result.current.effectiveBranch?.nameAr).toBe('فرع المنصورة')
  })

  it('موظف بلا فرع محدد: يقع على الفرع الرئيسي ويُقيَّد به', () => {
    useRawDataStore.setState({
      appUsers: [{ id: 4, nameAr: 'سالي', roleId: 'cashier', pinHash: '0'.repeat(64), active: true }],
      currentUserId: 4,
    })
    const { result } = renderHook(() => useEffectiveBranchScope())
    expect(result.current.isLockedToUserBranch).toBe(true)
    expect(result.current.effectiveBranchId).toBe(1)
  })
})
