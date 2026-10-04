/**
 * §102 (تعدد الطابعات): إقفال أمر مطعم يطبع آلياً نسخة لكل مسار مفعّل —
 * إيصال العميل على طابعته وبون المطبخ وبون المحطة على طابعتيهما.
 * printToRoute/printHtml منكّرة (يسجلان ولا يفتحان إطارات) — الفحص على
 * الاستدعاءات وترتيبها ومحتواها (بون المطبخ بلا أسعار · نسخة المحطة بعنوانها).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('../src/ui/print/printReceipt.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/print/printReceipt.ts')>()
  return { ...actual, printHtml: vi.fn(), printToRoute: vi.fn() }
})

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { DEFAULT_PRINTER_PROFILES } = await import('../src/core/printers.ts')
const { printToRoute } = await import('../src/ui/print/printReceipt.ts')

const originalData = useDataStore.getState()
const originalApp = useAppStore.getState()

const order = {
  id: 9, orderNumber: 'ORD-0009', type: 'dine_in', tableName: '5', notes: 'بصل زيادة',
  status: 'open', openedAt: new Date().toISOString(),
  lines: [
    { itemId: 1, nameAr: 'برجر لحم', qty: 2, unitPriceMinor: 9000, unitCostMinor: 5000, discountPercent: 0, soldByWeight: false },
    { itemId: 2, nameAr: 'عصير مانجو', qty: 1, unitPriceMinor: 3500, unitCostMinor: 1500, discountPercent: 0, soldByWeight: false },
  ],
}
const fakeSale = {
  id: 77, invoiceNumber: 'SAL-0077', refCode: 'R-77', date: '2026-10-04T12:00:00', payment: 'cash',
  paidMinor: 21500, lines: order.lines,
  totals: { subtotalMinor: 21500, discountMinor: 0, totalMinor: 21500, vatMinor: 0 },
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  useAppStore.setState({ printerProfiles: DEFAULT_PRINTER_PROFILES })
  useDataStore.setState({
    ...originalData,
    restaurantOrders: [order] as never,
    items: [], treasuries: [{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 10_000, isDefault: true }] as never,
    paymentTerminals: [] as never, appUsers: [] as never, currentUserId: null,
    sales: [], journal: [],
    openRestaurantOrder: vi.fn(), setRestaurantOrderLines: vi.fn(), cancelRestaurantOrder: vi.fn(), splitRestaurantOrder: vi.fn(),
    getEffectivePrice: vi.fn(() => 9000),
    settleRestaurantOrder: vi.fn(() => fakeSale),
  })
  vi.mocked(printToRoute).mockClear()
})
afterEach(() => cleanup())

const settleOpenOrder = async () => {
  const { RestaurantOrdersPage } = await import('../src/ui/pages/RestaurantOrdersPage.tsx')
  render(<RestaurantOrdersPage />)
  fireEvent.click(screen.getByText('ORD-0009')) /* بطاقة الأمر */
  fireEvent.click(screen.getByText('الفاتورة والدفع')) /* زر الدفع */
  fireEvent.click(screen.getByText('قفل الأمر وإصدار الفاتورة')) /* الإقفال */
}

describe('§102 الطباعة الآلية عند إقفال أمر المطعم', () => {
  it('بلا مسارات مفعّلة: لا طباعة آلية إطلاقاً (الافتراضي الآمن)', async () => {
    await settleOpenOrder()
    expect(printToRoute).not.toHaveBeenCalled()
    expect(useDataStore.getState().settleRestaurantOrder).toHaveBeenCalled()
  })

  it('إيصال العميل + بون المطبخ مفعّلان: نسختان آليتان على مساريهما — الإيصال بفاتورته والبون بلا أسعار', async () => {
    useAppStore.setState({
      printerProfiles: {
        ...DEFAULT_PRINTER_PROFILES,
        clientReceipt: { printerName: 'XP-80-Cashier', autoPrint: true },
        kitchenTicket: { printerName: 'TM-T20-Kitchen', autoPrint: true },
      },
    })
    await settleOpenOrder()
    expect(printToRoute).toHaveBeenCalledTimes(2)
    const [receiptHtml, receiptProfile] = vi.mocked(printToRoute).mock.calls[0]
    expect(receiptProfile).toEqual({ printerName: 'XP-80-Cashier', autoPrint: true })
    expect(receiptHtml).toContain('SAL-0077') /* إيصال العميل بالفاتورة */
    expect(receiptHtml).toContain('برجر لحم')
    const [kitchenHtml, kitchenProfile] = vi.mocked(printToRoute).mock.calls[1]
    expect(kitchenProfile).toEqual({ printerName: 'TM-T20-Kitchen', autoPrint: true })
    expect(kitchenHtml).toContain('ORD-0009') /* بون المطبخ برقم الأمر */
    expect(kitchenHtml).not.toContain('9,000') /* بلا أسعار */
    expect(kitchenHtml).toContain('بصل زيادة') /* ملاحظات السطح للمطبخ */
  })

  it('المحطة مفعّلة أيضاً: ثلاث نسخ — الثالثة بعنوان «المحطة» على طابعتها', async () => {
    useAppStore.setState({
      printerProfiles: {
        clientReceipt: { printerName: '', autoPrint: true },
        kitchenTicket: { printerName: '', autoPrint: true },
        stationTicket: { printerName: 'JuiceBar-Printer', autoPrint: true },
      },
    })
    await settleOpenOrder()
    expect(printToRoute).toHaveBeenCalledTimes(3)
    const [stationHtml, stationProfile] = vi.mocked(printToRoute).mock.calls[2]
    expect(stationProfile.printerName).toBe('JuiceBar-Printer')
    expect(stationHtml).toContain('المحطة') /* نسخة المحطة بعنوانها المميز */
    expect(stationHtml).not.toContain('9,000')
  })
})
