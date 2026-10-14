import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

/**
 * توزيع تركيبات لون/مقاس مباشرة داخل سطر فاتورة الشراء (فجوة فورية ① — نشاط
 * الملابس): بدل الاكتفاء بشاشة «مصفوفة المقاسات» المنفصلة بعد الترحيل.
 */

const original = useDataStore.getState()
const clothingItem = {
  id: 901, nameAr: 'قميص اختبار', sku: 'CLO-901', barcodes: ['6221000'], categoryId: 1, baseUnit: 'قطعة',
  extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 20000, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: ['أحمر', 'أزرق'], variantSizes: ['M', 'L'], isActive: true, isService: false,
}

function seed() {
  useDataStore.setState({
    ...original,
    items: [clothingItem] as never,
    suppliers: [{ id: 801, nameAr: 'مورد اختبار', phone: '', notes: '', openingBalanceMinor: 0 }] as never,
    purchases: [], batches: [], journal: [], variantStocks: [],
    warehouses: [{ id: 1, nameAr: 'الرئيسي', code: 'MAIN', isMain: true }] as never,
    treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', openingBalanceMinor: 1000000, isDefault: true }] as never,
  })
}
beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  seed()
})

describe('توزيع تركيبات لون/مقاس من سطر فاتورة الشراء', () => {
  it('يوزع الكمية على التركيبات المحددة فوق مصفوفة المخزون مباشرة عند الترحيل', () => {
    useDataStore.getState().postPurchase({
      supplierId: 801, date: '2026-01-10',
      lines: [{
        itemId: 901, qty: 10, unitPriceMinor: 10000, warehouseId: 1,
        variantBreakdown: [{ color: 'أحمر', size: 'M', qty: 6 }, { color: 'أزرق', size: 'L', qty: 3 }],
      }],
      expenses: [], paidMinor: 0, treasury: '1101', warehouseId: 1, inputVatMinor: 0, notes: '',
    })
    const state = useDataStore.getState()
    expect(state.items.find((it) => it.id === 901)?.stockQty).toBe(10)
    expect(state.variantStocks.find((v) => v.itemId === 901 && v.color === 'أحمر' && v.size === 'M')?.qty).toBe(6)
    expect(state.variantStocks.find((v) => v.itemId === 901 && v.color === 'أزرق' && v.size === 'L')?.qty).toBe(3)
    // الفرق (10 - 9 = 1) يبقى «غير موزَّع» كالمعتاد — لا يُجبر توزيع كامل
    expect(state.getUndistributedQty(901)).toBe(1)
  })

  it('يتراكم فوق توزيع سابق بدل استبداله عند شراء دفعة ثانية من نفس التركيبة', () => {
    useDataStore.getState().postPurchase({
      supplierId: 801, date: '2026-01-10',
      lines: [{ itemId: 901, qty: 5, unitPriceMinor: 10000, warehouseId: 1, variantBreakdown: [{ color: 'أحمر', size: 'M', qty: 5 }] }],
      expenses: [], paidMinor: 0, treasury: '1101', warehouseId: 1, inputVatMinor: 0, notes: '',
    })
    useDataStore.getState().postPurchase({
      supplierId: 801, date: '2026-01-12',
      lines: [{ itemId: 901, qty: 4, unitPriceMinor: 10000, warehouseId: 1, variantBreakdown: [{ color: 'أحمر', size: 'M', qty: 4 }] }],
      expenses: [], paidMinor: 0, treasury: '1101', warehouseId: 1, inputVatMinor: 0, notes: '',
    })
    const state = useDataStore.getState()
    expect(state.variantStocks.find((v) => v.itemId === 901 && v.color === 'أحمر' && v.size === 'M')?.qty).toBe(9)
  })

  it('يرفض توزيعاً بمجموع يتجاوز كمية السطر المشتراة قبل أي كتابة', () => {
    expect(() => useDataStore.getState().postPurchase({
      supplierId: 801, date: '2026-01-10',
      lines: [{ itemId: 901, qty: 5, unitPriceMinor: 10000, warehouseId: 1, variantBreakdown: [{ color: 'أحمر', size: 'M', qty: 6 }] }],
      expenses: [], paidMinor: 0, treasury: '1101', warehouseId: 1, inputVatMinor: 0, notes: '',
    })).toThrow(/توزيع تركيبات/)
    // تحقق ألا شيء كُتب فعلاً (لا مخزون زاد ولا مصفوفة تغيّرت) — التحقق قبل أي set()
    const state = useDataStore.getState()
    expect(state.items.find((it) => it.id === 901)?.stockQty).toBe(0)
    expect(state.variantStocks).toEqual([])
  })

  it('يرفض لوناً ليس من ألوان الصنف المعرَّفة', () => {
    expect(() => useDataStore.getState().postPurchase({
      supplierId: 801, date: '2026-01-10',
      lines: [{ itemId: 901, qty: 5, unitPriceMinor: 10000, warehouseId: 1, variantBreakdown: [{ color: 'أصفر', size: 'M', qty: 2 }] }],
      expenses: [], paidMinor: 0, treasury: '1101', warehouseId: 1, inputVatMinor: 0, notes: '',
    })).toThrow(/ليس من ألوان الصنف/)
  })

  it('فاتورة بلا توزيع تركيبات تترك المصفوفة فارغة كالسابق (لا تغيير سلوك قديم)', () => {
    useDataStore.getState().postPurchase({
      supplierId: 801, date: '2026-01-10',
      lines: [{ itemId: 901, qty: 5, unitPriceMinor: 10000, warehouseId: 1 }],
      expenses: [], paidMinor: 0, treasury: '1101', warehouseId: 1, inputVatMinor: 0, notes: '',
    })
    const state = useDataStore.getState()
    expect(state.items.find((it) => it.id === 901)?.stockQty).toBe(5)
    expect(state.variantStocks).toEqual([])
  })
})
