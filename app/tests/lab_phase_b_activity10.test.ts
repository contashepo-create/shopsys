/**
 * اختبارات سد فجوات النشاط #10 (معمل تحاليل طبية) — مرحلة ب:
 *  1) حالة "عيّنة مرفوضة" في دورة الفحص (collected→rejected→pending) (سد فجوة فورية #1)
 *  2) criticalUnacknowledgedResults + acknowledgeCriticalLabResult: توثيق إبلاغ القيم الحرجة (سد فجوة فورية #3)
 *  3) isActive/toggleLabReferrer/updateLabReferrer للطبيب المُحيل (سد فجوة فورية #4)
 *  4) testTurnaroundReport: متوسط زمن تنفيذ الفحص من السحب حتى الاعتماد (سد فجوة فورية #5)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  TEST_TRANSITIONS,
  canTransition,
  criticalUnacknowledgedResults,
  testTurnaroundReport,
  validateReferrer,
  type TestStatus,
} from '../src/core/lab.ts'

describe('سد فجوة فورية #1 — النشاط #10 (معمل): حالة عيّنة مرفوضة', () => {
  it('collected يسمح بالانتقال لـ resulted أو rejected فقط', () => {
    expect(TEST_TRANSITIONS.collected).toEqual(['resulted', 'rejected'])
    expect(canTransition('collected', 'rejected')).toBe(true)
    expect(canTransition('collected', 'resulted')).toBe(true)
    expect(canTransition('collected', 'approved')).toBe(false)
  })
  it('rejected يسمح فقط بالعودة لـ pending (إعادة سحب) — لا قفز لأي حالة أخرى', () => {
    expect(TEST_TRANSITIONS.rejected).toEqual(['pending'])
    expect(canTransition('rejected', 'pending')).toBe(true)
    expect(canTransition('rejected', 'resulted')).toBe(false)
    expect(canTransition('rejected', 'approved')).toBe(false)
  })
  it('pending/resulted/approved كما كانت تماماً بلا أي تغيير في مسارها الأصلي', () => {
    expect(TEST_TRANSITIONS.pending).toEqual(['collected'])
    expect(TEST_TRANSITIONS.resulted).toEqual(['approved'])
    expect(TEST_TRANSITIONS.approved).toEqual([])
  })
  it('لا انتقال مباشر من pending أو resulted أو approved إلى rejected (الرفض بعد السحب فقط)', () => {
    const states: TestStatus[] = ['pending', 'resulted', 'approved']
    for (const s of states) expect(canTransition(s, 'rejected')).toBe(false)
  })
})

describe('سد فجوة فورية #3 — النشاط #10 (معمل): criticalUnacknowledgedResults', () => {
  const baseTest = { testId: 1, nameAr: 'بوتاسيوم', unit: 'mmol/L', status: 'resulted' as TestStatus, resultValue: '7.5', resultedAt: '2026-10-10T10:00:00.000Z' }
  it('يضم فحصاً بعلامة حرجة لم يُؤكَّد إبلاغه بعد', () => {
    const orders = [{ id: 1, orderNumber: 'LAB-0001', patientName: 'مريض أ', tests: [{ ...baseTest, resultFlag: 'critical_high' as const, criticalAckAt: null }] }]
    const alerts = criticalUnacknowledgedResults(orders)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].patientName).toBe('مريض أ')
  })
  it('يستثني فحصاً حرجاً أُكِّد إبلاغه (criticalAckAt موجود)', () => {
    const orders = [{ id: 1, orderNumber: 'LAB-0001', patientName: 'مريض أ', tests: [{ ...baseTest, resultFlag: 'critical_low' as const, criticalAckAt: '2026-10-10T10:05:00.000Z' }] }]
    expect(criticalUnacknowledgedResults(orders)).toHaveLength(0)
  })
  it('يستثني فحصاً طبيعياً أو مرتفعاً عادياً (ليس حرجاً)', () => {
    const orders = [
      { id: 1, orderNumber: 'LAB-0001', patientName: 'مريض أ', tests: [{ ...baseTest, resultFlag: 'normal' as const, criticalAckAt: null }] },
      { id: 2, orderNumber: 'LAB-0002', patientName: 'مريض ب', tests: [{ ...baseTest, resultFlag: 'high' as const, criticalAckAt: null }] },
    ]
    expect(criticalUnacknowledgedResults(orders)).toHaveLength(0)
  })
})

describe('سد فجوة فورية #5 — النشاط #10 (معمل): testTurnaroundReport', () => {
  it('يحسب متوسط الدقائق من السحب حتى الاعتماد لكل فحص، ويتجاهل غير المكتمل', () => {
    const orders = [
      { tests: [{ testId: 1, code: 'CBC', nameAr: 'صورة دم', collectedAt: '2026-10-10T08:00:00.000Z', approvedAt: '2026-10-10T09:00:00.000Z' }] },
      { tests: [{ testId: 1, code: 'CBC', nameAr: 'صورة دم', collectedAt: '2026-10-11T08:00:00.000Z', approvedAt: '2026-10-11T08:30:00.000Z' }] },
      { tests: [{ testId: 2, code: 'TSH', nameAr: 'غدة درقية', collectedAt: '2026-10-10T08:00:00.000Z', approvedAt: null }] },
    ]
    const report = testTurnaroundReport(orders)
    const cbc = report.find((r) => r.testId === 1)!
    expect(cbc.count).toBe(2)
    expect(cbc.avgMinutes).toBe(45) // متوسط (60+30)/2
    expect(cbc.maxMinutes).toBe(60)
    expect(report.find((r) => r.testId === 2)).toBeUndefined() // approvedAt مفقود ⇒ مستبعد
  })
  it('يرتّب الأبطأ (أعلى متوسط) أولاً', () => {
    const orders = [
      { tests: [{ testId: 1, code: 'A', nameAr: 'أ', collectedAt: '2026-10-10T08:00:00.000Z', approvedAt: '2026-10-10T08:10:00.000Z' }] },
      { tests: [{ testId: 2, code: 'B', nameAr: 'ب', collectedAt: '2026-10-10T08:00:00.000Z', approvedAt: '2026-10-10T10:00:00.000Z' }] },
    ]
    const report = testTurnaroundReport(orders)
    expect(report[0].testId).toBe(2)
    expect(report[1].testId).toBe(1)
  })
})

describe('سد فجوة فورية #4 — النشاط #10 (معمل): isActive للطبيب المُحيل', () => {
  it('validateReferrer لا يتطلب isActive (يُضبط تلقائياً true عند الإضافة)', () => {
    expect(validateReferrer({ nameAr: 'د. محمد', phone: '', commissionPercent: 10, notes: '' })).toEqual([])
  })
})

describe('تكامل المتجر — النشاط #10 (معمل): دورة رفض/إعادة سحب + توثيق إبلاغ حرج + أرشفة مُحيل', () => {
  let useDataStore: typeof import('../src/data/repo.ts').useDataStore
  let patientId = 0
  let testId = 0
  let referrerId = 0

  beforeAll(async () => {
    localStorage.clear()
    ;({ useDataStore } = await import('../src/data/repo.ts'))
    const { useAppStore } = await import('../src/stores/app.store.ts')
    const app = useAppStore.getState()
    useAppStore.setState({
      ...app,
      setup: {
        ...app.setup, completed: true, countryCode: 'EG', activityId: 'lab', shopName: 'معمل الاختبار',
        ownerName: 'المالك', features: [], modules: ['lab', 'booking'], accountingMode: 'full',
        vatPercent: 0, taxRegistrationStatus: 'not_registered', allowNegativeTreasury: true,
      },
    })
    const s = useDataStore.getState()
    const patient = s.addLabPatient({ nameAr: 'مريض الاختبار', phone: '', gender: 'male', birthDate: '1990-01-01', notes: '' })
    patientId = patient.id
    const referrer = s.addLabReferrer({ nameAr: 'محيل الاختبار', phone: '', commissionPercent: 10, notes: '' })
    referrerId = referrer.id
    const test = s.addLabTest({
      code: 'K', nameAr: 'بوتاسيوم', category: 'كيمياء', sampleType: 'دم وريدي', unit: 'mmol/L',
      priceMinor: 10000, costMinor: 0,
      refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 }],
    })
    testId = test.id
  })

  it('addLabReferrer يضبط isActive=true تلقائياً', () => {
    const r = useDataStore.getState().labReferrers.find((x) => x.id === referrerId)!
    expect(r.isActive).toBe(true)
  })

  it('toggleLabReferrer يعطل/يفعّل دون حذف أي بيانات', () => {
    const s = useDataStore.getState()
    s.toggleLabReferrer(referrerId)
    expect(useDataStore.getState().labReferrers.find((x) => x.id === referrerId)!.isActive).toBe(false)
    s.toggleLabReferrer(referrerId)
    expect(useDataStore.getState().labReferrers.find((x) => x.id === referrerId)!.isActive).toBe(true)
  })

  it('updateLabReferrer يعدّل الهاتف/العمولة بلا مساس بـ isActive', () => {
    const s = useDataStore.getState()
    s.updateLabReferrer(referrerId, { nameAr: 'محيل الاختبار', phone: '0100000000', commissionPercent: 15, notes: '' })
    const r = useDataStore.getState().labReferrers.find((x) => x.id === referrerId)!
    expect(r.phone).toBe('0100000000')
    expect(r.commissionPercent).toBe(15)
    expect(r.isActive).toBe(true)
  })

  it('يرفض طلباً جديداً بمُحيل معطَّل (غير موجود أو معطل)', () => {
    const s = useDataStore.getState()
    s.toggleLabReferrer(referrerId) // عطّله
    expect(() => s.registerLabOrder({
      patientId, referrerId, testIds: [testId], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '',
    })).toThrow(/معطل/)
    useDataStore.getState().toggleLabReferrer(referrerId) // أعد تفعيله لبقية الاختبارات
  })

  it('دورة كاملة: تسجيل طلب ← سحب عينة ← رفضها بسبب ← إعادة سحب ← نتيجة حرجة ← توثيق إبلاغ', () => {
    const s = useDataStore.getState()
    const order = s.registerLabOrder({
      patientId, referrerId, testIds: [testId], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '',
    })
    s.advanceLabTest(order.id, testId, 'collected')
    // رفض بلا سبب يُرفض
    expect(() => s.advanceLabTest(order.id, testId, 'rejected')).toThrow(/سبب/)
    s.advanceLabTest(order.id, testId, 'rejected', undefined, 'انحلال دموي')
    let t = useDataStore.getState().labOrders.find((o) => o.id === order.id)!.tests[0]
    expect(t.status).toBe('rejected')
    expect(t.rejectionReason).toBe('انحلال دموي')

    // إعادة السحب تبدأ دورة جديدة نظيفة
    s.advanceLabTest(order.id, testId, 'pending')
    t = useDataStore.getState().labOrders.find((o) => o.id === order.id)!.tests[0]
    expect(t.status).toBe('pending')
    expect(t.rejectedAt).toBeNull()
    expect(t.rejectionReason).toBe('')

    s.advanceLabTest(order.id, testId, 'collected')
    s.advanceLabTest(order.id, testId, 'resulted', '7.0') // أعلى من criticalHigh=6.5
    t = useDataStore.getState().labOrders.find((o) => o.id === order.id)!.tests[0]
    expect(t.resultFlag).toBe('critical_high')
    expect(t.criticalAckAt ?? null).toBeNull()

    // توثيق الإبلاغ لازم اسم مُستلم
    expect(() => s.acknowledgeCriticalLabResult(order.id, testId, '')).toThrow(/اسم/)
    s.acknowledgeCriticalLabResult(order.id, testId, 'د. سامي', 'أُبلغ هاتفياً')
    t = useDataStore.getState().labOrders.find((o) => o.id === order.id)!.tests[0]
    expect(t.criticalAckAt).not.toBeNull()
    expect(t.criticalAckBy).toBe('د. سامي')

    // بعد التوثيق لا يظهر ضمن التنبيهات غير المُبلَّغة بعد
    expect(criticalUnacknowledgedResults(useDataStore.getState().labOrders)).toHaveLength(0)
  })

  it('acknowledgeCriticalLabResult يرفض فحصاً غير حرج', () => {
    const s = useDataStore.getState()
    const order = s.registerLabOrder({
      patientId, referrerId: null, testIds: [testId], payment: 'cash', discountPercent: 0, vatPercent: 0, notes: '',
    })
    s.advanceLabTest(order.id, testId, 'collected')
    s.advanceLabTest(order.id, testId, 'resulted', '4.0') // داخل النطاق الطبيعي
    expect(() => s.acknowledgeCriticalLabResult(order.id, testId, 'د. سامي')).toThrow(/حرجة/)
  })
})
