import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => commit() }))
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { QuotationsPage } from '../src/ui/pages/QuotationsPage.tsx'
import { ProjectEditorWindowView } from '../src/ui/windows/EntityPickerWindows.tsx'
import { CustomerQuickPicker } from '../src/ui/components/CustomerQuickPicker.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'

const data = useRawDataStore.getState(), app = useAppStore.getState()
const S = () => useRawDataStore.getState()
const searchAndCreate = (label: string, query: string) => {
 fireEvent.change(screen.getByLabelText(label), { target: { value: query } })
 fireEvent.click(screen.getByRole('button', { name: '+ عميل جديد' }))
 expect((screen.getByLabelText('اسم العميل الجديد') as HTMLInputElement).value).toBe(query)
}
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], quotations: [], projectExtracts: [], clientAdvances: [], advancedInvoiceDrafts: [], roleOverrides: {}, branchRoleOverrides: {}, customRoles: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })

it('العرض ينشئ العميل من البحث ويحتفظ بعنوانه ويربط العميل في المسودة', () => {
 render(<MemoryRouter><QuotationsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /عرض \/ مناقصة/ }))
 fireEvent.change(screen.getByPlaceholderText('تشطيب فيلا — الدور الأول…'), { target: { value: 'عرض محفوظ' } })
 searchAndCreate('بحث العميل المسجَّل', 'شركة العرض')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 const customer = S().customers[0]
 expect(customer.nameAr).toBe('شركة العرض')
 expect((screen.getByLabelText('اسم العميل') as HTMLInputElement).value).toBe(customer.nameAr)
 fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
 const saved = JSON.parse(S().advancedInvoiceDrafts[0].payload)
 expect(saved).toMatchObject({ titleAr: 'عرض محفوظ', clientId: String(customer.id), clientName: customer.nameAr })
})

it('المشروع الجديد ينشئ عميلاً ويختاره مع بقاء بيانات المشروع في المسودة', () => {
 render(<MemoryRouter><ProjectsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /مشروع جديد/ }))
 fireEvent.change(screen.getByPlaceholderText('فيلا الشيخ زايد…'), { target: { value: 'مشروع محفوظ' } })
 searchAndCreate('بحث العميل', 'شركة المشروع')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 const customer = S().customers[0]
 expect((screen.getByLabelText('اسم العميل') as HTMLInputElement).value).toBe(customer.nameAr)
 fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
 expect(JSON.parse(S().advancedInvoiceDrafts[0].payload)).toMatchObject({ nameAr: 'مشروع محفوظ', clientId: String(customer.id), clientName: customer.nameAr })
})

it('محرر المشروع السريع يربط العميل بعد إنشائه دون مغادرة المشروع', () => {
 render(<MemoryRouter><ProjectEditorWindowView /><ToastHost /></MemoryRouter>)
 fireEvent.change(screen.getByLabelText('اسم المشروع'), { target: { value: 'مشروع فرعي' } })
 searchAndCreate('بحث عميل المشروع', 'عميل المحرر')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 expect((screen.getByLabelText('اسم عميل المشروع') as HTMLInputElement).value).toBe('عميل المحرر')
 expect((screen.getByLabelText('اسم المشروع') as HTMLInputElement).value).toBe('مشروع فرعي')
})

it('الإلغاء لا ينشئ أو يبدّل العميل، ويحذر عند تغيير البيانات', () => {
 const onChange = vi.fn()
 render(<><CustomerQuickPicker parties={[]} value={0} cashLabel="نقدي" label="بحث عميل" onChange={onChange} /><ToastHost /></>)
 searchAndCreate('بحث عميل', 'اسم مقترح')
 fireEvent.change(screen.getByLabelText('هاتف العميل الجديد'), { target: { value: '123' } })
 fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
 expect(screen.getByRole('alert').textContent).toContain('تجاهل')
 fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'تجاهل' }))
 expect(S().customers).toHaveLength(0); expect(onChange).not.toHaveBeenCalled()
})

it('يمنع الحفظ عند سحب الصلاحية بعد فتح النموذج ويرفض الاسم المكرر', () => {
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'مكرر', phone: '', notes: '', creditLimitMinor: 0 })
 const onChange = vi.fn()
 render(<><CustomerQuickPicker parties={S().customers} value={0} cashLabel="نقدي" label="بحث عميل" onChange={onChange} /><ToastHost /></>)
 searchAndCreate('بحث عميل', 'مكرر')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 expect(S().customers).toHaveLength(1); expect(onChange).not.toHaveBeenCalled()
 act(() => { useRawDataStore.setState({ currentUserId: 9, appUsers: [{ id: 9, nameAr: 'مستخدم', roleId: 'restricted', active: true, pinHash: '' }], customRoles: [{ id: 'restricted', nameAr: 'مقيد' }], roleOverrides: { restricted: [] } }) })
 fireEvent.change(screen.getByLabelText('اسم العميل الجديد'), { target: { value: 'اسم آخر' } })
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 expect(S().customers).toHaveLength(1); expect(onChange).not.toHaveBeenCalled()
})

it('قفل ربط المشروع بعد مستخلص يمنع منتقي وإنشاء عميل في التعديل', async () => {
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'العميل الأصلي', phone: '', notes: '', creditLimitMinor: 0 })
 const customer = S().customers[0]
 const project = S().addProject({ nameAr: 'مشروع مقفل', clientName: customer.nameAr, clientId: customer.id, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().addProjectExtract({ projectId: project.id, description: 'أعمال', payment: 'credit', vatPercent: 0, grossMinor: 5000 })
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('تعديل بيانات المشروع (القيمة قبل أول مستخلص فقط)'))
 await waitFor(() => expect((screen.getByLabelText('ربط العميل') as HTMLInputElement).disabled).toBe(true))
 expect(screen.queryByRole('button', { name: '+ عميل جديد' })).toBeNull()
})

it('يحفظ المشروع الجديد بالعميل الذي أُنشئ من المنتقي', () => {
 render(<MemoryRouter><ProjectsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /مشروع جديد/ }))
 fireEvent.change(screen.getByPlaceholderText('فيلا الشيخ زايد…'), { target: { value: 'مشروع مرتبط' } })
 searchAndCreate('بحث العميل', 'عميل مرتبط')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 fireEvent.click(screen.getByRole('button', { name: 'قيمة إجمالية' }))
 fireEvent.change(document.getElementById('project-contract-value')!, { target: { value: '1000' } })
 fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
 expect(S().projects[0]).toMatchObject({ nameAr: 'مشروع مرتبط', clientId: S().customers[0].id, clientName: 'عميل مرتبط' })
})

it('تعديل مشروع غير مقفل يحفظ ربط العميل الجديد', async () => {
 S().addProject({ nameAr: 'مشروع للتعديل', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 render(<MemoryRouter><ProjectsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('تعديل بيانات المشروع (القيمة قبل أول مستخلص فقط)'))
 searchAndCreate('بحث العميل', 'عميل التعديل')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 expect((screen.getByLabelText('الجهة المالكة') as HTMLInputElement).value).toBe('عميل التعديل')
 fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }))
 await waitFor(() => expect(S().projects[0]).toMatchObject({ clientId: S().customers[0].id, clientName: 'عميل التعديل' }))
})

it('يخفي زر الإنشاء لمن ليست له صلاحية إدارة العملاء', () => {
 useRawDataStore.setState({ currentUserId: 9, appUsers: [{ id: 9, nameAr: 'مستخدم', roleId: 'restricted', active: true, pinHash: '' }], customRoles: [{ id: 'restricted', nameAr: 'مقيد' }], roleOverrides: { restricted: [] } })
 render(<CustomerQuickPicker parties={[]} value={0} cashLabel="نقدي" label="بحث عميل" onChange={() => {}} />)
 fireEvent.change(screen.getByLabelText('بحث عميل'), { target: { value: 'غير مصرح' } })
 expect(screen.queryByRole('button', { name: '+ عميل جديد' })).toBeNull()
})

it('الكاشير ينشئ عميلاً من نافذة الجزء الآجل ويحافظ على السلة', async () => {
 const { PosPage } = await import('../src/ui/pages/PosPage.tsx')
 S().addItem({ nameAr: 'سلعة اختبار', sku: 'TEST', barcodes: ['622100'], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 20, priceMinor: 200, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const view = render(<MemoryRouter><PosPage /><ToastHost /></MemoryRouter>)
 const scan = view.container.querySelector('input')!
 fireEvent.change(scan, { target: { value: '622100' } })
 fireEvent.keyDown(scan, { key: 'Enter', code: 'Enter' })
 fireEvent.click(screen.getByText(/الدفع \(F9\)/))
 const paid = document.querySelector('input[type="number"]')!
 fireEvent.change(paid, { target: { value: '0' } })
 searchAndCreate('بحث العميل للجزء الآجل', 'عميل الكاشير')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 expect((screen.getByLabelText('بحث العميل للجزء الآجل') as HTMLInputElement).value).toBe('عميل الكاشير')
 expect(view.container.textContent).toContain('سلعة اختبار')
})

it('تغيير الفرع بعد فتح نموذج العميل يمنع إنشاءه في فرع غير مقصود', () => {
 useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 1 })
 const onChange = vi.fn()
 render(<><CustomerQuickPicker parties={[]} value={0} cashLabel="نقدي" label="بحث عميل" onChange={onChange} /><ToastHost /></>)
 searchAndCreate('بحث عميل', 'عميل الفرع')
 act(() => { useRawDataStore.setState({ activeBranchId: 2 }) })
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 expect(S().customers).toHaveLength(0); expect(onChange).not.toHaveBeenCalled()
})

it('حفظ تعديل عرض قائم يربطه بالعميل المنشأ دون تغيير بنوده', async () => {
 const quote = { id: 7, quoteNumber: 'QT-0007', kind: 'quotation', clientName: 'قديم', clientId: null, titleAr: 'عرض قائم', date: '2026-01-01', validUntil: '2099-01-01', status: 'draft', lines: [{ nameAr: 'خدمة', descriptionAr: 'بند', qty: 1, unitAr: 'عدد', unitPriceMinor: 1000, estCostMinor: 0, vatPercent: 0 }], notes: '', projectId: null, winProbability: 50, bidBondMinor: 0 }
 useRawDataStore.setState({ quotations: [quote] as never[] })
 render(<MemoryRouter><QuotationsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
 searchAndCreate('بحث العميل المسجَّل', 'عميل العرض المعدل')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
 await waitFor(() => expect(S().quotations[0]).toMatchObject({ clientId: S().customers[0].id, clientName: 'عميل العرض المعدل', titleAr: 'عرض قائم', lines: [{ descriptionAr: 'بند' }] }))
})

it('يُنشأ العميل في الفرع الفعلي ويظهر مختاراً فيه', () => {
 useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 2 })
 const onChange = vi.fn()
 render(<><CustomerQuickPicker parties={[]} value={0} cashLabel="نقدي" label="بحث عميل" onChange={onChange} /><ToastHost /></>)
 searchAndCreate('بحث عميل', 'عميل الفرع الثاني')
 fireEvent.click(screen.getByRole('button', { name: /حفظ واختيار/ }))
 expect(S().customers[0]).toMatchObject({ nameAr: 'عميل الفرع الثاني', branchId: 2 })
 expect(onChange).toHaveBeenCalledWith(S().customers[0].id)
})
