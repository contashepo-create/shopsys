import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { currentDocumentContact } from '../src/core/customerProfile.ts'
import { QuotationsPage } from '../src/ui/pages/QuotationsPage.tsx'
import { renderProjectHtml } from '../src/ui/print/printProject.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const quoteArgs = { kind: 'quotation' as const, clientName: 'جهة أولى', titleAr: 'عرض أعمال', validUntil: '2099-01-01', lines: [{ descriptionAr: 'عمل', qty: 1, unitAr: 'عدد', unitPriceMinor: 10000 }], notes: '' }
const projectArgs = { nameAr: 'مشروع', clientName: 'جهة أولى', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' }
beforeEach(() => {
 const setup = { ...app.setup, activityId: 'contracting' as const, countryCode: 'SA', modules: ['contracting'] as typeof app.setup.modules }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, currentUserId: null, loggedOut: false, customers: [], projects: [], projectDeletionRecords: [], quotations: [], quotationDeletionRecords: [], projectExtracts: [], clientAdvances: [], boqItems: [] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'جهة أولى', phone: '', creditLimitMinor: 0, notes: '', customerType: 'company', contactPerson: '<سارة>', contactRole: 'مديرة', contactPhone: '050123', contactEmail: 'sara@example.com' })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'جهة ثانية', phone: '', creditLimitMinor: 0, notes: '', customerType: 'government', contactPerson: 'أحمد' })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(original); useAppStore.setState(app) })

it('يلتقط بيانات الاتصال للعرض والمشروع وقت الربط ولا يغيرها تعديل بطاقة العميل أو تحرير المحتوى', () => {
 const [a] = S().customers
 const q = S().addQuotation({ ...quoteArgs, clientId: a.id })
 const p = S().addProject({ ...projectArgs, clientId: a.id })
 expect(q.customerContactHistory?.[0]).toMatchObject({ customerId: a.id, customerName: 'جهة أولى', profile: { customerType: 'company', contactPerson: '<سارة>', contactPhone: '050123' } })
 expect(p.customerContactHistory?.[0]).toMatchObject({ customerId: a.id, customerName: 'جهة أولى', profile: { contactPerson: '<سارة>', contactPhone: '050123' } })
 S().updateCustomer(a.id, { contactPerson: 'اسم جديد', contactPhone: '055999' })
 S().updateQuotation(q.id, { titleAr: 'عنوان آخر' }); S().updateProject(p.id, { notes: 'تعديل' })
 expect(S().quotations[0].customerContactHistory?.[0].profile.contactPerson).toBe('<سارة>')
 expect(S().projects[0].customerContactHistory?.[0].profile.contactPhone).toBe('050123')
 const html = renderProjectHtml({ shopName: 'شركة', project: S().projects[0], items: [], orders: [], history: [], fmt: String, currency: 'ر.س' })
 expect(html).toContain('&lt;سارة&gt;'); expect(html).not.toContain('<سارة>'); expect(html).not.toContain('اسم جديد')
 render(<MemoryRouter><QuotationsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
 expect(screen.getByText(/بيانات العميل الحالية.*اسم جديد/)).toBeTruthy()
 expect(screen.getByText(/بيانات التواصل عند الربط.*<سارة>/)).toBeTruthy()
})
it('إعادة ربط العميل تضيف لقطة جديدة دون محو القديمة، والسجلات القديمة لا يُختلق لها ماضٍ', () => {
 const [a, b] = S().customers
 const q = S().addQuotation({ ...quoteArgs, clientId: a.id })
 const p = S().addProject({ ...projectArgs, clientId: a.id })
 S().updateQuotation(q.id, { clientId: b.id, clientName: b.nameAr })
 S().updateProject(p.id, { clientId: b.id, clientName: b.nameAr })
 expect(S().quotations[0].customerContactHistory?.map(event => event.profile.contactPerson)).toEqual(['<سارة>', 'أحمد'])
 expect(S().projects[0].customerContactHistory?.map(event => event.profile.contactPerson)).toEqual(['<سارة>', 'أحمد'])
 expect(currentDocumentContact(S().projects[0].customerContactHistory, a.id)).toBeUndefined()
 const old = { ...S().quotations[0], customerContactHistory: undefined }
 useRawDataStore.setState({ quotations: [old] })
 S().updateQuotation(old.id, { notes: 'قديم' })
 expect(S().quotations[0].customerContactHistory).toBeUndefined()
 S().updateQuotation(old.id, { clientId: a.id })
 expect(S().quotations[0].customerContactHistory).toHaveLength(1)
 expect(S().quotations[0].customerContactHistory?.[0].customerId).toBe(a.id)
})
it('يرفض تعديل أو إدخال سجل تاريخي مباشرة، ويستعيده JSON دون مشاركة مرجع بطاقة العميل', () => {
 const [a] = S().customers
 const p = S().addProject({ ...projectArgs, clientId: a.id })
 const q = S().addQuotation({ ...quoteArgs, clientId: a.id })
 expect(() => S().updateProject(p.id, { customerContactHistory: [] } as never)).toThrow(/سجل تواصل/)
 expect(() => S().updateQuotation(q.id, { customerContactHistory: [] } as never)).toThrow(/غير مسموح/)
 expect(() => S().addProject({ ...projectArgs, clientId: a.id, customerContactHistory: [] } as never)).toThrow(/تاريخي/)
 expect(JSON.parse(JSON.stringify(S().projects[0])).customerContactHistory).toEqual(S().projects[0].customerContactHistory)
 expect(JSON.parse(JSON.stringify(S().quotations[0])).customerContactHistory).toEqual(S().quotations[0].customerContactHistory)
})

it('معاينة عرض محفوظ تطبع بيانات الربط المسجلة مهربة لا بيانات البطاقة الحالية', () => {
 const [a] = S().customers
 S().addQuotation({ ...quoteArgs, clientId: a.id })
 S().updateCustomer(a.id, { contactPerson: 'شخص جديد' })
 render(<MemoryRouter><QuotationsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('معاينة عرض السعر'))
 const html = usePrintPreview.getState().handle?.html ?? ''
 expect(html).toContain('&lt;سارة&gt;'); expect(html).not.toContain('<سارة>'); expect(html).not.toContain('شخص جديد')
})

it('استعادة أو دمج لقطة لا تغير تاريخ التواصل المحفوظ لمستند باقٍ', async () => {
 const { assertContactHistoriesPreserved } = await import('../src/core/customerProfile.ts')
 const { mergeConcurrentSnapshots } = await import('../src/data/persistentStorage.ts')
 const [a] = S().customers
 const q = S().addQuotation({ ...quoteArgs, clientId: a.id })
 const base = { quotations: [q], projects: [] }
 const corrupt = { quotations: [{ ...q, customerContactHistory: [] }], projects: [] }
 expect(() => assertContactHistoriesPreserved(base, corrupt)).toThrow(/سجل التواصل التاريخي/)
 const other = { quotations: [{ ...q, notes: 'تعديل آخر' }], projects: [] }
 expect(() => mergeConcurrentSnapshots(JSON.stringify(base), JSON.stringify(corrupt), JSON.stringify(other))).toThrow(/سجل التواصل التاريخي/)
 const same = JSON.parse(JSON.stringify(base))
 expect(() => assertContactHistoriesPreserved(base, same)).not.toThrow()
})

it('تحويل العرض يلتقط بطاقة العميل وقت إنشاء المشروع ولا يغير لقطة العرض الأصلية', () => {
 const [a] = S().customers
 const q = S().addQuotation({ ...quoteArgs, clientId: a.id })
 S().setQuotationStatus(q.id, 'submitted'); S().setQuotationStatus(q.id, 'won')
 S().updateCustomer(a.id, { contactPerson: 'جهة المشروع الجديدة' })
 const project = S().convertQuotationToProject(q.id, 0)
 expect(project.customerContactHistory?.[0].profile.contactPerson).toBe('جهة المشروع الجديدة')
 expect(S().quotations[0].customerContactHistory?.[0].profile.contactPerson).toBe('<سارة>')
})

it('تعديل المشروع بجدول كميات يضيف سجل الربط دون استبدال السابق', () => {
 const [a, b] = S().customers
 const p = S().addProject({ ...projectArgs, clientId: a.id })
 const updated = S().updateProjectWithBoq({ id: p.id, expectedFingerprint: S().previewProjectEditFingerprint(p.id), changes: { clientId: b.id, clientName: b.nameAr }, sections: [], lines: [] })
 expect(updated.customerContactHistory?.map(item => item.profile.contactPerson)).toEqual(['<سارة>', 'أحمد'])
})

it('حارس اللقطات يرفض غياب قائمة مستندات لها سجل تواصل محفوظ ولا يفترض ماضياً للقديم', async () => {
 const { assertContactHistoriesPreserved } = await import('../src/core/customerProfile.ts')
 const [a] = S().customers
 const q = S().addQuotation({ ...quoteArgs, clientId: a.id })
 expect(() => assertContactHistoriesPreserved({ quotations: [q] }, {})).toThrow(/سجل التواصل التاريخي/)
 expect(() => assertContactHistoriesPreserved({ quotations: [{ id: 1 }] }, {})).not.toThrow()
 expect(() => assertContactHistoriesPreserved({ quotations: [q] }, { quotations: [] })).not.toThrow() // حذف المستند تحرسه سياسة أخرى
})

it('لقطة تواصل تالفة تعرض تنبيهاً بدل إظهار كائنات غير صالحة أو كسر الواجهة', async () => {
 const { DocumentContactSummary } = await import('../src/ui/components/CustomerProfileFields.tsx')
 const bad = { customerId: 1, customerName: { hidden: 1 }, capturedAt: '2026', capturedBy: 'مستخدم', profile: { contactPerson: { bad: true } } }
 render(<DocumentContactSummary history={[bad, bad] as never} customerId={1} />)
 expect(screen.getAllByText(/جهة التواصل التاريخية غير مسجلة/).length).toBeGreaterThan(0)
})
