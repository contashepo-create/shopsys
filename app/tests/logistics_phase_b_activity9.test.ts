/**
 * اختبارات سد فجوات النشاط #9 (لوجستيات/نقل) — مرحلة ب:
 *  1) vehicleComplianceWarnings: تنبيه رخصة/تأمين مركبة يقترب أو انتهى (سد فجوة فورية #1)
 *  2) unsettledDriverDues: تجميع مستحقات سائقين غير مسواة لمركز التنبيهات المركزي (سد فجوة فورية #2)
 *  3) vehicleFuelStats / fuelDeviationWarnings: تحليل انحراف استهلاك الوقود لكل نقلة (سد فجوة مستقبلية #2)
 *  4) addVehicleExpense + addVehiclePart: مصروف مركبة مبسَّط من شاشة الأسطول مباشرة مع خصم قطعة غيار تلقائياً
 *     (سد فجوة فورية #3 + مستقبلية #1)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  vehicleComplianceWarnings,
  unsettledDriverDues,
  vehicleFuelStats,
  fuelDeviationWarnings,
  isFuelExpenseName,
  type DriverDueRow,
} from '../src/core/logistics.ts'

describe('سد فجوة فورية #1 — النشاط #9 (لوجستيات): vehicleComplianceWarnings', () => {
  const vehicles = [
    { id: 1, plateNumber: 'أ ب ج 111', licenseExpiryDate: '2026-10-20', insuranceExpiryDate: null },
    { id: 2, plateNumber: 'د هـ و 222', licenseExpiryDate: '2026-08-01', insuranceExpiryDate: '2026-12-01' },
    { id: 3, plateNumber: 'ز ح ط 333', licenseExpiryDate: null, insuranceExpiryDate: null },
  ]
  it('يضم رخصة تقترب (خلال نافذة الإنذار) ورخصة منتهية، ويستثني ما بعد النافذة ومن بلا تواريخ', () => {
    const warnings = vehicleComplianceWarnings(vehicles, '2026-10-15T00:00:00.000Z', 30)
    const ids = warnings.map((w) => `${w.vehicleId}:${w.kind}`)
    expect(ids).toContain('1:license') // خلال 5 أيام
    expect(ids).toContain('2:license') // منتهية فعلاً
    expect(ids).not.toContain('2:insurance') // 2026-12-01 أبعد من 30 يوماً
    expect(ids).not.toContain('3:license')
    expect(ids).not.toContain('3:insurance')
  })
  it('يرتّب الأقدم استحقاقاً (الأكثر تأخراً) أولاً', () => {
    const warnings = vehicleComplianceWarnings(vehicles, '2026-10-15T00:00:00.000Z', 30)
    for (let i = 1; i < warnings.length; i++) expect(warnings[i].daysLeft).toBeGreaterThanOrEqual(warnings[i - 1].daysLeft)
  })
  it('منتهية منذ تُحسب بعدد أيام سالب صحيح', () => {
    const w = vehicleComplianceWarnings([{ id: 9, plateNumber: 'مركبة', insuranceExpiryDate: '2026-10-01' }], '2026-10-15T00:00:00.000Z', 30)
    expect(w[0].daysLeft).toBe(-14)
  })
})

describe('سد فجوة فورية #2 — النشاط #9 (لوجستيات): unsettledDriverDues', () => {
  const dues: DriverDueRow[] = [
    { driverId: 1, tripId: 10, settled: false, amountMinor: 5000 },
    { driverId: 1, tripId: 11, settled: false, amountMinor: 3000 },
    { driverId: 1, tripId: 12, settled: true, amountMinor: 9999 }, // مسواة — تُستبعد
    { driverId: 2, tripId: 13, settled: false, amountMinor: 1000 },
    { driverId: 3, tripId: 14, settled: true, amountMinor: 500 }, // كل رحلات هذا السائق مسواة
  ]
  it('يجمع غير المسوى فقط لكل سائق ويرتب تنازلياً حسب المبلغ', () => {
    const groups = unsettledDriverDues(dues)
    expect(groups).toEqual([
      { driverId: 1, totalMinor: 8000, tripCount: 2 },
      { driverId: 2, totalMinor: 1000, tripCount: 1 },
    ])
  })
  it('سائق كل مستحقاته مسواة لا يظهر إطلاقاً', () => {
    const groups = unsettledDriverDues(dues)
    expect(groups.some((g) => g.driverId === 3)).toBe(false)
  })
  it('بلا أي مستحقات غير مسواة = مصفوفة فارغة', () => {
    expect(unsettledDriverDues([{ driverId: 5, tripId: 1, settled: true, amountMinor: 100 }])).toEqual([])
  })
})

describe('سد فجوة مستقبلية #2 — النشاط #9 (لوجستيات): vehicleFuelStats و fuelDeviationWarnings', () => {
  it('isFuelExpenseName يميز سولار/بنزين/ديزل/وقود عن بنود أخرى', () => {
    expect(isFuelExpenseName('سولار الرحلة')).toBe(true)
    expect(isFuelExpenseName('وقود السيارة')).toBe(true)
    expect(isFuelExpenseName('بنزين')).toBe(true)
    expect(isFuelExpenseName('كارت طريق')).toBe(false)
  })
  const mkTrip = (vehicleId: number | null, fuelAmount: number) => ({
    vehicleId,
    expenses: fuelAmount > 0 ? [{ nameAr: 'سولار', amountMinor: fuelAmount }] : [],
  })
  it('يحسب متوسط تكلفة الوقود لكل نقلة لكل مركبة من مصاريف النقلات فقط', () => {
    const trips = [mkTrip(1, 10000), mkTrip(1, 12000), mkTrip(2, 5000)]
    const stats = vehicleFuelStats(trips)
    const v1 = stats.find((s) => s.vehicleId === 1)!
    expect(v1.fuelCostMinor).toBe(22000)
    expect(v1.fuelTripCount).toBe(2)
    expect(v1.avgFuelPerTripMinor).toBe(11000)
  })
  it('يرصد مركبة تنحرف استهلاكاً بوضوح عن متوسط الأسطول ويتجاهل العينات الصغيرة', () => {
    // ثلاث مركبات بعينة كافية (≥3 نقلات موقودة): اثنتان طبيعيتان (10000) وواحدة منحرفة بوضوح (25000)
    const trips = [
      ...[1, 2, 3].map(() => mkTrip(1, 10000)),
      ...[1, 2, 3].map(() => mkTrip(2, 10000)),
      ...[1, 2, 3].map(() => mkTrip(3, 25000)),
      mkTrip(4, 50000), mkTrip(4, 50000), // عينة صغيرة (2 فقط) — تُتجاهل رغم انحرافها الظاهري
    ]
    // fleetAvg = (10000+10000+25000)/3 = 15000؛ انحراف المركبة 3 = (25000-15000)/15000 ≈ 67٪
    const stats = vehicleFuelStats(trips)
    const warnings = fuelDeviationWarnings(stats, 50)
    expect(warnings.some((w) => w.vehicleId === 3)).toBe(true)
    expect(warnings.some((w) => w.vehicleId === 1)).toBe(false)
    expect(warnings.some((w) => w.vehicleId === 2)).toBe(false)
    expect(warnings.some((w) => w.vehicleId === 4)).toBe(false)
  })
  it('بلا مركبات كافية للمقارنة = لا تحذيرات', () => {
    expect(fuelDeviationWarnings(vehicleFuelStats([mkTrip(1, 10000), mkTrip(1, 10000), mkTrip(1, 10000)]))).toEqual([])
  })
})

describe('سد فجوات فورية #3 ومستقبلية #1 — النشاط #9 (لوجستيات): addVehicleExpense و addVehiclePart', () => {
  let useDataStore: typeof import('../src/data/repo.ts').useDataStore
  let vehicleId = 0

  beforeAll(async () => {
    localStorage.clear()
    ;({ useDataStore } = await import('../src/data/repo.ts'))
    const { useAppStore } = await import('../src/stores/app.store.ts')
    const app = useAppStore.getState()
    useAppStore.setState({
      ...app,
      setup: {
        ...app.setup, completed: true, countryCode: 'EG', activityId: 'logistics', shopName: 'نقل الاختبار',
        ownerName: 'المالك', features: [], modules: ['logistics'], accountingMode: 'full',
        vatPercent: 0, taxRegistrationStatus: 'not_registered' as never, allowNegativeTreasury: true,
      },
    })
    const s = useDataStore.getState()
    s.addVehicle({
      plateNumber: 'ن ق ل 999', vehicleType: 'تريلا', defaultDriverId: null, notes: '',
      licenseExpiryDate: '2026-10-18', insuranceExpiryDate: null,
    })
    vehicleId = useDataStore.getState().vehicles[0].id
  })

  it('يحفظ تاريخَي الرخصة والتأمين على المركبة وتظهر في vehicleComplianceWarnings', () => {
    const v = useDataStore.getState().vehicles.find((x) => x.id === vehicleId)!
    expect(v.licenseExpiryDate).toBe('2026-10-18')
    const warnings = vehicleComplianceWarnings([v], '2026-10-15T00:00:00.000Z', 30)
    expect(warnings.some((w) => w.kind === 'license' && w.vehicleId === vehicleId)).toBe(true)
  })

  it('addVehicleExpense بمبلغ حر: يبني قيداً متوازناً (5106 مدين / الخزينة دائن) ومركز تكلفة cost', () => {
    const s = useDataStore.getState()
    const before = s.journal.length
    const entry = s.addVehicleExpense({ vehicleId, kind: 'maintenance', amountMinor: 15000, description: 'تغيير زيت', treasury: '1101' })
    expect(entry.kind).toBe('cost')
    expect(entry.amountMinor).toBe(15000)
    expect(entry.category).toBe('maintenance')
    expect(entry.status).toBe('paid')
    const after = useDataStore.getState()
    expect(after.journal.length).toBe(before + 1)
    const je = after.journal.find((j) => j.id === entry.journalEntryId)!
    expect(je.lines.find((l) => l.accountCode === '5106')?.debit).toBe(15000)
    expect(je.lines.find((l) => l.accountCode === '1101')?.credit).toBe(15000)
    expect(after.vehicleCostEntries.some((c) => c.id === entry.id)).toBe(true)
  })

  it('مركبة غير موجودة أو مبلغ غير موجب يُرفَضان', () => {
    const s = useDataStore.getState()
    expect(() => s.addVehicleExpense({ vehicleId: 999999, kind: 'fuel', amountMinor: 1000, description: '', treasury: '1101' })).toThrow()
    expect(() => s.addVehicleExpense({ vehicleId, kind: 'fuel', amountMinor: 0, description: '', treasury: '1101' })).toThrow()
  })

  it('addVehiclePart: يرفض رصيداً أو تكلفة سالبة ويضيف قطعة صحيحة', () => {
    const s = useDataStore.getState()
    expect(() => s.addVehiclePart({ nameAr: 'فلتر', qty: -1, unitCostMinor: 100, minQty: 0, notes: '' })).toThrow()
    const part = s.addVehiclePart({ nameAr: 'إطار تريلا', qty: 4, unitCostMinor: 250000, minQty: 1, notes: '' })
    expect(part.qty).toBe(4)
    expect(useDataStore.getState().vehicleParts.some((p) => p.id === part.id)).toBe(true)
  })

  it('addVehicleExpense بقطعة غيار: يحسب المبلغ تلقائياً من الكمية×التكلفة ويخصم رصيد القطعة', () => {
    const s = useDataStore.getState()
    const part = s.addVehiclePart({ nameAr: 'بطارية', qty: 2, unitCostMinor: 400000, minQty: 0, notes: '' })
    const entry = s.addVehicleExpense({ vehicleId, kind: 'parts', description: 'استبدال بطارية', treasury: '1101', partId: part.id, partQty: 1 })
    expect(entry.amountMinor).toBe(400000)
    expect(entry.partId).toBe(part.id)
    expect(entry.partQty).toBe(1)
    const updatedPart = useDataStore.getState().vehicleParts.find((p) => p.id === part.id)!
    expect(updatedPart.qty).toBe(1)
  })

  it('addVehicleExpense بكمية قطعة أكبر من الرصيد المتاح يُرفَض', () => {
    const s = useDataStore.getState()
    const part = s.addVehiclePart({ nameAr: 'مساعد خلفي', qty: 1, unitCostMinor: 150000, minQty: 0, notes: '' })
    expect(() => s.addVehicleExpense({ vehicleId, kind: 'parts', description: '', treasury: '1101', partId: part.id, partQty: 5 })).toThrow()
  })

  it('removeVehiclePart: يرفض حذف قطعة مرتبطة بمصروف مسجَّل ويقبل حذف قطعة غير مستخدمة', () => {
    const s = useDataStore.getState()
    const usedPartId = useDataStore.getState().vehicleCostEntries.find((c) => c.partId != null)!.partId!
    expect(() => s.removeVehiclePart(usedPartId)).toThrow()
    const freePart = s.addVehiclePart({ nameAr: 'مصباح', qty: 3, unitCostMinor: 5000, minQty: 0, notes: '' })
    s.removeVehiclePart(freePart.id)
    expect(useDataStore.getState().vehicleParts.some((p) => p.id === freePart.id)).toBe(false)
  })
})
