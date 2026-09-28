import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvoiceLinesTable, type InvoiceTableLine } from '../src/ui/components/InvoiceLinesTable.tsx'
import { formatInvoiceAuditLine, formatAuditStamp } from '../src/core/invoiceAudit.ts'
import {
  DEFAULT_WAREHOUSE_RECEIPT,
  buildWarehouseReceiptHtml,
  sortWarehouseReceiptLines,
  warehouseReceiptColumns,
  warehouseReceiptTotals,
} from '../src/core/warehouseReceipt.ts'

afterEach(cleanup)

/* ============ ① سطر تدقيق الفاتورة المرحّلة (الشريط السفلي — سطر واحد) ============ */
describe('سطر تدقيق الفاتورة المرحّلة', () => {
  it('لا يظهر سطر تدقيق لفاتورة لم تُعدَّل', () => {
    expect(formatInvoiceAuditLine(undefined)).toBeNull()
    expect(formatInvoiceAuditLine([])).toBeNull()
  })

  it('يجمع الوقت والتاريخ والمستخدم والسبب في **سطر واحد**', () => {
    const line = formatInvoiceAuditLine([{ at: '2026-09-28T14:35:00', reason: 'تصحيح كمية الصنف', by: 'أحمد المحاسب' }])
    expect(line).toBe('عُدِّلت 2026-09-28 14:35 · بواسطة أحمد المحاسب · السبب: تصحيح كمية الصنف')
    expect(line!.includes('\n')).toBe(false)
  })

  it('يذكر عدد التعديلات عند تكرارها ويأخذ آخر تعديل', () => {
    const line = formatInvoiceAuditLine([
      { at: '2026-09-20T09:00:00', reason: 'سبب قديم', by: 'سالم' },
      { at: '2026-09-28T16:05:00', reason: 'إضافة صنف ناقص', by: 'هدى' },
    ])
    expect(line).toContain('عُدِّلت 2026-09-28 16:05')
    expect(line).toContain('بواسطة هدى')
    expect(line).toContain('السبب: إضافة صنف ناقص')
    expect(line).toContain('(2 تعديلات)')
  })

  it('يستعمل المستخدم البديل للسجلات القديمة التي بلا اسم', () => {
    expect(formatInvoiceAuditLine([{ at: '2026-01-05T08:10:00', reason: 'تسوية' }], 'المالك'))
      .toBe('عُدِّلت 2026-01-05 08:10 · بواسطة المالك · السبب: تسوية')
    expect(formatAuditStamp('2026-03-07T07:09:00')).toBe('2026-03-07 07:09')
  })
})

/* ============ ② إذن استلام المستودع: كميات فقط بلا أي سعر ============ */
describe('إذن استلام المستودع', () => {
  const lines = [
    { nameAr: 'أسمنت 50كجم', qty: 12, unit: 'كيس', code: 'CEM-50', barcode: '6221000000017', warehouseAr: 'المخزن الرئيسي' },
    { nameAr: 'حديد 12مم', qty: 3.5, unit: 'طن', code: 'ST-12', warehouseAr: 'مخزن الفرع' },
  ]

  it('لا يحمل أي سعر أو عملة مهما كانت الإعدادات', () => {
    const html = buildWarehouseReceiptHtml({
      title: 'إذن استلام من المستودع', docNumber: 'INV-0004', dateLabel: '2026-09-28',
      partyLabel: 'مؤسسة النور', branchLabel: 'الفرع الرئيسي', companyName: 'شركة تجريبية',
      userLabel: 'أمين المخزن', lines,
      settings: { ...DEFAULT_WAREHOUSE_RECEIPT, showBarcode: true, showLocation: true, showNotesColumn: true },
    })
    for (const forbidden of ['سعر', 'السعر', 'ر.س', 'ج.م', 'الإجمالي', 'المبلغ', 'الخصم', 'الضريبة']) {
      expect(html.includes(forbidden)).toBe(false)
    }
    expect(html).toContain('الكمية')
    expect(html).toContain('أسمنت 50كجم')
  })

  it('الأعمدة تتبع الإعدادات ولا تختفي الكمية أبداً', () => {
    const lean = warehouseReceiptColumns({ ...DEFAULT_WAREHOUSE_RECEIPT, showCode: false, showUnit: false, showReceivedActual: false })
    expect(lean).toEqual(['م', 'الصنف', 'الكمية'])
    const rich = warehouseReceiptColumns({ ...DEFAULT_WAREHOUSE_RECEIPT, showBarcode: true, showLocation: true, showNotesColumn: true, groupByWarehouse: true })
    expect(rich).toEqual(['م', 'الكود', 'الباركود', 'الصنف', 'المخزن', 'الموقع', 'الوحدة', 'الكمية', 'المستلم فعلياً', 'ملاحظات'])
  })

  it('الإجماليات كميات فقط والترتيب والتجميع يعملان', () => {
    expect(warehouseReceiptTotals(lines)).toEqual({ lineCount: 2, totalQty: 15.5 })
    const byQty = sortWarehouseReceiptLines(lines, { ...DEFAULT_WAREHOUSE_RECEIPT, sort: 'qty' })
    expect(byQty[0].nameAr).toBe('أسمنت 50كجم')
    const grouped = sortWarehouseReceiptLines(lines, { ...DEFAULT_WAREHOUSE_RECEIPT, groupByWarehouse: true })
    expect(grouped.map((line) => line.warehouseAr)).toEqual(['المخزن الرئيسي', 'مخزن الفرع'])
  })

  it('عدد النسخ يطبع صفحات متكررة مرقّمة', () => {
    const html = buildWarehouseReceiptHtml({
      title: 'إذن استلام من المستودع', docNumber: 'PUR-0009', dateLabel: '2026-09-28',
      partyLabel: 'مورد نقدي', branchLabel: 'الفرع الرئيسي', companyName: 'شركة تجريبية',
      userLabel: 'المالك', lines, settings: { ...DEFAULT_WAREHOUSE_RECEIPT, copies: 2 },
    })
    expect(html.match(/wr-page/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('نسخة 2 من 2')
    expect(html).toContain('أمين المخزن')
  })
})

/* ============ ③ جدول البنود: سطور فارغة حقيقية والبحث من خلية الاسم ============ */
describe('جدول بنود الفاتورة في الوضع الحي', () => {
  const items = [
    { id: 1, nameAr: 'أسمنت 50كجم', sku: 'CEM-50', stockQty: 40, priceMinor: 12000, baseUnit: 'كيس', isActive: true },
    { id: 2, nameAr: 'حديد 12مم', sku: 'ST-12', stockQty: 9, priceMinor: 450000, baseUnit: 'طن', isActive: true },
  ]
  const line: InvoiceTableLine = { key: 'k1', itemId: 1, nameAr: 'أسمنت 50كجم', qty: 2, unitPriceMinor: 12000, warehouseId: 1 }
  const renderTable = (lines: InvoiceTableLine[] = [line]) => render(
    <InvoiceLinesTable
      kind="sale" mode="standard" lines={lines} items={items}
      warehouses={[{ id: 1, nameAr: 'المخزن الرئيسي' }]} warehouseId={1}
      currencyDecimals={2} currencySymbol="ج.م"
      onPick={vi.fn()} onPatch={vi.fn()} onRemove={vi.fn()}
      placeholder="ابحث عن صنف" showPicker={false}
      entry={<input aria-label="بحث الأصناف" data-testid="entry-box" />}
    />,
  )

  it('يعرض خمسة سطور على الأقل فلا تقفز الشاشة مع أول صنف', () => {
    const view = renderTable()
    expect(view.container.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(5)
    expect(view.container.querySelectorAll('tr.invoice-line-ghost').length).toBe(4)
  })

  it('مربع البحث داخل خلية اسم أول سطر فارغ — لا شريط بحث منفصل', () => {
    const view = renderTable()
    const entry = view.getByTestId('entry-box')
    expect(entry.closest('td')?.className).toContain('invoice-line-entry-cell')
    expect(view.container.querySelectorAll('[data-testid="entry-box"]').length).toBe(1)
    expect(view.container.querySelector('.invoice-doc-entry')).toBeNull()
  })

  it('رأس الجدول يحمل زر «مسح باركود» بدل زر حذف السطر', () => {
    const view = renderTable()
    expect(view.getByLabelText('مسح باركود')).toBeTruthy()
    expect(view.container.querySelector('.invoice-doc-linebar')).toBeNull()
  })

  it('أعمدة المبالغ والمخزن والكميات موسَّطة والاسم يمين', () => {
    const view = renderTable()
    const headers = [...view.container.querySelectorAll('thead th')] as HTMLElement[]
    const total = headers.find((header) => header.textContent === 'الإجمالي')!
    expect(total.className).toContain('text-center')
    const name = headers.find((header) => header.textContent === 'الصنف / الوصف')!
    expect(name.className).toContain('text-start')
  })

  it('الأسهم تنقل التركيز داخل الجدول بلا تغيير أي قيمة', () => {
    const view = renderTable([line, { ...line, key: 'k2', itemId: 2, nameAr: 'حديد 12مم', qty: 1, unitPriceMinor: 450000 }])
    const qtyInputs = [...view.container.querySelectorAll('tbody tr .num-cell input')] as HTMLInputElement[]
    qtyInputs[0].focus()
    const before = qtyInputs[0].value
    fireEvent.keyDown(qtyInputs[0], { key: 'ArrowDown' })
    expect(document.activeElement).not.toBe(qtyInputs[0])
    expect(qtyInputs[0].value).toBe(before)
  })

  it('Enter ينتقل من الكمية إلى السعر ثم إلى السطر التالي', () => {
    const view = renderTable([line, { ...line, key: 'k2', itemId: 2, nameAr: 'حديد 12مم', qty: 1, unitPriceMinor: 450000 }])
    const firstRow = view.container.querySelectorAll('tbody tr')[0]
    const qty = firstRow.querySelector('.num-cell input') as HTMLInputElement
    const price = firstRow.querySelector('.price-cell input') as HTMLInputElement
    qty.focus()
    fireEvent.keyDown(qty, { key: 'Enter' })
    expect(document.activeElement).toBe(price)
  })
})
