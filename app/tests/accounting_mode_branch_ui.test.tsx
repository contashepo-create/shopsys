import { afterEach, expect, it } from 'vitest'
import React from 'react'
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Header } from '../src/ui/layout/Header.tsx'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'
const app = useAppStore.getState(), data = useRawDataStore.getState()
afterEach(() => { cleanup(); useAppStore.getState().setActiveBranchContext(null); useAppStore.getState().removeBranchBusinessProfile(2); useRawDataStore.setState(data); useAppStore.setState(app) })
it('تبديل وضع الحسابات في فرع مستقل تفضيل للفرع لا يغير إعداد الشركة أو صلاحيات المستخدم', async () => {
 const branch = { id: 2, nameAr: 'فرع ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
 const main = { id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
 useAppStore.setState({ ...app, companySetup: { ...app.setup, accountingMode: 'simple' }, setup: { ...app.setup, accountingMode: 'simple' }, branchBusinessProfiles: {}, activeBranchContext: null })
 useRawDataStore.setState({ ...data, branches: [main, branch], activeBranchId: 2, currentUserId: null, appUsers: [] })
 useAppStore.getState().setActiveBranchContext(branch)
 render(<MemoryRouter><Header title="اختبار" /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('تفعيل الوضع المحاسبي الكامل'))
 expect(useAppStore.getState().setup.accountingMode).toBe('full')
 expect(useAppStore.getState().companySetup.accountingMode).toBe('simple')
 expect(useAppStore.getState().branchBusinessProfiles[2].accountingMode).toBe('full')
 expect(useRawDataStore.getState().currentUserId).toBeNull()
 expect(() => useAppStore.getState().updateSetup({ ownerName: 'تغيير غير مسموح' })).toThrow(/الإعدادات العامة/)
 useAppStore.getState().setActiveBranchContext(main)
 expect(useAppStore.getState().setup.accountingMode).toBe('simple')
 useAppStore.getState().setActiveBranchContext(branch)
 expect(useAppStore.getState().setup.accountingMode).toBe('full')
 await act(async () => { await useAppStore.persist.rehydrate() })
 expect(useAppStore.getState().companySetup.accountingMode).toBe('simple')
 act(() => useAppStore.getState().setActiveBranchContext(branch))
 expect(useAppStore.getState().setup.accountingMode).toBe('full')
})
