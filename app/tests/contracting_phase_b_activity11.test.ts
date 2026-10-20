/**
 * اختبارات سد فجوات النشاط #11 (مقاولات وإنشاءات) — مرحلة ب:
 *  1) حد مالي اختياري لمسار الموافقات (ApprovalFlow.thresholdMinor) + pendingApprovalAging —
 *     سد التضارب بين دليل الشاشة («مستخلص فوق 200,000 ج.م يمر على مدير المشروع») والتنفيذ
 *     الفعلي الذي كان لا يعرف حدوداً مالية إطلاقاً.
 *  2) retentionReleaseDueDate / retentionDueWarnings / bondComplianceWarnings — لا تتبع كان
 *     موجوداً لفترة الضمان بعد التسليم ولا وصول مركزي لتنبيهات الضمان/الموازنة/الاعتمادات المعلّقة.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  retentionReleaseDueDate,
  retentionDueWarnings,
  bondComplianceWarnings,
  type Project,
} from '../src/core/contracting.ts'
import { pendingApprovalAging, type ApprovalRequest } from '../src/core/projectOps.ts'
import { collectNotifications } from '../src/core/notifications.ts'

describe('سد فجوة النشاط #11 — retentionReleaseDueDate', () => {
  it('null بلا تاريخ تسليم أو بلا فترة ضمان', () => {
    expect(retentionReleaseDueDate({ actualHandoverDate: null, defectsLiabilityMonths: 12 })).toBeNull()
    expect(retentionReleaseDueDate({ actualHandoverDate: '2026-01-01', defectsLiabilityMonths: null })).toBeNull()
    expect(retentionReleaseDueDate({ actualHandoverDate: '2026-01-01', defectsLiabilityMonths: 0 })).toBeNull()
  })
  it('يضيف فترة الضمان بالشهور لتاريخ التسليم الفعلي', () => {
    expect(retentionReleaseDueDate({ actualHandoverDate: '2026-01-15', defectsLiabilityMonths: 6 })).toBe('2026-07-15')
  })
})

describe('سد فجوة النشاط #11 — retentionDueWarnings', () => {
  const projects: Pick<Project, 'id' | 'nameAr' | 'actualHandoverDate' | 'defectsLiabilityMonths'>[] = [
    { id: 1, nameAr: 'مشروع أ (مستحق قريباً)', actualHandoverDate: '2026-10-01', defectsLiabilityMonths: 1 }, // يستحق 2026-11-01
    { id: 2, nameAr: 'مشروع ب (بلا محتجز متبقٍ)', actualHandoverDate: '2026-09-01', defectsLiabilityMonths: 1 },
    { id: 3, nameAr: 'مشروع ج (لا تسليم بعد)', actualHandoverDate: null, defectsLiabilityMonths: 6 },
    { id: 4, nameAr: 'مشروع د (بعيد الاستحقاق)', actualHandoverDate: '2026-01-01', defectsLiabilityMonths: 24 },
  ]
  const remaining = (id: number) => ({ 1: 50000, 2: 0, 3: 10000, 4: 30000 } as Record<number, number>)[id] ?? 0

  it('يضم المشروع المستحق قريباً فقط — يستبعد بلا محتجز وبلا تسليم وبعيد الاستحقاق', () => {
    const warnings = retentionDueWarnings(projects, remaining, '2026-10-15T00:00:00Z', 30)
    const ids = warnings.map((w) => w.projectId)
    expect(ids).toContain(1)
    expect(ids).not.toContain(2) // لا محتجز متبقٍ
    expect(ids).not.toContain(3) // لا تاريخ تسليم
    expect(ids).not.toContain(4) // الاستحقاق بعيد (2027)
    const w1 = warnings.find((w) => w.projectId === 1)!
    expect(w1.dueDate).toBe('2026-11-01')
    expect(w1.remainingRetentionMinor).toBe(50000)
    expect(w1.daysLeft).toBeGreaterThanOrEqual(0)
  })
})

describe('سد فجوة النشاط #11 — bondComplianceWarnings', () => {
  const bonds = [
    { id: 1, bondNumber: 'BND-0001', status: 'active', expiryDate: '2026-10-20' },
    { id: 2, bondNumber: 'BND-0002', status: 'active', expiryDate: '2026-08-01' },
    { id: 3, bondNumber: 'BND-0003', status: 'released', expiryDate: '2026-08-01' },
    { id: 4, bondNumber: 'BND-0004', status: 'active', expiryDate: '2027-06-01' },
  ]
  it('يضم النشط القريب والمنتهي فقط — يستبعد المُفرَج عنه والبعيد', () => {
    const warnings = bondComplianceWarnings(bonds, '2026-10-15T00:00:00Z', 30)
    const ids = warnings.map((w) => w.bondId)
    expect(ids).toContain(1)
    expect(ids).toContain(2)
    expect(ids).not.toContain(3)
    expect(ids).not.toContain(4)
    expect(warnings.find((w) => w.bondId === 2)!.daysLeft).toBeLessThan(0)
  })
})

describe('سد فجوة النشاط #11 — pendingApprovalAging', () => {
  const requests: ApprovalRequest[] = [
    { id: 1, action: 'project_extract', subject: 'مستخلص قديم معلّق', refId: 1, createdAt: '2026-10-05T00:00:00Z', status: 'pending', currentStep: 0, consumedAt: null, decisions: [] },
    { id: 2, action: 'material_requisition', subject: 'إذن صرف حديث', refId: 2, createdAt: '2026-10-14T00:00:00Z', status: 'pending', currentStep: 0, consumedAt: null, decisions: [] },
    { id: 3, action: 'sub_certificate', subject: 'شهادة محسومة', refId: 3, createdAt: '2026-10-01T00:00:00Z', status: 'approved', currentStep: 0, consumedAt: null, decisions: [] },
  ]
  it('يضم المعلّق المتجاوز للمهلة فقط — يستبعد الحديث والمحسوم', () => {
    const aging = pendingApprovalAging(requests, '2026-10-15T00:00:00Z', 3)
    const ids = aging.map((a) => a.requestId)
    expect(ids).toEqual([1]) // 10 أيام تجاوزت المهلة؛ الحديث (يوم واحد) لم يتجاوز
  })
})

describe('سد فجوة النشاط #11 — تكامل جرس التنبيهات المركزي', () => {
  const fmt = (m: number) => `${(m / 100).toFixed(2)} ج.م`
  it('يُنتج تنبيهات بالأيقونات والمسارات الصحيحة للأربع فئات الجديدة', () => {
    const out = collectNotifications({
      batches: [], itemName: () => '', installmentPlans: [], customerName: () => '', cheques: [],
      complianceDueBonds: [{ bondId: 1, bondNumber: 'BND-0001', dueDate: '2026-10-20', daysLeft: 5 }],
      projectBudgetOverruns: [{ projectId: 1, projectNameAr: 'مشروع أ', kindAr: 'مواد', overrunMinor: 400000 }],
      pendingApprovalsAging: [{ requestId: 1, subject: 'مستخلص معلّق', actionLabel: 'إصدار مستخلص عميل', daysPending: 10 }],
      retentionDueProjects: [{ projectId: 1, projectNameAr: 'مشروع أ', dueDate: '2026-11-01', daysLeft: 5, remainingMinor: 50000 }],
      fmt, todayIso: '2026-10-15T00:00:00Z',
    })
    const bond = out.find((n) => n.id.startsWith('bondcompl:'))!
    expect(bond.route).toBe('/contracting/bonds')
    expect(bond.severity).toBe('warn')
    const budget = out.find((n) => n.id.startsWith('prjbudget:'))!
    expect(budget.route).toBe('/contracting/budget')
    expect(budget.severity).toBe('danger')
    expect(budget.body).toContain('مواد')
    const aging = out.find((n) => n.id.startsWith('apprage:'))!
    expect(aging.route).toBe('/contracting/approvals')
    expect(aging.severity).toBe('danger') // 10 أيام ≥ 7
    const retention = out.find((n) => n.id.startsWith('retdue:'))!
    expect(retention.route).toBe('/contracting/projects')
    expect(retention.severity).toBe('warn')
  })
})

describe('سد فجوة النشاط #11 — الحد المالي للاعتماد عبر المتجر الحقيقي', () => {
  let useDataStore: typeof import('../src/data/repo.ts').useDataStore
  let projectId = 0

  beforeAll(async () => {
    localStorage.clear()
    ;({ useDataStore } = await import('../src/data/repo.ts'))
    const { useAppStore } = await import('../src/stores/app.store.ts')
    const app = useAppStore.getState()
    useAppStore.setState({
      ...app,
      setup: {
        ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting', shopName: 'مقاولات الاختبار',
        ownerName: 'المالك', features: [], modules: ['contracting'], accountingMode: 'full',
        vatPercent: 0, taxRegistrationStatus: 'not_registered', allowNegativeTreasury: true,
      },
    })
    const s = useDataStore.getState()
    const p = s.addProject({
      nameAr: 'مشروع الاختبار', clientName: 'عميل الاختبار', clientId: null,
      contractValueMinor: 100_000_00, retentionPercent: 5, startDate: '2026-01-01', notes: '',
    })
    projectId = p.id
  })

  it('بلا مسار نشط: المستخلص يمر حراً بأي قيمة', () => {
    const s = useDataStore.getState()
    const extract = s.addProjectExtract({ projectId, grossMinor: 10_000_00, vatPercent: 0, payment: 'cash', description: 'مستخلص 1', treasury: '1101' })
    expect(extract.totals.grossMinor).toBe(10_000_00)
  })

  it('مسار نشط بحد مالي 50,000: دون الحد يمر حراً، وعنده أو فوقه يتطلب اعتماداً', () => {
    const s = useDataStore.getState()
    s.setApprovalFlow('project_extract', [{ roleAr: 'مدير المشروع', employeeId: null }], true, 50_000_00)

    // دون الحد — يمر حراً بلا طلب اعتماد
    const small = s.addProjectExtract({ projectId, grossMinor: 5_000_00, vatPercent: 0, payment: 'cash', description: 'مستخلص صغير', treasury: '1101' })
    expect(small.totals.grossMinor).toBe(5_000_00)

    // عند الحد أو فوقه — يُرفض بلا اعتماد مكتمل
    expect(() => s.addProjectExtract({ projectId, grossMinor: 60_000_00, vatPercent: 0, payment: 'cash', description: 'مستخلص كبير', treasury: '1101' }))
      .toThrow(/يتطلب اعتماداً مكتملاً/)

    // بعد طلب واعتماد — ينفذ بنجاح ويُستهلك الاعتماد
    const req = s.requestApproval('project_extract', 'مستخلص كبير', projectId)
    s.decideApproval(req.id, 'approved', 'المالك')
    const big = s.addProjectExtract({ projectId, grossMinor: 60_000_00, vatPercent: 0, payment: 'cash', description: 'مستخلص كبير', treasury: '1101' })
    expect(big.totals.grossMinor).toBe(60_000_00)

    // الاعتماد استُهلك — محاولة ثانية بنفس القيمة الكبيرة تُرفض مجدداً
    expect(() => s.addProjectExtract({ projectId, grossMinor: 60_000_00, vatPercent: 0, payment: 'cash', description: 'مستخلص كبير آخر', treasury: '1101' }))
      .toThrow(/يتطلب اعتماداً مكتملاً/)
  })

  it('مسار نشط بلا حد مالي (null): الاعتماد مطلوب لكل مستخلص دون استثناء (التوافق الرجعي)', () => {
    const s = useDataStore.getState()
    s.setApprovalFlow('material_requisition', [{ roleAr: 'مدير المشروع', employeeId: null }], true, null)
    s.addEmployee({ nameAr: 'أمين المخزن', phone: '', roleId: 'cashier', salaryMinor: 500000, active: true } as never)
    s.addEmployee({ nameAr: 'مهندس الموقع', phone: '', roleId: 'cashier', salaryMinor: 500000, active: true } as never)
    const [issuer, receiver] = useDataStore.getState().employees
    useDataStore.getState().addItem({ nameAr: 'أسمنت', sku: 'CEM1', barcodes: [], categoryId: 0, baseUnit: 'شيكارة', costMinor: 12000, stockQty: 1000, priceMinor: 15000, minQty: 0 } as never)
    const item = useDataStore.getState().items[0]

    // حتى بمبلغ ضئيل — الاعتماد مطلوب لأن الحد null
    expect(() => useDataStore.getState().issueMaterials({
      projectId, issuedByEmployeeId: issuer.id, receivedByEmployeeId: receiver.id,
      lines: [{ itemId: item.id, qty: 1, unitAr: '' }], notes: '',
    })).toThrow(/يتطلب اعتماداً مكتملاً/)
  })
})
