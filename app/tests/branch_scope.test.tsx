/**
 * نطاق الفرع الفعّال — حالات الهوية الثلاث التي يبني عليها شارة الفرع:
 *  - `currentUserId = null` = المالك الافتراضي (كل الشيفرة تعامله كذلك:
 *    BranchesPage/Header) ⇒ لا قفل و«كل الفروع» متاحة.
 *  - مالك مسجَّل بدور owner ⇒ لا قفل ويحكم اختياره.
 *  - موظف له فرع ⇒ مقيَّد بفرعه مهما اختار.
 */
import { createHash } from 'node:crypto'
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
  useAppStore.getState().setActiveBranchContext(null)
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

describe('تبديل جلسة المستخدم بين الفروع مع ترحيل PIN قديم', () => {
  it('يسمح بتسجيل الدخول من الفرع 2 بعد الخروج من الفرع 1 ثم يحدّث PIN القديم داخل نطاق صاحبه', async () => {
    const legacyHash = (pin: string) => createHash('sha256').update(`tahakam:${pin}`).digest('hex')
    useRawDataStore.setState({
      branches: [branch(), branch({ id: 2, nameAr: 'فرع 2', isMain: false, warehouseId: 2, treasuryCode: '1102' })],
      appUsers: [
        { id: 11, nameAr: 'مستخدم فرع 1', roleId: 'cashier', pinHash: legacyHash('111111'), active: true, branchId: 1 },
        { id: 22, nameAr: 'مستخدم فرع 2', roleId: 'cashier', pinHash: legacyHash('222222'), active: true, branchId: 2 },
      ],
      currentUserId: null,
      activeBranchId: 1,
      loggedOut: true,
    })

    // أنشئ سياقاً حقيقياً للفرع 1، ثم اخرج منه من دون مسح هويته المحفوظة.
    await expect(useRawDataStore.getState().login(11, '111111')).resolves.toMatchObject({ mustChangePin: false })
    expect(useRawDataStore.getState().currentUserId).toBe(11)
    expect(useAppStore.getState().activeBranchContext?.id).toBe(1)
    useRawDataStore.getState().logout()
    expect(useRawDataStore.getState().loggedOut).toBe(true)

    // PIN الفرع 2 قديم عمداً؛ ترحيله يكتب appUsers بعد تبديل الهوية وتغيير النطاق.
    await expect(useRawDataStore.getState().login(22, '222222')).resolves.toMatchObject({ mustChangePin: false })
    expect(useRawDataStore.getState().currentUserId).toBe(22)
    expect(useRawDataStore.getState().appUsers.find((user) => user.id === 22)?.pinHash).toMatch(/^pbkdf2-sha256\$/)
    expect(useRawDataStore.getState().appUsers.find((user) => user.id === 11)?.pinHash).toMatch(/^pbkdf2-sha256\$/)
    expect(useAppStore.getState().activeBranchContext?.id).toBe(2)

    useRawDataStore.getState().logout()
    await expect(useRawDataStore.getState().login(11, '111111')).resolves.toMatchObject({ mustChangePin: false })
    expect(useRawDataStore.getState().currentUserId).toBe(11)
    expect(useAppStore.getState().activeBranchContext?.id).toBe(1)
  })
})

describe('إدارة appUsers من فرع 4 مع بقاء عزل الفروع', () => {
  it('يسمح بتعديل وتعطيل حساب من فرع 4 ويرفض حساب فرع آخر', () => {
    useRawDataStore.setState({
      branches: [
        branch(),
        branch({ id: 2, nameAr: 'فرع 2', isMain: false, warehouseId: 2, treasuryCode: '1102' }),
        branch({ id: 4, nameAr: 'فرع 4', isMain: false, warehouseId: 4, treasuryCode: '1104' }),
      ],
      activeBranchId: 1, // فرع المالك المتروك سابقاً يجب ألا يتغلب على فرع المستخدم بعد دخوله
      customRoles: [{ id: 'custom_4', nameAr: 'مسؤول مستخدمي فرع 4', branchId: 4 }],
      branchRoleOverrides: { 4: { custom_4: ['set.users'] } },
      appUsers: [
        { id: 40, nameAr: 'مسؤول فرع 4', roleId: 'custom_4', pinHash: '0'.repeat(64), active: true, branchId: 4 },
        { id: 41, nameAr: 'حساب للتعديل', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: 4 },
        { id: 42, nameAr: 'حساب للتعطيل', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: 4 },
        { id: 21, nameAr: 'حساب فرع 2', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: 2 },
      ],
      currentUserId: 40,
      loggedOut: false,
    })

    useRawDataStore.getState().updateAppUser(41, { nameAr: 'حساب فرع 4 المعدل' })
    useRawDataStore.getState().removeAppUser(42)
    expect(useRawDataStore.getState().appUsers.find((user) => user.id === 41)?.nameAr).toBe('حساب فرع 4 المعدل')
    expect(useRawDataStore.getState().appUsers.find((user) => user.id === 42)?.active).toBe(false)
    expect(() => useRawDataStore.getState().updateAppUser(21, { nameAr: 'تعديل عابر للفروع' })).toThrow(/فرع آخر/)
    expect(() => useRawDataStore.getState().removeAppUser(21)).toThrow(/فرع آخر/)
  })
})

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
