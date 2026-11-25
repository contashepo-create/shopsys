import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { unzipSync, strFromU8 } from 'fflate'
import { LettersPage } from '../src/ui/pages/LettersPage.tsx'
import { LetterCanvas } from '../src/ui/pages/LetterCanvas.tsx'
import { LetterSignaturePad } from '../src/ui/pages/LetterSignaturePad.tsx'
import { ConfirmHost } from '../src/ui/components/ConfirmDialog.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { createLetterWord } from '../src/core/letterWord.ts'
import { applyCompleteLetterTemplate, applySavedLetterTemplate, captureLetterTemplate, createLetterLayout, getLetterBoxes, letterLayoutItems, LETTER_TEMPLATES } from '../src/core/letterLayout.ts'
import { newLetterParagraph, validLetterObjects, validateLetter, type Letter, type LetterObject } from '../src/core/letters.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'
import * as confirmStore from '../src/ui/components/confirmStore.ts'
import { guardNavigation } from '../src/ui/components/navigationGuard.ts'

vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => commit() }))
const print = vi.hoisted(() => vi.fn())
vi.mock('../src/ui/print/printReceipt.ts', () => ({ printHtml: print }))
const pdf = vi.hoisted(() => ({ set: vi.fn(), from: vi.fn(), save: vi.fn(async () => {}) }))
vi.mock('html2pdf.js', () => ({ default: () => pdf }))
const data = useRawDataStore.getState(), app = useAppStore.getState()
const letter: Letter = { id: 'abc', subject: 'طلب رسمي', recipient: 'شركة النور', reference: 'R-1', date: '2024-06-01', salutation: 'تحية طيبة', closing: 'وتفضلوا بقبول الاحترام', signer: 'محمد', position: 'المدير', identity: { name: 'شركة المثال', logo: '', address: 'الرياض', phone: '123', email: 'a@example.com', website: '', commercialRegister: '456' }, accent: '#1c6975', font: 'Arial', paragraphs: [{ ...newLetterParagraph('النص العربي\nالسطر الثاني'), bold: true, color: '#13579a', size: 16 }], createdAt: '2024-01-01', updatedAt: '2024-01-01' }

beforeEach(() => {
 useRawDataStore.setState({ ...data, branches: [], activeBranchId: null, currentUserId: null, loggedOut: false, letters: [], letterTemplates: [], letterDefaultTemplates: {} })
 useAppStore.setState({ ...app, setup: { ...app.setup, shopName: 'شركة المثال', city: 'الرياض' } })
 pdf.set.mockReset().mockReturnValue(pdf); pdf.from.mockReset().mockReturnValue(pdf); pdf.save.mockClear()
})
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('يحفظ ويعدّل ويعاين ويحذف خطاباً دون تغيير دفتر اليومية', async () => {
 const before = useRawDataStore.getState().journal
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />)
 fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'شركة النور' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'طلب رسمي' } })
 fireEvent.change(screen.getByLabelText('نص فقرة 1'), { target: { value: 'نص تجريبي' } })
 fireEvent.click(screen.getByLabelText('خط عريض'))
 expect(document.querySelector('.letters-sheet-paragraph')?.textContent).toBe('نص تجريبي')
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(1))
 expect(useRawDataStore.getState().journal).toBe(before)
 expect(useRawDataStore.getState().letters[0].paragraphs[0]).toMatchObject({ text: 'نص تجريبي', bold: true })
 fireEvent.click(screen.getByText('السجل'))
 fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'موضوع معدّل' } })
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].subject).toBe('موضوع معدّل'))
 fireEvent.click(screen.getByText('حذف'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(0))
})

it('يمنع حفظ نسخة قديمة بعد تعديل أو حذف من نافذة أخرى', () => {
 const store = useRawDataStore.getState()
 store.saveLetter(letter, null)
 const original = useRawDataStore.getState().letters[0], basis = JSON.stringify(original)
 useRawDataStore.getState().saveLetter({ ...original, subject: 'أحدث' }, basis)
 expect(() => useRawDataStore.getState().saveLetter({ ...original, subject: 'قديم' }, basis)).toThrow(/تغير الخطاب/)
 expect(() => useRawDataStore.getState().deleteLetter(original.id, basis)).toThrow(/تغير/)
 expect(useRawDataStore.getState().letters[0].subject).toBe('أحدث')
})

it('يصدر Word حقيقياً يحتوي النص والهوية والتنسيق وبنية DOCX', async () => {
 const blob = await createLetterWord(letter)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const zip = unzipSync(new Uint8Array(buffer))
 const main = strFromU8(zip['word/document.xml']), header = strFromU8(zip['word/header1.xml']), footer = strFromU8(zip['word/footer1.xml'])
 expect(main).toContain('طلب رسمي'); expect(main).toContain('النص العربي'); expect(main).toContain('13579a'); expect(main).toContain('w:bidi')
 expect(header).toContain('شركة المثال'); expect(footer).toContain('الرياض')
})

it('يوجه زر PDF المعاينة الحالية للتصدير ويحفظ امتداد PDF', async () => {
 useRawDataStore.setState({ letters: [letter] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('PDF'))
 await waitFor(() => expect(pdf.save).toHaveBeenCalledOnce())
 expect(pdf.set.mock.calls[0][0]).toMatchObject({ filename: 'طلب رسمي.pdf', jsPDF: { format: 'a4' } })
 expect((pdf.from.mock.calls[0][0] as HTMLElement).textContent).toContain('النص العربي')
})

it('يتحقق من المتطلبات الأساسية ونوع التنسيق', () => {
 expect(validateLetter(letter)).toEqual([])
 expect(validateLetter({ ...letter, subject: '', date: '2024-02-30', paragraphs: [] }).length).toBeGreaterThan(2)
 expect(validateLetter({ ...letter, paragraphs: [{ ...letter.paragraphs[0], color: 'red; background:black' }] })).not.toEqual([])
})

it('يعزل الخطابات عن الفروع الأخرى ويحفظ خطاب المالك في الرئيسي عند النطاق الشامل', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الآخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: null })
 useRawDataStore.getState().saveLetter(letter, null)
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.branchId).toBe(1)
 useRawDataStore.setState({ activeBranchId: 2 })
 expect(() => useRawDataStore.getState().saveLetter({ ...saved, subject: 'تغيير' }, JSON.stringify(saved))).toThrow(/فرع آخر/)
 expect(() => useRawDataStore.getState().deleteLetter(saved.id, JSON.stringify(saved))).toThrow(/غير متاح/)
})

it('يتطلب صلاحية إدارة الخطابات عند الحفظ والحذف', () => {
 useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '' }] })
 expect(() => useRawDataStore.getState().saveLetter(letter, null)).toThrow(/صلاحية/)
 useRawDataStore.setState({ letters: [letter] })
 expect(() => useRawDataStore.getState().deleteLetter(letter.id, JSON.stringify(letter))).toThrow(/صلاحية/)
 useRawDataStore.setState({ appUsers: [{ id: 20, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '', extraPerms: ['rep.letters'] }] })
 useRawDataStore.getState().deleteLetter(letter.id, JSON.stringify(letter))
 expect(useRawDataStore.getState().letters).toHaveLength(0)
})

it('يعرض النص المدخل كنص لا كعناصر HTML', () => {
 useRawDataStore.setState({ letters: [{ ...letter, paragraphs: [{ ...letter.paragraphs[0], text: '<img src=x onerror=alert(1)>' }] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const sheet = document.querySelector('.letters-sheet')!
 expect(sheet.textContent).toContain('<img src=x onerror=alert(1)>')
 expect(sheet.querySelector('img')).toBeNull()
})

it('يحذر عند مغادرة المحرر إذا كانت هناك تغييرات غير محفوظة', () => {
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'موضوع' } })
 const navigate = vi.fn()
 let guarded = false
 act(() => { guarded = guardNavigation(navigate) })
 expect(guarded).toBe(true)
 expect(navigate).not.toHaveBeenCalled()
 expect(screen.getByText('متابعة التعديل')).toBeTruthy()
 fireEvent.click(screen.getByText('متابعة التعديل'))
 expect(navigate).not.toHaveBeenCalled()
})

it('ينسخ بيانات العميل المسجل ويحفظ لقطة مستقلة ويدعم الإدخال الحر', async () => {
 const customer = { id: 22, nameAr: 'شركة الندى', phone: '055123', address: 'طريق الملك', city: 'الرياض', email: 'customer@example.com', taxNumber: 'VAT22', commercialReg: 'CR22', postalCode: '12345', buildingNo: '14', nationalId: '', creditLimitMinor: 0, notes: '', contactPerson: 'خالد' }
 useRawDataStore.setState({ customers: [customer] })
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.change(screen.getByLabelText('مصدر بيانات المستلم'), { target: { value: '22' } })
 expect((screen.getByLabelText('الجهة الموجه إليها') as HTMLInputElement).value).toBe('شركة الندى')
 expect(screen.getByText(/طريق الملك/, { selector: '[data-letter-field="recipientAddress"]' })).toBeTruthy()
 expect(screen.getByText(/VAT22/, { selector: '[data-letter-field="recipientTaxNumber"]' })).toBeTruthy()
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'طلب الندى' } })
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(1))
 expect(useRawDataStore.getState().letters[0]).toMatchObject({ customerId: 22, recipient: 'شركة الندى', recipientDetails: { phone: '055123', taxNumber: 'VAT22', contactPerson: 'خالد' } })
 useRawDataStore.setState({ customers: [{ ...customer, nameAr: 'اسم تغير', phone: '999' }] })
 expect(document.querySelector('[data-letter-field="recipient"]')?.textContent).toContain('شركة الندى')
 fireEvent.change(screen.getByLabelText('مصدر بيانات المستلم'), { target: { value: '' } })
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'مستلم حر' } })
 expect(document.querySelector('[data-letter-field="recipient"]')?.textContent).toContain('مستلم حر')
 expect(useRawDataStore.getState().customers[0].nameAr).toBe('اسم تغير')
})

it('ينسق الحقول والفقرات كل منها مستقلاً ويحفظ التنسيق في Word', async () => {
 useRawDataStore.setState({ letters: [letter] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.focus(screen.getByLabelText('موضوع الخطاب'))
 fireEvent.change(screen.getByLabelText('حجم خط الفقرة'), { target: { value: '23' } })
 fireEvent.change(screen.getByLabelText('محاذاة الفقرة'), { target: { value: 'center' } })
 fireEvent.change(screen.getByLabelText('لون الفقرة'), { target: { value: '#123456' } })
 fireEvent.change(screen.getByLabelText('نوع خط العنصر'), { target: { value: 'Tahoma' } })
 fireEvent.focus(screen.getByLabelText('الجهة الموجه إليها'))
 fireEvent.change(screen.getByLabelText('حجم خط الفقرة'), { target: { value: '11' } })
 fireEvent.focus(screen.getByLabelText('نص فقرة 1'))
 fireEvent.change(screen.getByLabelText('حجم خط الفقرة'), { target: { value: '18' } })
 expect((document.querySelector('[data-letter-field="subject"]') as HTMLElement).style).toMatchObject({ fontSize: '23pt', textAlign: 'center', color: 'rgb(18, 52, 86)' })
 expect((document.querySelector('[data-letter-field="recipient"]') as HTMLElement).style.fontSize).toBe('11pt')
 expect((document.querySelector('.letters-sheet-paragraph') as HTMLElement).style.fontSize).toBe('18pt')
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].fieldStyles?.subject?.size).toBe(23))
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.fieldStyles?.recipient?.size).toBe(11)
 expect(saved.paragraphs[0].size).toBe(18)
 const blob = await createLetterWord(saved)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(xml).toContain('123456'); expect(xml).toContain('w:cs="Tahoma"'); expect(xml).toContain('<w:szCs w:val="46"'); expect(xml).toContain('w:val="center"')
})

it('يرشح السجل بالعميل والاسم والموضوع ورقم الخطاب معاً', () => {
 const customer = { id: 22, nameAr: 'شركة الندى', phone: '', address: '', city: '', email: '', taxNumber: '', commercialReg: '', postalCode: '', buildingNo: '', nationalId: '', creditLimitMinor: 0, notes: '' }
 useRawDataStore.setState({ customers: [customer], letters: [
   { ...letter, id: '1', customerId: 22, recipient: 'شركة الندى', subject: 'طلب تعاون', reference: 'A-101' },
   { ...letter, id: '2', customerId: null, recipient: 'عميل حر', subject: 'طلب تعاون', reference: 'B-202' },
 ] })
 render(<LettersPage />)
 expect(screen.getAllByText('فتح ومعاينة')).toHaveLength(2)
 fireEvent.change(screen.getByLabelText('تصفية حسب العميل المسجل'), { target: { value: '22' } })
 expect(screen.getAllByText('فتح ومعاينة')).toHaveLength(1)
 fireEvent.change(screen.getByLabelText('البحث برقم الخطاب'), { target: { value: '202' } })
 expect(screen.getByText('لا توجد نتائج مطابقة')).toBeTruthy()
 fireEvent.click(screen.getByText('مسح الفلاتر'))
 fireEvent.change(screen.getByLabelText('البحث باسم المستلم'), { target: { value: 'حر' } })
 fireEvent.change(screen.getByLabelText('البحث بموضوع الخطاب'), { target: { value: 'تعاون' } })
 fireEvent.change(screen.getByLabelText('البحث برقم الخطاب'), { target: { value: '202' } })
 expect(screen.getAllByText('فتح ومعاينة')).toHaveLength(1)
 expect(screen.getByText(/عميل حر ·/)).toBeTruthy()
})

it('يأخذ هوية المنشأة المسجلة عند الإنشاء ويحتفظ بنسختها في الخطاب', async () => {
 useAppStore.setState({ setup: { ...app.setup, shopName: 'منشأة الرياض', phone: '011111', city: 'الرياض', street: 'التحلية', commercialRegister: 'CR1' }, einvoice: { ...app.einvoice, taxNumber: 'VAT1' } })
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'جهة حرة' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'خطاب' } })
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(1))
 expect(useRawDataStore.getState().letters[0].identity).toMatchObject({ name: 'منشأة الرياض', phone: '011111', taxNumber: 'VAT1', commercialRegister: 'CR1' })
 useAppStore.setState({ setup: { ...app.setup, shopName: 'اسم آخر' } })
 expect(document.querySelector('[data-letter-field="identityName"]')).toBeNull()
 fireEvent.click(screen.getByLabelText('إظهار اسم المنشأة'))
 expect(document.querySelector('[data-letter-field="identityName"]')?.textContent).toBe('منشأة الرياض')
})

it('يتيح ترشيح عميل مرتبط بخطاب حتى لو لم يعد في القائمة', () => {
 useRawDataStore.setState({ customers: [], letters: [{ ...letter, customerId: 99 }] })
 render(<LettersPage />)
 fireEvent.change(screen.getByLabelText('تصفية حسب العميل المسجل'), { target: { value: '99' } })
 expect(screen.getByText('فتح ومعاينة')).toBeTruthy()
 expect(screen.getByText(/من خطاب محفوظ/)).toBeTruthy()
})

it('يولد تسلسلاً سنوياً ويثبته عند الحفظ ويحافظ على العداد بعد الحذف', () => {
 const store = useRawDataStore.getState()
 expect(store.suggestLetterReference('2026-05-01')).toBe('LT-2026-0001')
 store.saveLetter({ ...letter, id: 'n1', date: '2026-05-01' }, null, 'automatic')
 expect(useRawDataStore.getState().letters[0].reference).toBe('LT-2026-0001')
 expect(useRawDataStore.getState().suggestLetterReference('2027-01-01')).toBe('LT-2027-0001')
 const first = useRawDataStore.getState().letters[0]
 useRawDataStore.getState().deleteLetter(first.id, JSON.stringify(first))
 expect(useRawDataStore.getState().suggestLetterReference('2026-05-01')).toBe('LT-2026-0002')
 useRawDataStore.getState().saveLetter({ ...letter, id: 'n2', reference: 'LT-2026-0040', date: '2026-05-01' }, null)
 expect(useRawDataStore.getState().suggestLetterReference('2026-12-31')).toBe('LT-2026-0041')
})

it('يعيد تخصيص اقتراح قديم تلقائياً ويمنع تكرار الرقم اليدوي في الفرع', () => {
 const state = useRawDataStore.getState(), proposal = state.suggestLetterReference('2026-01-01')
 state.saveLetter({ ...letter, id: 'one', date: '2026-01-01', reference: proposal }, null, 'automatic')
 useRawDataStore.getState().saveLetter({ ...letter, id: 'two', date: '2026-01-01', reference: proposal }, null, 'automatic')
 expect(useRawDataStore.getState().letters.map(row => row.reference)).toEqual(['LT-2026-0001', 'LT-2026-0002'])
 expect(() => useRawDataStore.getState().saveLetter({ ...letter, id: 'three', reference: ' lt-2026-0001 ' }, null)).toThrow(/مستخدم/)
 useRawDataStore.getState().saveLetter({ ...letter, id: 'three', reference: 'مرجع خاص / 45' }, null)
 expect(useRawDataStore.getState().letters[2].reference).toBe('مرجع خاص / 45')
})

it('يعزل عداد الترقيم بين الفروع', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الآخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1 })
 useRawDataStore.getState().saveLetter({ ...letter, id: 'one', date: '2026-01-01' }, null, 'automatic')
 useRawDataStore.setState({ activeBranchId: 2 })
 expect(useRawDataStore.getState().suggestLetterReference('2026-01-01')).toBe('LT-2026-0001')
 useRawDataStore.getState().saveLetter({ ...letter, id: 'two', date: '2026-01-01' }, null, 'automatic')
 expect(useRawDataStore.getState().letters.map(row => row.reference)).toEqual(['LT-2026-0001', 'LT-2026-0001'])
})

it('يغير اقتراح السنة ويتيح كتابة رقم يدوي دون فرض الصيغة', async () => {
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.change(screen.getByLabelText('التاريخ'), { target: { value: '2027-01-01' } })
 expect((screen.getByLabelText('رقم الخطاب / المرجع') as HTMLInputElement).value).toBe('LT-2027-0001')
 fireEvent.change(screen.getByLabelText('رقم الخطاب / المرجع'), { target: { value: 'ر-خاص-7' } })
 fireEvent.change(screen.getByLabelText('التاريخ'), { target: { value: '2028-01-01' } })
 expect((screen.getByLabelText('رقم الخطاب / المرجع') as HTMLInputElement).value).toBe('ر-خاص-7')
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'جهة' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'موضوع' } })
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].reference).toBe('ر-خاص-7'))
})

it('يرفض دمج إصدارين متزامنين بنفس الرقم حتى لو تساوى العدّاد', async () => {
 const { mergeConcurrentSnapshots } = await import('../src/data/persistentStorage.ts')
 const wrap = (state: object) => JSON.stringify({ state })
 const base = { letters: [], letterNumberCounters: {} }
 const l = { letters: [{ ...letter, id: 'one', reference: 'LT-2026-0001' }], letterNumberCounters: { 'unscoped:2026': 1 } }
 const r = { letters: [{ ...letter, id: 'two', reference: 'LT-2026-0001' }], letterNumberCounters: { 'unscoped:2026': 1 } }
 expect(() => mergeConcurrentSnapshots(wrap(base), wrap(l), wrap(r))).toThrow(/تعارض.*الخطابات/)
 expect(() => mergeConcurrentSnapshots(wrap(base), wrap(r), wrap(l))).toThrow(/تعارض.*الخطابات/)
 expect(JSON.parse(mergeConcurrentSnapshots(wrap({ ...base, issues: [] }), wrap({ ...l, issues: [] }), wrap({ ...base, issues: [{ id: 1 }] }))).state.letters[0].id).toBe('one')
})

it('يمنع تصدير رقم مقترح قبل تثبيته ويعيد احتسابه عند تعارض الاقتراح قبل الحفظ', async () => {
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.change(screen.getByLabelText('التاريخ'), { target: { value: '2027-01-01' } })
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'جهة' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'موضوع' } })
 fireEvent.click(screen.getByText('PDF'))
 await waitFor(() => expect(pdf.save).not.toHaveBeenCalled())
 act(() => { useRawDataStore.getState().saveLetter({ ...letter, id: 'parallel', date: '2027-01-01' }, null, 'automatic') })
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters.find(row => row.id !== 'parallel')?.reference).toBe('LT-2027-0002'))
 expect((screen.getByLabelText('رقم الخطاب / المرجع') as HTMLInputElement).value).toBe('LT-2027-0002')
})

it('يغير القالب ويحرك العناصر ويحفظ مواضعها ويعيد فتحها مع صندوق البريد', async () => {
 useAppStore.setState({ setup: { ...app.setup, shopName: 'شركة المثال', city: 'الرياض', phone: '123', email: 'a@example.com', poBox: '999' } })
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'جهة' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'خطاب' } })
 const dateBox = document.querySelector('[data-letter-box="date"]') as HTMLElement
 expect(dateBox.style.left).toBe(`${15 / 210 * 100}%`)
 expect(document.querySelector('[data-letter-box="footerBlock"]')?.textContent).toContain('999')
 fireEvent.change(screen.getByLabelText('قالب شكل الخطاب'), { target: { value: 'modern' } })
 await waitFor(() => expect(dateBox.style.left).toBe(`${18 / 210 * 100}%`))
 fireEvent.click(screen.getByLabelText('تحريك التاريخ'))
 fireEvent.change(screen.getByLabelText('الموضع الأفقي بالملليمتر'), { target: { value: '55' } })
 fireEvent.change(screen.getByLabelText('الموضع الرأسي بالملليمتر'), { target: { value: '88.5' } })
 fireEvent.change(screen.getByLabelText('عرض العنصر بالملليمتر'), { target: { value: '50' } })
 fireEvent.keyDown(screen.getByLabelText('تحريك التاريخ'), { key: 'ArrowRight' })
 expect((screen.getByLabelText('الموضع الأفقي بالملليمتر') as HTMLInputElement).value).toBe('56')
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0]?.layout?.boxes.date).toEqual({ x: 56, y: 88.5, width: 50 }))
 fireEvent.click(screen.getByText('السجل')); fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect((screen.getByLabelText('قالب شكل الخطاب') as HTMLSelectElement).value).toBe('modern')
 expect((document.querySelector('[data-letter-box="date"]') as HTMLElement).style.left).toBe(`${56 / 210 * 100}%`)
})

it('يصدر تخطيط العناصر كإطارات Word قابلة للتحرير ويحذف حدود التحديد من PDF', async () => {
 const { createLetterLayout } = await import('../src/core/letterLayout.ts')
 const layout = createLetterLayout(letter, 'classic'); layout.boxes.date = { x: 42, y: 77, width: 50 }
 const value = { ...letter, layout, identity: { ...letter.identity, poBox: '999' } }
 const blob = await createLetterWord(value)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(xml).toContain('w:framePr'); expect(xml).toContain('w:x="2381"'); expect(xml).toContain('w:y="4365"'); expect(xml).toContain('999')
 useRawDataStore.setState({ letters: [value] }); render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('PDF'))
 await waitFor(() => expect(pdf.save).toHaveBeenCalledOnce())
 expect((pdf.from.mock.calls[0][0] as HTMLElement).querySelector('.is-selected')).toBeNull()
 expect((pdf.from.mock.calls[0][0] as HTMLElement).style.height).toBe('1122px')
})

it('يتحقق من إحداثيات التخطيط ويزيل موضع الفقرة عند حذفها', async () => {
 const { createLetterLayout } = await import('../src/core/letterLayout.ts')
 const layout = createLetterLayout(letter, 'classic')
 expect(validateLetter({ ...letter, layout: { ...layout, boxes: { ...layout.boxes, date: { x: 209, y: 2, width: 50 } } } })).toContain('تخطيط الخطاب غير صالح')
 useRawDataStore.setState({ letters: [{ ...letter, layout }] }); render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.click(screen.getByText('فقرة', { exact: true, selector: 'button' }))
 fireEvent.change(screen.getByLabelText('نص فقرة 2'), { target: { value: 'فقرة جديدة' } })
 fireEvent.click(screen.getByLabelText('حذف فقرة 1'))
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].paragraphs[0].text).toBe('فقرة جديدة'))
 expect(useRawDataStore.getState().letters[0].layout?.boxes[`paragraph:${letter.paragraphs[0].id}`]).toBeUndefined()
})

it('يحافظ على المواضع عند إلغاء تغيير القالب ويثبت التذييل', () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(false)
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 expect(screen.queryByLabelText('تحريك خط التذييل')).toBeNull()
 expect((screen.getByLabelText('العنصر المراد تحريكه') as HTMLSelectElement).querySelector('option[value="footerBlock"]')).toBeNull()
 fireEvent.click(screen.getByLabelText('تحريك التاريخ'))
 fireEvent.change(screen.getByLabelText('الموضع الرأسي بالملليمتر'), { target: { value: '82' } })
 fireEvent.change(screen.getByLabelText('قالب شكل الخطاب'), { target: { value: 'modern' } })
 expect((screen.getByLabelText('قالب شكل الخطاب') as HTMLSelectElement).value).toBe('classic')
 expect((document.querySelector('[data-letter-box="bottomRule"]') as HTMLElement).style.top).toBe(`${269 / 297 * 100}%`)
 expect((document.querySelector('[data-letter-box="date"]') as HTMLElement).style.top).toBe(`${82 / 297 * 100}%`)
})

it('يضيف صفحات وينقل الفقرة ويكرر التذييل ويحفظ توزيعها دون حذف صفحة مأهولة', async () => {
 const { createLetterLayout } = await import('../src/core/letterLayout.ts')
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic') }] })
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.click(screen.getByText('+ صفحة'))
 expect(document.querySelectorAll('.letters-canvas')).toHaveLength(2)
 fireEvent.click(screen.getByLabelText('تحريك فقرة 1'))
 fireEvent.change(screen.getByLabelText('صفحة العنصر'), { target: { value: '2' } })
 expect(document.querySelector('[data-letter-page="1"] .letters-sheet-paragraph')).toBeNull()
 expect(document.querySelector('[data-letter-page="2"] .letters-sheet-paragraph')?.textContent).toContain('النص العربي')
 fireEvent.click(screen.getByLabelText('تحريك عنوان المنشأة في الترويسة'))
 fireEvent.click(screen.getByLabelText('تكرار العنصر على كل الصفحات'))
 expect(document.querySelectorAll('[data-letter-box="headerAddress"]')).toHaveLength(2)
 expect(document.querySelectorAll('[data-letter-box="footerBlock"]')).toHaveLength(2)
 fireEvent.click(screen.getByText('حذف الصفحة الأخيرة'))
 expect(document.querySelectorAll('.letters-canvas')).toHaveLength(2)
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].layout?.pageCount).toBe(2))
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.layout?.boxes[`paragraph:${letter.paragraphs[0].id}`].page).toBe(2)
 expect(saved.layout?.boxes.headerAddress.repeat).toBe(true)
 fireEvent.click(screen.getByText('السجل')); fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect(document.querySelectorAll('.letters-canvas')).toHaveLength(2)
 expect(document.querySelectorAll('[data-letter-box="headerAddress"]')).toHaveLength(2)
 expect(document.querySelectorAll('[data-letter-box="footerBlock"]')).toHaveLength(2)
})

it('يرفض صفحات غير صالحة ويولد Word بمقاطع لكل صفحة مع تكرار الهوية', async () => {
 const { createLetterLayout } = await import('../src/core/letterLayout.ts')
 const layout = createLetterLayout(letter, 'classic'); layout.pageCount = 2; layout.hiddenHeader = []
 layout.boxes.identityName = { ...layout.boxes.identityName, repeat: true }
 layout.boxes[`paragraph:${letter.paragraphs[0].id}`] = { x: 15, y: 50, width: 180, page: 2 }
 expect(validateLetter({ ...letter, layout })).toEqual([])
 expect(validateLetter({ ...letter, layout: { ...layout, pageCount: 1 } })).toContain('تخطيط الخطاب غير صالح')
 expect(validateLetter({ ...letter, layout: { ...layout, pageCount: 11 } })).toContain('تخطيط الخطاب غير صالح')
 const blob = await createLetterWord({ ...letter, layout })
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(xml.match(/شركة المثال/g)).toHaveLength(2)
 expect(xml.match(/w:sectPr/g)).toHaveLength(4)
 expect(xml).toContain('w:val="nextPage"'); expect(xml).toContain('النص العربي')
})

it('يقسم النص عند المؤشر لصفحة جديدة ويحافظ على النص والتنسيق', async () => {
 const { createLetterLayout } = await import('../src/core/letterLayout.ts')
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic') }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const text = screen.getByLabelText('نص فقرة 1') as HTMLTextAreaElement
 text.focus(); text.setSelectionRange(6, 6)
 fireEvent.click(screen.getByLabelText('تقسيم فقرة 1 عند المؤشر'))
 const one = screen.getByLabelText('نص فقرة 1') as HTMLTextAreaElement, two = screen.getByLabelText('نص فقرة 2') as HTMLTextAreaElement
 expect(one.value + two.value).toBe(letter.paragraphs[0].text)
 expect(document.querySelectorAll('.letters-canvas')).toHaveLength(2)
 expect(document.querySelector('[data-letter-page="2"] .letters-sheet-paragraph')?.textContent).toBe(two.value)
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].paragraphs).toHaveLength(2))
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.paragraphs[1]).toMatchObject({ bold: true, color: '#13579a', size: 16 })
 expect(saved.layout?.boxes[`paragraph:${saved.paragraphs[1].id}`].page).toBe(2)
})

it('يوزع الفقرة بعد التأكيد فقط ويحفظ النص كما هو، ويرفع مجس القياس بعد الإلغاء أو النجاح', async () => {
 const { createLetterLayout } = await import('../src/core/letterLayout.ts')
 const content = 'نص عربي للتجربة دون فقد مسافات. '.repeat(60)
 const value = { ...letter, paragraphs: [{ ...letter.paragraphs[0], text: content }] }
 useRawDataStore.setState({ letters: [{ ...value, layout: createLetterLayout(value, 'classic') }] })
 const confirm = vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(false)
 const rect = (width: number, height: number) => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   if (this.style.left === '-10000px') return rect(680, Math.max(32, Math.ceil((this.textContent?.length ?? 0) / 40) * 32))
   if (this.classList.contains('letters-canvas')) return rect(794, 1123)
   return rect(680, 32)
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.click(screen.getByLabelText('توزيع فقرة 1 على الصفحات'))
 expect(screen.queryByLabelText('نص فقرة 2')).toBeNull()
 expect([...document.body.querySelectorAll('div')].some(el => el.style.left === '-10000px')).toBe(false)
 await act(async () => {})
 confirm.mockResolvedValue(true); fireEvent.click(screen.getByLabelText('توزيع فقرة 1 على الصفحات'))
 await waitFor(() => expect(screen.getAllByLabelText(/^نص فقرة/).length).toBeGreaterThan(1))
 expect(screen.getAllByLabelText(/^نص فقرة/).map(el => (el as HTMLTextAreaElement).value).join('')).toBe(content)
 expect(screen.getAllByLabelText(/^نص فقرة/).length).toBeGreaterThan(1)
 expect([...document.body.querySelectorAll('div')].some(el => el.style.left === '-10000px')).toBe(false)
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].paragraphs.length).toBeGreaterThan(1))
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.paragraphs.map(p => p.text).join('')).toBe(content)
 expect(saved.paragraphs.every(p => p.bold && p.color === '#13579a')).toBe(true)
})

it('لا يوزع فقرة مكررة ولا يغير بياناتها', async () => {
 const { createLetterLayout } = await import('../src/core/letterLayout.ts')
 const layout = createLetterLayout(letter, 'classic'), key = `paragraph:${letter.paragraphs[0].id}`
 layout.boxes[key] = { ...layout.boxes[key], repeat: true }; layout.pageCount = 2
 const value = { ...letter, layout }; useRawDataStore.setState({ letters: [value] })
 const confirm = vi.spyOn(confirmStore, 'confirmDialog')
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.click(screen.getByLabelText('توزيع فقرة 1 على الصفحات'))
 expect(confirm).not.toHaveBeenCalled(); expect(useRawDataStore.getState().letters[0]).toEqual(value)
 expect(screen.queryByLabelText('نص فقرة 2')).toBeNull()
})


it('يحدد تقرير التداخل صفحة العناصر ويتيح اختيارها ويحذر قبل التصدير ثم يختفي عند الإصلاح', () => {
 const saved = { ...letter, layout: { ...createLetterLayout(letter, 'classic'), pageCount: 2 } }
 saved.layout.boxes.date = { ...saved.layout.boxes.date, page: 2 }
 saved.layout.boxes.subject = { ...saved.layout.boxes.subject, page: 2 }
 useRawDataStore.setState({ letters: [saved] })
 let overlap = true
 const rectangle = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect)
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   if (this.classList.contains('letters-canvas')) return rectangle(0, 0, 200, 300)
   if (this.dataset.letterBox === 'date') return rectangle(10, 10, 50, 20)
   if (this.dataset.letterBox === 'subject') return rectangle(overlap ? 20 : 100, 10, 50, 20)
   return rectangle(0, 0, 0, 0)
 })
 const confirm = vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(false)
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const report = document.querySelector('.letters-layout-warning') as HTMLElement
 expect(report.textContent).toContain('صفحة 2: تداخل: التاريخ و الموضوع')
 fireEvent.click(within(report).getByRole('button', { name: 'الموضوع' }))
 expect((screen.getByLabelText('العنصر المراد تحريكه') as HTMLSelectElement).value).toBe('subject')
 expect(document.activeElement?.getAttribute('data-letter-box')).toBe('subject')
 fireEvent.click(screen.getByText('PDF'))
 expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('تتداخل') }))
 expect(pdf.save).not.toHaveBeenCalled()
 overlap = false
 fireEvent.change(screen.getByLabelText('الموضع الأفقي بالملليمتر'), { target: { value: '16' } })
 expect(document.querySelector('.letters-layout-warning')).toBeNull()
})


it('يعرض أحد عشر قالباً ويوفر خلفيات منفصلة ويصون التخطيطات القديمة', () => {
 expect(Object.keys(LETTER_TEMPLATES)).toHaveLength(11)
 const layouts = Object.keys(LETTER_TEMPLATES).map(key => createLetterLayout(letter, key as keyof typeof LETTER_TEMPLATES))
 expect(new Set(layouts.map(layout => JSON.stringify(layout.boxes))).size).toBe(11)
 expect(new Set(layouts.map(layout => layout.background?.source)).size).toBeGreaterThanOrEqual(5)
 expect(validateLetter({ ...letter, layout: { template: 'classic', boxes: {} } })).toEqual([])
 const layout = layouts[3]
 expect(validateLetter({ ...letter, layout: { ...layout, background: { source: 'formal', opacity: 101 } } })).toContain('تخطيط الخطاب غير صالح')
 expect(validateLetter({ ...letter, layout: { ...layout, background: { source: 'custom', opacity: 50, data: 'https://example.com/image.png' } } })).toContain('تخطيط الخطاب غير صالح')
})

it('يتحكم في القالب والخلفية ويخزن قالباً لإعادة تطبيق المواضع بلا نسخ نص المستلم', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />)
 fireEvent.click(screen.getByText('إنشاء خطاب جديد')); fireEvent.click(screen.getByRole('button', { name: /التحكم في القوالب والخلفية/ }))
 expect(screen.getByLabelText('خلفية الصفحة')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('قالب شكل الخطاب'), { target: { value: 'executive' } })
 await waitFor(() => expect((screen.getByLabelText('قالب شكل الخطاب') as HTMLSelectElement).value).toBe('executive'))
 expect((document.querySelector('[data-letter-background]') as HTMLImageElement).style.opacity).toBe('0.55')
 fireEvent.change(screen.getByLabelText('خلفية الصفحة'), { target: { value: 'formal' } })
 fireEvent.change(screen.getByLabelText('درجة شفافية الخلفية'), { target: { value: '72' } })
 expect((document.querySelector('[data-letter-background]') as HTMLImageElement).style.opacity).toBe('0.28')
 fireEvent.click(screen.getByLabelText('تحريك التاريخ'))
 fireEvent.change(screen.getByLabelText('الموضع الأفقي بالملليمتر'), { target: { value: '55' } })
 fireEvent.click(screen.getByLabelText('حفظ نصوص الخطاب والصور والجداول في القالب'))
 fireEvent.change(screen.getByLabelText('اسم القالب المخصص'), { target: { value: 'قالب شركتي' } })
 fireEvent.click(screen.getByText('حفظ التصميم كقالب'))
 await waitFor(() => expect(useRawDataStore.getState().letterTemplates).toHaveLength(1))
 const preset = useRawDataStore.getState().letterTemplates[0]
 expect(preset).toMatchObject({ name: 'قالب شركتي', background: { source: 'formal', opacity: 28 }, boxes: { date: { x: 55 } } })
 expect(JSON.stringify(preset)).not.toContain('السلام عليكم')
 fireEvent.change(screen.getByLabelText('قالب شكل الخطاب'), { target: { value: 'geometric' } })
 await waitFor(() => expect((screen.getByLabelText('قالب شكل الخطاب') as HTMLSelectElement).value).toBe('geometric'))
 fireEvent.click(screen.getByRole('button', { name: /^تطبيق$/ }))
 await waitFor(() => expect((document.querySelector('[data-letter-box="date"]') as HTMLElement).style.left).toBe(`${55 / 210 * 100}%`))
 expect((document.querySelector('[data-letter-box="date"]') as HTMLElement).style.left).toBe(`${55 / 210 * 100}%`)
 expect((document.querySelector('[data-letter-background]') as HTMLImageElement).style.opacity).toBe('0.28')
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'جهة خاصة' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'موضوع' } })
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(1))
 fireEvent.click(screen.getByLabelText('حذف قالب قالب شركتي'))
 await waitFor(() => expect(useRawDataStore.getState().letterTemplates).toHaveLength(0))
 expect(useRawDataStore.getState().letters[0].layout?.background).toEqual({ source: 'formal', opacity: 28 })
})

it('يحفظ صورة الخلفية المضافة في الخطاب مع التحقق من نوعها وأبعادها', async () => {
 vi.stubGlobal('Image', class { src = ''; naturalWidth = 1; naturalHeight = 1; async decode() {} })
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد')); fireEvent.click(screen.getByRole('button', { name: /التحكم في القوالب والخلفية/ }))
 const file = new File([Uint8Array.from([137,80,78,71,13,10,26,10,1])], 'background.png', { type: 'image/png' })
 fireEvent.change(screen.getByLabelText('إضافة خلفية من الجهاز'), { target: { files: [file] } })
 await waitFor(() => expect((screen.getByLabelText('خلفية الصفحة') as HTMLSelectElement).value).toBe('custom'))
 fireEvent.change(screen.getByLabelText('درجة شفافية الخلفية'), { target: { value: '60' } })
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'شركة' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'خطاب' } })
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(1))
 expect(useRawDataStore.getState().letters[0].layout?.background).toMatchObject({ source: 'custom', opacity: 40, data: expect.stringMatching(/^data:image\/png;base64,/) })
})

it('يحفظ القالب في فرعه ويرفض التكرار وغياب الصلاحية والتعارض في الدمج', () => {
 const layout = createLetterLayout(letter, 'geometric')
 const template = captureLetterTemplate({ ...letter, layout }, 'قالب', 'template1')
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'آخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1 })
 useRawDataStore.getState().saveLetterTemplate(template)
 expect(useRawDataStore.getState().letterTemplates[0].branchId).toBe(1)
 expect(() => useRawDataStore.getState().saveLetterTemplate({ ...template, id: 'other' })).toThrow(/اسم القالب/)
 useRawDataStore.setState({ activeBranchId: 2 })
 expect(() => useRawDataStore.getState().deleteLetterTemplate('template1', JSON.stringify(useRawDataStore.getState().letterTemplates[0]))).toThrow(/غير متاح/)
 useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '' }] })
 expect(() => useRawDataStore.getState().saveLetterTemplate({ ...template, id: 'third' })).toThrow(/صلاحية/)
 const state = (letterTemplates: unknown[]) => JSON.stringify({ state: { letterTemplates }, version: 25 })
 expect(() => mergeConcurrentSnapshots(state([]), state([template]), state([{ ...template, name: 'آخر' }]))).toThrow(/تعارض.*قوالب/)
 const otherLetter = { ...letter, paragraphs: [newLetterParagraph('نص مختلف')] }
 expect(applySavedLetterTemplate(otherLetter, template).boxes[`paragraph:${otherLetter.paragraphs[0].id}`]).toEqual(template.paragraphs[0])
})

it('يثبت القالب الافتراضي لكل فرع ويطبقه على الخطابات الجديدة فقط ويصون حذف القالب وصلاحيته', async () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'آخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1, letters: [{ ...letter, branchId: 1, layout: createLetterLayout(letter, 'classic') }] })
 const template = captureLetterTemplate({ ...letter, layout: createLetterLayout(letter, 'arch') }, 'إدارة', 'custom')
 useRawDataStore.getState().saveLetterTemplate(template)
 useRawDataStore.getState().setLetterDefaultTemplate('saved:custom')
 expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('saved:custom')
 useRawDataStore.setState({ activeBranchId: 2 })
 expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('builtin:classic')
 expect(() => useRawDataStore.getState().setLetterDefaultTemplate('saved:custom')).toThrow(/غير متاح/)
 useRawDataStore.getState().setLetterDefaultTemplate('builtin:navy')
 useRawDataStore.setState({ activeBranchId: 1 })
 render(<LettersPage />)
 fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 expect((screen.getByLabelText('قالب شكل الخطاب') as HTMLSelectElement).value).toBe('arch')
 expect(useRawDataStore.getState().letters[0].layout?.template).toBe('classic')
 fireEvent.click(screen.getByRole('button', { name: /التحكم في القوالب/  }))
 fireEvent.change(screen.getByLabelText('القالب الافتراضي للخطابات الجديدة'), { target: { value: 'builtin:laurel' } })
 await waitFor(() => expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('builtin:laurel'))
 expect((screen.getByLabelText('قالب شكل الخطاب') as HTMLSelectElement).value).toBe('arch')
 useRawDataStore.getState().setLetterDefaultTemplate('saved:custom')
 useRawDataStore.getState().deleteLetterTemplate('custom', JSON.stringify(useRawDataStore.getState().letterTemplates[0]))
 expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('builtin:classic')
 useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'موظف', roleId: 'cashier', active: true, pinHash: '' }] })
 expect(() => useRawDataStore.getState().setLetterDefaultTemplate('builtin:navy')).toThrow(/صلاحية/)
 const state = (letterTemplates: unknown[], letterDefaultTemplates: object) => JSON.stringify({ state: { letterTemplates, letterDefaultTemplates }, version: 25 })
 expect(() => mergeConcurrentSnapshots(state([template], {}), state([], {}), state([template], { 'branch:1': 'saved:custom' }))).toThrow(/تعارض.*قوالب/)
})

it('يرفع صور التوقيع والختم ويحفظ موضعهما المستقل ويرفض الصورة غير الصالحة', async () => {
 vi.stubGlobal('Image', class { src = ''; naturalWidth = 1; naturalHeight = 1; async decode() {} })
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 const file = new File([Uint8Array.from([137,80,78,71,13,10,26,10,1])], 'signature.png', { type: 'image/png' })
 fireEvent.change(screen.getByLabelText('رفع صورة التوقيع'), { target: { files: [file] } })
 await waitFor(() => expect(document.querySelector('[data-letter-box="signatureImage"] img')).not.toBeNull())
 fireEvent.change(screen.getByLabelText('رفع صورة الختم'), { target: { files: [file] } })
 await waitFor(() => expect(document.querySelector('[data-letter-box="stampImage"] img')).not.toBeNull())
 fireEvent.click(screen.getByLabelText('تحريك صورة التوقيع'))
 fireEvent.change(screen.getByLabelText('الموضع الأفقي بالملليمتر'), { target: { value: '60' } })
 fireEvent.change(screen.getByLabelText('ارتفاع الصورة بالملليمتر'), { target: { value: '25' } })
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'جهة' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'موضوع' } })
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(1))
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.signatureImage).toMatch(/^data:image\/png;base64,/); expect(saved.stampImage).toBe(saved.signatureImage)
 expect(saved.layout?.boxes.signatureImage).toMatchObject({ x: 60, height: 25 })
 expect(validateLetter({ ...saved, stampImage: 'https://bad.example/image.png' })).toContain('صورة التوقيع أو الختم غير صالحة')
 fireEvent.click(screen.getByText('السجل')); fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect(document.querySelector('[data-letter-box="signatureImage"] img')).not.toBeNull()
})

it('يرتب اسم الجهة وبياناتها أعلى الخط، والموضوع والنداء والتحية أسفله بجانب الرقم والتاريخ في كل قالب', () => {
 const details = { address: 'الرياض، العليا', phone: '0551234567', email: 'client@example.sa', taxNumber: '300012345678900', commercialReg: '1010123456', contactPerson: 'أحمد', nationalId: '12345', contactRole: 'مدير', contactPhone: '0559876543', contactEmail: 'manager@example.sa' }
 for (const template of Object.keys(LETTER_TEMPLATES) as (keyof typeof LETTER_TEMPLATES)[]) {
  const value = { ...letter, recipientDetails: details, layout: createLetterLayout(letter, template) }, boxes = getLetterBoxes(value), items = letterLayoutItems(value)
  expect(value.layout.contentVersion).toBe(4)
  expect(items.find(item => item.key === 'headerRecipientName')?.text).toBe(letter.recipient)
  expect(items.find(item => item.key === 'recipient')?.text).toBe(`إلى السادة / ${letter.recipient}`)
  expect(boxes.headerRecipientName.y).toBeLessThan(boxes.topRule.y)
  for (const key of ['recipientAddress','recipientPhone','recipientEmail','recipientTaxNumber','recipientCommercialReg','recipientNationalId','recipientContactPerson','recipientContactRole','recipientContactPhone','recipientContactEmail']) expect(boxes[key].y).toBeLessThan(boxes.topRule.y)
  expect(boxes.subject.y).toBeGreaterThan(boxes.topRule.y); expect(boxes.recipient.y).toBeGreaterThan(boxes.subject.y); expect(boxes.salutation.y).toBeGreaterThan(boxes.recipient.y)
  expect(boxes.reference.y).toBe(boxes.subject.y); expect(boxes.date.y).toBeGreaterThan(boxes.reference.y); expect(boxes.reference.x + boxes.reference.width).toBeLessThan(boxes.subject.x)
  expect(boxes.footerBlock.repeat).toBe(true); expect(items.find(item => item.key === 'footerBlock')?.fixed).toBe(true)
  const modified = { ...value, layout: { ...value.layout, boxes: { ...value.layout.boxes, footerBlock: { x: 1, y: 1, width: 5 }, bottomRule: { x: 1, y: 1, width: 5 } } } }
  expect(getLetterBoxes(modified).footerBlock).toEqual(boxes.footerBlock); expect(getLetterBoxes(modified).bottomRule).toEqual(boxes.bottomRule)
 }
})

it('يبقي الخطاب والقالب السابقين على مواضعهما حتى يطلب المستخدم إعادة الترتيب', async () => {
 const old = { ...letter, layout: { template: 'classic' as const, boxes: {}, contentVersion: 1 as const } }
 const before = getLetterBoxes(old)
 expect(before.recipient.y).toBeLessThan(before.topRule.y)
 expect(letterLayoutItems(old).some(item => item.key === 'footerBlock')).toBe(false)
 useRawDataStore.setState({ letters: [old] }); vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect(screen.getByText(/هذا الخطاب يستخدم تخطيطاً محفوظاً سابقاً/)).toBeTruthy()
 fireEvent.click(screen.getByText('إعادة ترتيب عناصر القالب'))
 await waitFor(() => expect(document.querySelector('[data-letter-box="headerRecipientName"]')?.textContent).toBe(letter.recipient))
 expect(document.querySelector('[data-letter-box="footerBlock"]')).not.toBeNull()
 expect(useRawDataStore.getState().letters[0].layout?.contentVersion).toBe(1)
})

it('يقرب بيانات الجهتين في القوالب دون تداخل موضع الشعار ويتيح تحديث خطاب محفوظ دون تغيير بقية عناصره', async () => {
 for (const name of Object.keys(LETTER_TEMPLATES) as (keyof typeof LETTER_TEMPLATES)[]) {
  const layout = createLetterLayout(letter, name), boxes = getLetterBoxes({ ...letter, layout })
  expect(boxes.headerAddress.y - boxes.identityName.y).toBe(8)
  expect(boxes.headerPhone.y - boxes.headerAddress.y).toBeCloseTo(4.2)
  expect(boxes.recipientPhone.y - boxes.recipientAddress.y).toBeCloseTo(4.2)
  expect(boxes.headerAddress.x).toBe(boxes.identityName.x)
  expect(boxes.headerAddress.width).toBe(boxes.identityName.width)
  expect(boxes.headerAddress.x + boxes.headerAddress.width <= boxes.logo.x || boxes.logo.x + boxes.logo.width <= boxes.headerAddress.x).toBe(true)
  expect(boxes.recipientContactEmail.y).toBeLessThan(boxes.topRule.y)
 }
 const layout = createLetterLayout(letter, 'classic')
 layout.pageCount = 2
 layout.boxes.headerAddress = { x: 110, y: 31, width: 85, page: 2, repeat: false }
 layout.boxes.recipientPhone = { x: 30, y: 30, width: 45 }
 layout.boxes.subject = { x: 98, y: 85, width: 90 }
 useRawDataStore.setState({ letters: [{ ...letter, layout }] })
 const confirm = vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(false)
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.click(screen.getByText('تقريب بيانات الترويسة'))
 expect((document.querySelector('[data-letter-page="2"] [data-letter-box="headerAddress"]') as HTMLElement).style.top).toBe(`${31 / 297 * 100}%`)
 confirm.mockResolvedValue(true); fireEvent.click(screen.getByText('تقريب بيانات الترويسة'))
 await waitFor(() => expect((document.querySelector('[data-letter-page="2"] [data-letter-box="headerAddress"]') as HTMLElement).style.top).toBe(`${19 / 297 * 100}%`))
 expect((document.querySelector('[data-letter-box="subject"]') as HTMLElement).style.top).toBe(`${85 / 297 * 100}%`)
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].layout?.boxes.headerAddress).toMatchObject({ y: 19, page: 2, repeat: false }))
 expect(useRawDataStore.getState().letters[0].layout?.boxes.subject).toEqual({ x: 98, y: 85, width: 90 })
})

it('يحافظ على مباعدة الإصدار السابق حتى يطلب تقريبها، بما فيها الصناديق الافتراضية غير المخزنة', async () => {
 const value = { ...letter, layout: { template: 'classic' as const, boxes: {}, contentVersion: 2 as const } }
 const previous = getLetterBoxes(value)
 expect(previous.topRule.y).toBe(76); expect(previous.headerAddress.y).toBe(31)
 useRawDataStore.setState({ letters: [value] }); vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.click(screen.getByText('تقريب بيانات الترويسة'))
 await waitFor(() => expect((document.querySelector('[data-letter-box="headerAddress"]') as HTMLElement).style.top).toBe(`${19 / 297 * 100}%`))
 expect((document.querySelector('[data-letter-box="topRule"]') as HTMLElement).style.top).toBe(`${76 / 297 * 100}%`)
 expect(useRawDataStore.getState().letters[0].layout?.boxes).toEqual({})
})

it('يتيح ضبط مسافات الترويسة وحفظها دون تحريك الفقرات أو التذييل', async () => {
 const layout = createLetterLayout(letter, 'classic')
 useRawDataStore.setState({ letters: [{ ...letter, layout }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const horizontal = screen.getByLabelText('المسافة بين بيانات الجهتين بالملليمتر') as HTMLInputElement
 const company = screen.getByLabelText('تباعد سطور بيانات المنشأة بالملليمتر') as HTMLInputElement
 const customer = screen.getByLabelText('تباعد سطور بيانات الجهة بالملليمتر') as HTMLInputElement
 expect(horizontal.value).toBe('25')
 fireEvent.change(horizontal, { target: { value: '35' } })
 fireEvent.change(company, { target: { value: '5' } })
 fireEvent.change(customer, { target: { value: '6' } })
 expect(horizontal.value).toBe('35'); expect(company.value).toBe('5'); expect(customer.value).toBe('6')
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].layout?.boxes.headerRecipientName.width).toBe(layout.boxes.headerRecipientName.width - 10))
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.layout?.boxes.topRule).toEqual(layout.boxes.topRule)
 expect(saved.layout?.boxes[`paragraph:${letter.paragraphs[0].id}`]).toEqual(layout.boxes[`paragraph:${letter.paragraphs[0].id}`])
 expect(saved.layout?.boxes.footerBlock).toEqual(layout.boxes.footerBlock)
 fireEvent.click(screen.getByText('السجل')); fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect((screen.getByLabelText('المسافة بين بيانات الجهتين بالملليمتر') as HTMLInputElement).value).toBe('35')
})


it('يطبع كل صفحة بالتموضع الثابت نفسه للتذييل وخطه دون تغيير طباعة الخطاب القديم', async () => {
 print.mockClear()
 const layout = createLetterLayout(letter, 'classic'); layout.pageCount = 2
 useRawDataStore.setState({ letters: [{ ...letter, layout }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('طباعة'))
 await waitFor(() => expect(print).toHaveBeenCalledOnce())
 const html = print.mock.calls[0][0] as string
 expect(html).toContain('.letters-canvas-fixed{position:absolute;box-sizing:border-box;pointer-events:none}')
 expect(html).toContain('.letters-canvas-footer{white-space:pre-wrap;overflow-wrap:anywhere;text-align:center;line-height:1.25;font-size:9pt;color:#435664}')
 const doc = new DOMParser().parseFromString(html, 'text/html')
 expect(doc.querySelectorAll('.letters-canvas-footer')).toHaveLength(2)
 expect(doc.querySelectorAll('.letters-canvas-fixed.letters-canvas-line')).toHaveLength(2)
 cleanup(); print.mockClear(); useRawDataStore.setState({ letters: [letter] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('طباعة'))
 await waitFor(() => expect(print).toHaveBeenCalledOnce())
 expect(print.mock.calls[0][0]).not.toContain('.letters-canvas-fixed{')
})

it('يثبت تصميم الخطاب الحالي مع الخطوط فقط، وينشئ خطاباً جديداً دون نسخ المحتوى', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد')); fireEvent.click(screen.getByRole('button', { name: /التحكم في القوالب والخلفية/ }))
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'جهة سرية' } })
 fireEvent.change(screen.getByLabelText('نص فقرة 1'), { target: { value: 'نص سري' } })
 fireEvent.change(screen.getByLabelText('حجم خط الفقرة'), { target: { value: '18' } })
 fireEvent.click(screen.getByRole('button', { name: 'فقرة' }))
 fireEvent.change(screen.getByLabelText('نص فقرة 2'), { target: { value: 'فقرة خاصة' } })
 fireEvent.click(screen.getByLabelText('تحريك فقرة 2'))
 fireEvent.change(screen.getByLabelText('الموضع الرأسي بالملليمتر'), { target: { value: '125' } })
 fireEvent.click(screen.getByLabelText('تحريك التاريخ'))
 fireEvent.change(screen.getByLabelText('الموضع الأفقي بالملليمتر'), { target: { value: '55' } })
 fireEvent.click(screen.getByLabelText('حفظ نصوص الخطاب والصور والجداول في القالب'))
 fireEvent.change(screen.getByLabelText('اسم القالب المخصص'), { target: { value: 'تصميم جديد' } })
 fireEvent.click(screen.getByText('حفظ التصميم كقالب'))
 await waitFor(() => expect(useRawDataStore.getState().letterTemplates).toHaveLength(1))
 const preset = useRawDataStore.getState().letterTemplates[0]
 fireEvent.change(screen.getByLabelText('القالب الافتراضي للخطابات الجديدة'), { target: { value: `saved:${preset.id}` } })
 await waitFor(() => expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe(`saved:${preset.id}`))
 expect(JSON.stringify(preset)).not.toContain('جهة سرية'); expect(JSON.stringify(preset)).not.toContain('نص سري'); expect(JSON.stringify(preset)).not.toContain('فقرة خاصة')
 expect(preset.formatting?.paragraphs[0].size).toBe(18); expect(preset.boxes.date.x).toBe(55)
 fireEvent.click(screen.getByText('السجل')); fireEvent.click(await screen.findByText('إنشاء خطاب جديد'))
 expect((screen.getByLabelText('الجهة الموجه إليها') as HTMLInputElement).value).toBe('')
 expect((screen.getByLabelText('نص فقرة 1') as HTMLTextAreaElement).value).not.toBe('نص سري')
 expect((screen.getByLabelText('حجم خط الفقرة') as HTMLSelectElement).value).toBe('18')
 expect((screen.getByLabelText('نص فقرة 2') as HTMLTextAreaElement).value).toBe('')
 fireEvent.change(screen.getByLabelText('نص فقرة 2'), { target: { value: 'نص جديد' } })
 expect((screen.getByLabelText('تحريك فقرة 2') as HTMLElement).style.top).toBe(`${125 / 297 * 100}%`)
 expect((document.querySelector('[data-letter-box="date"]') as HTMLElement).style.left).toBe(`${55 / 210 * 100}%`)
})

it('يعزل التصميم المثبت لكل فرع ويرفض الكتابة فوق تعديل متزامن أو تنسيق غير صالح', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1 })
 const template = captureLetterTemplate({ ...letter, layout: createLetterLayout(letter, 'classic') }, 'افتراضي', 'id', true)
 const basis = useRawDataStore.getState().getLetterDefaultDesignBasis()
 useRawDataStore.getState().setLetterDefaultDesign(template, basis)
 expect(() => useRawDataStore.getState().setLetterDefaultDesign(template, basis)).toThrow(/تغير/)
 useRawDataStore.setState({ activeBranchId: 2 })
 expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('builtin:classic')
 const secondBasis = useRawDataStore.getState().getLetterDefaultDesignBasis()
 expect(() => useRawDataStore.getState().setLetterDefaultDesign({ ...template, formatting: { ...template.formatting!, accent: 'red' } }, secondBasis)).toThrow(/غير صالح/)
 useRawDataStore.getState().setLetterDefaultDesign(template, secondBasis)
 expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('saved:__default-letter:branch:2')
 expect(useRawDataStore.getState().letterTemplates).toHaveLength(2)
})

it('يخفي ويظهر كل عنصر ترويسة دون حذف بياناته أو المساس بالتذييل وينعكس في الطباعة', async () => {
 print.mockClear()
 const value = { ...letter, recipientDetails: { address: 'عنوان العميل', phone: '099999', email: '', taxNumber: '', commercialReg: '', contactPerson: '' }, layout: createLetterLayout(letter, 'classic') }
 useRawDataStore.setState({ letters: [value] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect(document.querySelector('[data-letter-box="identityName"]')).toBeNull()
 fireEvent.click(screen.getByLabelText('إظهار اسم المنشأة'))
 expect(document.querySelector('[data-letter-box="identityName"]')?.textContent).toBe('شركة المثال')
 for (const label of ['اسم المنشأة', 'عنوان المنشأة في الترويسة', 'اسم الجهة في الترويسة', 'هاتف المستلم', 'خط الترويسة']) fireEvent.click(screen.getByLabelText(`إظهار ${label}`))
 for (const key of ['identityName', 'headerAddress', 'headerRecipientName', 'recipientPhone', 'topRule']) expect(document.querySelector(`[data-letter-box="${key}"]`)).toBeNull()
 expect(document.querySelector('[data-letter-box="footerBlock"]')?.textContent).toContain('الرياض')
 fireEvent.click(screen.getByText('حفظ')); await waitFor(() => expect(useRawDataStore.getState().letters[0].layout?.hiddenHeader).toContain('recipientPhone'))
 expect(useRawDataStore.getState().letters[0].recipientDetails?.phone).toBe('099999')
 fireEvent.click(screen.getByText('طباعة')); await waitFor(() => expect(print).toHaveBeenCalledOnce())
 const doc = new DOMParser().parseFromString(print.mock.calls[0][0] as string, 'text/html')
 for (const key of ['identityName', 'headerAddress', 'headerRecipientName', 'recipientPhone', 'topRule']) expect(doc.querySelector(`[data-letter-box="${key}"]`)).toBeNull()
 expect(doc.querySelector('[data-letter-box="footerBlock"]')?.textContent).toContain('الرياض')
 fireEvent.click(screen.getByLabelText('إظهار هاتف المستلم'))
 expect(document.querySelector('[data-letter-box="recipientPhone"]')?.textContent).toContain('099999')
})

it('يحفظ القالب المسمى ويحدثه مع كامل التنسيق والإخفاء ويطبقه كافتراضي مع المحتوى عند اختياره', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد')); fireEvent.click(screen.getByRole('button', { name: /التحكم في القوالب والخلفية/ }))
 fireEvent.click(screen.getByLabelText('إظهار اسم المنشأة'))
 fireEvent.click(screen.getByLabelText('إظهار خط الترويسة'))
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'عميل خاص' } })
 fireEvent.change(screen.getByLabelText('نص فقرة 1'), { target: { value: 'نص القالب المشترك' } })
 fireEvent.change(screen.getByLabelText('حجم خط الفقرة'), { target: { value: '19' } })
 fireEvent.click(screen.getByLabelText('خط مائل'))
 fireEvent.change(screen.getByLabelText('خلفية الصفحة'), { target: { value: 'formal' } })
 fireEvent.change(screen.getByLabelText('درجة شفافية الخلفية'), { target: { value: '66' } })
 expect((screen.getByLabelText('حفظ نصوص الخطاب والصور والجداول في القالب') as HTMLInputElement).checked).toBe(true)
 fireEvent.change(screen.getByLabelText('اسم القالب المخصص'), { target: { value: 'قالب متكامل' } })
 fireEvent.click(screen.getByText('حفظ التصميم كقالب'))
 await waitFor(() => expect(useRawDataStore.getState().letterTemplates).toHaveLength(1))
 const id = useRawDataStore.getState().letterTemplates[0].id
 fireEvent.change(screen.getByLabelText('القالب الافتراضي للخطابات الجديدة'), { target: { value: `saved:${id}` } })
 await waitFor(() => expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe(`saved:${id}`))
 fireEvent.click(screen.getByLabelText('تحريك التاريخ'))
 fireEvent.change(screen.getByLabelText('الموضع الأفقي بالملليمتر'), { target: { value: '60' } })
 fireEvent.click(screen.getByLabelText('تحديث قالب قالب متكامل'))
 await waitFor(() => expect(useRawDataStore.getState().letterTemplates[0].boxes.date.x).toBe(60))
 expect(useRawDataStore.getState().letterTemplates[0]).toMatchObject({ hiddenHeader: ['topRule'], background: { source: 'formal', opacity: 34 }, content: { paragraphs: ['نص القالب المشترك'] }, formatting: { paragraphs: [{ size: 19, italic: true }] } })
 expect(JSON.stringify(useRawDataStore.getState().letterTemplates[0])).not.toContain('عميل خاص')
 fireEvent.click(screen.getByText('السجل')); fireEvent.click(await screen.findByText('إنشاء خطاب جديد'))
 expect((screen.getByLabelText('نص فقرة 1') as HTMLTextAreaElement).value).toBe('نص القالب المشترك')
 expect((screen.getByLabelText('الجهة الموجه إليها') as HTMLInputElement).value).toBe('')
 expect((screen.getByLabelText('حجم خط الفقرة') as HTMLSelectElement).value).toBe('19')
 expect(document.querySelector('[data-letter-box="identityName"]')).not.toBeNull()
 expect(document.querySelector('[data-letter-box="topRule"]')).toBeNull()
 expect((document.querySelector('[data-letter-box="date"]') as HTMLElement).style.left).toBe(`${60 / 210 * 100}%`)
 expect((document.querySelector('[data-letter-background]') as HTMLImageElement).style.opacity).toBe('0.34')
})

it('يرفض تحديث قالب تغير أو يقع في فرع آخر ويحافظ على إعداد الافتراضي', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1 })
 const template = captureLetterTemplate({ ...letter, layout: createLetterLayout(letter, 'classic') }, 'قالب', 'design')
 useRawDataStore.getState().saveLetterTemplate(template)
 useRawDataStore.getState().setLetterDefaultTemplate('saved:design')
 const original = useRawDataStore.getState().letterTemplates[0], basis = JSON.stringify(original)
 useRawDataStore.getState().updateLetterTemplate({ ...original, boxes: { ...original.boxes, date: { ...original.boxes.date, x: 55 } } }, basis)
 expect(() => useRawDataStore.getState().updateLetterTemplate(original, basis)).toThrow(/تغير/)
 expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('saved:design')
 useRawDataStore.setState({ activeBranchId: 2 })
 const fresh = useRawDataStore.getState().letterTemplates[0]
 expect(() => useRawDataStore.getState().updateLetterTemplate(fresh, JSON.stringify(fresh))).toThrow(/غير متاح/)
})

it('يتحقق من خيارات إخفاء الترويسة ويحتفظ بصور التوقيع ومحتوى القالب عند طلب تضمينهما', async () => {
 const { applyLetterTemplateContent, applyLetterTemplateFormatting, validSavedLetterTemplate } = await import('../src/core/letterLayout.ts')
 const layout = createLetterLayout(letter, 'classic')
 layout.hiddenHeader = ['logo', 'identityName', 'headerPhone', 'topRule']
 layout.boxes.headerPhone = { ...layout.boxes.headerPhone, x: 133, y: 34, repeat: true }
 const source = { ...letter, layout, signatureImage: 'data:image/png;base64,iVBORw0KGgoB', stampImage: 'data:image/jpeg;base64,AQID', fieldStyles: { headerPhone: { align: 'center' as const, size: 15, color: '#445566', bold: true, italic: true, underline: true, font: 'Tahoma' as const } } }
 const template = captureLetterTemplate(source, 'قالب', 'id', true, true)
 expect(validSavedLetterTemplate(template)).toBe(true)
 expect(validSavedLetterTemplate({ ...template, hiddenHeader: ['footerBlock'] })).toBe(true)
 expect(validSavedLetterTemplate({ ...template, hiddenHeader: ['unknownFooter'] })).toBe(false)
 expect(validSavedLetterTemplate({ ...template, content: { ...template.content!, signatureImage: 'https://invalid' } })).toBe(false)
 const fresh = { ...letter, recipient: 'مستلم جديد', signatureImage: undefined, paragraphs: [newLetterParagraph('محتوى مختلف')] }
 const applied = applyLetterTemplateContent(applyLetterTemplateFormatting(fresh, template), template)
 expect(applied).toMatchObject({ recipient: 'مستلم جديد', signatureImage: source.signatureImage, stampImage: source.stampImage, fieldStyles: source.fieldStyles })
 expect(applied.paragraphs[0].text).toBe(letter.paragraphs[0].text)
 expect(applySavedLetterTemplate(applied, template)).toMatchObject({ hiddenHeader: layout.hiddenHeader, boxes: { headerPhone: layout.boxes.headerPhone } })
})

it('يحفظ التصميم ويجعله افتراضياً بضغطة واحدة مع هوية المنشأة ويستعيده للخطاب الجديد', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد')); fireEvent.click(screen.getByRole('button', { name: /التحكم في القوالب والخلفية/ }))
 fireEvent.change(screen.getByRole('textbox', { name: 'اسم المنشأة', hidden: true }), { target: { value: 'هوية معدلة في القالب' } })
 fireEvent.click(screen.getByLabelText('إظهار اسم المنشأة'))
 fireEvent.change(screen.getByLabelText('نص فقرة 1'), { target: { value: 'نص ثابت في القالب' } })
 fireEvent.change(screen.getByLabelText('حجم خط الفقرة'), { target: { value: '19' } })
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'لا تُنسخ' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'موضوع خاص' } })
 fireEvent.change(screen.getByLabelText('خلفية الصفحة'), { target: { value: 'formal' } })
 fireEvent.click(screen.getByLabelText('تحريك التاريخ'))
 fireEvent.change(screen.getByLabelText('الموضع الأفقي بالملليمتر'), { target: { value: '65' } })
 fireEvent.change(screen.getByLabelText('اسم القالب المخصص'), { target: { value: 'افتراضي جديد' } })
 expect((screen.getByLabelText('تثبيت القالب المحفوظ افتراضياً') as HTMLInputElement).checked).toBe(true)
 fireEvent.click(screen.getByText('حفظ التصميم كقالب'))
 await waitFor(() => expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe(`saved:${useRawDataStore.getState().letterTemplates[0]?.id}`))
 fireEvent.click(screen.getByText('السجل')); fireEvent.click(await screen.findByText('إنشاء خطاب جديد'))
 expect((screen.getByRole('textbox', { name: 'اسم المنشأة', hidden: true }) as HTMLInputElement).value).toBe('هوية معدلة في القالب')
 expect((screen.getByLabelText('نص فقرة 1') as HTMLTextAreaElement).value).toBe('نص ثابت في القالب')
 expect((screen.getByLabelText('الجهة الموجه إليها') as HTMLInputElement).value).toBe('')
 expect((screen.getByLabelText('موضوع الخطاب') as HTMLInputElement).value).toBe('')
 expect((screen.getByLabelText('حجم خط الفقرة') as HTMLSelectElement).value).toBe('19')
 expect((document.querySelector('[data-letter-box="date"]') as HTMLElement).style.left).toBe(`${65 / 210 * 100}%`)
 expect((document.querySelector('[data-letter-background]') as HTMLImageElement).style.opacity).toBe('0.55')
 expect(document.querySelector('[data-letter-box="identityName"]')?.textContent).toBe('هوية معدلة في القالب')
})

it('اختيار حفظ قالب دون تثبيته لا يغيّر الافتراضي، ويرفض تعارض تعيينه دون حفظ جزئي', () => {
 const original = useRawDataStore.getState().getLetterDefaultDesignBasis()
 useRawDataStore.getState().setLetterDefaultTemplate('builtin:modern')
 const template = captureLetterTemplate({ ...letter, layout: createLetterLayout(letter, 'classic') }, 'نموذج', 'atomic', true, true, true)
 expect(() => useRawDataStore.getState().saveLetterTemplate(template, original)).toThrow(/تغير القالب الافتراضي/)
 expect(useRawDataStore.getState().letterTemplates).toHaveLength(0)
 useRawDataStore.getState().saveLetterTemplate(template)
 expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('builtin:modern')
})

it('لا يستبدل الافتراضي غير المتاح بصمت، ويمكن اختيار بديل عن قصد', async () => {
 const { getByText, queryByLabelText } = render(<LettersPage />)
 useRawDataStore.setState({ letterDefaultTemplates: { company: 'saved:missing' } })
 const confirm = vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValueOnce(false).mockResolvedValueOnce(true)
 fireEvent.click(getByText('إنشاء خطاب جديد')); await act(async () => {}); expect(queryByLabelText('موضوع الخطاب')).toBeNull()
 fireEvent.click(getByText('إنشاء خطاب جديد')); await waitFor(() => expect(queryByLabelText('موضوع الخطاب')).not.toBeNull())
 expect(confirm).toHaveBeenCalledTimes(2)
 fireEvent.click(screen.getByRole('button', { name: /التحكم في القوالب والخلفية/ }))
 expect((screen.getByLabelText('القالب الافتراضي للخطابات الجديدة') as HTMLSelectElement).value).toBe('')
 fireEvent.change(screen.getByLabelText('القالب الافتراضي للخطابات الجديدة'), { target: { value: 'builtin:classic' } })
 await waitFor(() => expect(useRawDataStore.getState().getLetterDefaultTemplate()).toBe('builtin:classic'))
})

it('ينتظر تحميل البيانات قبل إنشاء خطاب ويمنع استعمال افتراضي مؤقت', () => {
 vi.spyOn(useRawDataStore.persist, 'hasHydrated').mockReturnValue(false)
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 expect(screen.queryByLabelText('موضوع الخطاب')).toBeNull()
})

it('يدعم القالب القديم دون هوية أو تنسيق ويعيد خانات فقراته ومواقعها', async () => {
 const { applyCompleteLetterTemplate, validSavedLetterTemplate } = await import('../src/core/letterLayout.ts')
 const p2 = newLetterParagraph('فقرة أخرى'), draft = { ...letter, paragraphs: [letter.paragraphs[0], p2] }
 draft.layout = createLetterLayout(draft, 'classic')
 draft.layout.boxes[`paragraph:${p2.id}`] = { x: 25, y: 125, width: 120 }
 const template = JSON.parse(JSON.stringify(captureLetterTemplate(draft, 'قديم', 'old', false, false)))
 expect(validSavedLetterTemplate(template)).toBe(true)
 const result = applyCompleteLetterTemplate({ ...letter, paragraphs: [newLetterParagraph('جديد')] }, template)
 expect(result.identity).toEqual(letter.identity); expect(result.paragraphs).toHaveLength(2)
 expect(result.layout?.boxes[`paragraph:${result.paragraphs[1].id}`]).toEqual(template.paragraphs[1])
 expect(result.paragraphs[0].text).toBe('جديد')
})

it('يتحقق من هوية القالب دون رفض القوالب القديمة وينسخها مستقلة عن القالب', async () => {
 const { applyCompleteLetterTemplate, validSavedLetterTemplate } = await import('../src/core/letterLayout.ts')
 const template = captureLetterTemplate({ ...letter, layout: createLetterLayout(letter, 'classic') }, 'هوية', 'identity', true, true, true)
 expect(validSavedLetterTemplate(JSON.parse(JSON.stringify(template)))).toBe(true)
 expect(validSavedLetterTemplate({ ...template, identity: { ...letter.identity, logo: 'https://invalid/logo.png' } })).toBe(false)
 const result = applyCompleteLetterTemplate(letter, template)
 result.identity.name = 'تغيير في الخطاب'
 expect(template.identity?.name).toBe('شركة المثال')
})

it('لا يثبت قالباً في فرع آخر إذا تغير الفرع المرجعي أثناء انتظار الحفظ', () => {
 const branches = [{ id: 1, nameAr: 'الأول', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1 })
 const basis = useRawDataStore.getState().getLetterDefaultDesignBasis()
 useRawDataStore.setState({ activeBranchId: 2 })
 const template = captureLetterTemplate({ ...letter, layout: createLetterLayout(letter, 'classic') }, 'تصميم', 'new', true)
 expect(() => useRawDataStore.getState().saveLetterTemplate(template, basis)).toThrow(/تغير القالب الافتراضي/)
 expect(useRawDataStore.getState().letterTemplates).toEqual([])
})


it('تأكيد مغادرة الخطاب الداخلي يرفض الإلغاء ويحمي تعديلاً حدث أثناء انتظار الموافقة', async () => {
 render(<><LettersPage /><ConfirmHost /></>)
 fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'نسخة أولى' } })
 fireEvent.click(screen.getByText('السجل'))
 expect(screen.getByText(/لديك تعديلات غير محفوظة/)).toBeTruthy()
 fireEvent.click(document.querySelector('[data-confirm-cancel]') as HTMLElement)
 expect(screen.getByLabelText('موضوع الخطاب')).toBeTruthy()
 fireEvent.click(screen.getByText('السجل'))
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'تعديل أحدث' } })
 fireEvent.click(document.querySelector('[data-confirm-accept]') as HTMLElement)
 await waitFor(() => expect((screen.getByLabelText('موضوع الخطاب') as HTMLInputElement).value).toBe('تعديل أحدث'))
 fireEvent.click(screen.getByText('السجل'))
 fireEvent.click(document.querySelector('[data-confirm-accept]') as HTMLElement)
 expect(await screen.findByText('إنشاء خطاب جديد')).toBeTruthy()
})

it('معاينة اللوحة تستخدم مواضع الصفحة وتستجيب لاختيار التاريخ', () => {
 const value = { ...letter, layout: createLetterLayout(letter, 'classic') }
 const select = vi.fn()
 render(<LetterCanvas letter={value} pageNumber={1} selected="" onSelect={select} onMove={vi.fn()} />)
 fireEvent.click(screen.getByLabelText('تحريك التاريخ'))
 expect(select).toHaveBeenCalledWith('date')
 expect((document.querySelector('[data-letter-box="date"]') as HTMLElement).style.left).toBe(`${15 / 210 * 100}%`)
})

it('لوحة التوقيع لا تسمح باستخدام رسم فارغ وتسمح بالإلغاء', () => {
 const onUse = vi.fn(), onClose = vi.fn()
 render(<LetterSignaturePad onUse={onUse} onClose={onClose} />)
 expect((screen.getByText('استخدام التوقيع') as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByText('إلغاء الرسم'))
 expect(onUse).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce()
})


it('يحافظ على الكتابة المباشرة عند تبديل الأدوات ويحفظ الحالة والتذييل', async () => {
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.click(screen.getByText('بيانات الخطاب'))
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'مراسلة جديدة' } })
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'شركة الاختبار' } })
 fireEvent.change(screen.getByLabelText('حالة المراسلة'), { target: { value: 'sent' } })
 fireEvent.click(screen.getByText('إغلاق الأدوات'))
 const paragraph = document.querySelector<HTMLElement>('[data-letter-box^="paragraph:"]')!
 fireEvent.doubleClick(paragraph)
 fireEvent.change(screen.getByLabelText('تحرير الفقرة داخل الخطاب'), { target: { value: 'محتوى لم يضع عند تبديل القوائم' } })
 fireEvent.blur(screen.getByLabelText('تحرير الفقرة داخل الخطاب'))
 fireEvent.click(screen.getByText('الترويسة والتذييل'))
 fireEvent.click(screen.getByLabelText('إظهار تذييل المنشأة الثابت'))
 fireEvent.click(screen.getByText('القوالب والخلفية'))
 fireEvent.click(screen.getByText('إغلاق الأدوات'))
 expect(document.querySelector('[data-letter-box="footerBlock"]')).toBeNull()
 expect(paragraph.textContent).toContain('محتوى لم يضع')
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(1))
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.status).toBe('sent'); expect(saved.paragraphs[0].text).toBe('محتوى لم يضع عند تبديل القوائم')
 expect(saved.layout?.hiddenHeader).toContain('footerBlock')
 fireEvent.click(screen.getByText('السجل'))
 fireEvent.change(screen.getByLabelText('تصفية حالة الخطاب'), { target: { value: 'draft' } })
 expect(screen.getByText('لا توجد نتائج مطابقة')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('تصفية حالة الخطاب'), { target: { value: 'sent' } })
 fireEvent.change(screen.getByLabelText('البحث في نص الخطاب'), { target: { value: 'تبديل' } })
 expect(screen.getByText('مراسلة جديدة')).toBeTruthy()
})

it('يحفظ إخفاء التذييل في القالب وWord دون حذف بيانات المنشأة', async () => {
 const source = { ...letter, layout: createLetterLayout(letter, 'classic') }
 source.layout.hiddenHeader = ['bottomRule', 'footerBlock']
 expect(validateLetter(source)).toEqual([])
 const template = captureLetterTemplate(source, 'قالب', 'footer', true, true)
 expect(applySavedLetterTemplate(source, template).hiddenHeader).toEqual(['bottomRule', 'footerBlock'])
 const blob = await createLetterWord(source)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const main = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(main).not.toContain('هاتف: 123   |')
 const visibleBlob = await createLetterWord({ ...source, layout: { ...source.layout, hiddenHeader: [] } })
 const visibleBuffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(visibleBlob) })
 expect(strFromU8(unzipSync(new Uint8Array(visibleBuffer))['word/document.xml'])).toContain('هاتف: 123   |')
 expect(source.identity.address).toBe('الرياض')
 expect(validateLetter({ ...source, status: 'invalid' as never })).toContain('حالة الخطاب غير صالحة')
})


it('يضيف جدولاً وصورة ويحركهما ويحفظهما ويعيد فتحهما', async () => {
 vi.stubGlobal('Image', class { src = ''; naturalWidth = 10; naturalHeight = 10; async decode() {} })
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.click(screen.getByText('بيانات الخطاب'))
 fireEvent.change(screen.getByLabelText('الجهة الموجه إليها'), { target: { value: 'شركة الجدول' } })
 fireEvent.change(screen.getByLabelText('موضوع الخطاب'), { target: { value: 'تفاصيل الأسعار' } })
 fireEvent.click(screen.getByText('إدراج صورة أو جدول'))
 fireEvent.click(screen.getByText('إضافة جدول'))
 fireEvent.change(screen.getByLabelText('خلية صف 1 عمود 1'), { target: { value: 'الصنف' } })
 fireEvent.change(screen.getByLabelText('خلية صف 2 عمود 2'), { target: { value: '250 ريال' } })
 fireEvent.click(screen.getByText('+ صف'))
 expect(screen.getByLabelText('خلية صف 3 عمود 1')).toBeTruthy()
 expect(document.querySelector('.letters-canvas-table')?.textContent).toContain('250 ريال')
 fireEvent.click(screen.getByText('الموضع والصفحات'))
 fireEvent.change(screen.getByLabelText('الموضع الأفقي بالملليمتر'), { target: { value: '35' } })
 fireEvent.click(screen.getByText('إدراج صورة أو جدول'))
 const file = new File([Uint8Array.from([137,80,78,71,13,10,26,10,1])], 'image.png', { type: 'image/png' })
 fireEvent.change(screen.getByLabelText('إضافة صورة للخطاب'), { target: { files: [file] } })
 await waitFor(() => expect(document.querySelector('[data-letter-box^="object:"] img')).toBeTruthy())
 fireEvent.click(screen.getByText('الموضع والصفحات'))
 fireEvent.change(screen.getByLabelText('ارتفاع الصورة بالملليمتر'), { target: { value: '30' } })
 fireEvent.click(screen.getByText('إغلاق الأدوات')); fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters).toHaveLength(1))
 const saved = useRawDataStore.getState().letters[0]
 expect(saved.objects).toHaveLength(2)
 expect(saved.objects?.[0]).toMatchObject({ kind: 'table', box: { x: 35 }, cells: [['الصنف', ''], ['', '250 ريال'], ['', '']] })
 expect(saved.objects?.[1]).toMatchObject({ kind: 'image', box: { height: 30 } })
 expect(validateLetter(saved)).toEqual([])
 fireEvent.click(screen.getByText('السجل'))
 fireEvent.change(screen.getByLabelText('البحث في نص الخطاب'), { target: { value: '250 ريال' } })
 expect(screen.getByText('تفاصيل الأسعار')).toBeTruthy()
 fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect(document.querySelector('.letters-canvas-table')?.textContent).toContain('250 ريال')
 expect(document.querySelector('[data-letter-box^="object:"] img')).toBeTruthy()
})

it('ينسخ عناصر القالب فقط عند تضمين المحتوى ويحافظ على العناصر عند استعمال قالب قديم', () => {
 const table: LetterObject = { id: 'table-a', kind: 'table', box: { x: 25, y: 110, width: 120, page: 2 }, cells: [['بيان', 'مبلغ'], ['طلب', '10']] }
 const original: Letter = { ...letter, layout: { ...createLetterLayout(letter, 'classic'), pageCount: 2 }, objects: [table] }
 const full = captureLetterTemplate(original, 'المحتوى', 'full', true, true, true)
 const design = captureLetterTemplate(original, 'الشكل', 'design', true, false, true)
 expect(full.content?.objects).toEqual([table]); expect(design.content).toBeUndefined()
 const fresh = { ...letter, objects: undefined }
 expect(applyCompleteLetterTemplate(fresh, full).objects).toEqual([table])
 expect(applyCompleteLetterTemplate(fresh, design).objects).toBeUndefined()
 const old = { ...full, pageCount: 1, content: { ...full.content!, objects: undefined } }
 const retained = applyCompleteLetterTemplate(original, old)
 expect(retained.objects?.[0].box.page).toBe(1); expect(retained.objects?.[0]).toMatchObject({ kind: 'table', cells: table.cells })
 expect(original.objects?.[0].box.page).toBe(2)
})

it('يرفض عناصر غير صالحة ويصدر جدول Word حقيقياً وصورة مستقلة', async () => {
 vi.stubGlobal('Image', class { src = ''; naturalWidth = 10; naturalHeight = 10; async decode() {} })
 const objects: LetterObject[] = [
  { id: 'table-a', kind: 'table', box: { x: 20, y: 145, width: 100, page: 1 }, cells: [['البيان', 'المبلغ'], ['خدمة', '250']] },
  { id: 'image-a', kind: 'image', box: { x: 30, y: 200, width: 40, height: 20 }, data: 'data:image/png;base64,iVBORw0KGgoB' },
 ]
 expect(validLetterObjects(objects, 1)).toBe(true)
 expect(validLetterObjects([...objects, objects[0]], 1)).toBe(false)
 expect(validLetterObjects([{ ...objects[0], cells: [['a'], ['b', 'c']] } as LetterObject], 1)).toBe(false)
 expect(validLetterObjects([{ ...objects[1], data: 'https://example.test/image.png' } as LetterObject], 1)).toBe(false)
 expect(validLetterObjects([{ ...objects[1], box: { x: 200, y: 0, width: 40, height: 20 } } as LetterObject], 1)).toBe(false)
 const source = { ...letter, layout: createLetterLayout(letter, 'classic'), objects }
 const blob = await createLetterWord(source)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const zip = unzipSync(new Uint8Array(buffer)), main = strFromU8(zip['word/document.xml'])
 expect(main).toContain('<w:tbl>'); expect(main).toContain('<w:tblpPr'); expect(main).toContain('البيان'); expect(main).toContain('250'); expect(main).toContain('w:drawing')
 expect(Object.keys(zip).some(key => key.startsWith('word/media/'))).toBe(true)
})

it('يتيح حجم العنصر والحذف والتراجع والإعادة دون اعتراض Delete داخل الحقول', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic') }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByText('إضافة جدول'))
 fireEvent.change(screen.getByLabelText('خلية صف 1 عمود 1'), { target: { value: 'محتوى' } })
 fireEvent.change(screen.getByLabelText('نمط الجدول'), { target: { value: 'teal' } })
 const table = document.querySelector<HTMLElement>('[data-letter-box^="object:"]')!
 expect(table.querySelector('td')?.style.backgroundColor).toBe('rgb(23, 107, 117)')
 fireEvent.click(within(table).getByLabelText(/تغيير حجم/))
 const width = parseFloat(table.style.width)
 fireEvent.click(within(table).getByLabelText('تصغير العنصر'))
 expect(parseFloat(table.style.width)).toBeLessThan(width)
 fireEvent.click(screen.getByLabelText('تراجع'))
 expect(parseFloat(table.style.width)).toBeCloseTo(width)
 fireEvent.click(screen.getByLabelText('إعادة'))
 expect(parseFloat(table.style.width)).toBeLessThan(width)
 fireEvent.keyDown(screen.getByLabelText('خلية صف 1 عمود 1'), { key: 'Delete' })
 expect(document.querySelector('.letters-canvas-table')).toBeTruthy()
 fireEvent.keyDown(table, { key: 'Delete' })
 await waitFor(() => expect(document.querySelector('.letters-canvas-table')).toBeNull())
 fireEvent.keyDown(screen.getByLabelText('تراجع'), { key: 'z', ctrlKey: true })
 expect(document.querySelector('.letters-canvas-table')?.textContent).toContain('محتوى')
 fireEvent.keyDown(screen.getByLabelText('تراجع'), { key: 'y', ctrlKey: true })
 expect(document.querySelector('.letters-canvas-table')).toBeNull()
})

it('يحفظ نمط الجدول ضمن القالب ويصدره في Word ويرفض النمط غير المعروف', async () => {
 const table: LetterObject = { id: 'table-style', kind: 'table', box: { x: 20, y: 140, width: 100 }, cells: [['عنوان'], ['بيان']], style: 'navy' }
 const source = { ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }
 expect(validLetterObjects([table], 1)).toBe(true)
 expect(validLetterObjects([{ ...table, style: 'unknown' } as never], 1)).toBe(false)
 expect(applyCompleteLetterTemplate(letter, captureLetterTemplate(source, 'نمط', 'style', true, true, true)).objects).toEqual([table])
 const blob = await createLetterWord(source)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(blob) })
 const main = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(main).toContain('243F60'); expect(main).toContain('عنوان'); expect(main).toContain('w:shd')
})

it('يخفي الحقل المرتبط دون حذف بياناته ويسمح بإظهاره أو التراجع، ويمسح الفقرة فعلياً', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic') }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const subject = screen.getByLabelText('تحريك الموضوع')
 fireEvent.click(subject); fireEvent.click(within(subject).getByLabelText('إخفاء الموضوع'))
 await waitFor(() => expect(screen.queryByLabelText('تحريك الموضوع')).toBeNull())
 fireEvent.click(screen.getByText('الترويسة والتذييل'))
 fireEvent.click(screen.getByText('إظهار الموضوع'))
 expect(screen.getByLabelText('تحريك الموضوع').textContent).toContain('طلب رسمي')
 const para = screen.getByLabelText('تحريك فقرة 1')
 fireEvent.click(para); fireEvent.click(within(para).getByLabelText('حذف فقرة 1'))
 await waitFor(() => expect(screen.queryByLabelText('تحريك فقرة 1')).toBeNull())
 fireEvent.click(screen.getByLabelText('تراجع'))
 expect(screen.getByLabelText('تحريك فقرة 1').textContent).toContain('النص العربي')
})

it('يعيد التراجع حالة الترقيم التلقائي كما يعيد رقم المرجع', () => {
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.click(screen.getByText('بيانات الخطاب'))
 const reference = screen.getByLabelText('رقم الخطاب / المرجع') as HTMLInputElement
 const suggested = reference.value
 expect(screen.getByText(/رقم مقترح حسب سنة التاريخ/)).toBeTruthy()
 fireEvent.change(reference, { target: { value: 'يدوي' } })
 expect(screen.getByText(/رقم يدوي أو محفوظ/)).toBeTruthy()
 fireEvent.keyDown(reference, { key: 'z', ctrlKey: true })
 expect(reference.value).toBe(suggested)
 expect(screen.getByText(/رقم مقترح حسب سنة التاريخ/)).toBeTruthy()
 fireEvent.keyDown(reference, { key: 'y', ctrlKey: true })
 expect(reference.value).toBe('يدوي'); expect(screen.getByText(/رقم يدوي أو محفوظ/)).toBeTruthy()
})

it('ينسخ الجدول مع نمطه ومحتواه ويتيح التراجع عن النسخة', () => {
 render(<LettersPage />); fireEvent.click(screen.getByText('إنشاء خطاب جديد'))
 fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByText('إضافة جدول'))
 fireEvent.change(screen.getByLabelText('خلية صف 1 عمود 1'), { target: { value: 'نسخة' } })
 fireEvent.click(screen.getByLabelText('تطبيق نمط رسمي كحلي'))
 fireEvent.click(screen.getByText('نسخ العنصر المحدد'))
 expect(document.querySelectorAll('.letters-canvas-table')).toHaveLength(2)
 expect(screen.getByLabelText('خلية صف 1 عمود 1')).toHaveProperty('value', 'نسخة')
 expect(screen.getByLabelText('نمط الجدول')).toHaveProperty('value', 'navy')
 fireEvent.click(screen.getByLabelText('تراجع'))
 expect(document.querySelectorAll('.letters-canvas-table')).toHaveLength(1)
})

it('لا يطبع أدوات العنصر ويطبع النص الجاري تحريره ولون نمط الجدول', async () => {
 print.mockClear(); vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'table-print', kind: 'table', style: 'navy', box: { x: 20, y: 150, width: 100 }, cells: [['العنوان'], ['نص']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.doubleClick(screen.getByLabelText('تحريك فقرة 1'))
 fireEvent.change(screen.getByLabelText('تحرير الفقرة داخل الخطاب'), { target: { value: 'نص يحرر الآن' } })
 fireEvent.click(screen.getByText('طباعة'))
 await waitFor(() => expect(print).toHaveBeenCalledOnce())
 const html = print.mock.calls[0][0] as string
 expect(html).toContain('نص يحرر الآن'); expect(html).toContain('rgb(36, 63, 96)')
 expect(html).not.toContain('letters-item-tools'); expect(html).not.toContain('letters-canvas-edit')
})

it('يمسح سجل الإعادة عند تغيير جديد ويبدأ سجل التراجع من جديد بعد الحفظ', async () => {
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic') }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('بيانات الخطاب'))
 const subject = screen.getByLabelText('موضوع الخطاب')
 fireEvent.change(subject, { target: { value: 'واحد' } }); fireEvent.click(screen.getByLabelText('تراجع'))
 expect((screen.getByLabelText('إعادة') as HTMLButtonElement).disabled).toBe(false)
 fireEvent.change(subject, { target: { value: 'اثنان' } })
 expect((screen.getByLabelText('إعادة') as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].subject).toBe('اثنان'))
 expect((screen.getByLabelText('تراجع') as HTMLButtonElement).disabled).toBe(true)
})

it('يحرر خلايا الجدول داخل الورقة ويتراجع دون حذف الجدول عند Delete', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'edit-cells', kind: 'table', box: { x: 20, y: 150, width: 100 }, cells: [['عنوان', 'ثمن'], ['خدمة', '50']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const cell = document.querySelector('[data-letter-box="object:edit-cells"] td[data-row="1"][data-column="1"]')!
 fireEvent.doubleClick(cell)
 const editor = screen.getByLabelText('تحرير خلية الجدول صف 2 عمود 2') as HTMLTextAreaElement
 fireEvent.change(editor, { target: { value: '125' } })
 fireEvent.keyDown(editor, { key: 'Delete' }); expect(document.querySelector('.letters-canvas-table')).toBeTruthy()
 fireEvent.keyDown(editor, { key: 'z', ctrlKey: true }); expect(editor.value).toBe('50')
 fireEvent.change(editor, { target: { value: '125' } }); fireEvent.blur(editor)
 fireEvent.click(screen.getByText('إدراج صورة أو جدول'))
 expect(screen.getByLabelText('خلية صف 2 عمود 2')).toHaveProperty('value', '125')
 expect(screen.getByText('الخلية المحددة: صف 2، عمود 2')).toBeTruthy()
})

it('يدرج ويحذف الصف والعمود المحددين مع تأكيد وتراجع عن الحذف', async () => {
 const confirm = vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'rows-columns', kind: 'table', box: { x: 20, y: 150, width: 100 }, cells: [['أ', 'ب'], ['ج', 'د']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' }))
 fireEvent.focus(screen.getByLabelText('خلية صف 2 عمود 2'))
 fireEvent.click(screen.getByText('إدراج صف قبل'))
 expect(screen.getByLabelText('خلية صف 3 عمود 2')).toHaveProperty('value', 'د')
 fireEvent.click(screen.getByText('إدراج عمود بعد'))
 expect(screen.getByLabelText('خلية صف 1 عمود 2')).toHaveProperty('value', 'ب')
 fireEvent.click(screen.getByText('حذف العمود المحدد'))
 await waitFor(() => expect(screen.queryByLabelText('خلية صف 1 عمود 3')).toBeNull())
 expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('العمود 3') }))
 fireEvent.click(screen.getByLabelText('تراجع'))
 expect(screen.getByLabelText('خلية صف 1 عمود 3')).toBeTruthy()
 fireEvent.click(screen.getByText('حذف الصف المحدد'))
 await waitFor(() => expect(screen.queryByLabelText('خلية صف 3 عمود 1')).toBeNull())
 fireEvent.click(screen.getByLabelText('تراجع'))
 expect(screen.getByLabelText('خلية صف 3 عمود 2')).toHaveProperty('value', 'د')
})

it('يتحقق من خيارات تنسيق الجدول ويطبقها في المعاينة والقالب وWord', async () => {
 const table: LetterObject = { id: 'format-table', kind: 'table', box: { x: 20, y: 150, width: 100 }, cells: [['عنوان'], ['قيمة']], style: 'navy', format: { align: 'center', fontSize: 18, header: false, striped: false } }
 expect(validLetterObjects([table], 1)).toBe(true)
 expect(validLetterObjects([{ ...table, format: { fontSize: 200 } }], 1)).toBe(false)
 expect(validLetterObjects([{ ...table, format: { align: 'unknown' } } as never], 1)).toBe(false)
 const source = { ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }
 expect(applyCompleteLetterTemplate(letter, captureLetterTemplate(source, 'جدول', 'fmt', true, true, true)).objects).toEqual([table])
 const blob = await createLetterWord(source)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(xml).toContain('w:val="center"'); expect(xml).toContain('w:val="36"'); expect(xml).not.toContain('w:fill="243F60"')
 useRawDataStore.setState({ letters: [source] }); render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const el = document.querySelector<HTMLTableElement>('.letters-canvas-table')!
 expect(el.style.textAlign).toBe('center'); expect(el.style.fontSize).toBe('18pt'); expect(el.querySelector('td')?.style.backgroundColor).toBe('rgb(255, 255, 255)')
})

it('يصدر نص الخلية أثناء تحريرها ولا يطبع مربع التحرير', async () => {
 print.mockClear(); vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'print-cell', kind: 'table', box: { x: 20, y: 150, width: 100 }, cells: [['قديم']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 fireEvent.doubleClick(document.querySelector('[data-letter-box="object:print-cell"] td')!)
 fireEvent.change(screen.getByLabelText('تحرير خلية الجدول صف 1 عمود 1'), { target: { value: 'تحرير مباشر الآن' } })
 fireEvent.click(screen.getByText('طباعة'))
 await waitFor(() => expect(print).toHaveBeenCalledOnce())
 const html = print.mock.calls[0][0] as string
 expect(html).toContain('تحرير مباشر الآن'); expect(html).not.toContain('letters-table-cell-edit')
})

it('يتحقق من الدمج وتنسيق الخلايا ويرفض فقد البيانات والتداخل', () => {
 const table: LetterObject = { id: 'merge', kind: 'table', box: { x: 20, y: 150, width: 120 }, cells: [['رئيسي', ''], ['', '']], merges: [{ row: 0, column: 0, rows: 2, columns: 2 }], cellFormats: { '0:0': { bold: true, color: '#123456', background: '#abcdef', fontSize: 18, align: 'center' } } }
 expect(validLetterObjects([table], 1)).toBe(true)
 expect(validLetterObjects([{ ...table, cells: [['رئيسي', 'لا تحذف'], ['', '']] }], 1)).toBe(false)
 expect(validLetterObjects([{ ...table, merges: [...table.merges!, { row: 0, column: 1, rows: 2, columns: 1 }] }], 1)).toBe(false)
 expect(validLetterObjects([{ ...table, cellFormats: { '2:1': { bold: true } } }], 1)).toBe(false)
 expect(validLetterObjects([{ ...table, cellFormats: { '0:0': { color: 'red' } } }], 1)).toBe(false)
})

it('يدمج ويفك خلايا فارغة ويحفظ تنسيق الخلية ويمنع تغييرات البنية أثناء الدمج', async () => {
 const table: LetterObject = { id: 'merge-ui', kind: 'table', box: { x: 20, y: 150, width: 120 }, cells: [['عنوان', ''], ['', '']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' }))
 fireEvent.change(screen.getByLabelText('محاذاة الخلية المحددة'), { target: { value: 'center' } })
 fireEvent.change(screen.getByLabelText('حجم خط الخلية المحددة'), { target: { value: '18' } })
 fireEvent.change(screen.getByLabelText('لون خلفية الخلية المحددة'), { target: { value: '#abcdef' } })
 fireEvent.change(screen.getByLabelText('عدد صفوف الدمج'), { target: { value: '2' } })
 fireEvent.click(screen.getByText('دمج من الخلية المحددة'))
 const cell = document.querySelector<HTMLTableCellElement>('.letters-canvas-table td')!
 expect(cell.rowSpan).toBe(2); expect(cell.colSpan).toBe(2); expect(cell.style.textAlign).toBe('center'); expect(cell.style.fontSize).toBe('18pt')
 expect((screen.getByLabelText('خلية صف 2 عمود 2') as HTMLInputElement).disabled).toBe(true)
 fireEvent.click(screen.getByText('+ صف')); expect(screen.queryByLabelText('خلية صف 3 عمود 1')).toBeNull()
 fireEvent.click(screen.getByText('فك دمج الخلية')); expect(document.querySelectorAll('.letters-canvas-table td')).toHaveLength(4)
 fireEvent.click(screen.getByLabelText('تراجع')); expect(document.querySelector<HTMLTableCellElement>('.letters-canvas-table td')?.rowSpan).toBe(2)
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].objects?.[0]).toMatchObject({ merges: [{ row: 0, column: 0, rows: 2, columns: 2 }], cellFormats: { '0:0': { align: 'center', fontSize: 18, background: '#abcdef' } } }))
})

it('ينقل تنسيق الخلايا عند إدراج وحذف الصفوف والأعمدة', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'shift-style', kind: 'table', box: { x: 20, y: 150, width: 120 }, cells: [['أ', 'ب'], ['ج', 'د']], cellFormats: { '1:1': { color: '#123456' } } }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' }))
 fireEvent.click(screen.getByText('إدراج صف قبل')); fireEvent.click(screen.getByText('إدراج عمود قبل'))
 const td = document.querySelector<HTMLTableCellElement>('.letters-canvas-table td[data-row="2"][data-column="2"]')!
 expect(td.textContent).toBe('د'); expect(td.style.color).toBe('rgb(18, 52, 86)')
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].objects?.[0]).toMatchObject({ cellFormats: { '2:2': { color: '#123456' } } }))
})

it('يصدر الدمج وتنسيق الخلية في Word ويستعيدهما من القالب', async () => {
 const table: LetterObject = { id: 'merge-word', kind: 'table', box: { x: 20, y: 150, width: 120 }, cells: [['عنوان', ''], ['', '']], merges: [{ row: 0, column: 0, rows: 2, columns: 2 }], cellFormats: { '0:0': { bold: true, color: '#123456', background: '#abcdef', fontSize: 18, align: 'center' } } }
 const source = { ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }
 expect(applyCompleteLetterTemplate(letter, captureLetterTemplate(source, 'دمج', 'merged', true, true, true)).objects).toEqual([table])
 const blob = await createLetterWord(source)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(xml).toContain('w:gridSpan'); expect(xml).toContain('w:vMerge'); expect(xml).toContain('abcdef'); expect(xml).toContain('123456'); expect(xml).toContain('w:val="36"'); expect(xml).toContain('w:val="center"')
})

it('يوزع جدولاً مقاساً إلى أجزاء مع تكرار العنوان وتنسيقه، ويتراجع في خطوة واحدة', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'paginate', kind: 'table', box: { x: 20, y: 160, width: 120, page: 1 }, cells: [['رأس'], ['أ'], ['ب'], ['ج']], cellFormats: { '0:0': { bold: true }, '2:0': { color: '#123456' } } }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   const height = this.classList.contains('letters-canvas') ? 297 : this.tagName === 'TR' ? ((this as HTMLTableRowElement).rowIndex === 0 ? 20 : 70) : 0
   return { x: 0, y: 0, left: 0, top: 0, right: 210, bottom: height, width: 210, height, toJSON: () => ({}) } as DOMRect
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' }))
 fireEvent.click(screen.getByText('توزيع الجدول على الصفحات'))
 await waitFor(() => expect(document.querySelectorAll('.letters-canvas-table')).toHaveLength(2))
 const tables = [...document.querySelectorAll('.letters-canvas-table')]
 expect(tables[0].textContent).toContain('أ'); expect(tables[1].textContent).toContain('رأس'); expect(tables[1].textContent).toContain('ب'); expect(tables[1].textContent).toContain('ج')
 expect(tables[1].querySelectorAll('tr')[1].querySelector('td')?.style.color).toBe('rgb(18, 52, 86)')
 fireEvent.click(screen.getByLabelText('تراجع')); expect(document.querySelectorAll('.letters-canvas-table')).toHaveLength(1)
 expect(document.querySelector('.letters-canvas-table')?.textContent).toContain('ج')
})

it('لا يدمج فوق محتوى موجود', async () => {
 const table: LetterObject = { id: 'guard-merge', kind: 'table', box: { x: 20, y: 150, width: 120, page: 1 }, cells: [['أ', 'ب'], ['', '']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' }))
 fireEvent.click(screen.getByText('دمج من الخلية المحددة'))
 expect(document.querySelectorAll('.letters-canvas-table td')).toHaveLength(4)
 expect(screen.getByLabelText('خلية صف 1 عمود 2')).toHaveProperty('value', 'ب')
 fireEvent.change(screen.getByLabelText('خلية صف 1 عمود 2'), { target: { value: '' } })
 fireEvent.focus(screen.getByLabelText('خلية صف 1 عمود 1')); fireEvent.click(screen.getByText('دمج من الخلية المحددة'))
 expect(document.querySelector<HTMLTableCellElement>('.letters-canvas-table td')?.colSpan).toBe(2)
})

it('لا يوزع الجدول إذا تجاوز حد الصفحات ويحافظ على المحتوى', () => {
 const confirm = vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'page-limit', kind: 'table', box: { x: 20, y: 160, width: 120, page: 10 }, cells: [['رأس'], ['بيان'], ['آخر']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: { ...createLetterLayout(letter, 'classic'), pageCount: 10 }, objects: [table] }] })
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   const height = this.classList.contains('letters-canvas') ? 297 : this.tagName === 'TR' ? ((this as HTMLTableRowElement).rowIndex === 0 ? 20 : 70) : 0
   return { x: 0, y: 0, left: 0, top: 0, right: 210, bottom: height, width: 210, height, toJSON: () => ({}) } as DOMRect
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' }))
 fireEvent.click(screen.getByText('توزيع الجدول على الصفحات'))
 expect(confirm).not.toHaveBeenCalled(); expect(document.querySelectorAll('.letters-canvas-table')).toHaveLength(1); expect(document.querySelector('.letters-canvas-table')?.textContent).toContain('آخر')
})

it('يوزع جدولاً بدمج أفقي وعمودي دون فصل الصفوف أو تغيير تظليلها ويحفظه', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'merged-paging', kind: 'table', style: 'navy', box: { x: 20, y: 160, width: 120, page: 1 }, cells: [['رأس', ''], ['أ', 'نص'], ['دمج', 'ب'], ['', 'ج'], ['آخر', 'نهاية']], merges: [{ row: 0, column: 0, rows: 1, columns: 2 }, { row: 2, column: 0, rows: 2, columns: 1 }], cellFormats: { '2:0': { color: '#123456' }, '3:0': { bold: true } } }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   const height = this.classList.contains('letters-canvas') ? 297 : this.tagName === 'TR' ? [20, 40, 60, 40, 30][(this as HTMLTableRowElement).rowIndex] : 0
   return { x: 0, y: 0, left: 0, top: 0, right: 210, bottom: height, width: 210, height, toJSON: () => ({}) } as DOMRect
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' }))
 fireEvent.click(screen.getByText('توزيع الجدول على الصفحات'))
 await waitFor(() => expect(document.querySelectorAll('.letters-canvas-table')).toHaveLength(2))
 const [first, second] = [...document.querySelectorAll('.letters-canvas-table')]
 expect(first.querySelector('td')?.colSpan).toBe(2); expect(second.querySelector('td')?.colSpan).toBe(2)
 const merged = second.querySelector<HTMLTableCellElement>('td[data-row="1"][data-column="0"]')!
 expect(merged.rowSpan).toBe(2); expect(merged.textContent).toBe('دمج'); expect(merged.style.color).toBe('rgb(18, 52, 86)'); expect(merged.style.backgroundColor).toBe('rgb(239, 244, 249)')
 expect(second.textContent).toContain('ج'); expect(second.textContent).toContain('نهاية')
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].objects).toHaveLength(2))
 const saved = useRawDataStore.getState().letters[0]
 expect(validLetterObjects(saved.objects, 2)).toBe(true)
 expect(saved.objects?.[1]).toMatchObject({ merges: [{ row: 0, column: 0, rows: 1, columns: 2 }, { row: 1, column: 0, rows: 2, columns: 1 }], cellFormats: { '1:0': { color: '#123456' }, '2:0': { bold: true } }, format: { stripeOffset: 1 } })
 const blob = await createLetterWord(saved)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(xml).toContain('w:gridSpan'); expect(xml).toContain('w:vMerge'); expect(xml).toContain('123456'); expect(xml).toContain('EFF4F9')
})

it('ينقل الجدول كاملاً للصفحة التالية إذا لم يتسع أول صف بيانات', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'move-whole', kind: 'table', box: { x: 20, y: 245, width: 120, page: 1 }, cells: [['العنوان'], ['البيان']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   const height = this.classList.contains('letters-canvas') ? 297 : this.tagName === 'TR' ? 20 : 0
   return { x: 0, y: 0, left: 0, top: 0, right: 210, bottom: height, width: 210, height, toJSON: () => ({}) } as DOMRect
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' }))
 fireEvent.click(screen.getByText('توزيع الجدول على الصفحات'))
 await waitFor(() => expect(document.querySelector('[data-letter-page="2"] .letters-canvas-table')?.textContent).toContain('البيان'))
 expect(document.querySelector('[data-letter-page="1"] .letters-canvas-table')).toBeNull()
 fireEvent.click(screen.getByLabelText('تراجع'))
 expect(document.querySelector('[data-letter-page="1"] .letters-canvas-table')?.textContent).toContain('البيان')
})

it('يوزع صفاً مغطى بالكامل بدمج حتى إن كان قياسه صفراً', async () => {
 vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'zero-covered', kind: 'table', box: { x: 20, y: 207, width: 120 }, format: { header: false }, cells: [['أ', ''], ['', ''], ['ب', 'ج']], merges: [{ row: 0, column: 0, rows: 2, columns: 2 }] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   const height = this.classList.contains('letters-canvas') ? 297 : this.tagName === 'TR' ? [20, 0, 90][(this as HTMLTableRowElement).rowIndex] : 0
   return { x: 0, y: 0, left: 0, top: 0, right: 210, bottom: height, width: 210, height, toJSON: () => ({}) } as DOMRect
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('إدراج صورة أو جدول')); fireEvent.click(screen.getByRole('button', { name: 'جدول 1' })); fireEvent.click(screen.getByText('توزيع الجدول على الصفحات'))
 await waitFor(() => expect(document.querySelectorAll('.letters-canvas-table')).toHaveLength(2))
 expect(document.querySelector<HTMLTableCellElement>('.letters-canvas-table td')?.rowSpan).toBe(2)
 expect(document.querySelector('[data-letter-page="2"] .letters-canvas-table')?.textContent).toContain('ج')
})

it('يعيد التدفق التلقائي توزيع جدول واحد بعد التحرير ويعيده بالتراجع ويحفظ المصدر', async () => {
 const table: LetterObject = { id: 'live-flow', kind: 'table', autoFlow: true, box: { x: 20, y: 160, width: 120 }, cells: [['عنوان'], ['صف طويل أ'], ['صف طويل ب'], ['صف طويل ج']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   const height = this.classList.contains('letters-canvas') ? 297 : this.tagName === 'TR' ? (this.textContent?.includes('طويل') ? 70 : 20) : 0
   return { x: 0, y: 0, left: 0, top: 0, right: 210, bottom: height, width: 210, height, toJSON: () => ({}) } as DOMRect
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const preview = document.querySelector('.letters-preview-frame')!
 expect(preview.querySelectorAll('.letters-canvas-table')).toHaveLength(2)
 const continuation = preview.querySelector('[data-letter-page="2"] .letters-canvas-table tr:nth-child(2) td')!
 expect(continuation.textContent).toBe('صف طويل ب')
 fireEvent.doubleClick(continuation)
 const editor = within(preview as HTMLElement).getByLabelText('تحرير خلية الجدول صف 3 عمود 1')
 fireEvent.change(editor, { target: { value: 'ب معدل' } })
 // لا تتغير عناوين الصفوف أثناء الكتابة داخل الخلية، حتى لا ينقلب المؤشر إلى خلية أخرى.
 expect(preview.querySelectorAll('.letters-canvas-table')).toHaveLength(2)
 fireEvent.blur(editor)
 fireEvent.click(screen.getByText('إدراج صورة أو جدول'))
 expect(screen.getByLabelText('خلية صف 3 عمود 1')).toHaveProperty('value', 'ب معدل')
 fireEvent.change(screen.getByLabelText('خلية صف 2 عمود 1'), { target: { value: 'أ' } })
 fireEvent.change(screen.getByLabelText('خلية صف 4 عمود 1'), { target: { value: 'ج' } })
 expect(preview.querySelectorAll('.letters-canvas-table')).toHaveLength(1)
 fireEvent.click(screen.getByLabelText('تراجع')); expect(preview.querySelectorAll('.letters-canvas-table')).toHaveLength(2)
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].objects?.[0]).toMatchObject({ autoFlow: true, cells: [['عنوان'], ['أ'], ['ب معدل'], ['صف طويل ج']] }))
 expect(useRawDataStore.getState().letters[0].objects).toHaveLength(1)
 fireEvent.click(screen.getByText('السجل')); fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect(document.querySelectorAll('.letters-preview-frame .letters-canvas-table')).toHaveLength(2)
})

it('يمنع تصدير التدفق إذا تعذر القياس مع بقاء المصدر وحفظه متاحاً', async () => {
 print.mockClear()
 const table: LetterObject = { id: 'bad-flow', kind: 'table', autoFlow: true, box: { x: 20, y: 160, width: 120 }, cells: [['عنوان'], ['محتوى']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 expect(screen.getByRole('alert').textContent).toContain('تعذر قياس')
 fireEvent.click(screen.getByText('طباعة')); expect(print).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].objects?.[0]).toMatchObject({ cells: table.cells, autoFlow: true }))
})

it('يطبع صفحات التدفق المشتقة ويصدرها Word دون تكرار صفوف البيانات', async () => {
 print.mockClear(); vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true)
 const table: LetterObject = { id: 'print-flow', kind: 'table', autoFlow: true, box: { x: 20, y: 160, width: 120 }, cells: [['عنوان مشترك'], ['أ طويل'], ['ب طويل'], ['ج طويل']] }
 const source = { ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }
 useRawDataStore.setState({ letters: [source] })
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   const height = this.classList.contains('letters-canvas') ? 297 : this.tagName === 'TR' ? (this.textContent?.includes('طويل') ? 70 : 20) : 0
   return { x: 0, y: 0, left: 0, top: 0, right: 210, bottom: height, width: 210, height, toJSON: () => ({}) } as DOMRect
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة')); fireEvent.click(screen.getByText('طباعة'))
 await waitFor(() => expect(print).toHaveBeenCalledOnce())
 const doc = new DOMParser().parseFromString(print.mock.calls[0][0] as string, 'text/html')
 expect(doc.querySelectorAll('.letters-canvas-table')).toHaveLength(2)
 expect(doc.body.textContent?.match(/عنوان مشترك/g)).toHaveLength(2)
 for (const text of ['أ طويل', 'ب طويل', 'ج طويل']) expect(doc.body.textContent?.match(new RegExp(text, 'g'))).toHaveLength(1)
 const { expandLetterTableFlows, letterFlowFingerprint } = await import('../src/core/letterTableFlow.ts')
 if (table.kind !== 'table') throw new Error('table')
 const expanded = expandLetterTableFlows(source, { 'print-flow': { fingerprint: letterFlowFingerprint(source, table), plan: { groups: [{ pageOffset: 0, rows: [0, 1] }, { pageOffset: 1, rows: [0, 2, 3] }] } } })
 await expect(createLetterWord(source)).rejects.toThrow(/قياس توزيع الجدول/)
 const blob = await createLetterWord(expanded.letter)
 const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml'])
 expect(xml.match(/<w:tbl[ >]/g)).toHaveLength(2)
 for (const text of ['أ طويل', 'ب طويل', 'ج طويل']) expect(xml.match(new RegExp(text, 'g'))).toHaveLength(1)
})

it('يحرر العنوان المكرر من صفحة لاحقة في مصدر الجدول الوحيد', async () => {
 const table: LetterObject = { id: 'flow-heading', kind: 'table', autoFlow: true, box: { x: 20, y: 160, width: 120 }, cells: [['عنوان أول'], ['أ طويل'], ['ب طويل'], ['ج طويل']] }
 useRawDataStore.setState({ letters: [{ ...letter, layout: createLetterLayout(letter, 'classic'), objects: [table] }] })
 vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
   const height = this.classList.contains('letters-canvas') ? 297 : this.tagName === 'TR' ? (this.textContent?.includes('طويل') ? 70 : 20) : 0
   return { x: 0, y: 0, left: 0, top: 0, right: 210, bottom: height, width: 210, height, toJSON: () => ({}) } as DOMRect
 })
 render(<LettersPage />); fireEvent.click(screen.getByText('فتح ومعاينة'))
 const preview = document.querySelector('.letters-preview-frame')!
 const header = preview.querySelector('[data-letter-page="2"] .letters-canvas-table tr:first-child td')!
 fireEvent.doubleClick(header)
 const editor = within(preview as HTMLElement).getByLabelText('تحرير خلية الجدول صف 1 عمود 1')
 fireEvent.change(editor, { target: { value: 'عنوان موحّد' } }); fireEvent.blur(editor)
 expect([...preview.querySelectorAll('.letters-canvas-table tr:first-child td')].map(node => node.textContent)).toEqual(['عنوان موحّد', 'عنوان موحّد'])
 fireEvent.click(screen.getByText('حفظ'))
 await waitFor(() => expect(useRawDataStore.getState().letters[0].objects?.[0]).toMatchObject({ autoFlow: true, cells: [['عنوان موحّد'], ['أ طويل'], ['ب طويل'], ['ج طويل']] }))
 const saved = useRawDataStore.getState().letters[0]
 expect(applyCompleteLetterTemplate(letter, captureLetterTemplate(saved, 'تدفق', 'flow-template', true, true, true)).objects).toEqual(saved.objects)
})
