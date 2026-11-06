import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ACTIVITY_TEMPLATES } from '../src/core/activities.ts'
import { type Quotation } from '../src/core/contracting.ts'
import { canAccessPath, effectivePermissionsFor, permissionsForModules, rolesWithOverrides } from '../src/core/permissions.ts'
import { pathAllowedForSetup } from '../src/core/coaVisibility.ts'
import { NAV_SECTIONS } from '../src/ui/navCatalog.tsx'
import { QuotationsPage } from '../src/ui/pages/QuotationsPage.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'

const raw = useRawDataStore.getState(), app = useAppStore.getState()
const quote: Quotation = {
  id: 7, quoteNumber: 'QT-0007', kind: 'quotation', clientName: 'شركة النور', clientId: 9901,
  titleAr: 'توريد وتركيب', date: '2026-11-05', validUntil: '2027-01-01',
  lines: [{ nameAr: 'خدمة', descriptionAr: 'تفاصيل الأعمال', qty: 2, unitAr: 'عدد', unitPriceMinor: 1000, estCostMinor: 300, vatPercent: 15 }],
  status: 'draft', notes: 'شروط العرض', projectId: null, winProbability: 50, bidBondMinor: 0,
}
const mount = () => render(<MemoryRouter><QuotationsPage /><ToastHost /></MemoryRouter>)
beforeEach(() => {
  useAppStore.getState().setActiveBranchContext(null)
  const setup = { ...app.setup, countryCode: 'SA', activityId: 'contracting', modules: ['contracting', 'inventory', 'purchases'] as typeof app.setup.modules }
  useAppStore.setState({ companySetup: setup, setup, receipt: { ...app.receipt, silentPrint: true } })
  useRawDataStore.setState({ ...raw, branches: [], activeBranchId: null, currentUserId: null, quotations: [quote], customers: [{ ...EMPTY_EXTENDED, id: 9901, nameAr: 'شركة النور', phone: '', creditLimitMinor: 0, notes: '' }], auditLog: [] })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(raw); useAppStore.setState(app) })

describe('وصول ومعاينة العروض لكل الأنشطة', () => {
  it.each(ACTIVITY_TEMPLATES.map(activity => [activity.id, activity] as const))('%s: قائمة عامة ومعاينة مستقلة عن الطباعة الصامتة', (_id, activity) => {
    const section = NAV_SECTIONS.find(s => s.id === 'quotations')!
    expect(section.module).toBeUndefined()
    expect(section.children[0].path).toBe('/contracting/quotations')
    expect(pathAllowedForSetup('/contracting/quotations', activity.modules, activity.features, activity.id)).toBe(true)
    const setup = { ...useAppStore.getState().setup, activityId: activity.id, modules: activity.modules, features: activity.features }
    useAppStore.setState({ companySetup: setup, setup })
    mount()
    fireEvent.click(screen.getByTitle('معاينة عرض السعر'))
    expect(usePrintPreview.getState().open).toBe(true)
    const preview = usePrintPreview.getState().handle!
    expect(preview.html).toContain('QT-0007')
    expect(preview.html).toContain('تفاصيل الأعمال')
    expect(preview.rebuild?.()).toContain('شروط العرض')
  })
  it('زر معاينة المحرر لا يطبع صامتاً ولا يغير تاريخ العرض المحفوظ', () => {
    mount()
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    fireEvent.click(screen.getByRole('button', { name: /معاينة/ }))
    expect(usePrintPreview.getState().open).toBe(true)
    expect(useRawDataStore.getState().quotations[0]).toEqual(quote)
  })
  it('العرض المتحول لمشروع يمكن معاينته ولا يمكن حذفه أو تعديله', () => {
    useRawDataStore.setState({ quotations: [{ ...quote, status: 'won', projectId: 12 }] })
    mount()
    expect(screen.queryByTitle('فتح العرض وتعديله')).toBeNull()
    expect((screen.getByTitle('لا يمكن حذف عرض تحوّل إلى مشروع') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTitle('معاينة عرض السعر'))
    expect(usePrintPreview.getState().open).toBe(true)
  })
  it('البحث بالعميل والرقم وتصفية الحالة', () => {
    useRawDataStore.setState({ quotations: [quote, { ...quote, id: 8, quoteNumber: 'TN-0008', kind: 'tender', status: 'submitted', clientName: 'عميل آخر' }] })
    mount()
    fireEvent.change(screen.getByLabelText('بحث عروض الأسعار'), { target: { value: 'النور' } })
    expect(document.querySelectorAll('[data-quotation-preview]')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('بحث عروض الأسعار'), { target: { value: 'TN-0008' } })
    expect(document.querySelectorAll('[data-quotation-preview]')).toHaveLength(1)
    // QuickSelect mirrors a native select for keyboard/accessibility.
    fireEvent.change(screen.getByLabelText('حالة عرض السعر'), { target: { value: 'draft' } })
    expect(document.querySelectorAll('[data-quotation-preview]')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toContain('لا عروض مطابقة')
  })
  it('تحويل المشروع لا يظهر لنشاط غير مفعل للمقاولات', () => {
    const setup = { ...useAppStore.getState().setup, modules: ['pos', 'inventory', 'purchases'] as typeof app.setup.modules, activityId: 'grocery' }
    useAppStore.setState({ companySetup: setup, setup })
    useRawDataStore.setState({ quotations: [{ ...quote, status: 'won' }] })
    mount()
    expect(screen.queryByTitle('تحويل لمشروع')).toBeNull()
    expect(pathAllowedForSetup('/contracting/projects', ['pos'], [], 'grocery')).toBe(false)
  })
})

describe('الحذف الآمن', () => {
  it('التأكيد والتراجع قبل حذف العرض من القائمة ومصادر التعبئة', () => {
    mount()
    fireEvent.click(screen.getByTitle('حذف عرض السعر'))
    expect(useDataStore.getState().quotations).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'تراجع' }))
    expect(useDataStore.getState().quotations).toHaveLength(1)
    fireEvent.click(screen.getByTitle('حذف عرض السعر'))
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الحذف/ }))
    expect(useDataStore.getState().quotations).toHaveLength(0)
    expect(document.querySelector('[data-quotation-preview]')).toBeNull()
    expect(screen.getByText('لا عروض أسعار بعد')).toBeTruthy()
  })
  it.each(['draft', 'submitted', 'won', 'lost'] as const)('حذف %s بلا أثر مالي مع حفظ الرقم والتدقيق', status => {
    useRawDataStore.setState({ quotations: [{ ...quote, status }] })
    const before = useRawDataStore.getState()
    useDataStore.getState().deleteQuotation(quote.id)
    const after = useRawDataStore.getState()
    expect(after.journal).toBe(before.journal)
    expect(after.items).toBe(before.items)
    expect(after.customers).toBe(before.customers)
    expect(after.projects).toBe(before.projects)
    expect(after.quotations[0].deletedAt).toBeTruthy()
    expect(after.auditLog.at(-1)?.title).toContain('QT-0007')
    expect(useDataStore.getState().quotations).toEqual([])
    expect(useDataStore.getState()).toBe(useDataStore.getState())
    const next = useDataStore.getState().addQuotation({ ...quote, lines: quote.lines })
    expect(next.id).toBe(8)
    expect(next.quoteNumber).toBe('QT-0008')
    expect(() => useDataStore.getState().updateQuotation(7, { titleAr: 'محاولة' })).toThrow('محذوف')
    expect(() => useDataStore.getState().setQuotationStatus(7, 'submitted')).toThrow('محذوف')
    expect(() => useDataStore.getState().convertQuotationToProject(7, 5)).toThrow('محذوف')
    // Reloaded snapshots preserve the tombstone, preventing resurrection and number reuse.
    useRawDataStore.setState({ quotations: JSON.parse(JSON.stringify(useRawDataStore.getState().quotations)) })
    expect(useDataStore.getState().quotations.map(q => q.id)).toEqual([8])
  })
  it('يحجب التحول إلى مشروع حتى إذا تغير العرض بعد فتح تأكيد الحذف', () => {
    mount()
    fireEvent.click(screen.getByTitle('حذف عرض السعر'))
    useRawDataStore.setState({ quotations: [{ ...quote, projectId: 3 }] })
    fireEvent.click(screen.getByRole('button', { name: /تأكيد الحذف/ }))
    expect(useDataStore.getState().quotations).toHaveLength(1)
    expect(useRawDataStore.getState().auditLog).toHaveLength(0)
  })
  it('صلاحية الحذف مستقلة ومفروضة من المستودع أيضاً', () => {
    useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'كاشير', roleId: 'cashier', active: true, pinHash: '' }] })
    mount()
    expect((screen.getByTitle('تحتاج صلاحية حذف عروض الأسعار') as HTMLButtonElement).disabled).toBe(true)
    expect(() => useDataStore.getState().deleteQuotation(7)).toThrow('صلاحية')
    useRawDataStore.setState({ appUsers: [{ id: 20, nameAr: 'كاشير', roleId: 'cashier', active: true, pinHash: '', extraPerms: ['sales.quotation.delete'] }] })
    useDataStore.getState().deleteQuotation(7)
    expect(useDataStore.getState().quotations).toHaveLength(0)
  })
  it('الحذف لا يتجاوز عزل الفرع حتى عند استدعاء المتجر الخام', () => {
    const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'فرع ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
    useRawDataStore.setState({ branches, activeBranchId: 1, quotations: [{ ...quote, branchId: 2 } as Quotation] })
    const before = useRawDataStore.getState()
    expect(() => useRawDataStore.getState().deleteQuotation(7)).toThrow('الفرع')
    expect(useRawDataStore.getState()).toBe(before)
    useRawDataStore.setState({ activeBranchId: 2 })
    useRawDataStore.getState().deleteQuotation(7)
    expect(useDataStore.getState().quotations).toHaveLength(0)
    expect(useDataStore.getState()).toBe(useDataStore.getState())
  })
  it('صلاحيات إدارة العروض عامة وتظل قابلة للمنع الصريح دون فتح شاشات المقاولات', () => {
    expect(permissionsForModules([]).some(p => p.id === 'sales.quotation.delete')).toBe(true)
    const roles = rolesWithOverrides({}, [], 'grocery')
    const perms = effectivePermissionsFor({ roleId: 'cashier' }, roles)
    expect(canAccessPath('/contracting/quotations', perms)).toBe(true)
    expect(perms.has('sales.quotation.delete')).toBe(false)
    const denied = effectivePermissionsFor({ roleId: 'cashier', deniedPerms: ['sales.quotation.manage'] }, roles)
    expect(canAccessPath('/contracting/quotations', denied)).toBe(false)
    expect(canAccessPath('/contracting/projects', perms)).toBe(false)
  })
})

describe('مراجعة حراس العروض', () => {
  it('إلغاء إدارة العروض من الدور يبقى نافذاً ولو احتفظ بصلاحية البيع أو التشغيل', () => {
    for (const permissions of [['sales.invoice.create'], ['ops.activity.use']]) {
      const roles = rolesWithOverrides({ cashier: permissions }, [], 'grocery')
      expect(effectivePermissionsFor({ roleId: 'cashier' }, roles).has('sales.quotation.manage')).toBe(false)
    }
  })
  it('المستخدم المحجوب عن إدارة العروض لا يكتب من نافذة قديمة أو استدعاء مباشر', () => {
    useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'مستخدم محجوب', roleId: 'cashier', active: true, pinHash: '', deniedPerms: ['sales.quotation.manage'] }] })
    const before = useRawDataStore.getState()
    expect(() => before.addQuotation({ ...quote, lines: quote.lines })).toThrow('صلاحية')
    expect(() => before.updateQuotation(7, { titleAr: 'تعديل محجوب' })).toThrow('صلاحية')
    expect(() => before.setQuotationStatus(7, 'submitted')).toThrow('صلاحية')
    expect(useRawDataStore.getState()).toBe(before)
  })
  it('لا ينشئ تحويل عرض فرع آخر مشروعاً جزئياً قبل رفض الربط', () => {
    useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 1, quotations: [{ ...quote, status: 'won', branchId: 2 } as Quotation] })
    const before = useRawDataStore.getState()
    expect(() => before.convertQuotationToProject(7, 5)).toThrow()
    expect(useRawDataStore.getState()).toBe(before)
  })
  it('لا يربط العرض بعميل من فرع آخر حتى عند الاستدعاء المباشر', () => {
    useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 1, customers: [{ ...EMPTY_EXTENDED, id: 9901, nameAr: 'عميل أجنبي', branchId: 2, phone: '', creditLimitMinor: 0, notes: '' }] })
    const before = useRawDataStore.getState()
    expect(() => before.addQuotation({ ...quote, lines: quote.lines })).toThrow()
    expect(() => before.updateQuotation(7, { clientId: 9901 })).toThrow()
    expect(useRawDataStore.getState()).toBe(before)
  })
  it('يرفض تحويل عرض يصعب تمثيل صافي بنده بسعر وحدة دون أثر جزئي', () => {
    useRawDataStore.setState({ quotations: [{ ...quote, status: 'won', lines: [{ ...quote.lines[0], qty: 3, unitPriceMinor: 10, vatPercent: 5, taxIncluded: true }] }] })
    const before = useRawDataStore.getState()
    expect(() => before.convertQuotationToProject(7, 5)).toThrow(/تقريب/)
    expect(useRawDataStore.getState()).toBe(before)
  })
  it('تحويل عرض قابل للتمثيل يطابق صافي العقد ومجموع جدول كمياته', () => {
    useRawDataStore.setState({ quotations: [{ ...quote, status: 'won', lines: [{ ...quote.lines[0], qty: 2, unitPriceMinor: 115, vatPercent: 15, taxIncluded: true }] }] })
    const project = useRawDataStore.getState().convertQuotationToProject(7, 5)
    const boq = useRawDataStore.getState().boqItems.filter(row => row.projectId === project.id)
    expect(project.contractValueMinor).toBe(200)
    expect(boq.reduce((sum, row) => sum + Math.round(row.qty * row.unitPriceMinor), 0)).toBe(project.contractValueMinor)
  })
  it('تحويل مشروع يتطلب صلاحية التشغيل في المستودع وليس إظهار الزر فقط', () => {
    useRawDataStore.setState({ quotations: [{ ...quote, status: 'won' }], currentUserId: 20, appUsers: [{ id: 20, nameAr: 'بائع', roleId: 'cashier', active: true, pinHash: '' }] })
    const before = useRawDataStore.getState()
    expect(() => before.convertQuotationToProject(7, 5)).toThrow('صلاحية')
    expect(useRawDataStore.getState()).toBe(before)
  })
})


it('يتحقق المستودع من تفعيل المقاولات قبل تحويل العرض حتى للمالك', () => {
  const setup = { ...useAppStore.getState().setup, modules: ['pos', 'inventory', 'purchases'] as typeof app.setup.modules, activityId: 'grocery' }
  useAppStore.setState({ companySetup: setup, setup })
  useRawDataStore.setState({ quotations: [{ ...quote, status: 'won' }] })
  const before = useRawDataStore.getState()
  expect(() => before.convertQuotationToProject(7, 5)).toThrow('وحدة المقاولات')
  expect(useRawDataStore.getState()).toBe(before)
})

it('يمنع المستخدم الموقوف من تعديل عرض ولو بقيت نافذته مفتوحة', () => {
  useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'موقوف', roleId: 'owner', active: false, pinHash: '' }] })
  const before = useRawDataStore.getState()
  expect(() => before.updateQuotation(7, { titleAr: 'تعديل' })).toThrow('صلاحية')
  expect(() => before.deleteQuotation(7)).toThrow('صلاحية')
  expect(useRawDataStore.getState()).toBe(before)
})
