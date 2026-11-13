import { afterEach, beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { renderCloseoutHtml } from '../src/ui/print/printCloseout.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', activityId: 'contracting', modules: ['contracting'] } as never })
 useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, currentUserId: null, customers: [], projects: [], boqItems: [], projectSurveys: [], projectCloseouts: [], projectExtractDrafts: [], projectExtracts: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], approvalRequests: [], changeOrders: [] } as never)
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app) })
function setup() {
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 const p = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 100000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 const b = S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 1000, unitPriceMinor: 100 })
 return { p, b }
}
const issue = (id: number, rev: number, confirmed = true) => S().issueProjectCloseout({ projectId: id, expectedRevision: rev, notes: '<ملاحظة>', confirmed })
const extract = (p: number, b: number, qty: number) => S().addProjectExtract({ projectId: p, description: 'سابق', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: b, cumulativeQty: qty }] })
const finalSurvey = (p: number, b: number, qty: number, revision: number) => S().saveProjectSurvey({ projectId: p, lines: [{ boqItemId: b, cumulativeQty: qty }], expectedRevision: revision, reason: '', isFinal: true })
it('محضر ختامي مطابق 856 لا ينشئ مستخلصاً صفرياً ولا يغير القيد أو حالة المشروع', () => {
 const { p, b } = setup(); extract(p.id, b.id, 856); finalSurvey(p.id, b.id, 856, 0)
 const before = S(); expect(() => issue(p.id, 2, false)).toThrow(/أكد/)
 const c = issue(p.id, 1)
 expect(c.lines[0]).toMatchObject({ contractQty: 1000, executedQty: 856, billedQty: 856, remainingQty: 144, billedMinor: 85600 })
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().projects).toBe(before.projects)
 expect(S().isProjectCloseoutCurrent(c.id)).toBe(true)
 expect(() => issue(p.id, 1)).toThrow(/بالفعل/)
 const html = renderCloseoutHtml({ record: c, shopName: '<منشأة>', current: true, currency: 'ج', fmt: String })
 expect(html).toContain('@page{size:A4 landscape'); expect(html).toContain('&lt;منشأة&gt;'); expect(html).toContain('&lt;ملاحظة&gt;'); expect(html).toContain('براءة الذمة')
})
it('يرفض دون حصر ختامي، ومع فرق غير مستخلص، أو مستخلص بلا أساس مالي سليم', () => {
 const { p, b } = setup(); extract(p.id, b.id, 200)
 expect(() => issue(p.id, 1)).toThrow(/حصر المشروع/)
 finalSurvey(p.id, b.id, 300, 0)
 expect(() => issue(p.id, 1)).toThrow(/لا يطابق/)
 expect(S().projectCloseouts).toHaveLength(0)
})
it('يحفظ نسخة تاريخية ويعلّمها غير مطابقة إذا تغير الحصر أو القيد', () => {
 const { p, b } = setup(); const e = extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0); const c = issue(p.id, 1)
 const snapshot = JSON.parse(JSON.stringify(c))
 useRawDataStore.setState({ journal: S().journal.map(j => j.id === e.journalEntryId ? { ...j, lines: [] } : j) })
 expect(S().isProjectCloseoutCurrent(c.id)).toBe(false)
 expect(S().projectCloseouts[0]).toEqual(snapshot)
 expect(renderCloseoutHtml({ record: c, shopName: 'منشأة', current: false, currency: '', fmt: String })).toContain('نسخة تاريخية')
})
it('يمنع الصلاحية والفرع ويعزل المحاضر', () => {
 const { p, b } = setup(); extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0); const c = issue(p.id, 1)
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 2, projects: S().projects.map(row => ({ ...row, branchId: 1 })) as never, projectCloseouts: [{ ...c, branchId: 1 }] })
 expect(useDataStore.getState().projectCloseouts).toHaveLength(0); expect(S().isProjectCloseoutCurrent(c.id)).toBe(false); expect(() => issue(p.id, 1)).toThrow()
})
it('دمج سطح المكتب يرفض محضراً تزامن مع تعديل الحصر أو القيد في الاتجاهين', () => {
 const snap = (state: object) => JSON.stringify({ state })
 const baseState = { projectCloseouts: [], projectSurveys: [{ id: 1, projectId: 1, qty: 100 }], projectExtracts: [{ id: 7, projectId: 1 }], journal: [{ id: 10, sourceType: 'project_extract', sourceId: 7, lines: [1] }] }
 const base = snap(baseState), issue = snap({ ...baseState, projectCloseouts: [{ id: 1, projectId: 1, basis: 'a' }] })
 for (const changed of [snap({ ...baseState, projectSurveys: [{ id: 1, projectId: 1, qty: 200 }] }), snap({ ...baseState, journal: [{ id: 10, sourceType: 'project_extract', sourceId: 7, lines: [2] }] })]) {
  expect(() => mergeConcurrentSnapshots(base, issue, changed)).toThrow(/تعارض/)
  expect(() => mergeConcurrentSnapshots(base, changed, issue)).toThrow(/تعارض/)
 }
})
it('المستودع يفرض الصلاحية حتى عند استدعائه مباشرة', () => {
 const { p, b } = setup(); extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0)
 useRawDataStore.setState({ currentUserId: 20, appUsers: [{ id: 20, nameAr: 'كاشير', roleId: 'cashier', active: true, pinHash: '' }] })
 const before = S(); expect(() => issue(p.id, 1)).toThrow(/صلاحية/); expect(S()).toBe(before)
})
it('يرفض مستخلصاً تقديرياً أو غير مطابق لمبلغ بنده حتى لو تطابقت الكميات', () => {
 const { p, b } = setup(); extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0)
 const originalExtracts = S().projectExtracts
 useRawDataStore.setState({ projectExtracts: originalExtracts.map(e => ({ ...e, lines: e.lines?.map(l => ({ ...l, previousQtyEstimated: true })) })) })
 expect(() => issue(p.id, 1)).toThrow(/تقديرية/)
 expect(S().projectCloseouts).toHaveLength(0)
})
it('مراجعة الحصر تغيّر صلاحية المحضر السابق ويُسمح بمحضر جديد بعد فحص الأساس', () => {
 const { p, b } = setup(); extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0); const old = issue(p.id, 1)
 finalSurvey(p.id, b.id, 200, 1)
 expect(S().isProjectCloseoutCurrent(old.id)).toBe(false)
 const fresh = issue(p.id, 2)
 expect(fresh.id).not.toBe(old.id); expect(S().projectCloseouts).toHaveLength(2); expect(S().isProjectCloseoutCurrent(fresh.id)).toBe(true)
})
it('لا يسمح بمسودة مستخلص معلقة أو رقم مراجعة متقادم عند إصدار المحضر', () => {
 const { p, b } = setup(); extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0)
 expect(() => issue(p.id, 2)).toThrow(/تغير الحصر/)
 useRawDataStore.setState({ projectExtractDrafts: [{ id: p.id, projectId: p.id }] as never })
 expect(() => issue(p.id, 1)).toThrow(/مسودة/)
})
it('الدمج يرفض محضرين مكررين لأساس المشروع', () => {
 const snap = (state: object) => JSON.stringify({ state })
 const base = snap({ projectCloseouts: [] })
 expect(() => mergeConcurrentSnapshots(base, snap({ projectCloseouts: [{ id: 1, projectId: 1, basis: 'x' }] }), snap({ projectCloseouts: [{ id: 2, projectId: 1, basis: 'x' }] }))).toThrow(/مكرر/)
})
it('يتحقق من القيمة المستخلصة لكل بند وليس الكمية فقط', async () => {
 const { closeoutLines } = await import('../src/core/projectCloseout.ts')
 const { p, b } = setup(); extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0)
 const altered = S().projectExtracts.map(e => ({ ...e, lines: e.lines?.map(line => ({ ...line, lineValueMinor: line.lineValueMinor + 1 })) }))
 expect(() => closeoutLines(S().projectSurveys[0], [b], altered)).toThrow(/قيمة البند/)
})
it('يستعيد المحضر وكمياته من نسخة احتياطية عبر التخزين المشفر في بيئة الاختبار', async () => {
 const { secureStorage, flushSecureStorageWrites } = await import('../src/data/secureStorage.ts')
 const { buildBackup, parseBackup } = await import('../src/core/backup.ts')
 const { p, b } = setup(); extract(p.id, b.id, 856); finalSurvey(p.id, b.id, 856, 0); const c = issue(p.id, 1)
 await flushSecureStorageWrites('shopsys-data')
 const stored = await secureStorage.getItem('shopsys-data')
 const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 25, shopName: 'اختبار' })
 const restored = parseBackup(JSON.stringify(backup))
 useRawDataStore.setState({ projectCloseouts: [], projectSurveys: [], projectExtracts: [], journal: [] })
 await flushSecureStorageWrites('shopsys-data')
 await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
 await useRawDataStore.persist.rehydrate()
 expect(S().projectCloseouts).toContainEqual(c)
 expect(S().isProjectCloseoutCurrent(c.id)).toBe(true)
})
it('لا يصدر محضر كميات بعد فقد أمر الزيادة المرتبط بشريحته', () => {
 const { p, b } = setup()
 const order = S().addChangeOrder({ projectId: p.id, titleAr: 'زيادة', amountMinor: 1000, quantityChange: { originalBoqItemId: b.id, qty: 10 } })
 S().setChangeOrderStatus(order.id, 'approved')
 extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0)
 useRawDataStore.setState({ changeOrders: [] })
 expect(() => issue(p.id, 1)).toThrow(/شريحة كميات بلا أمر/)
 expect(S().projectCloseouts).toHaveLength(0)
})

it('مرتجع بعد المستخلص الختامي يجعل محضر الكميات تاريخياً ولا يسمح بمحضر جديد دون معالجة المرتجع', () => {
 const { p, b } = setup()
 const first = extract(p.id, b.id, 200)
 S().addProjectExtract({ projectId: p.id, description: 'ختامي', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: b.id, cumulativeQty: 1000 }], isFinal: true })
 finalSurvey(p.id, b.id, 1000, 0)
 const record = issue(p.id, 1)
 expect(S().isProjectCloseoutCurrent(record.id)).toBe(true)
 const before = S().projectCloseouts[0]
 S().refundProjectExtract({ extractId: first.id, quantities: [{ boqItemId: b.id, qty: 1 }], amountMinor: 100, mode: 'customer_credit', reason: 'إشعار بعد الختامي' })
 expect(S().projectCloseouts[0]).toEqual(before)
 expect(S().isProjectCloseoutCurrent(record.id)).toBe(false)
 expect(() => issue(p.id, 1)).toThrow(/مرتجع/)
 expect(() => extract(p.id, b.id, 1000)).toThrow(/ختامي/)
 expect(S().projectCloseouts).toHaveLength(1)
})

it('تغيير تعريف المشروع داخل نسخة المحضر لا يُعرض كمطابق رغم سلامة أساس الكميات', () => {
 const { p, b } = setup(); extract(p.id, b.id, 200); finalSurvey(p.id, b.id, 200, 0); const original = issue(p.id, 1)
 for (const changed of [{ projectCode: 'PRJ-OTHER' }, { projectName: 'مشروع آخر' }, { clientName: 'عميل آخر' }]) {
  useRawDataStore.setState({ projectCloseouts: [{ ...original, ...changed }] })
  expect(S().isProjectCloseoutCurrent(original.id)).toBe(false)
 }
 useRawDataStore.setState({ projectCloseouts: [original] })
 expect(S().isProjectCloseoutCurrent(original.id)).toBe(true)
})

it('دمج سطح المكتب يحمي المحضر القديم من الحذف أو تعديل بياناته، ويسمح بإضافة محضر جديد', () => {
 const snap = (state: object) => JSON.stringify({ state })
 const record = { id: 1, projectId: 1, basis: 'a', projectName: 'مشروع', notes: 'أصلي' }
 const initial = { projectCloseouts: [record], projects: [{ id: 1, name: 'مشروع' }] }
 const base = snap(initial)
 const unrelated = snap({ ...initial, projects: [{ id: 1, name: 'تغيير مستقل' }] })
 for (const tampered of [snap({ ...initial, projectCloseouts: [] }), snap({ ...initial, projectCloseouts: [{ ...record, notes: 'معدل' }] })]) {
  expect(() => mergeConcurrentSnapshots(base, tampered, unrelated)).toThrow(/محضر/)
  expect(() => mergeConcurrentSnapshots(base, unrelated, tampered)).toThrow(/محضر/)
 }
 const added = snap({ ...initial, projectCloseouts: [record, { id: 2, projectId: 2, basis: 'b' }] })
 const merged = JSON.parse(mergeConcurrentSnapshots(base, added, unrelated))
 expect(merged.state.projectCloseouts).toEqual([record, { id: 2, projectId: 2, basis: 'b' }])
 expect(merged.state.projects[0].name).toBe('تغيير مستقل')
})
