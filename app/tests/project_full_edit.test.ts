import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
const original = useRawDataStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => useRawDataStore.setState({ ...original, projects: [], boqItems: [], journal: [], branches: [], activeBranchId: null, currentUserId: null, customers: [], employees: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], projectExtracts: [], clientAdvances: [], changeOrders: [], projectTasks: [], projectCosts: [], subContracts: [] }))
afterEach(() => useRawDataStore.setState(original))
const project = { nameAr: 'مشروع', clientName: '', contractValueMinor: 2000, retentionPercent: 0, startDate: '2026-01-01', notes: '', boqSections: [{ id: 'floor', nameAr: 'الدور الأول' }] }
const line = { code: '1', descriptionAr: 'دهانات', sectionId: 'floor', unit: 'م2', qty: 2, unitPriceMinor: 1000, estCostMinor: 0 }
function setup() {
  const p = S().addProjectWithBoq(project, [line])
  const item = S().boqItems[0]
  const args = { id: p.id, expectedFingerprint: S().previewProjectEditFingerprint(p.id), changes: { nameAr: 'مشروع معدل' }, sections: [{ id: 'floor', nameAr: 'الدور الأرضي' }], lines: [{ ...line, id: item.id, qty: 3 }] }
  return { p, item, args }
}
it('يحفظ البيانات والبنود والقيمة في نشر واحد ويحافظ على هوية البند', () => {
  const { args, item } = setup()
  const observed: [string, number, number][] = []
  const off = useRawDataStore.subscribe(state => observed.push([state.projects[0].nameAr, state.projects[0].contractValueMinor, state.boqItems[0].qty]))
  try {
    S().updateProjectWithBoq(args)
    expect(observed).toEqual([['مشروع معدل', 3000, 3]])
    expect(S().boqItems[0].id).toBe(item.id)
    expect(S().projects[0].boqSections?.[0].nameAr).toBe('الدور الأرضي')
    expect(S().journal).toHaveLength(0)
  } finally { off() }
})
it('يرفض الحصر والأثر المالي والتقدم قبل أي تغيير', () => {
  const { args, p } = setup()
  const before = JSON.stringify([S().projects, S().boqItems])
  useRawDataStore.setState({ projectSurveys: [{ id: 1, projectId: p.id }] as never[] })
  args.expectedFingerprint = S().previewProjectEditFingerprint(p.id)
  expect(() => S().updateProjectWithBoq(args)).toThrow(/حصر/)
  expect(JSON.stringify([S().projects, S().boqItems])).toBe(before)
  useRawDataStore.setState({ projectSurveys: [], projectCosts: [{ id: 1, projectId: p.id }] as never[] })
  args.expectedFingerprint = S().previewProjectEditFingerprint(p.id)
  expect(() => S().updateProjectWithBoq(args)).toThrow(/حركة|مستند/)
  expect(JSON.stringify([S().projects, S().boqItems])).toBe(before)
  useRawDataStore.setState({ projectCosts: [], boqItems: [{ ...S().boqItems[0], progressPercent: 10 }] })
  args.expectedFingerprint = S().previewProjectEditFingerprint(p.id)
  expect(() => S().updateProjectWithBoq(args)).toThrow(/تقدماً/)
})
it('يرفض بصمة قديمة ومعرفات مكررة أو دخيلة دون تحديث البيانات', () => {
  const { args } = setup()
  useRawDataStore.setState({ projects: [{ ...S().projects[0], notes: 'تعديل آخر' }] })
  const before = JSON.stringify([S().projects, S().boqItems])
  expect(() => S().updateProjectWithBoq(args)).toThrow(/تغير/)
  args.expectedFingerprint = S().previewProjectEditFingerprint(args.id)
  expect(() => S().updateProjectWithBoq({ ...args, lines: [args.lines[0], args.lines[0]] })).toThrow(/معرّف/)
  expect(() => S().updateProjectWithBoq({ ...args, lines: [{ ...args.lines[0], id: 987 }] })).toThrow(/معرّف/)
  expect(JSON.stringify([S().projects, S().boqItems])).toBe(before)
})
it('يسمح ببيانات عامة دون تعديل جدول مرتبط بحصر', () => {
  const { args, p, item } = setup()
  useRawDataStore.setState({ projectSurveys: [{ id: 1, projectId: p.id }] as never[] })
  S().updateProjectWithBoq({ ...args, expectedFingerprint: S().previewProjectEditFingerprint(p.id), sections: project.boqSections, lines: [{ ...line, id: item.id }] })
  expect(S().projects[0].nameAr).toBe('مشروع معدل')
  expect(S().boqItems[0]).toEqual(item)
})
it('لا يعيد تسعير عقد تاريخي غير مطابق عند تعديل عنوان القسم ويرفض تغيير كميته', () => {
  const { args, item } = setup()
  useRawDataStore.setState({ projects: [{ ...S().projects[0], contractValueMinor: 2001 }] })
  const fingerprint = S().previewProjectEditFingerprint(args.id)
  expect(() => S().updateProjectWithBoq({ ...args, expectedFingerprint: fingerprint })).toThrow(/لا تطابق/)
  S().updateProjectWithBoq({ ...args, expectedFingerprint: fingerprint, lines: [{ ...line, id: item.id }] })
  expect(S().projects[0].contractValueMinor).toBe(2001)
})
it('يضيف ويحذف بنوداً قبل الأثر مع بقاء المعرفات الأخرى كما هي', () => {
  const { args, item } = setup()
  S().updateProjectWithBoq({ ...args, lines: [{ ...line, id: item.id }, { ...line, code: '2', descriptionAr: 'سباكة', qty: 1 }] })
  expect(S().projects[0].contractValueMinor).toBe(3000)
  expect(S().boqItems.map(row => row.id)).toEqual([item.id, item.id + 1])
  S().updateProjectWithBoq({ ...args, expectedFingerprint: S().previewProjectEditFingerprint(args.id), lines: [{ ...line, id: item.id }] })
  expect(S().projects[0].contractValueMinor).toBe(2000)
  expect(S().boqItems.map(row => row.id)).toEqual([item.id])
})
it('يرفض بنداً من فرع آخر حتى في عرض كل الفروع', () => {
  const { args, p, item } = setup()
  const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
  useRawDataStore.setState({ branches: branches as never, activeBranchId: null, projects: [{ ...p, branchId: 1 }] as never, boqItems: [{ ...item, branchId: 2 }] as never })
  args.expectedFingerprint = S().previewProjectEditFingerprint(p.id)
  const before = JSON.stringify([S().projects, S().boqItems])
  expect(() => S().updateProjectWithBoq(args)).toThrow(/فرع آخر/)
  expect(JSON.stringify([S().projects, S().boqItems])).toBe(before)
})
it('يرفض حقول الهوية والصلاحية في وقت التشغيل', () => {
  const { args } = setup()
  const before = JSON.stringify([S().projects, S().boqItems])
  expect(() => S().updateProjectWithBoq({ ...args, changes: { ...args.changes, status: 'completed' } as never })).toThrow(/حقل/)
  expect(() => S().updateProjectWithBoq({ ...args, lines: [{ ...args.lines[0], projectId: 999 }] as never })).toThrow(/حقل/)
  useRawDataStore.setState({ currentUserId: 987 })
  expect(() => S().updateProjectWithBoq({ ...args, expectedFingerprint: S().previewProjectEditFingerprint(args.id) })).toThrow(/صلاحية/)
  expect(JSON.stringify([S().projects, S().boqItems])).toBe(before)
})
it('لا يغير القيمة المستمدة من عرض فائز ويتيح وصفاً لا يغير السعر أو الكمية', () => {
  const { args, item } = setup()
  useRawDataStore.setState({ quotations: [{ id: 10, projectId: args.id, status: 'won' }] as never[] })
  const expectedFingerprint = S().previewProjectEditFingerprint(args.id)
  expect(() => S().updateProjectWithBoq({ ...args, expectedFingerprint })).toThrow(/عرض فائز/)
  S().updateProjectWithBoq({ ...args, expectedFingerprint, lines: [{ ...line, id: item.id, descriptionAr: 'دهانات داخلية' }] })
  expect(S().projects[0].contractValueMinor).toBe(2000)
})
