import { afterEach, beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, currentUserId: null, customers: [], projects: [], boqItems: [], projectExtracts: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], approvalRequests: [] } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
function setup(qty = 1000, price = 100) {
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = S().customers.at(-1)!
  const project = S().addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: Math.round(qty * price), retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const boq = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'دهانات', unit: 'م2', qty, unitPriceMinor: price })
  return { project, boq }
}
function measured(projectId: number, boqId: number, cumulativeQty: number, isFinal = false, acceptEstimatedPrior = false) {
 return S().addProjectExtract({ projectId, description: 'حصر', payment: 'credit', vatPercent: 0, isFinal, extractQtyLines: [{ boqItemId: boqId, cumulativeQty }], acceptEstimatedPrior } as never)
}
it('يحفظ 200 ثم 856 تراكمي بدقة، ويقيد فرق 656 فقط ويمنع مستخلصاً بعد الختامي', () => {
 const { project, boq } = setup()
 const first = measured(project.id, boq.id, 200)
 expect(first.totals.grossMinor).toBe(20000)
 expect(first.lines?.[0]).toMatchObject({ prevExecutedQty: 0, newExecutedQty: 200, newProgressPercent: 20 })
 const final = measured(project.id, boq.id, 856, true)
 expect(final.totals.grossMinor).toBe(65600)
 expect(final.lines?.[0]).toMatchObject({ prevExecutedQty: 200, newExecutedQty: 856, newProgressPercent: 85.6 })
 expect(S().journal).toHaveLength(2)
 expect(() => measured(project.id, boq.id, 900)).toThrow(/الختامي/)
})
it('يرفض التراجع والتجاوز والدقة غير المدعومة دون أي قيد جديد', () => {
 const { project, boq } = setup()
 measured(project.id, boq.id, 200)
 const before = S()
 for (const qty of [199, 1001, 200.0001, NaN]) expect(() => measured(project.id, boq.id, qty)).toThrow()
 expect(S().journal).toBe(before.journal)
 expect(S().projectExtracts).toBe(before.projectExtracts)
})
it('السابق المحسوب من نسبة قديمة تقديري ولا يقبل بغير موافقة واضحة', () => {
 const { project, boq } = setup()
 S().addProjectExtract({ projectId: project.id, description: 'قديم', payment: 'credit', vatPercent: 0, extractLines: [{ boqItemId: boq.id, newProgressPercent: 20 }] })
 expect(() => measured(project.id, boq.id, 856)).toThrow(/تقدير|نسبة/)
 const next = measured(project.id, boq.id, 856, false, true)
 expect(next.totals.grossMinor).toBe(65600)
 expect(next.lines?.[0]).toMatchObject({ prevExecutedQty: 200, newExecutedQty: 856, previousQtyEstimated: true })
})
it('تعديل المستخلص بالكميات يعيد بناء القيد، ويرفض إسقاط دليل الحصر أو تعديل سابق له لاحق', () => {
 const { project, boq } = setup()
 const first = measured(project.id, boq.id, 200)
 const args = { extractId: first.id, description: 'تصحيح', payment: 'credit', vatPercent: 0, reason: 'حصر مصحح' } as const
 expect(() => S().editProjectExtract({ ...args, extractLines: [{ boqItemId: boq.id, newProgressPercent: 30 }] })).toThrow(/الكمية|الحصر/)
 const edited = S().editProjectExtract({ ...args, extractQtyLines: [{ boqItemId: boq.id, cumulativeQty: 250 }] } as never)
 expect(edited.lines?.[0]).toMatchObject({ prevExecutedQty: 0, newExecutedQty: 250 })
 expect(edited.totals.grossMinor).toBe(25000)
 measured(project.id, boq.id, 500)
 expect(() => S().editProjectExtract({ ...args, extractQtyLines: [{ boqItemId: boq.id, cumulativeQty: 300 }] } as never)).toThrow(/الأحدث/)
})
it('مستخلص إجمالي سابق لا يُوزع على بنود بأثر رجعي', () => {
 const { project, boq } = setup()
 S().addProjectExtract({ projectId: project.id, description: 'إجمالي قديم', payment: 'credit', vatPercent: 0, grossMinor: 1000 })
 expect(() => measured(project.id, boq.id, 200)).toThrow(/إجمالي سابق/)
})
it('تراكم كسور سعر الوحدة لا يضاعف أثر التقريب', () => {
 const { project, boq } = setup(1, 3)
 const first = measured(project.id, boq.id, 0.5)
 const second = measured(project.id, boq.id, 1, true)
 expect(first.totals.grossMinor + second.totals.grossMinor).toBe(3)
})
it('يرفض الحصر إذا تغير السابق بين المعاينة والترحيل', () => {
 const { project, boq } = setup()
 measured(project.id, boq.id, 200)
 const stale = { boqItemId: boq.id, cumulativeQty: 856, expectedPreviousQty: 0, expectedPreviouslyBilledMinor: 0, expectedContractQty: 1000, expectedUnitPriceMinor: 100 }
 const before = S()
 expect(() => S().addProjectExtract({ projectId: project.id, description: '', payment: 'credit', vatPercent: 0, extractQtyLines: [stale] })).toThrow(/تغير حصر/)
 expect(S().journal).toBe(before.journal)
})
it('يرفض تاريخاً فسدت قيمته أو قيده وتغيير سعر بند مستخلص حتى لو أعيد تقدمه يدوياً', () => {
 const { project, boq } = setup()
 measured(project.id, boq.id, 200)
 S().updateBoqProgress(boq.id, 0)
 expect(() => S().updateBoqItem(boq.id, { qty: 900 })).toThrow(/الكمية|السعر/)
 const old = S().projectExtracts[0]
 useRawDataStore.setState({ projectExtracts: [{ ...old, lines: old.lines!.map(line => ({ ...line, lineValueMinor: line.lineValueMinor + 1 })) }] })
 const before = S()
 expect(() => measured(project.id, boq.id, 856)).toThrow(/مجموع بنود/)
 expect(S().journal).toBe(before.journal)
 useRawDataStore.setState({ projectExtracts: [old], journal: [] })
 expect(() => measured(project.id, boq.id, 856)).toThrow()
})
it('يرفض دليل كمية سابقاً لا يتسلسل مع الذي قبله', () => {
 const { project, boq } = setup()
 measured(project.id, boq.id, 200)
 const old = S().projectExtracts[0]
 useRawDataStore.setState({ projectExtracts: [{ ...old, lines: old.lines!.map(line => ({ ...line, prevExecutedQty: 10 })) }] })
 expect(() => measured(project.id, boq.id, 856)).toThrow(/تسلسل كميات/)
})
it('لا يحفظ سطر كمية لم يتغير عند تقدير سابق لا يُمثل النسبة تماماً', () => {
 const { project, boq } = setup(3, 100)
 const second = S().addBoqItem({ projectId: project.id, code: '2', descriptionAr: 'عمل آخر', unit: 'م', qty: 2, unitPriceMinor: 100 })
 S().addProjectExtract({ projectId: project.id, description: 'قديم', payment: 'credit', vatPercent: 0, extractLines: [{ boqItemId: boq.id, newProgressPercent: 33.33 }] })
 // زيادة سقف العقد تغطي البند الإضافي في هذا المثال
 useRawDataStore.setState({ projects: S().projects.map(p => ({ ...p, contractValueMinor: 500 })) })
 const ex = S().addProjectExtract({ projectId: project.id, description: 'حصر', payment: 'credit', vatPercent: 0, acceptEstimatedPrior: true, extractQtyLines: [{ boqItemId: boq.id, cumulativeQty: 1 }, { boqItemId: second.id, cumulativeQty: 1 }] })
 expect(ex.lines?.map(line => line.boqItemId)).toEqual([second.id])
})
