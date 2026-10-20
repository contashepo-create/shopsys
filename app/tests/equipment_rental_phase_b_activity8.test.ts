/**
 * اختبارات سد فجوات النشاط #8 (إيجار معدات ثقيلة) — مرحلة ب:
 *  1) equipmentStatus: شارة حالة صريحة مشتقة تلقائياً (سد فجوة فورية #3)
 *  2) equipmentComplianceWarnings: سجل امتثال تأمين/فحص دوري (سد فجوة مستقبلية #3)
 *  3) توثيق حالة المعدة وتوقيع رقمي عند التسليم/الإرجاع + موقع المعدة (سد فجوة فورية #4 / مستقبلية #2)
 *  4) جدولة المتبقي الآجل من عقد الإيجار كأقساط مباشرة (سد فجوة فورية #2)
 *  5) قطع غيار/مستهلكات معدات مبسَّطة تُخصَم تلقائياً عند مصروف صيانة/إصلاح (سد فجوة مستقبلية #1)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { equipmentStatus, equipmentComplianceWarnings } from '../src/core/rentalMeter.ts'

describe('سد فجوة فورية #3 — النشاط #8 (إيجار معدات): equipmentStatus', () => {
  it('مؤجَّرة الآن حين يوجد عقد نشط — بصرف النظر عن حالة الصيانة', () => {
    expect(equipmentStatus({ hasActiveContract: true, service: { dueAtReading: 100, remainingHours: -5, overdue: true, progress: 1 } })).toBe('rented')
    expect(equipmentStatus({ hasActiveContract: true, service: null })).toBe('rented')
  })
  it('صيانة متأخرة حين لا عقد نشط وتجاوزت الصيانة الوقائية موعدها', () => {
    expect(equipmentStatus({ hasActiveContract: false, service: { dueAtReading: 100, remainingHours: -5, overdue: true, progress: 1.05 } })).toBe('under_maintenance')
  })
  it('متاحة حين لا عقد نشط ولا صيانة متأخرة (أو بلا خطة صيانة أصلاً)', () => {
    expect(equipmentStatus({ hasActiveContract: false, service: { dueAtReading: 300, remainingHours: 50, overdue: false, progress: 0.5 } })).toBe('available')
    expect(equipmentStatus({ hasActiveContract: false, service: null })).toBe('available')
  })
})

describe('سد فجوة مستقبلية #3 — النشاط #8 (إيجار معدات): equipmentComplianceWarnings', () => {
  const eq = [
    { id: 1, nameAr: 'حفار 1', insuranceExpiryDate: '2026-10-20', nextInspectionDate: null },
    { id: 2, nameAr: 'ونش 2', insuranceExpiryDate: '2026-08-01', nextInspectionDate: '2026-12-01' },
    { id: 3, nameAr: 'لودر 3', insuranceExpiryDate: null, nextInspectionDate: null },
  ]
  it('يضم تأميناً يقترب (خلال نافذة الإنذار) وتأميناً منتهياً، ويستثني ما بعد النافذة ومن بلا تواريخ', () => {
    const warnings = equipmentComplianceWarnings(eq, '2026-10-15T00:00:00.000Z', 30)
    const ids = warnings.map((w) => `${w.equipmentId}:${w.kind}`)
    expect(ids).toContain('1:insurance') // خلال 5 أيام
    expect(ids).toContain('2:insurance') // منتهٍ فعلاً
    expect(ids).not.toContain('2:inspection') // 2026-12-01 أبعد من 30 يوماً
    expect(ids).not.toContain('3:insurance')
    expect(ids).not.toContain('3:inspection')
  })
  it('يرتّب الأقدم استحقاقاً (الأكثر تأخراً) أولاً', () => {
    const warnings = equipmentComplianceWarnings(eq, '2026-10-15T00:00:00.000Z', 30)
    for (let i = 1; i < warnings.length; i++) expect(warnings[i].daysLeft).toBeGreaterThanOrEqual(warnings[i - 1].daysLeft)
  })
  it('منتهٍ منذ يُحسب بعدد أيام سالب صحيح', () => {
    const w = equipmentComplianceWarnings([{ id: 9, nameAr: 'معدة', insuranceExpiryDate: '2026-10-01' }], '2026-10-15T00:00:00.000Z', 30)
    expect(w[0].daysLeft).toBe(-14)
  })
})

describe('سد فجوات فورية #2/#4 ومستقبلية #1/#2 — النشاط #8 (إيجار معدات): سلوك المتجر', () => {
  let useDataStore: typeof import('../src/data/repo.ts').useDataStore
  let equipmentId = 0
  let customerId = 0

  beforeAll(async () => {
    localStorage.clear()
    ;({ useDataStore } = await import('../src/data/repo.ts'))
    const { useAppStore } = await import('../src/stores/app.store.ts')
    const app = useAppStore.getState()
    useAppStore.setState({
      ...app,
      setup: {
        ...app.setup, completed: true, countryCode: 'EG', activityId: 'equipment_rental', shopName: 'تأجير معدات الاختبار',
        ownerName: 'المالك', features: [], modules: ['equipment_rental', 'installments'], accountingMode: 'full',
        vatPercent: 0, taxRegistrationStatus: 'not_registered', allowNegativeTreasury: true,
      },
    })
    const s = useDataStore.getState()
    s.addEquipment({
      nameAr: 'حفار اختبار', code: 'EQ-T1', dailyRateMinor: 100000, hourlyRateMinor: 0, monthlyRateMinor: 0,
      meterReading: 500, serviceEveryHours: 250, lastServiceReading: 0, notes: '',
      insuranceExpiryDate: '2026-10-18', nextInspectionDate: null,
    })
    equipmentId = useDataStore.getState().equipment[0].id
    s.addCustomer({
      nameAr: 'عميل إيجار', phone: '0100', notes: '', taxNumber: '', commercialReg: '', email: '',
      address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', creditLimitMinor: 0,
    })
    customerId = useDataStore.getState().customers[0].id
  })

  it('يحفظ تاريخَي الامتثال على المعدة وتظهر في equipmentComplianceWarnings', () => {
    const eq = useDataStore.getState().equipment.find((e) => e.id === equipmentId)!
    expect(eq.insuranceExpiryDate).toBe('2026-10-18')
    const warnings = equipmentComplianceWarnings([eq], '2026-10-15T00:00:00.000Z', 30)
    expect(warnings.some((w) => w.kind === 'insurance' && w.equipmentId === equipmentId)).toBe(true)
  })

  it('فتح عقد إيجار آجل يحفظ ملاحظة حالة التسليم وموقع المعدة', () => {
    const s = useDataStore.getState()
    const c = s.openRental({
      customerId, equipmentId,
      input: { equipmentName: 'حفار اختبار', days: 5, dailyRateMinor: 100000, depositMinor: 20000, payment: 'credit', vatPercent: 0 },
      notes: '', rateType: 'daily', startReading: null, treasury: '1101',
      deliveryConditionNote: 'خدوش بسيطة في الهيكل', siteName: 'موقع مشروع النصر',
    })
    expect(c.deliveryConditionNote).toBe('خدوش بسيطة في الهيكل')
    expect(c.siteName).toBe('موقع مشروع النصر')
    expect(c.totals.collectCreditMinor).toBe(500000)
  })

  it('توقيع رقمي للعميل عند التسليم ثم عند الإرجاع بعد الإقفال', () => {
    let s = useDataStore.getState()
    const contract = s.rentalContracts[s.rentalContracts.length - 1]
    const signed = s.setRentalSignature(contract.id, 'delivery', 'data:image/png;base64,AAA')
    expect(signed.deliverySignatureDataUrl).toBe('data:image/png;base64,AAA')
    expect(() => s.setRentalSignature(contract.id, 'delivery', '')).toThrow()
    expect(() => s.setRentalSignature(999999, 'delivery', 'x')).toThrow()

    const closed = s.closeRental(contract.id, 0, { endDate: '2026-10-20' }, '1101', 'أُعيدت بحالة جيدة')
    expect(closed.returnConditionNote).toBe('أُعيدت بحالة جيدة')
    s = useDataStore.getState()
    const resigned = s.setRentalSignature(contract.id, 'return', 'data:image/png;base64,BBB')
    expect(resigned.returnSignatureDataUrl).toBe('data:image/png;base64,BBB')
  })

  it('جدولة المتبقي الآجل من عقد إيجار جديد كأقساط مباشرة دون إعادة إدخال يدوي', () => {
    let s = useDataStore.getState()
    const c = s.openRental({
      customerId, equipmentId,
      input: { equipmentName: 'حفار اختبار', days: 3, dailyRateMinor: 100000, depositMinor: 0, payment: 'credit', vatPercent: 0 },
      notes: '', rateType: 'daily', startReading: null, treasury: '1101',
    })
    expect(c.totals.collectCreditMinor).toBe(300000)
    const plan = s.createInstallmentPlan({
      customerId, saleId: null, totalMinor: c.totals.collectCreditMinor, downPaymentMinor: 0,
      count: 3, intervalMonths: 1, firstDueDate: '2026-11-15', treasury: '1101', notes: `جدولة إيجار العقد ${c.contractNumber}`,
    })
    expect(plan.totalMinor).toBe(300000)
    expect(plan.items).toHaveLength(3)
    s = useDataStore.getState()
    expect(s.installmentPlans.some((p) => p.id === plan.id)).toBe(true)
  })

  it('قطع غيار معدات: إضافة، وخصم تلقائي عند مصروف صيانة مرتبط، ورفض تجاوز الرصيد', () => {
    const s = useDataStore.getState()
    const part = s.addEquipmentPart({ nameAr: 'فلتر زيت', qty: 10, unitCostMinor: 5000, minQty: 2, notes: '' })
    expect(part.qty).toBe(10)

    // رفض بيانات غير سليمة
    expect(() => s.addEquipmentPart({ nameAr: '', qty: 1, unitCostMinor: 0, minQty: 0, notes: '' })).toThrow()
    expect(() => s.addEquipmentPart({ nameAr: 'قطعة', qty: -1, unitCostMinor: 0, minQty: 0, notes: '' })).toThrow()

    // مصروف صيانة مرتبط بقطعة: يخصم الرصيد ويحسب المبلغ تلقائياً من تكلفة الوحدة (3 × 5000 = 15000)
    const cost = s.addEquipmentCost({ equipmentId, kind: 'maintenance', amountMinor: 0, description: 'تغيير فلتر', partId: part.id, partQty: 3 })
    expect(cost.amountMinor).toBe(15000)
    expect(cost.partId).toBe(part.id)
    expect(cost.partQty).toBe(3)
    const updatedPart = useDataStore.getState().equipmentParts.find((p) => p.id === part.id)!
    expect(updatedPart.qty).toBe(7)

    // رفض تجاوز الرصيد المتاح
    expect(() => s.addEquipmentCost({ equipmentId, kind: 'maintenance', amountMinor: 0, description: '', partId: part.id, partQty: 100 })).toThrow()

    // حماية الحذف: قطعة مرتبطة بمصروف مسجَّل لا تُحذف
    expect(() => s.removeEquipmentPart(part.id)).toThrow()

    // قطعة غير مرتبطة بأي مصروف تُحذف بلا مشكلة
    const freePart = s.addEquipmentPart({ nameAr: 'إطار احتياطي', qty: 2, unitCostMinor: 100000, minQty: 1, notes: '' })
    s.updateEquipmentPart(freePart.id, { qty: 5 })
    expect(useDataStore.getState().equipmentParts.find((p) => p.id === freePart.id)!.qty).toBe(5)
    s.removeEquipmentPart(freePart.id)
    expect(useDataStore.getState().equipmentParts.find((p) => p.id === freePart.id)).toBeUndefined()
  })

  it('مصروف تشغيل عادي بلا قطعة يبقى بسلوكه السابق (مبلغ يدوي صريح)', () => {
    const s = useDataStore.getState()
    const cost = s.addEquipmentCost({ equipmentId, kind: 'fuel', amountMinor: 20000, description: 'سولار' })
    expect(cost.amountMinor).toBe(20000)
    expect(cost.partId).toBeUndefined()
  })
})
