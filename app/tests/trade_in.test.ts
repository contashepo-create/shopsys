import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()

beforeEach(() => useDataStore.setState({ ...original, items: [], serials: [], tradeIns: [], journal: [] }))
afterEach(() => useDataStore.setState(original))

const addTrackedItem = (nameAr = 'آيفون 13') =>
  useDataStore.getState().addItem({ nameAr, sku: 'PH1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 1000, stockQty: 0, priceMinor: 2000, minQty: 0, trackSerial: true } as never)

describe('استبدال/مقايضة جهاز قديم Trade-In (سد فجوة مستقبلية — النشاط #3: موبايلات وصيانة)', () => {
  it('يسجل الجهاز القديم كسيريال بالمخزون ويولّد قيداً متوازناً 1103/2109', () => {
    addTrackedItem()
    const item = useDataStore.getState().items[0]
    const rec = useDataStore.getState().registerTradeIn({
      itemId: item.id, serial: '356789012345678', deviceCondition: 'خدوش بسيطة',
      valuationMinor: 500000, customerId: null, customerName: 'أحمد علي', notes: '',
    })
    expect(rec.tradeInNumber).toBe('TI-0001')
    const serials = useDataStore.getState().serials
    expect(serials).toHaveLength(1)
    expect(serials[0]).toMatchObject({ serial: '356789012345678', status: 'in_stock', purchaseId: null, itemId: item.id })
    const entry = useDataStore.getState().journal.find((e) => e.id === rec.journalEntryId)!
    expect(entry.lines).toEqual([
      expect.objectContaining({ accountCode: '1103', debit: 500000, credit: 0 }),
      expect.objectContaining({ accountCode: '2109', debit: 0, credit: 500000 }),
    ])
  })

  it('يرفض صنفاً لا يتتبع السيريال', () => {
    useDataStore.getState().addItem({ nameAr: 'كابل شحن', sku: 'CBL1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 100, stockQty: 0, priceMinor: 200, minQty: 0, trackSerial: false } as never)
    const item = useDataStore.getState().items[0]
    expect(() => useDataStore.getState().registerTradeIn({
      itemId: item.id, serial: '356789012345678', deviceCondition: '', valuationMinor: 1000, customerId: null, customerName: 'عميل', notes: '',
    })).toThrow('لا يتتبع السيريال')
  })

  it('يرفض سيريالاً مكرراً مسجلاً من قبل', () => {
    addTrackedItem()
    const item = useDataStore.getState().items[0]
    useDataStore.getState().registerTradeIn({ itemId: item.id, serial: 'ABC123456789', deviceCondition: '', valuationMinor: 1000, customerId: null, customerName: 'عميل', notes: '' })
    expect(() => useDataStore.getState().registerTradeIn({ itemId: item.id, serial: 'abc123456789', deviceCondition: '', valuationMinor: 1000, customerId: null, customerName: 'عميل آخر', notes: '' })).toThrow('مسجل من قبل')
  })

  it('يرفض سعر تقييم غير موجب أو عدم تحديد عميل', () => {
    addTrackedItem()
    const item = useDataStore.getState().items[0]
    expect(() => useDataStore.getState().registerTradeIn({ itemId: item.id, serial: 'XYZ987654321', deviceCondition: '', valuationMinor: 0, customerId: null, customerName: 'عميل', notes: '' })).toThrow()
    expect(() => useDataStore.getState().registerTradeIn({ itemId: item.id, serial: 'XYZ987654321', deviceCondition: '', valuationMinor: 1000, customerId: null, customerName: '', notes: '' })).toThrow('حدد العميل')
  })
})
