import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { financialEntityBasis, type FinancialEntityProfile } from '../src/core/financialEntities.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'
import { FinancialEntitiesSettings } from '../src/ui/pages/FinancialEntitiesSettings.tsx'

const initial = useRawDataStore.getState()
const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
const sample: FinancialEntityProfile = { id: 'entity', nameAr: 'شركة', branchIds: [1], framework: 'sme', externalAudit: 'undetermined' }
const input = { nameAr: 'شركة', branchIds: [1], framework: 'sme' as const, externalAudit: 'undetermined' as const }
const S = () => useRawDataStore.getState()
const basis = () => financialEntityBasis(S().financialEntityProfiles, S().branches)
const wrap = (state: object) => JSON.stringify({ state })
beforeEach(() => useRawDataStore.setState({ ...initial, branches, financialEntityProfiles: [], journal: [], appUsers: [], currentUserId: null, activeBranchId: null, loggedOut: false, auditLog: [] }))
afterEach(() => { cleanup(); useRawDataStore.setState(initial) })

it('يحفظ إعداداً وصفياً للمالك دون المساس بالقيود ويرفض التداخل أو أساساً قديماً', () => {
 const old = basis(), journal = S().journal
 const entity = S().saveFinancialEntityProfile(input, old, 'الإعداد الأول')
 expect(entity).toMatchObject(input); expect(S().journal).toBe(journal)
 expect(S().auditLog.some(event => event.title.includes('الإعداد الأول'))).toBe(true)
 expect(() => S().saveFinancialEntityProfile({ ...input, nameAr: 'أخرى' }, old, 'سبب')).toThrow(/تغيرت/)
 expect(() => S().saveFinancialEntityProfile({ ...input, nameAr: 'أخرى' }, basis(), 'سبب')).toThrow(/أكثر من كيان/)
 expect(() => S().saveFinancialEntityProfile({ ...input, id: entity.id, branchIds: [99] }, basis(), 'سبب')).toThrow(/غير موجود/)
 expect(() => S().saveFinancialEntityProfile({ ...input, id: entity.id }, basis(), '')).toThrow(/سبب/)
 expect(() => S().removeBranch(2)).toThrow(/ارتباط/)
 S().removeFinancialEntityProfile(entity.id, basis(), 'تصحيح')
 expect(S().financialEntityProfiles).toEqual([]); expect(S().journal).toBe(journal)
})
it('يمنع موظف الفرع والجلسة المغلقة من الوصول أو التعديل حتى عبر إجراءات المتجر الخام', () => {
 S().saveFinancialEntityProfile(input, basis(), 'سبب')
 useRawDataStore.setState({ appUsers: [{ id: 3, nameAr: 'موظف', roleId: 'cashier', pinHash: '', active: true, branchId: 2 }], currentUserId: 3 })
 expect(useDataStore.getState().financialEntityProfiles).toEqual([])
 expect(() => S().saveFinancialEntityProfile(input, basis(), 'سبب')).toThrow(/للمالك/)
 expect(() => S().removeFinancialEntityProfile(S().financialEntityProfiles[0].id, basis(), 'سبب')).toThrow(/للمالك/)
 useRawDataStore.setState({ currentUserId: null, loggedOut: true })
 expect(useDataStore.getState().financialEntityProfiles).toEqual([])
 expect(() => S().saveFinancialEntityProfile(input, basis(), 'سبب')).toThrow(/للمالك/)
})
it('يرفض الدمج تغييرات متزامنة في كيانات أو فروع ويحافظ على الروابط', () => {
 const before = { branches, financialEntityProfiles: [] }
 const left = { ...before, financialEntityProfiles: [sample] }
 const right = { ...before, financialEntityProfiles: [{ ...sample, id: 'other' }] }
 const changedBranch = { ...before, branches: [branches[0]] }
 expect(() => mergeConcurrentSnapshots(wrap(before), wrap(left), wrap(right))).toThrow(/تعارض/)
 expect(() => mergeConcurrentSnapshots(wrap(before), wrap(changedBranch), wrap(left))).toThrow(/تعارض/)
 expect(JSON.parse(mergeConcurrentSnapshots(wrap(before), wrap(left), wrap(before))).state.financialEntityProfiles).toEqual([sample])
 const existing = { branches, financialEntityProfiles: [sample] }
 expect(() => mergeConcurrentSnapshots(wrap(existing), wrap({ ...existing, branches: [branches[1]] }), wrap(existing))).toThrow(/غير موجود/)
})
it('واجهة الإعداد تُبقي الحالتين غير محددتين افتراضياً وتسمح بربط الفروع مع ذكر الحدود', () => {
 render(<FinancialEntitiesSettings />)
 expect(screen.getByText(/لا يفصل الدفاتر/)).toBeTruthy()
 fireEvent.click(screen.getByText('إضافة إعداد كيان'))
 expect(screen.getAllByDisplayValue('غير محدد')).toHaveLength(2)
 fireEvent.change(screen.getByLabelText('اسم المنشأة أو الكيان'), { target: { value: 'شركة تجريبية' } })
 fireEvent.click(screen.getByLabelText('الرئيسي'))
 fireEvent.change(screen.getByLabelText('سبب الإعداد أو التعديل أو الحذف (يسجل في التدقيق)'), { target: { value: 'للمراجعة' } })
 fireEvent.click(screen.getByText('حفظ الإعداد'))
 expect(S().financialEntityProfiles[0]).toMatchObject({ nameAr: 'شركة تجريبية', branchIds: [1], framework: 'undetermined', externalAudit: 'undetermined' })
})
