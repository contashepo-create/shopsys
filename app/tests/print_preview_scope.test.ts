import { afterEach, expect, it, vi } from 'vitest'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useRawDataStore } from '../src/data/repo.ts'
const original = useRawDataStore.getState()
afterEach(() => { usePrintPreview.getState().closePreview(); useRawDataStore.setState(original) })
it('يغلق المعاينة فور تبديل المستخدم أو الفرع ولا يسمح بطباعة لقطة النطاق السابق', () => {
 const branches = [{ id: 1, nameAr: 'أ', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ب', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches, currentUserId: null, activeBranchId: 1, appUsers: [] })
 const rebuild = vi.fn(() => 'مستند أ')
 usePrintPreview.getState().openPreview({ html: 'مستند أ', wide: true, rebuild })
 useRawDataStore.setState({ journal: [] })
 expect(usePrintPreview.getState().open).toBe(true)
 useRawDataStore.setState({ activeBranchId: 2 })
 expect(usePrintPreview.getState().open).toBe(false); expect(usePrintPreview.getState().handle).toBeNull()
 usePrintPreview.getState().openPreview({ html: 'مستند ب', wide: true })
 useRawDataStore.setState({ currentUserId: 3 })
 expect(usePrintPreview.getState().open).toBe(false)
})
it('يغلق عند نقل فرع الموظف الفعلي ولو لم تتغير قيمة الفرع المختار', () => {
 const branches = [{ id: 1, nameAr: 'أ', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ب', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 const employee = { id: 3, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '', branchId: 1 }
 useRawDataStore.setState({ branches, currentUserId: 3, activeBranchId: null, appUsers: [employee] })
 usePrintPreview.getState().openPreview({ html: 'مستند أ', wide: true })
 useRawDataStore.setState({ appUsers: [{ ...employee, branchId: 2 }] })
 expect(usePrintPreview.getState().open).toBe(false)
})
