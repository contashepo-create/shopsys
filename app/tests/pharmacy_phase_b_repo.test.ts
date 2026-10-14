import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()
const S = () => useDataStore.getState()

beforeEach(() => useDataStore.setState({ ...original, items: [], controlledDispenses: [], coldChainReadings: [], suppliers: [] }))
afterEach(() => useDataStore.setState(original))

describe('سجل صرف الأصناف الخاضعة للرقابة (سد فجوة مستقبلية — النشاط #5: صيدلية)', () => {
  it('يسجل صرفاً صحيحاً برقم متسلسل ويحذفه بمعرّفه', () => {
    S().addItem({ nameAr: 'ترامادول', sku: 'CTRL1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 500, stockQty: 10, priceMinor: 1000, minQty: 0, isControlled: true } as never)
    const item = S().items[0]
    const row = S().addControlledDispense({ itemId: item.id, qty: 2, patientName: 'أحمد', prescriberName: 'د. سارة' })
    expect(S().controlledDispenses).toHaveLength(1)
    expect(row.patientName).toBe('أحمد')
    S().deleteControlledDispense(row.id)
    expect(S().controlledDispenses).toHaveLength(0)
  })

  it('يرفض صرفاً لصنف غير موجود، أو بلا اسم مريض/طبيب، أو بكمية غير موجبة', () => {
    expect(() => S().addControlledDispense({ itemId: 999, qty: 1, patientName: 'أحمد', prescriberName: 'د. سارة' })).toThrow()
    S().addItem({ nameAr: 'ترامادول', sku: 'CTRL2', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 500, stockQty: 10, priceMinor: 1000, minQty: 0, isControlled: true } as never)
    const item = S().items[0]
    expect(() => S().addControlledDispense({ itemId: item.id, qty: 1, patientName: '  ', prescriberName: 'د. سارة' })).toThrow()
    expect(() => S().addControlledDispense({ itemId: item.id, qty: 1, patientName: 'أحمد', prescriberName: '' })).toThrow()
    expect(() => S().addControlledDispense({ itemId: item.id, qty: 0, patientName: 'أحمد', prescriberName: 'د. سارة' })).toThrow()
  })
})

describe('سجل قراءات سلسلة التبريد (سد فجوة مستقبلية — النشاط #5: صيدلية)', () => {
  it('يسجل قراءة حرارة بحدين أدنى وأعلى اختياريين ويحذفها', () => {
    const row = S().addColdChainReading({ storageUnitName: 'ثلاجة اللقاحات', tempC: 6.5, minC: 2, maxC: 8 })
    expect(S().coldChainReadings).toHaveLength(1)
    expect(row.tempC).toBe(6.5)
    S().deleteColdChainReading(row.id)
    expect(S().coldChainReadings).toHaveLength(0)
  })

  it('يرفض وحدة تخزين بلا اسم أو درجة حرارة غير رقمية', () => {
    expect(() => S().addColdChainReading({ storageUnitName: '  ', tempC: 5 })).toThrow()
    expect(() => S().addColdChainReading({ storageUnitName: 'ثلاجة', tempC: Number.NaN })).toThrow()
  })
})

describe('نافذة إرجاع المورد (سد فجوة فورية — النشاط #5: صيدلية)', () => {
  it('addSupplier/updateSupplier يحفظان returnWindowDays', () => {
    S().addSupplier({ nameAr: 'مورد أدوية', phone: '', notes: '', returnWindowDays: 20 } as never)
    const supplier = S().suppliers.find((s) => s.nameAr === 'مورد أدوية')
    expect(supplier?.returnWindowDays).toBe(20)
  })
})

describe('روشتة مرفقة بفاتورة البيع (سد فجوة مستقبلية — النشاط #5: صيدلية)', () => {
  it('تُحفظ الروشتة على الفاتورة عند إرفاقها ببيانات صحيحة', () => {
    S().addItem({ nameAr: 'دواء روشتة', sku: 'RX1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 500, stockQty: 10, priceMinor: 1000, minQty: 0, requiresPrescription: true } as never)
    const item = S().items.find((i) => i.sku === 'RX1')!
    const sale = S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0 }],
      payment: 'cash', paidMinor: 1000, treasury: '1101', taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: false,
      prescription: { patientName: 'مريم', prescriberName: 'د. خالد', rxLines: [{ medication: 'دواء روشتة', form: 'strip', formQty: 1, timesPerDay: 2, everyHours: 0, mealRelation: 'after', mealsCount: 1, durationDays: 5, repeated: false, repeatTimes: 0, repeatEveryDays: 0, notes: '' }] },
    } as never)
    expect(sale.prescription?.patientName).toBe('مريم')
    expect(sale.prescription?.rxLines).toHaveLength(1)
  })

  it('يرفض روشتة بلا اسم مريض أو ببند روشتة غير صالح', () => {
    S().addItem({ nameAr: 'دواء روشتة', sku: 'RX2', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 500, stockQty: 10, priceMinor: 1000, minQty: 0, requiresPrescription: true } as never)
    const item = S().items.find((i) => i.sku === 'RX2')!
    const baseArgs = {
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0 }],
      payment: 'cash', paidMinor: 1000, treasury: '1101', taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: false,
    }
    expect(() => S().postSale({ ...baseArgs, prescription: { patientName: '  ', prescriberName: 'د. خالد', rxLines: [] } } as never)).toThrow()
    expect(() => S().postSale({ ...baseArgs, prescription: { patientName: 'مريم', prescriberName: 'د. خالد', rxLines: [{ medication: '', form: 'strip', formQty: 1, timesPerDay: 2, everyHours: 0, mealRelation: 'after', mealsCount: 1, durationDays: 5, repeated: false, repeatTimes: 0, repeatEveryDays: 0, notes: '' }] } } as never)).toThrow()
  })
})
