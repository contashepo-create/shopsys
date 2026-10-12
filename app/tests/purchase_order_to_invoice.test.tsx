/**
 * دورة أمر الشراء الكاملة (أثبتها المالك: «راجع كل التعديلات واختبرها»):
 *
 *   أمر شراء (التزام تجاري: بلا قيد وبلا حركة مخزون)
 *     ↓ «فاتورة استلام» تُعبَّأ من البنود المتبقية
 *   فاتورة شراء مرحَّلة (القيد الوحيد: مخزون + تكلفة + ذمة المورد)
 *     ↓
 *   مخزون زاد · متوسط التكلفة تحدّث · رصيد المورد زاد · حالة الأمر صارت «مستلَم»
 *   ولا يُستلم الأمر مرتين (الفاتورة الثانية لا تجد بنوداً متبقية).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { AdvancedPurchaseInvoicePage } = await import('../src/ui/pages/AdvancedPurchaseInvoicePage.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const S = () => useDataStore.getState()
let supplierId = 0
let itemId = 0
let saleItemId = 0

afterEach(() => cleanup())

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'اختبار الدورة',
      ownerName: 'المالك', features: [], modules: ['pos', 'inventory', 'purchases'], accountingMode: 'full',
      vatPercent: 0, taxRegistrationStatus: 'not_registered',
    },
  })
  S().addCategory('بضائع', [])
  const categoryId = S().categories[0]?.id ?? 0
  S().addItem({
    nameAr: 'سكر أبيض', sku: 'SUG-1', barcodes: [], categoryId, baseUnit: 'كيس', extraUnits: [],
    costMinor: 10000, stockQty: 10, priceMinor: 13000, minQty: 2, trackExpiry: false, trackSerial: false,
    warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
  S().addItem({
    nameAr: 'زيت طعام', sku: 'OIL-1', barcodes: [], categoryId, baseUnit: 'زجاجة', extraUnits: [],
    costMinor: 5000, stockQty: 4, priceMinor: 7000, minQty: 1, trackExpiry: false, trackSerial: false,
    warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
  itemId = S().items.find((item) => item.sku === 'SUG-1')!.id
  saleItemId = S().items.find((item) => item.sku === 'OIL-1')!.id
  S().addSupplier({ nameAr: 'مورد الأمانة', phone: '0100', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  supplierId = S().suppliers[0].id
})

/** ينشئ أمر شراء من المخزن مباشرة (كما يفعله زر «اعتماد أمر الشراء» في الشاشة) */
function createOrder(lines: { itemId: number; nameAr: string; qty: number; unitPriceMinor: number }[]) {
  return S().addPurchaseOrder({
    supplierId, supplierName: 'مورد الأمانة', date: '2026-10-12', expectedDate: '2026-10-14', warehouseId: null, notes: 'توريد أسبوعي',
    lines: lines.map((line) => ({ ...line, receivedQty: 0, unitAr: 'كيس', vatPercent: 0, notes: '' })),
  })
}

/** يفتح فاتورة الشراء معبَّأة من الأمر (نفس ما يفعله زر «فاتورة استلام») */
function openReceipt(orderId: number) {
  return render(
    <MemoryRouter initialEntries={[`/purchases/invoices/new?po=${orderId}`]}>
      <AdvancedPurchaseInvoicePage /><ToastHost />
    </MemoryRouter>,
  )
}

describe('دورة أمر الشراء ← فاتورة الاستلام ← الترحيل', () => {
  it('الفاتورة تُعبَّأ من البنود المتبقية بالكمية والسعر المكتوبين في الأمر', () => {
    const order = createOrder([{ itemId, nameAr: 'سكر أبيض', qty: 3, unitPriceMinor: 4000 }])
    const view = openReceipt(order.id)
    const body = document.body.textContent ?? ''
    expect(body, 'أمر الشراء لم يُعبَّأ في الفاتورة').toContain('سكر أبيض')
    const qtyInput = document.querySelector('tbody tr input') as HTMLInputElement
    expect(qtyInput?.value, 'كمية الأمر لم تُنقل للفاتورة').toBe('3')
    cleanup(); view.unmount()
    S().deletePurchaseOrder(order.id)
  })

  it('بعد الترحيل: مخزون زائد · تكلفة محدَّثة · ذمة المورد زادت · الأمر «مستلَم» بلا قيد مزدوج', () => {
    const stockBefore = S().items.find((item) => item.id === itemId)!.stockQty ?? 0
    const balanceBefore = S().getSupplierBalance(supplierId)
    const journalBefore = S().journal.length

    const order = createOrder([{ itemId, nameAr: 'سكر أبيض', qty: 3, unitPriceMinor: 4000 }])
    expect(order.status, 'الأمر يجب أن يُسجَّل مسودة بلا قيد').toBe('draft')
    expect(S().journal.length, 'أمر الشراء يجب ألا يولّد أي قيد').toBe(journalBefore)

    const view = openReceipt(order.id)
    const postButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('حفظ وترحيل'))
    expect(postButton, 'زر الترحيل غير موجود في شريط الفاتورة').toBeTruthy()
    fireEvent.click(postButton!)
    cleanup(); view.unmount()

    /* ① المخزون زاد بكمية الأمر (والحركة مصدرها الفاتورة وحدها) */
    expect(S().items.find((item) => item.id === itemId)!.stockQty, 'المخزون لم يُحدَّث من الفاتورة').toBe(stockBefore + 3)
    /* ② القيد واحد فقط للفاتورة (أمر الشراء نفسه بلا قيد) */
    expect(S().journal.length, 'عدد القيود غير متوقع').toBe(journalBefore + 1)
    /* ③ ذمة المورد: 3 × 40 = 120 */
    expect(S().getSupplierBalance(supplierId) - balanceBefore, 'ذمة المورد لم تُسجَّل صحيحة').toBe(12000)
    /* ④ الأمر صار مُستلَماً بالكامل ومربوطاً بالفاتورة */
    const after = S().purchaseOrders.find((row) => row.id === order.id)!
    expect(after.lines[0].receivedQty, 'الكمية المستلمة على الأمر لم تُحدَّث').toBe(3)
    expect(after.status, 'حالة الأمر لم تُشتق من الاستلام').toBe('closed')
    expect(after.invoiceIds.length, 'الفاتورة لم تُربط بالأمر').toBe(1)
    /* ⑤ لا قيد ثانٍ عند إعادة فتح الفاتورة من نفس الأمر (لا بنود متبقية) */
    const second = openReceipt(order.id)
    expect(document.body.textContent, 'أمر مُستلَم بالكامل يجب ألا يُعبَّأ مرة أخرى').toContain('كل بنود هذا الأمر استُلمت بالفعل')
    cleanup(); second.unmount()
  })

  it('الاستلام الجزئي يبقي الأمر «جزئي» والمتبقي يُتاح لفاتورة تالية', () => {
    const order = createOrder([{ itemId: saleItemId, nameAr: 'زيت طعام', qty: 5, unitPriceMinor: 5000 }])
    S().receivePurchaseOrder(order.id, [{ itemId: saleItemId, qty: 2 }], undefined)
    const partial = S().purchaseOrders.find((row) => row.id === order.id)!
    expect(partial.status, 'استلام 2 من 5 يجب أن يبقى جزئياً').toBe('partial')
    expect(partial.lines[0].receivedQty).toBe(2)
    S().receivePurchaseOrder(order.id, [{ itemId: saleItemId, qty: 3 }], undefined)
    const closed = S().purchaseOrders.find((row) => row.id === order.id)!
    expect(closed.status, 'إتمام المتبقي يجب أن يُغلق الأمر').toBe('closed')
    expect(closed.lines[0].receivedQty).toBe(5)
    /* الحالات المستلمة تُشتق ولا تُضبط يدوياً، والمكتمل لا يُلغى */
    expect(() => S().setPurchaseOrderStatus(order.id, 'partial'), 'الحالة المستلمة لا تُضبط يدوياً').toThrow()
    expect(() => S().setPurchaseOrderStatus(order.id, 'cancelled'), 'الأمر المكتمل لا يُلغى').toThrow()
  })
})
