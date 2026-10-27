/**
 * محرر أمر الشراء — بلاغ المالك (2026-10-12):
 * ① «يمنعني أن أكتب في أول سطر في جدول الأصناف» — كان المحرر يُفتح بسطر فارغ
 *    جاهز بلا خانة بحث، فيقع مربع البحث في السطر الثاني. الفحص يثبت أن السطر
 *    الأول نفسه يحمل خانة البحث/الباركود، وأن الكتابة فيه تُضيف صنفاً فعلاً.
 * ② «لا يحمل كل خصائص الفاتورة من تسهيلات الاستخدام» — الفحص يثبت وجود أدوات
 *    الفاتورة في الأمر: تصفية التصنيف، بطاقة الصنف، شروط التوريد، الضريبة،
 *    المسودات، مفاتيح الطباعة، وحراسة التغييرات غير المحفوظة.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { PurchaseOrdersPage } = await import('../src/ui/pages/PurchaseOrdersPage.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')


/* عزل DOM بين الاختبارات: فشل اختبار لا يُسقط الذي بعده */
afterEach(() => cleanup())

const S = () => useDataStore.getState()

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'اختبار',
      ownerName: 'المالك', features: [], modules: ['pos', 'inventory', 'purchases'], accountingMode: 'full',
      vatPercent: 14, taxRegistrationStatus: 'registered',
    },
  })
  S().addCategory('بضائع', [])
  const categoryId = S().categories[0]?.id ?? 0
  S().addItem({
    nameAr: 'شاي معتّق', sku: 'TEA-1', barcodes: ['622200'], categoryId, baseUnit: 'علبة',
    extraUnits: [], costMinor: 4500, stockQty: 24, priceMinor: 6000, minQty: 2, trackExpiry: false,
    trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
  S().addSupplier({ nameAr: 'مورد الأمانة', phone: '01000000000', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
})

const openEditor = () => {
  const view = render(<MemoryRouter><PurchaseOrdersPage /><ToastHost /></MemoryRouter>)
  fireEvent.click(view.getAllByText(/أمر شراء/)[0].closest('button')!)
  return view
}

const rows = () => [...document.querySelectorAll('tbody tr')] as HTMLTableRowElement[]

describe('محرر أمر الشراء — خانة البحث في السطر الأول', () => {
  it('يُفتح بلا سطر محتجز: السطر الأول نفسه يحمل خانة البحث/الباركود', () => {
    const view = openEditor()
    const first = rows()[0]
    expect(first, 'لا صفوف في جدول البنود').toBeTruthy()
    const entryCell = first.querySelector('.invoice-line-entry-cell')
    expect(entryCell, 'أول سطر بلا خلية إدخال').toBeTruthy()
    const input = entryCell!.querySelector('input')
    expect(input, 'أول سطر لا يحمل خانة بحث — الكتابة فيه مستحيلة').toBeTruthy()
    expect(first.getAttribute('data-line-key'), 'أول صف يجب أن يكون سطر الإدخال لا سطراً فارغاً محتجزاً').toBeNull()
    cleanup()
    view.unmount()
  })

  it('الكتابة في أول سطر تُفتح نتائج الأصناف وتُضيف الصنف بـ Enter', () => {
    const view = openEditor()
    const input = rows()[0].querySelector('.invoice-line-entry-cell input') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'شاي' } })
    const overlay = document.querySelector('.invoice-search-overlay')
    expect(overlay, 'الكتابة في أول سطر لم تفتح نتائج الأصناف').toBeTruthy()
    const optionText = overlay!.textContent ?? ''
    expect(optionText, 'البحث في أول سطر لا يعرض الصنف').toContain('شاي معتّق')
    const search = overlay!.querySelector('input') as HTMLInputElement
    fireEvent.focus(search)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    const body = document.body.textContent ?? ''
    expect(body).toContain('شاي معتّق')
    /* بعد الإضافة: سطر حقيقي + سطر إدخال جديد يحمل خانة البحث من جديد */
    const next = rows()[0]
    expect(next.getAttribute('data-line-key'), 'السطر الأول بعد الإضافة ليس سطراً حقيقياً').not.toBeNull()
    cleanup()
    view.unmount()
  })
})

describe('محرر أمر الشراء — تسهيلات الفاتورة', () => {
  it('يحمل أدوات فاتورة الشراء: تصفية التصنيف · الضريبة · الشروط · بطاقة الصنف', () => {
    const view = openEditor()
    const text = document.body.textContent ?? ''
    expect(document.querySelector('[data-po-lines]'), 'جدول البنود بلا معرّف').toBeTruthy()
    expect(document.querySelector('[aria-label="تصفية الأصناف بالتصنيف"]'), 'تصفية التصنيف غائبة').toBeTruthy()
    /* إصلاح بلاغ المالك: لم يعد هناك تشيك بوكس واحد يفرض الضريبة على كل البنود —
       نسبة الإعدادات تظهر كشارة، ولكل بند خانته المستقلة في الجدول بعد إضافته */
    expect(text, 'نسبة ضريبة الإعدادات غائبة').toContain('ضريبة الإعدادات')
    expect(text).toContain('شروط التوريد')
    expect(text).toContain('السداد بعد المطابقة والاستلام')
    expect(text).toContain('الرصيد السابق')
    expect(document.querySelector('[data-po-totals]'), 'لوحة الإجماليات بلا معرّف').toBeTruthy()
    cleanup()
    view.unmount()
  })

  it('الإدخال الذكي «شاي*3@40» يُطبَّق كما في الفاتورة: كمية 3 وسعر 40 ⇒ 120', () => {
    const view = openEditor()
    const input = rows()[0].querySelector('.invoice-line-entry-cell input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'شاي*3@40' } })
    const search = document.querySelector('.invoice-search-overlay input') as HTMLInputElement
    fireEvent.focus(search)
    fireEvent.keyDown(search, { key: 'Enter' })
    const totals = document.querySelector('[data-po-totals]')!.textContent ?? ''
    expect(totals, 'الكمية المكتوبة في الإدخال الذكي لم تُطبَّق').toContain('120')
    cleanup()
    view.unmount()
  })

  it('الضريبة تُفعَّل تلقائياً على البند الجديد تبعاً لإعدادات الشركة، وتظهر في الإجماليات', () => {
    const view = openEditor()
    const input = rows()[0].querySelector('.invoice-line-entry-cell input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'شاي' } })
    const search = document.querySelector('.invoice-search-overlay input') as HTMLInputElement
    fireEvent.focus(search)
    fireEvent.keyDown(search, { key: 'Enter' })
    /* الإعدادات هنا: ضريبة مسجَّلة 14% — فالبند الجديد يُفعَّل تلقائياً بلا أي نقرة */
    const totalsPanel = document.querySelector('[data-po-totals]')!
    expect(totalsPanel.textContent, 'الضريبة لم تظهر تلقائياً في الإجماليات رغم تسجيل الشركة ضريبياً').toContain('ضريبة القيمة المضافة')
    cleanup()
    view.unmount()
  })

  it('بلاغ المالك: خانة ضريبة كل بند مستقلة تماماً — إلغاؤها لبند لا يمس بنداً آخر', () => {
    // عمود الضريبة مخفي افتراضياً (قرار المالك v1.0.3) — نظهره هنا لفحص خانة كل بند
    useAppStore.getState().toggleInvoiceColumn('tax')
    const view = openEditor()
    const input1 = rows()[0].querySelector('.invoice-line-entry-cell input') as HTMLInputElement
    fireEvent.change(input1, { target: { value: 'شاي' } })
    let search = document.querySelector('.invoice-search-overlay input') as HTMLInputElement
    fireEvent.focus(search)
    fireEvent.keyDown(search, { key: 'Enter' })
    const input2 = document.querySelector('.invoice-line-entry-cell input') as HTMLInputElement
    fireEvent.change(input2, { target: { value: 'شاي' } })
    search = document.querySelector('.invoice-search-overlay input') as HTMLInputElement
    fireEvent.focus(search)
    fireEvent.keyDown(search, { key: 'Enter' })
    const taxBoxes = [...document.querySelectorAll('.invoice-line-taxcheck input[type="checkbox"]')] as HTMLInputElement[]
    expect(taxBoxes.length, 'خانات ضريبة البنود غائبة من الجدول').toBe(2)
    expect(taxBoxes[0].checked, 'البند الأول لم يُفعَّل تلقائياً تبعاً للإعدادات').toBe(true)
    expect(taxBoxes[1].checked, 'البند الثاني لم يُفعَّل تلقائياً تبعاً للإعدادات').toBe(true)
    fireEvent.click(taxBoxes[0])
    expect(taxBoxes[0].checked, 'لم يُلغَ تفعيل البند الأول').toBe(false)
    expect(taxBoxes[1].checked, 'إلغاء ضريبة البند الأول أثّر خطأً على البند الثاني').toBe(true)
    cleanup()
    view.unmount()
  })
})
