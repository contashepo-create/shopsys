import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { draftFromCategory } from '../src/core/items.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useToast } from '../src/ui/components/ui.tsx'
import { AdvancedSalesInvoicePage } from '../src/ui/pages/AdvancedSalesInvoicePage.tsx'
const lock = vi.hoisted(() => ({ failAfter: false, before: null as null | (() => void), after: null as null | (() => void) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { lock.before?.(); const result = commit(); lock.after?.(); if (lock.failAfter) throw new Error('flush failed'); return result } }))
const data = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery' as const, vatPercent: 0, taxRegistrationStatus: 'exempt' as const, requireOpenShiftForSales: false }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], receipt: { ...app.receipt, silentPrint: false, printAfterSave: true, cashierPrint: false } })
 useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], customers: [], suppliers: [], items: [{ ...draftFromCategory(undefined, 'POST'), id: 1, nameAr: 'خدمة الاختبار', isService: true, costMinor: 0, priceMinor: 5000 }], sales: [], journal: [], warehouses: [], batches: [], serials: [] })
 lock.failAfter = false; lock.before = null; lock.after = null; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(data); useAppStore.setState(app) })
function post() {
 render(<MemoryRouter><AdvancedSalesInvoicePage /></MemoryRouter>)
 fireEvent.doubleClick(screen.getByLabelText('اسم الصنف — اكتب أو اضغط مرتين للبحث'))
 fireEvent.doubleClick(screen.getByRole('option', { name: /خدمة الاختبار/ }))
 fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
}
it('الطباعة بعد تأكيد الحفظ تظهر رقم ومرجع الفاتورة المسجلة', async () => {
 post(); await waitFor(() => expect(usePrintPreview.getState().open).toBe(true))
 const invoice = useRawDataStore.getState().sales[0], html = usePrintPreview.getState().handle!.html
 expect(html).toContain(invoice.invoiceNumber); expect(html).toContain(invoice.refCode)
 expect(html).toContain('خدمة الاختبار'); expect(html).not.toContain('مسودة تعديل')
})
it('فشل تأكيد الحفظ لا يفتح طبعة مستند صادر', async () => {
 lock.failAfter = true; post()
 await waitFor(() => expect(useToast.getState().msg).toContain('تعذّر تأكيد اكتمال الحفظ'))
 expect(useRawDataStore.getState().sales).toHaveLength(1)
 expect(usePrintPreview.getState().open).toBe(false)
 fireEvent.click(screen.getByTitle('طباعة الفاتورة الآن دون إغلاقها — تتبع مفاتيح الطباعة الثلاثة أسفل المستند'))
 expect(usePrintPreview.getState().handle?.html).toContain('مسودة')
})

it('تغيير الفرع قبل دخول القفل يرفض الترحيل بلا مستند', async () => {
 lock.before = () => { useRawDataStore.setState({ activeBranchId: 2 }) }; post()
 await waitFor(() => expect(useToast.getState().msg).toContain('تغير المستخدم أو الفرع'))
 expect(useRawDataStore.getState().sales).toHaveLength(0)
 expect(usePrintPreview.getState().open).toBe(false)
})
it('تغيير الفرع بعد التسجيل يمنع فتح الطبعة بسياق مختلف', async () => {
 lock.after = () => { useRawDataStore.setState({ activeBranchId: 2 }) }; post()
 await waitFor(() => expect(useToast.getState().msg).toContain('لم تُفتح طباعتها'))
 expect(useRawDataStore.getState().sales).toHaveLength(1)
 expect(usePrintPreview.getState().open).toBe(false)
})
