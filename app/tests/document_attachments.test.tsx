/**
 * مرفقات المستندات التجارية + تخصيص أعمدة جدول البنود (التصميم المرجعي للمالك).
 *
 * القاعدتان اللتان تحرسهما هذه الاختبارات:
 *   ① المرفق **حقيقي**: يُفحص نوعه وحجمه، ويُربط برقم مستند موجود، ويُحذف فعلاً.
 *   ② إخفاء عمود من جدول البنود **عرضٌ فقط**: الإجمالي والضريبة لا يتغيران رقماً
 *      واحداً عند إخفاء عمودهما — التخصيص لا يمس الحساب ولا القيد.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore, DEFAULT_INVOICE_COLUMNS } = await import('../src/stores/app.store.ts')
const { InvoiceLinesTable } = await import('../src/ui/components/InvoiceLinesTable.tsx')
const { attachmentSizeKb } = await import('../src/ui/attachmentFile.ts')

const S = () => useDataStore.getState()
const A = () => useAppStore.getState()
const originalData = useDataStore.getState()
const PNG = 'data:image/jpeg;base64,' + 'A'.repeat(400)

beforeEach(() => {
  useDataStore.setState({ ...originalData, documentFiles: [] })
  useAppStore.setState({ ...useAppStore.getState(), invoiceColumns: { ...DEFAULT_INVOICE_COLUMNS } })
})
afterEach(() => { cleanup(); useDataStore.setState(originalData) })

describe('مرفقات الفاتورة', () => {
  it('يحفظ المرفق مربوطاً برقم المستند ونوعه ومن أضافه', () => {
    const saved = S().addDocumentFile({ documentKind: 'sale', documentId: 7, name: 'أمر شراء العميل', mime: 'image/jpeg', dataUrl: PNG, addedBy: 'المالك' })
    expect(saved.id).toBeGreaterThan(0)
    expect(saved.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(S().documentFiles).toHaveLength(1)
    expect(S().documentFiles[0]).toMatchObject({ documentKind: 'sale', documentId: 7, addedBy: 'المالك' })
  })

  it('يرفض المرفق بلا مستند مرحّل — لا مرفق معلق في قاعدة البيانات', () => {
    expect(() => S().addDocumentFile({ documentKind: 'sale', documentId: 0, name: 'ملف', mime: 'image/jpeg', dataUrl: PNG, addedBy: 'المالك' })).toThrow('رحّل الفاتورة أولاً')
    expect(S().documentFiles).toHaveLength(0)
  })

  it('يرفض النوع غير المسموح والملف الضخم والاسم الفارغ', () => {
    expect(() => S().addDocumentFile({ documentKind: 'purchase', documentId: 3, name: 'فيروس', mime: 'application/x-msdownload', dataUrl: PNG, addedBy: 'المالك' })).toThrow('المسموح')
    expect(() => S().addDocumentFile({ documentKind: 'purchase', documentId: 3, name: 'كبير', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + 'A'.repeat(3_000_000), addedBy: 'المالك' })).toThrow('كبير')
    expect(() => S().addDocumentFile({ documentKind: 'purchase', documentId: 3, name: '   ', mime: 'application/pdf', dataUrl: PNG, addedBy: 'المالك' })).toThrow('اسم المستند مطلوب')
    expect(S().documentFiles).toHaveLength(0)
  })

  it('يفصل مرفقات البيع عن الشراء وعن باقي المستندات ثم يحذف المطلوب وحده', () => {
    const sale = S().addDocumentFile({ documentKind: 'sale', documentId: 1, name: 'بوليصة', mime: 'application/pdf', dataUrl: PNG, addedBy: 'المالك' })
    S().addDocumentFile({ documentKind: 'purchase', documentId: 1, name: 'فاتورة المورد', mime: 'application/pdf', dataUrl: PNG, addedBy: 'المالك' })
    S().addDocumentFile({ documentKind: 'sale', documentId: 2, name: 'تحويل بنكي', mime: 'image/jpeg', dataUrl: PNG, addedBy: 'المالك' })
    expect(S().documentFiles.filter((f) => f.documentKind === 'sale' && f.documentId === 1)).toHaveLength(1)
    S().removeDocumentFile(sale.id)
    expect(S().documentFiles.map((f) => f.name)).toEqual(['فاتورة المورد', 'تحويل بنكي'])
  })

  it('يحسب حجم المرفق بالكيلوبايت من طول base64', () => {
    expect(attachmentSizeKb(PNG)).toBeGreaterThan(0)
    expect(attachmentSizeKb('data:image/jpeg;base64,' + 'A'.repeat(1024 * 40))).toBe(30)
  })
})

describe('تخصيص أعمدة جدول البنود', () => {
  const items = [{ id: 1, nameAr: 'شاشة', sku: 'SKU-1', stockQty: 5, baseUnit: 'قطعة', priceMinor: 10000, costMinor: 6000, isActive: true }]
  const lines = [{ key: 'k1', itemId: 1, nameAr: 'شاشة', qty: 2, unitPriceMinor: 10000, discountPercent: 0, warehouseId: 1 }]
  /* عمود الضريبة لا يظهر إلا في الربحية/المتقدمة ومع تفعيل الضريبة (قرار المالك ⑩ي). */
  const table = (extra: Record<string, unknown> = {}) => render(
    <InvoiceLinesTable
      kind="sale" mode="advanced" taxEnabled lines={lines} items={items} warehouses={[{ id: 1, nameAr: 'الرئيسي' }]} warehouseId={1}
      currencyDecimals={2} currencySymbol="ج.م" documentTaxPercent={14} placeholder="ابحث" showPicker={false}
      onPick={() => {}} onPatch={() => {}} onRemove={() => {}}
      {...extra}
    />,
  )

  it('الكود والوحدة ظاهران افتراضياً — الضريبة مخفية افتراضياً (بلاغ v1.0.3: الإجماليات فقط)', () => {
    const view = table()
    expect(view.getByText('كود الصنف')).toBeTruthy()
    expect(view.getByText('الوحدة')).toBeTruthy()
    // طلب المالك: حقل الضريبة لا يظهر إلا بإعادته من «تخصيص الحقول» داخل الفاتورة
    expect(view.queryByText('الضريبة')).toBeNull()
    expect(view.queryByText('14% ض.ق.م')).toBeNull()
    cleanup()
    // الإعادة من زر التخصيص تعيده فوراً — الإخفاء الافتراضي لا يقفل الباب
    A().toggleInvoiceColumn('tax')
    const taxed = table()
    expect(taxed.getByText('الضريبة')).toBeTruthy()
    expect(taxed.getByText('14% ض.ق.م')).toBeTruthy()
  })

  it('عمود الضريبة يختفي في البيع المباشر أو عند إلغاء تفعيل الضريبة (قرار المالك ⑩ي)', () => {
    const direct = table({ mode: 'simple' })
    expect(direct.queryByText('الضريبة')).toBeNull()
    expect(direct.queryByText('14% ض.ق.م')).toBeNull()
    cleanup()
    const noTax = table({ taxEnabled: false })
    expect(noTax.queryByText('الضريبة')).toBeNull()
    expect(noTax.queryByText('14% ض.ق.م')).toBeNull()
  })

  it('خلية اسم الصنف تحمل الاسم وحده بلا سطر فرعي (قرار المالك ⑩ي)', () => {
    const view = table()
    expect(view.container.querySelector('.invoice-doc-linesub')).toBeNull()
    const nameCell = [...view.container.querySelectorAll('tbody tr[data-entry-row] td')].find((cell) => cell.textContent?.includes('شاشة'))!
    expect(nameCell.textContent?.trim()).toBe('شاشة')
  })

  it('يخفي الأعمدة المطفأة ولا يغيّر إجمالي السطر — إخفاء عرضٍ لا حساب', () => {
    A().toggleInvoiceColumn('tax') // الضريبة الآن مخفية افتراضياً — نشغلها لبيانات المقارنة
    const before = table().container.querySelector('.invoice-table-total')?.textContent
    cleanup()
    A().toggleInvoiceColumn('code'); A().toggleInvoiceColumn('unit'); A().toggleInvoiceColumn('tax')
    const view = table()
    expect(view.queryByText('كود الصنف')).toBeNull()
    expect(view.queryByText('الوحدة')).toBeNull()
    expect(view.queryByText('الضريبة')).toBeNull()
    expect(view.queryByText('14% ض.ق.م')).toBeNull()
    expect(view.container.querySelector('.invoice-doc-linesub')).toBeNull()
    expect(view.container.querySelector('.invoice-table-total')?.textContent).toBe(before)
    expect(view.getByText('الإجمالي')).toBeTruthy()
  })

  it('يعيد كل الأعمدة بزر الاسترجاع', () => {
    /* الضريبة مخفية افتراضياً (v1.0.3): التبديل يظهرها ثم الاسترجاع يخفيها ثانية */
    A().toggleInvoiceColumn('tax')
    expect(A().invoiceColumns.tax).toBe(true)
    A().resetInvoiceColumns()
    expect(A().invoiceColumns).toEqual(DEFAULT_INVOICE_COLUMNS)
    expect(A().invoiceColumns.tax).toBe(false)
  })

  it('لا يسمح بإخفاء أعمدة الإدخال — الكمية والسعر والإجمالي ثابتة', () => {
    A().toggleInvoiceColumn('code'); A().toggleInvoiceColumn('unit')
    const view = table()
    expect(view.getByText('الكمية')).toBeTruthy()
    expect(view.getByText('السعر')).toBeTruthy()
    expect(view.getByText('الإجمالي')).toBeTruthy()
    expect(view.getByText('إجراءات')).toBeTruthy()
  })
})
