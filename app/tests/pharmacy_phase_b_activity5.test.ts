import { describe, expect, it } from 'vitest'
import { nearestExpiryByItem, expiryValueAtRisk, supplierReturnCandidates, type StockBatch } from '../src/core/batches.ts'
import { sameIngredientAlternatives } from '../src/core/items.ts'

const batch = (id: number, itemId: number, expiryDate: string | null, qty = 10, purchaseId: number | null = 1): StockBatch =>
  ({ id, itemId, expiryDate, qty, purchaseId, receivedAt: '2026-09-01T00:00:00.000Z', lotNumber: `LOT-${id}` })

describe('سد فجوة فورية — النشاط #5 (صيدلية): أقرب انتهاء لكل صنف', () => {
  it('يرجع أقرب تاريخ انتهاء من بين دفعات الصنف الموجبة الرصيد فقط', () => {
    const today = '2026-09-20'
    const batches = [
      batch(1, 1, '2026-09-25'),
      batch(2, 1, '2026-09-22'), // أقرب
      batch(3, 1, '2026-09-21', 0), // رصيد صفر — يُستبعد رغم قربه
      batch(4, 2, '2026-10-30'),
    ]
    const map = nearestExpiryByItem(batches, today)
    expect(map.get(1)?.expiryDate).toBe('2026-09-22')
    expect(map.get(1)?.daysLeft).toBe(2)
    expect(map.get(2)?.daysLeft).toBe(40)
    expect(map.has(3)).toBe(false)
  })

  it('صنف بلا دفعات صلاحية لا يظهر في الخريطة', () => {
    const map = nearestExpiryByItem([batch(1, 1, null)], '2026-09-20')
    expect(map.size).toBe(0)
  })
})

describe('سد فجوة فورية — النشاط #5 (صيدلية): قيمة المخزون المعرَّض لخطر الانتهاء', () => {
  it('يجمّع الكمية والقيمة لكل أفق تصاعدياً (30 يشمل المنتهي فعلاً)', () => {
    const today = '2026-09-20'
    const batches = [
      batch(1, 1, '2026-08-01', 5), // منتهٍ فعلاً
      batch(2, 2, '2026-10-10', 4), // خلال 30 يوماً تقريباً (20 يوم)
      batch(3, 3, '2026-12-01', 3), // خلال 90 لكن ليس 30/60
    ]
    const items = [
      { id: 1, costMinor: 100 },
      { id: 2, costMinor: 200 },
      { id: 3, costMinor: 300 },
    ]
    const rows = expiryValueAtRisk(batches, items, today, [30, 60, 90])
    const r30 = rows.find((r) => r.horizonDays === 30)!
    const r90 = rows.find((r) => r.horizonDays === 90)!
    expect(r30.qty).toBe(9) // منتهٍ + خلال 30
    expect(r30.valueMinor).toBe(5 * 100 + 4 * 200)
    expect(r90.qty).toBe(12) // الثلاثة كلها خلال 90
    expect(r90.valueMinor).toBe(5 * 100 + 4 * 200 + 3 * 300)
  })

  it('مصفوفة فارغة بلا دفعات تعطي صفراً لكل أفق', () => {
    const rows = expiryValueAtRisk([], [], '2026-09-20', [30, 60])
    expect(rows).toEqual([
      { horizonDays: 30, qty: 0, valueMinor: 0, batchCount: 0 },
      { horizonDays: 60, qty: 0, valueMinor: 0, batchCount: 0 },
    ])
  })
})

describe('سد فجوة فورية — النشاط #5 (صيدلية): مرشحات إرجاع المورد', () => {
  const items = [{ id: 1, nameAr: 'دواء أ' }, { id: 2, nameAr: 'دواء ب' }]
  const purchases = [{ id: 10, supplierId: 100 }, { id: 11, supplierId: 101 }]

  it('تظهر الدفعة فقط إن كان موردها مسجَّلاً بنافذة إرجاع > 0 والمتبقي داخل النافذة', () => {
    const today = '2026-09-20'
    const suppliers = [
      { id: 100, nameAr: 'مورد له نافذة', returnWindowDays: 15 },
      { id: 101, nameAr: 'مورد بلا نافذة' }, // returnWindowDays غائبة
    ]
    const batches = [
      batch(1, 1, '2026-09-30', 5, 10), // متبقٍ 10 أيام ≤ 15 — مرشح
      batch(2, 2, '2026-10-20', 3, 11), // مورده بلا نافذة — يُستبعد رغم قربه
    ]
    const rows = supplierReturnCandidates(batches, items, purchases, suppliers, today)
    expect(rows).toHaveLength(1)
    expect(rows[0].itemId).toBe(1)
    expect(rows[0].supplierName).toBe('مورد له نافذة')
    expect(rows[0].daysLeft).toBe(10)
  })

  it('دفعة متبقيها أكبر من نافذة المورد لا تظهر، ودفعة منتهية فعلاً (سالبة) لا تظهر أيضاً', () => {
    const today = '2026-09-20'
    const suppliers = [{ id: 100, nameAr: 'مورد', returnWindowDays: 5 }]
    const batches = [
      batch(1, 1, '2026-10-10', 5, 10), // متبقٍ 20 يوم > 5 — خارج النافذة
      batch(2, 1, '2026-09-10', 5, 10), // منتهٍ فعلاً — خارج النافذة (daysLeft سالب)
    ]
    expect(supplierReturnCandidates(batches, items, purchases, suppliers, today)).toEqual([])
  })

  it('دفعة بلا ربط فاتورة شراء (purchaseId = null) تُستبعد دوماً — لا تخمين لمورد', () => {
    const today = '2026-09-20'
    const suppliers = [{ id: 100, nameAr: 'مورد', returnWindowDays: 30 }]
    const batches = [batch(1, 1, '2026-09-30', 5, null)]
    expect(supplierReturnCandidates(batches, items, purchases, suppliers, today)).toEqual([])
  })
})

describe('سد فجوة فورية — النشاط #5 (صيدلية): تطبيع المادة الفعالة لتطابق البدائل', () => {
  const base = { id: 1, isActive: true, isService: false, priceMinor: 1000, stockQty: 5 } as const

  it('يطابق رغم اختلاف الحالة والفراغ بين الرقم والوحدة', () => {
    const target = { id: 1, activeIngredient: 'Paracetamol 500 mg' }
    const alt = { ...base, id: 2, activeIngredient: 'paracetamol 500mg', nameAr: 'بديل' }
    const result = sameIngredientAlternatives(target, [alt as any])
    expect(result.map((r) => r.id)).toEqual([2])
  })

  it('لا يطابق جرعات مختلفة فعلياً (500 مقابل 250)', () => {
    const target = { id: 1, activeIngredient: 'Paracetamol 500 mg' }
    const alt = { ...base, id: 2, activeIngredient: 'Paracetamol 250mg', nameAr: 'جرعة مختلفة' }
    expect(sameIngredientAlternatives(target, [alt as any])).toEqual([])
  })
})
